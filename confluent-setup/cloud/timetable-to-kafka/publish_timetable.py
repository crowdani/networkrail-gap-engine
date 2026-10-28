#!/usr/bin/env python3
"""
publish_timetable.py - load Network Rail timetable data straight into Confluent
Cloud topics, with no PostgreSQL in between.

Replaces, for the Confluent Cloud / Flink deployment:

    timetable/load_corpus.py + load_cif_json_fast.py   (files -> PostgreSQL)
  + cloud/connectors.sh  jdbc-tiploc-reference         (PostgreSQL -> NR_TIPLOC_REFERENCE)
  + cloud/connectors.sh  jdbc-active-schedule          (PostgreSQL -> NR_ACTIVE_SCHEDULE)

with a single step:   Network Rail files -> NR_TIPLOC_REFERENCE / NR_ACTIVE_SCHEDULE

The records have the same key and the same JSON field names as the JDBC
connectors produced, so flink-cloud/01-reference-tables.sql (and the ksqlDB
pipeline) read them unchanged.

  NR_TIPLOC_REFERENCE   key = STANOX          value = {stanox, tiploc, three_alpha, station_name}
  NR_ACTIVE_SCHEDULE    key = SERVICE_CODE    value = {cif_train_uid, ..., tiploc_array, stanox_array, timing_data}

What gets published
-------------------
* TIPLOC: one record per STANOX (the same choice as the active_locations view:
  a location with a 3-alpha code wins, then alphabetical TIPLOC).
* Schedules: only schedules that RUN ON --date (default: today, UK time), one
  record per SERVICE_CODE.  Where several schedules share a service code the
  highest STP priority wins (C > O > N > P) and, within the same priority, the
  one later in the CIF file wins.  This is what the connector query
  (WHERE running today ... ORDER BY stp) + the compacted topic produced.

Record timestamps
-----------------
Kafka record timestamps are set to the start of --date (UK time) rather than
"now".  Flink joins movements to reference data by event time
(FOR SYSTEM_TIME AS OF), so a reference row must not be *newer* than the
movements that use it.  Stamping it at the start of the day means movements
from that day - including ones replayed later - join to that day's timetable,
and tomorrow's run is a strictly newer version.

Environment
-----------
  CONFLUENT_BOOTSTRAP_SERVERS   e.g. pkc-xxxxx.eu-west-2.aws.confluent.cloud:9092   (required)
  CONFLUENT_CLOUD_API_KEY       Kafka API key     (same variable as cloud/*.sh)    (required for SASL)
  CONFLUENT_CLOUD_API_SECRET    Kafka API secret                                   (required for SASL)
  NETWORK_RAIL_USERNAME         Network Rail data feed login                       (required to download)
  NETWORK_RAIL_PASSWORD
  KAFKA_SECURITY_PROTOCOL       default SASL_SSL; set PLAINTEXT for a local broker
  NR_CORPUS_URL / NR_CIF_URL    override the download URLs (testing)
"""

import argparse
import gzip
import io
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

TOPIC_TIPLOC = "NR_TIPLOC_REFERENCE"
TOPIC_SCHEDULE = "NR_ACTIVE_SCHEDULE"

CORPUS_URL = os.getenv(
    "NR_CORPUS_URL",
    "https://publicdatafeeds.networkrail.co.uk/ntrod/SupportingFileAuthenticate?type=CORPUS",
)
CIF_URL = os.getenv(
    "NR_CIF_URL",
    "https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate"
    "?type=CIF_ALL_FULL_DAILY&day=toc-full",
)

# Same ordering as the connector query:  P, N, O, C ascending, last one wins.
STP_PRIORITY = {"P": 0, "N": 1, "O": 2, "C": 3}


# --------------------------------------------------------------------------- #
# Input
# --------------------------------------------------------------------------- #
def open_binary(source, auth):
    """Return a binary stream for a path or URL.  Gzip is detected by its magic
    bytes, so it works for .gz files, plain files and servers that return gzip
    regardless of Accept-Encoding (Network Rail does)."""
    if source.startswith(("http://", "https://")):
        import requests

        resp = requests.get(
            source,
            auth=auth,
            stream=True,
            timeout=(30, 600),
            headers={"Accept-Encoding": "identity"},
        )
        resp.raise_for_status()
        raw = io.BufferedReader(resp.raw, buffer_size=1024 * 1024)
    else:
        raw = open(source, "rb")
    if raw.peek(2)[:2] == b"\x1f\x8b":
        return gzip.GzipFile(fileobj=raw)
    return raw


def clean(value):
    """Strip; blank -> None."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


# --------------------------------------------------------------------------- #
# CORPUS -> TIPLOC reference
# --------------------------------------------------------------------------- #
def load_corpus(stream):
    """Return (tiploc_to_stanox, stanox_records)."""
    data = json.load(io.TextIOWrapper(stream, encoding="utf-8"))
    rows = data.get("TIPLOCDATA", [])
    print(f"CORPUS: {len(rows):,} location records", flush=True)

    tiploc_to_stanox = {}
    best = {}  # stanox -> (sort_key, record)
    for r in rows:
        stanox = clean(r.get("STANOX"))
        tiploc = clean(r.get("TIPLOC"))
        alpha = clean(r.get("3ALPHA"))
        if tiploc and stanox and tiploc not in tiploc_to_stanox:
            tiploc_to_stanox[tiploc] = stanox
        if not (stanox and tiploc):
            continue
        name = (
            clean(r.get("NLCDESC16"))
            or clean(r.get("NLCDESC"))
            or tiploc
            or stanox
        )
        # active_locations view: ORDER BY three_alpha NULLS LAST, tiploc NULLS LAST
        sort_key = (alpha is None, alpha or "", tiploc)
        rec = {
            "stanox": stanox,
            "tiploc": tiploc,
            "three_alpha": alpha,
            "station_name": name,
        }
        if stanox not in best or sort_key < best[stanox][0]:
            best[stanox] = (sort_key, rec)
    return tiploc_to_stanox, {k: v[1] for k, v in best.items()}


# --------------------------------------------------------------------------- #
# CIF -> active schedules
# --------------------------------------------------------------------------- #
def iter_schedules(stream, run_date, tiploc_to_stanox):
    """Yield schedule records that run on run_date."""
    weekday = run_date.weekday()  # Monday = 0  ->  index into schedule_days_runs
    read = kept = 0
    for line in io.TextIOWrapper(stream, encoding="utf-8", errors="replace"):
        if '"JsonScheduleV1"' not in line:
            continue
        read += 1
        if read % 100000 == 0:
            print(f"  scanned {read:,} schedules, {kept:,} run on {run_date}", flush=True)
        try:
            s = json.loads(line)["JsonScheduleV1"]
            start = date.fromisoformat(s["schedule_start_date"])
            end = date.fromisoformat(s["schedule_end_date"])
        except Exception:
            continue
        if not (start <= run_date <= end):
            continue
        days = s.get("schedule_days_runs") or "0000000"
        if len(days) < 7 or days[weekday] != "1":
            continue

        seg = s.get("schedule_segment") or {}
        service_code = clean(seg.get("CIF_train_service_code"))
        if not service_code:
            continue  # cannot be keyed
        tiplocs, timings = [], []
        for loc in seg.get("schedule_location") or []:
            tip = loc.get("tiploc_code")
            if not tip:
                continue
            tiplocs.append(tip)
            timings.append(
                {
                    "tiploc": tip,
                    "location_type": loc.get("location_type"),
                    "arrival": loc.get("arrival"),
                    "departure": loc.get("departure"),
                    "pass": loc.get("pass"),
                    "public_arrival": loc.get("public_arrival"),
                    "public_departure": loc.get("public_departure"),
                    "platform": loc.get("platform"),
                    "line": loc.get("line"),
                }
            )
        if not tiplocs:
            continue  # e.g. cancellations carry no route; the loader skipped them too

        kept += 1
        yield {
            "cif_train_uid": s.get("CIF_train_uid"),
            "cif_stp_indicator": s.get("CIF_stp_indicator", "P"),
            "schedule_start_date": start.isoformat(),
            "schedule_end_date": end.isoformat(),
            "schedule_days_runs": days,
            "atoc_code": s.get("atoc_code"),
            "train_status": s.get("train_status", "P"),
            "train_category": seg.get("CIF_train_category"),
            "signalling_id": seg.get("signalling_id"),
            "headcode": seg.get("CIF_headcode"),
            "service_code": service_code,
            # JSON *text* inside the JSON record, exactly as the connector sent them
            "tiploc_array": json.dumps(tiplocs, separators=(",", ":")),
            "stanox_array": json.dumps(
                [tiploc_to_stanox.get(t) for t in tiplocs], separators=(",", ":")
            ),
            "timing_data": json.dumps(timings),
            "transaction_type": s.get("transaction_type", "Create"),
            "applicable_timetable": s.get("applicable_timetable", "Y"),
        }
    print(f"CIF: scanned {read:,} schedules, {kept:,} run on {run_date}", flush=True)


def pick_one_per_service_code(records):
    winners = {}
    for rec in records:
        prio = STP_PRIORITY.get(rec["cif_stp_indicator"], 0)
        cur = winners.get(rec["service_code"])
        if cur is None or prio >= cur[0]:
            winners[rec["service_code"]] = (prio, rec)
    return {k: v[1] for k, v in winners.items()}


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
class Publisher:
    def __init__(self, dry_run_dir=None):
        self.dry_run_dir = dry_run_dir
        self.errors = 0
        self.sent = {}
        if dry_run_dir:
            os.makedirs(dry_run_dir, exist_ok=True)
            self.files = {}
            return
        from confluent_kafka import Producer

        proto = os.getenv("KAFKA_SECURITY_PROTOCOL", "SASL_SSL")
        conf = {
            "bootstrap.servers": need("CONFLUENT_BOOTSTRAP_SERVERS"),
            "security.protocol": proto,
            "acks": "all",
            "enable.idempotence": True,
            "compression.type": "lz4",
            "linger.ms": 50,
            "client.id": "nr-timetable-publisher",
        }
        if proto.startswith("SASL"):
            conf.update(
                {
                    "sasl.mechanisms": "PLAIN",
                    "sasl.username": need("CONFLUENT_CLOUD_API_KEY"),
                    "sasl.password": need("CONFLUENT_CLOUD_API_SECRET"),
                }
            )
        self.producer = Producer(conf)

    def _delivery(self, err, msg):
        if err is not None:
            self.errors += 1
            if self.errors <= 5:
                print(f"  delivery failed: {err}", file=sys.stderr)

    def send(self, topic, key, value, timestamp_ms):
        self.sent[topic] = self.sent.get(topic, 0) + 1
        payload = json.dumps(value, ensure_ascii=False)
        if self.dry_run_dir:
            f = self.files.setdefault(
                topic, open(os.path.join(self.dry_run_dir, f"{topic}.jsonl"), "w")
            )
            f.write(json.dumps({"key": key, "timestamp": timestamp_ms, "value": json.loads(payload)}) + "\n")
            return
        while True:
            try:
                self.producer.produce(
                    topic,
                    key=key.encode("utf-8"),
                    value=payload.encode("utf-8"),
                    timestamp=timestamp_ms,
                    on_delivery=self._delivery,
                )
                break
            except BufferError:
                self.producer.poll(1)
        self.producer.poll(0)

    def close(self):
        if self.dry_run_dir:
            for f in self.files.values():
                f.close()
        else:
            self.producer.flush(120)


def need(name):
    v = os.getenv(name)
    if not v:
        sys.exit(f"ERROR: environment variable {name} is required")
    return v


def uk_today():
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("Europe/London")).date()
    except Exception:
        return datetime.now(timezone.utc).date()


def start_of_day_ms(d):
    try:
        from zoneinfo import ZoneInfo

        dt = datetime(d.year, d.month, d.day, tzinfo=ZoneInfo("Europe/London"))
    except Exception:
        dt = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", type=date.fromisoformat, default=None,
                    help="timetable day to publish (YYYY-MM-DD, default: today UK)")
    ap.add_argument("--corpus", default=CORPUS_URL, help="CORPUS file/URL (default: download)")
    ap.add_argument("--cif", default=CIF_URL, help="CIF full-daily file/URL (default: download)")
    ap.add_argument("--only", choices=["tiploc", "schedule", "both"], default="both")
    ap.add_argument("--timestamp-ms", type=int, default=None,
                    help="record timestamp (default: start of --date, UK time)")
    ap.add_argument("--dry-run", metavar="DIR", default=None,
                    help="write JSONL files to DIR instead of publishing to Kafka")
    args = ap.parse_args()

    run_date = args.date or uk_today()
    ts_ms = args.timestamp_ms if args.timestamp_ms is not None else start_of_day_ms(run_date)
    print(f"Timetable day {run_date}, record timestamp {ts_ms} "
          f"({datetime.fromtimestamp(ts_ms / 1000, timezone.utc).isoformat()})", flush=True)

    need_download = args.corpus.startswith("http") or args.cif.startswith("http")
    auth = None
    if need_download:
        auth = (need("NETWORK_RAIL_USERNAME"), need("NETWORK_RAIL_PASSWORD"))

    # Create the publisher first so a bad Kafka config fails before a 3 GB download.
    pub = Publisher(args.dry_run)
    started = time.time()

    print("Reading CORPUS ...", flush=True)
    with open_binary(args.corpus, auth) as f:
        tiploc_to_stanox, stanox_records = load_corpus(f)

    if args.only in ("tiploc", "both"):
        for stanox, rec in sorted(stanox_records.items()):
            pub.send(TOPIC_TIPLOC, stanox, rec, ts_ms)
        print(f"Queued {len(stanox_records):,} records for {TOPIC_TIPLOC}", flush=True)

    if args.only in ("schedule", "both"):
        print("Reading CIF schedules (this streams a multi-GB file; allow several minutes) ...", flush=True)
        with open_binary(args.cif, auth) as f:
            winners = pick_one_per_service_code(iter_schedules(f, run_date, tiploc_to_stanox))
        for service_code, rec in sorted(winners.items()):
            pub.send(TOPIC_SCHEDULE, service_code, rec, ts_ms)
        print(f"Queued {len(winners):,} records for {TOPIC_SCHEDULE}", flush=True)

    pub.close()
    print(f"Done in {time.time() - started:,.0f}s: " +
          ", ".join(f"{t}={n:,}" for t, n in pub.sent.items()), flush=True)
    if pub.errors:
        sys.exit(f"ERROR: {pub.errors} record(s) failed to deliver")


if __name__ == "__main__":
    main()
