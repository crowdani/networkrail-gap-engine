#!/usr/bin/env python3
"""
Completed Journey Gap Detector (Standalone Python Stream Processor)

Consumes the COMPLETED_JOURNEYS topic (produced by ksqlDB), calculates missing
stations compared to the scheduled route, and publishes detected gaps to the
NR_JOURNEY_GAPS Kafka topic.

Station names are resolved from the STATIONS_VISITED payload field (already
enriched by ksqlDB via TIPLOC_REFERENCE_TABLE).

Schedule timings (tiploc_array + timing_data) are fetched from Postgres by
CIF_TRAIN_UID.  The SCHEDULED_TIMINGS/SCHEDULED_TIPLOCS carried in the
COMPLETED_JOURNEYS payload come from a ksqlDB SCHEDULE_TABLE keyed by
SERVICE_CODE, which may hold a different schedule variant than the one that
actually ran.  The Postgres lookup is the authoritative source; the payload
fields are used only as a fallback when no DB record is found.
"""
import os
import json
import logging
import signal
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

import psycopg2
import psycopg2.extras
from kafka import KafkaConsumer, KafkaProducer
from infill_predictor import InfillPredictor

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [gap-detector] %(message)s'
)
logger = logging.getLogger("gap_detector")

# Configuration
KAFKA_BROKER_RAW  = os.getenv("KAFKA_BROKER", "kafka-0.kafka.confluent.svc.cluster.local:9092")
BOOTSTRAP_SERVERS = [s.strip() for s in KAFKA_BROKER_RAW.split(",") if s.strip()]
INPUT_TOPIC       = os.getenv("INPUT_TOPIC",   "COMPLETED_JOURNEYS")
OUTPUT_TOPIC      = os.getenv("OUTPUT_TOPIC",  "NR_JOURNEY_GAPS")
CONSUMER_GROUP    = os.getenv("CONSUMER_GROUP", "completed-journey-gap-detector-v1")
AUTO_OFFSET_RESET = os.getenv("AUTO_OFFSET_RESET", "earliest")

# Postgres (for authoritative schedule lookup by CIF_TRAIN_UID)
PG_HOST     = os.getenv("POSTGRES_HOST",     "localhost")
PG_PORT     = int(os.getenv("POSTGRES_PORT", "5432"))
PG_DB       = os.getenv("POSTGRES_DB",       "network_rail")
PG_USER     = os.getenv("POSTGRES_USER",     "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")

# Allowed origin STANOX prefixes for South & Kent routes:
# 87 (South London / Sussex / Wessex borders), 88 (Sussex / South London), 89 (Kent).
# Journeys originating in South / Kent are retained with all their scheduled stations.
ALLOWED_ORIGIN_PREFIXES = ("87", "88", "89")

# A candidate schedule is only accepted if at least this fraction of the
# stations the train actually reported are on the schedule's route.
MIN_ROUTE_OVERLAP = float(os.getenv("MIN_ROUTE_OVERLAP", "0.6"))
MAX_TIME_OFFSET_MIN = int(os.getenv("MAX_TIME_OFFSET_MIN", "60"))

running = True

def handle_shutdown(signum, frame):
    global running
    logger.info(f"Signal {signum} received, shutting down gracefully...")
    running = False

signal.signal(signal.SIGINT,  handle_shutdown)
signal.signal(signal.SIGTERM, handle_shutdown)


class CompletedJourneyGapProcessor:
    def __init__(self):
        self.consumer:  Optional[KafkaConsumer]  = None
        self.producer:  Optional[KafkaProducer]  = None
        self.predictor: InfillPredictor          = InfillPredictor()
        self.pg_conn:   Optional[psycopg2.extensions.connection] = None
        self.init_kafka()
        self.init_postgres()

    # ------------------------------------------------------------------
    # Postgres setup
    # ------------------------------------------------------------------

    def init_postgres(self):
        """Opens a persistent Postgres connection for schedule lookups."""
        try:
            self.pg_conn = psycopg2.connect(
                host=PG_HOST, port=PG_PORT, dbname=PG_DB,
                user=PG_USER, password=PG_PASSWORD,
                connect_timeout=10,
            )
            self.pg_conn.set_session(autocommit=True)
            logger.info(f"Connected to Postgres {PG_HOST}/{PG_DB} for schedule lookups")
        except Exception as e:
            logger.warning(f"Postgres connection failed: {e}. Will fall back to payload timings.")
            self.pg_conn = None

    def fetch_schedule_from_db(
        self, train_uid: str, schedule_date: str
    ) -> Tuple[List[str], List[Any], List[Any], str]:
        """
        Looks up the best-matching schedule for a given CIF train UID and
        running date, returning (tiploc_array, timing_data, stanox_array,
        signalling_id).

        Matching rules (NR CIF STP priority: C > N > O > P):
          1. Exact-date cancellation (STP=C) — if found, return empty lists
             so the journey is skipped as cancelled.
          2. Overlay (STP=O) covering the date & running on day-of-week.
          3. New (STP=N) covering the date & running on day-of-week.
          4. Permanent (STP=P) covering the date & running on day-of-week.

        Falls back to empty results if no matching schedule is found or on any error.
        """
        empty: Tuple[List[str], List[Any], List[Any], str] = ([], [], [], "")
        if not self.pg_conn or not train_uid:
            return empty
        try:
            # Reconnect if the connection has gone away
            if self.pg_conn.closed:
                self.init_postgres()
                if not self.pg_conn:
                    return empty

            with self.pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # First try with day-of-week filter (matches JourneyBuilder get_active_schedule)
                cur.execute(
                    """
                    SELECT cif_stp_indicator, signalling_id,
                           array_to_json(tiploc_array)::text  AS tiploc_json,
                           array_to_json(stanox_array)::text  AS stanox_json,
                           timing_data::text                  AS timing_json
                    FROM   active_schedule
                    WHERE  cif_train_uid = %s
                      AND  schedule_start_date <= %s::date
                      AND  schedule_end_date   >= %s::date
                      AND  SUBSTRING(schedule_days_runs, EXTRACT(ISODOW FROM %s::date)::int, 1) = '1'
                    ORDER BY
                        CASE cif_stp_indicator
                            WHEN 'C' THEN 0
                            WHEN 'O' THEN 1
                            WHEN 'N' THEN 2
                            WHEN 'P' THEN 3
                            ELSE          4
                        END
                    LIMIT 1
                    """,
                    (train_uid, schedule_date, schedule_date, schedule_date),
                )
                row = cur.fetchone()

                # If no schedule matched the day-of-week bitmask, fallback to date range only
                if not row:
                    cur.execute(
                        """
                        SELECT cif_stp_indicator, signalling_id,
                               array_to_json(tiploc_array)::text  AS tiploc_json,
                               array_to_json(stanox_array)::text  AS stanox_json,
                               timing_data::text                  AS timing_json
                        FROM   active_schedule
                        WHERE  cif_train_uid = %s
                          AND  schedule_start_date <= %s::date
                          AND  schedule_end_date   >= %s::date
                        ORDER BY
                            CASE cif_stp_indicator
                                WHEN 'C' THEN 0
                                WHEN 'O' THEN 1
                                WHEN 'N' THEN 2
                                WHEN 'P' THEN 3
                                ELSE          4
                            END
                        LIMIT 1
                        """,
                        (train_uid, schedule_date, schedule_date),
                    )
                    row = cur.fetchone()

            if not row:
                return empty

            # Cancelled schedule — treat as no schedule
            if row["cif_stp_indicator"] == "C":
                logger.debug(f"Schedule for {train_uid} on {schedule_date} is cancelled (STP=C)")
                return empty

            return (
                json.loads(row["tiploc_json"] or "[]"),
                json.loads(row["timing_json"] or "[]"),
                json.loads(row["stanox_json"] or "[]"),
                (row["signalling_id"] or "").strip(),
            )

        except Exception as e:
            logger.warning(f"Schedule DB lookup failed for {train_uid}: {e}")
            return empty

    @staticmethod
    def route_overlap(
        visited_events: List[Dict[str, Any]],
        tiploc_array: List[Any],
        stanox_array: List[Any],
    ) -> float:
        """
        Fraction of the distinct visited locations (by STANOX) that appear in a
        candidate schedule's route (by STANOX or TIPLOC).  1.0 = every location
        the train reported is on the schedule; 0.0 = none are.
        """
        sched_sx = {str(x).strip() for x in stanox_array if x}
        sched_tip = {str(t).strip() for t in tiploc_array if t}
        seen: Dict[str, bool] = {}
        for ev in visited_events:
            sx = ev.get("stanox")
            if not sx or sx in seen:
                continue
            seen[sx] = sx in sched_sx or (bool(ev.get("tiploc")) and ev["tiploc"] in sched_tip)
        if not seen:
            return 0.0
        return sum(seen.values()) / len(seen)

    @staticmethod
    def schedule_time_offset(
        visited_events: List[Dict[str, Any]],
        stanox_array: List[Any],
        timing_data: List[Any],
    ) -> Optional[int]:
        """
        Median circular minute-distance between the train's reported times and
        the schedule's times at the same locations.  Unlike comparing first
        departures, this works when the feed only starts tracking the train
        part-way along its route.  None if no location can be compared.
        """
        times_at: Dict[str, List[int]] = {}
        for sx, t in zip(stanox_array, timing_data):
            if not sx or not isinstance(t, dict):
                continue
            for k in ("arrival", "departure", "pass", "public_arrival", "public_departure"):
                v = t.get(k)
                if v and len(v) >= 4 and v[:4].isdigit():
                    times_at.setdefault(str(sx).strip(), []).append(int(v[:2]) * 60 + int(v[2:4]))
        diffs: List[int] = []
        for ev in visited_events:
            ts = ev.get("actual_time")
            cands = times_at.get(ev.get("stanox") or "")
            if ts is None or not cands:
                continue
            dt = datetime.utcfromtimestamp(int(ts) / 1000.0)
            a = dt.hour * 60 + dt.minute
            diffs.append(min(min(abs(a - c), 1440 - abs(a - c)) for c in cands))
        if not diffs:
            return None
        diffs.sort()
        return diffs[len(diffs) // 2]

    def fetch_schedule_by_headcode(
        self,
        headcode: str,
        schedule_date: str,
        actual_dep_hhmm: Optional[str],
        visited_events: List[Dict[str, Any]],
    ) -> Tuple[List[str], List[Any], List[Any], str]:
        """
        Fallback when the UID-derived schedule is missing or fails validation.

        Fetches every non-cancelled schedule with the same signalling headcode
        (e.g. '9R44') running on schedule_date, keeps only those whose route
        covers at least MIN_ROUTE_OVERLAP of the stations the train actually
        reported and whose times at those stations are within
        MAX_TIME_OFFSET_MIN of the reported times (median), picking the
        closest.  STP priority
        (O > N > P) breaks ties.

        Returns empty results when no candidate passes — the journey is then
        excluded rather than compared against the wrong timetable.
        """
        empty: Tuple[List[str], List[Any], List[Any], str] = ([], [], [], "")
        if not self.pg_conn or not headcode or not actual_dep_hhmm:
            return empty
        try:
            if self.pg_conn.closed:
                self.init_postgres()
                if not self.pg_conn:
                    return empty

            act_mins = int(actual_dep_hhmm[:2]) * 60 + int(actual_dep_hhmm[2:4])
            dow = datetime.strptime(schedule_date, "%Y-%m-%d").isoweekday()  # Mon=1…Sun=7

            with self.pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT cif_stp_indicator, signalling_id,
                           array_to_json(tiploc_array)::text AS tiploc_json,
                           array_to_json(stanox_array)::text AS stanox_json,
                           timing_data::text                 AS timing_json
                    FROM   active_schedule
                    WHERE  signalling_id = %s
                      AND  schedule_start_date <= %s::date
                      AND  schedule_end_date   >= %s::date
                      AND  SUBSTRING(schedule_days_runs, %s::int, 1) = '1'
                      AND  cif_stp_indicator != 'C'
                    """,
                    (headcode, schedule_date, schedule_date, dow),
                )
                rows = cur.fetchall()

            stp_order = {"O": 0, "N": 1, "P": 2}
            best_key = None
            best: Optional[Tuple[List[str], List[Any], List[Any], str]] = None

            for row in rows:
                tips = json.loads(row["tiploc_json"] or "[]")
                timings = json.loads(row["timing_json"] or "[]")
                stanoxes = json.loads(row["stanox_json"] or "[]")
                if self.route_overlap(visited_events, tips, stanoxes) < MIN_ROUTE_OVERLAP:
                    continue
                dist = self.schedule_time_offset(visited_events, stanoxes, timings)
                if dist is None or dist > MAX_TIME_OFFSET_MIN:
                    continue
                key = (dist, stp_order.get(row["cif_stp_indicator"], 9))
                if best_key is None or key < best_key:
                    best_key = key
                    best = (tips, timings, stanoxes, (row["signalling_id"] or "").strip())

            return best if best else empty

        except Exception as e:
            logger.warning(f"Headcode schedule lookup failed for {headcode}: {e}")
            return empty

    def check_cancellation(self, train_id: str, schedule_date: str) -> Optional[Dict[str, Any]]:
        """
        Checks if the train has a recorded cancellation or reinstatement in the database.
        """
        if not self.pg_conn or not train_id:
            return None
        try:
            if self.pg_conn.closed:
                self.init_postgres()
                if not self.pg_conn:
                    return None

            with self.pg_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT msg_type, loc_stanox, canx_type, canx_reason_code
                    FROM train_movements
                    WHERE train_id = %s
                      AND msg_type IN ('0002', '0005')
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (train_id,)
                )
                row = cur.fetchone()
                if row:
                    return dict(row)
        except Exception as e:
            logger.debug(f"Cancellation check query: {e}")
        return None

    # ------------------------------------------------------------------
    # Kafka setup
    # ------------------------------------------------------------------

    def init_kafka(self):
        """Initialises Kafka consumer and producer with retry."""
        logger.info(f"Connecting to Kafka brokers {BOOTSTRAP_SERVERS}...")
        connected = False
        while running and not connected:
            try:
                self.consumer = KafkaConsumer(
                    INPUT_TOPIC,
                    bootstrap_servers=BOOTSTRAP_SERVERS,
                    group_id=CONSUMER_GROUP,
                    auto_offset_reset=AUTO_OFFSET_RESET,
                    enable_auto_commit=True,
                    auto_commit_interval_ms=5000,
                    key_deserializer=lambda k: k.decode('utf-8', errors='ignore') if k else None,
                    value_deserializer=lambda v: json.loads(v.decode('utf-8')) if v else {}
                )
                self.producer = KafkaProducer(
                    bootstrap_servers=BOOTSTRAP_SERVERS,
                    key_serializer=lambda k: k.encode('utf-8') if k else None,
                    value_serializer=lambda v: json.dumps(v).encode('utf-8')
                )
                connected = True
                logger.info(f"Connected to Kafka. Subscribed to {INPUT_TOPIC}, publishing to {OUTPUT_TOPIC}")
            except Exception as e:
                logger.error(f"Kafka connection failed: {e}. Retrying in 5 seconds...")
                time.sleep(5)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def format_epoch(self, epoch_ms: Any) -> Optional[str]:
        """Formats epoch ms → HH:MM:SS string.

        Always UTC: Network Rail TRUST timestamps encode UK wall-clock time as
        if it were UTC, so the UTC clock reading is what lines up with the
        (UK-local) CIF schedule times.  Using local time here made the result
        depend on the container's TZ.
        """
        if not epoch_ms or epoch_ms == 0:
            return None
        try:
            return datetime.utcfromtimestamp(int(epoch_ms) / 1000.0).strftime("%H:%M:%S")
        except Exception:
            return None

    def parse_time_str(self, val: Any) -> Optional[str]:
        """Parses a timing string or dict field to HH:MM format."""
        if not val:
            return None
        s = str(val).strip()
        if ":" in s:
            parts = s.split(":")
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
        digits = "".join(ch for ch in s if ch.isdigit())
        if len(digits) >= 4:
            return f"{digits[:2]}:{digits[2:4]}"
        return s if s else None

    def format_timing_display(self, timing_obj: Any) -> Optional[str]:
        """Returns HH:MM display string for a scheduled timing object."""
        if not timing_obj:
            return None
        if isinstance(timing_obj, dict):
            t = (
                timing_obj.get('public_departure') or
                timing_obj.get('public_arrival') or
                timing_obj.get('departure') or
                timing_obj.get('arrival') or
                timing_obj.get('pass')
            )
        else:
            t = str(timing_obj)
        return self.parse_time_str(t)

    # ------------------------------------------------------------------
    # Core processing
    # ------------------------------------------------------------------

    def process_message(self, key: Optional[str], value: Dict[str, Any]):
        train_id   = key or value.get("TRAIN_ID")   or value.get("train_id")
        train_uid  = value.get("TRAIN_UID")          or value.get("train_uid")  or ""
        completion_time = value.get("COMPLETION_TIME") or value.get("completion_time")

        # Derive schedule start date
        schedule_start_date = (
            value.get("SCHEDULE_START_DATE") or value.get("schedule_start_date") or ""
        )
        ref_ts_ms = None
        if completion_time:
            try:
                ref_ts_ms = int(completion_time)
            except Exception:
                pass
        if not schedule_start_date and ref_ts_ms:
            try:
                schedule_start_date = datetime.fromtimestamp(ref_ts_ms / 1000.0).strftime("%Y-%m-%d")
            except Exception:
                pass

        # ------------------------------------------------------------------
        # 1. Parse STATIONS_VISITED from the ksqlDB payload.
        #    Each entry already carries STATION_NAME resolved by ksqlDB's
        #    TIPLOC_REFERENCE_TABLE join — no database lookup needed.
        # ------------------------------------------------------------------
        visited_raw = value.get("STATIONS_VISITED") or value.get("stations_visited") or []
        if isinstance(visited_raw, str):
            try:
                visited_raw = json.loads(visited_raw)
            except Exception:
                visited_raw = []

        # Build lookup maps and chronological events from visited stops
        visited_stanoxes: List[str]          = []
        visited_events: List[Dict[str, Any]] = []
        tiploc_to_name: Dict[str, str]       = {}   # populated from payload
        tiploc_to_stanox: Dict[str, str]     = {}
        stanox_to_name: Dict[str, str]       = {}
        first_actual_ts: Optional[int]       = None

        for item in visited_raw:
            stanox = str(item.get("STANOX") or item.get("stanox") or "").strip()
            tiploc = str(item.get("TIPLOC") or item.get("tiploc") or "").strip()
            name   = str(item.get("STATION_NAME") or item.get("station_name") or "").strip()

            # Build reverse-lookup maps from payload data
            if tiploc and name:
                tiploc_to_name[tiploc] = name
            if stanox and name:
                stanox_to_name[stanox] = name
            if tiploc and stanox:
                tiploc_to_stanox[tiploc] = stanox

            # Capture timing data for visited stops
            act_time = item.get("ACTUAL_TIME") or item.get("actual_time")
            event    = item.get("EVENT")        or item.get("event") or ""
            act_ts   = None
            if act_time is not None:
                try:
                    act_ts = int(act_time)
                    if first_actual_ts is None:
                        first_actual_ts = act_ts
                except ValueError:
                    pass

            if stanox:
                visited_stanoxes.append(stanox)
                visited_events.append({
                    "stanox": stanox,
                    "tiploc": tiploc,
                    "actual_time": act_ts,
                    "event": event,
                })

        if not ref_ts_ms and first_actual_ts:
            ref_ts_ms = first_actual_ts

        # ------------------------------------------------------------------
        # 2. Resolve the schedule this train is actually running
        #
        # The UID in the payload comes from ksqlDB's SCHEDULE_TABLE (keyed by
        # SERVICE_CODE, one UID per service code) when no activation record
        # exists, and a service code can cover hundreds of different trains.
        # So the UID-derived schedule is only trusted when it passes both:
        #   (a) headcode: schedule signalling_id == headcode in the TRUST
        #       train_id (characters 3-6, e.g. 879R44MQ19 -> 9R44)
        #   (b) route: >= MIN_ROUTE_OVERLAP of the stations the train reported
        #       are on the schedule's route
        # Otherwise search schedules by headcode + date, requiring the same
        # route overlap and times at the reported stations within
        # MAX_TIME_OFFSET_MIN of the schedule.
        # If nothing qualifies the journey is excluded — never compared with a
        # timetable that isn't the train's own.
        # ------------------------------------------------------------------

        # Derive actual first departure as HHMM string for schedule matching
        actual_dep_hhmm: Optional[str] = None
        if first_actual_ts:
            try:
                dt = datetime.utcfromtimestamp(first_actual_ts / 1000.0)
                actual_dep_hhmm = dt.strftime("%H%M")
            except Exception:
                pass

        headcode = str(train_id or "")[2:6].upper()

        db_tiplocs, db_timings, db_stanoxes, db_sig = self.fetch_schedule_from_db(
            train_uid, schedule_start_date
        )

        if db_tiplocs:
            overlap = self.route_overlap(visited_events, db_tiplocs, db_stanoxes)
            if (db_sig.upper() != headcode) or overlap < MIN_ROUTE_OVERLAP:
                logger.info(
                    f"Train {train_id}: UID={train_uid} schedule rejected "
                    f"(schedule headcode={db_sig or '?'} vs {headcode}, route overlap={overlap:.2f}) "
                    f"— searching by headcode"
                )
                db_tiplocs, db_timings, db_stanoxes, db_sig = [], [], [], ""

        if not db_tiplocs:
            db_tiplocs, db_timings, db_stanoxes, db_sig = self.fetch_schedule_by_headcode(
                headcode, schedule_start_date, actual_dep_hhmm, visited_events
            )
            if db_tiplocs:
                logger.info(f"Train {train_id}: matched schedule by headcode {headcode} ({len(db_tiplocs)} locations)")

        if not db_tiplocs:
            logger.info(
                f"Train {train_id}: excluding journey — no verified schedule for "
                f"UID='{train_uid}' headcode={headcode} date={schedule_start_date}"
            )
            return

        # Drop pass-only timing points (junctions, signals, plain-line passes).
        # In CIF these are LI records with only a pass time and no arrival,
        # departure or public times; the train never calls there, so it can't
        # "miss" them and they must not count toward stops or severity.
        keep = [
            i for i, t in enumerate(db_timings)
            if not (
                isinstance(t, dict)
                and t.get("location_type") == "LI"
                and t.get("pass")
                and not (t.get("arrival") or t.get("departure")
                         or t.get("public_arrival") or t.get("public_departure"))
            )
        ]
        sched_tiplocs = [db_tiplocs[i] for i in keep if i < len(db_tiplocs)]
        sched_timings = [db_timings[i] for i in keep]
        logger.debug(
            f"Train {train_id}: schedule {len(db_tiplocs)} locations, "
            f"{len(sched_tiplocs)} calling points after dropping pass-only points"
        )

        # ------------------------------------------------------------------
        # 2b. Direction check — detect reversed schedule
        #
        # NR CIF schedules are stored origin→destination.  Some freight
        # workings run the return leg under the same UID, so the schedule
        # tiploc array is in the opposite direction to the actual journey.
        #
        # Detection: for each scheduled tiploc that was visited, record its
        # position in the schedule (sched_idx) and its actual timestamp.
        # If the Spearman-like rank correlation between sched_idx and
        # actual_ts is strongly negative (< -0.5), the schedule is reversed.
        # In that case we flip sched_tiplocs and sched_timings so that
        # station_index=0 corresponds to where the train actually started.
        # ------------------------------------------------------------------
        if len(sched_tiplocs) >= 4 and visited_events:
            corr_pairs: List[tuple] = []
            matched_events = set()
            for si, tip in enumerate(sched_tiplocs):
                tip = str(tip).strip()
                sx = tiploc_to_stanox.get(tip, tip)
                # Find earliest unmatched actual movement matching this stanox
                for e_idx, ev in enumerate(visited_events):
                    if e_idx not in matched_events and (ev["stanox"] == sx or ev["tiploc"] == tip):
                        ts = ev.get("actual_time")
                        if ts is not None:
                            corr_pairs.append((si, int(ts)))
                            matched_events.add(e_idx)
                            break
            if len(corr_pairs) >= 3:
                # Rank both sequences and compare
                n = len(corr_pairs)
                idx_ranks = {v: r for r, v in enumerate(
                    sorted(p[0] for p in corr_pairs))}
                ts_ranks  = {v: r for r, v in enumerate(
                    sorted(p[1] for p in corr_pairs))}
                d_sq = sum(
                    (idx_ranks[si] - ts_ranks[ts]) ** 2
                    for si, ts in corr_pairs
                )
                # Spearman's rho = 1 - 6*Σd² / (n*(n²-1))
                rho = 1.0 - 6.0 * d_sq / (n * (n * n - 1))
                if rho < -0.5:
                    logger.debug(
                        f"Train {train_id}: schedule direction reversed "
                        f"(rho={rho:.2f}, {n} matched stops) — flipping"
                    )
                    sched_tiplocs = list(reversed(sched_tiplocs))
                    sched_timings = list(reversed(sched_timings))

        # ------------------------------------------------------------------
        # 2c. Filter schedule to allowed STANOX locations (Kent PDAC)
        #
        # tiploc_to_stanox is built only from STATIONS_VISITED (visited stops).
        # Scheduled stops that weren't visited won't be in that map — so we
        # look up any missing TIPLOCs from tiploc_reference in Postgres before
        # applying the filter.
        # ------------------------------------------------------------------
        # Pre-populate missing TIPLOC -> STANOX and station names from DB
        # so unvisited stops have full names and STANOX codes.
        all_unknown_tips = {
            str(t).strip() for t in sched_tiplocs
            if str(t).strip() and (
                str(t).strip() not in tiploc_to_stanox or
                str(t).strip() not in tiploc_to_name
            )
        }
        if all_unknown_tips and self.pg_conn:
            try:
                if self.pg_conn.closed:
                    self.init_postgres()
                with self.pg_conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT tiploc, stanox, COALESCE(nlc_desc_16, nlc_desc) AS name
                        FROM tiploc_reference
                        WHERE tiploc = ANY(%s)
                        """,
                        (list(all_unknown_tips),)
                    )
                    for tip_row in cur.fetchall():
                        tip_val, sx_val, name_val = tip_row[0], tip_row[1], tip_row[2]
                        if sx_val and tip_val not in tiploc_to_stanox:
                            tiploc_to_stanox[tip_val] = sx_val
                        if name_val and tip_val not in tiploc_to_name:
                            tiploc_to_name[tip_val] = name_val
                        if sx_val and name_val and sx_val not in stanox_to_name:
                            stanox_to_name[sx_val] = name_val
            except Exception as e:
                logger.warning(f"Train {train_id}: tiploc_reference enrichment DB lookup failed: {e}")

        # ------------------------------------------------------------------
        # 2c. Regional filter: Journeys starting in South and Kent (STANOX 87/88/89)
        #
        # We retain all stations for journeys originating in South and Kent.
        # ------------------------------------------------------------------
        first_tip = str(sched_tiplocs[0]).strip() if sched_tiplocs else ""
        first_sx  = tiploc_to_stanox.get(first_tip, first_tip)
        first_visited_sx = visited_stanoxes[0] if visited_stanoxes else ""

        is_south_kent = (
            any(first_sx.startswith(p) for p in ALLOWED_ORIGIN_PREFIXES) or
            any(first_visited_sx.startswith(p) for p in ALLOWED_ORIGIN_PREFIXES)
        )

        if not is_south_kent:
            logger.debug(
                f"Train {train_id}: skipping — origin STANOX ({first_sx} / {first_visited_sx}) "
                f"does not start in South & Kent (prefixes {ALLOWED_ORIGIN_PREFIXES})"
            )
            return

        # Require at least 3 scheduled stops for the journey.
        # Trains with only 1 or 2 stops are depot shunts or light engine moves.
        if len(sched_tiplocs) < 3:
            logger.debug(
                f"Train {train_id}: skipping — only {len(sched_tiplocs)} scheduled stops (minimum 3 required)"
            )
            return

        # ------------------------------------------------------------------
        # 3. Build unified stations list
        #
        # For circular routes or routes passing through the same location
        # multiple times (e.g. origin == destination), match visited events
        # sequentially so each movement event is consumed once in order.
        #
        # Network Rail fires separate ARRIVAL and DEPARTURE messages for each
        # station stop.  Both appear in STATIONS_VISITED.  We match them
        # independently so each stop carries actual_arrival and actual_departure
        # as distinct fields.  An event is an ARRIVAL when its EVENT field
        # contains "ARR" (case-insensitive); DEPARTURE when it contains "DEP"
        # or "DEPARTURE".  Any other event (e.g. DESTINATION, ORIGIN) is used
        # as a fallback actual_time only.
        # ------------------------------------------------------------------
        stations: List[Dict[str, Any]] = []
        missed_count = 0
        found_count  = 0
        consumed_event_indices: set = set()

        def _is_arr(ev: Dict[str, Any]) -> bool:
            return "ARR" in str(ev.get("event", "")).upper()

        def _is_dep(ev: Dict[str, Any]) -> bool:
            evt = str(ev.get("event", "")).upper()
            return "DEP" in evt or "DEPARTURE" in evt

        def _matches_location(ev: Dict[str, Any], sx: str, tip: str) -> bool:
            return ev["stanox"] == sx or (ev["tiploc"] and ev["tiploc"] == tip)

        def _hhmm_to_mins(hhmm: Optional[str]) -> Optional[int]:
            """Parse 'HH:MM' or 'HHMM' or 'HH:MM:SS' → minutes since midnight."""
            if not hhmm:
                return None
            s = str(hhmm).strip()
            try:
                if ":" in s:
                    parts = s.split(":")
                    return int(parts[0]) * 60 + int(parts[1])
                if len(s) >= 4 and s[:4].isdigit():
                    return int(s[:2]) * 60 + int(s[2:4])
            except Exception:
                pass
            return None

        def _circular_dist(a: int, b: int) -> int:
            """Circular minute-distance between two HH:MM times (handles midnight crossing)."""
            diff = abs(a - b)
            return min(diff, 1440 - diff)

        def _event_time_mins(ev: Dict[str, Any]) -> Optional[int]:
            """Return actual_time of an event as minutes-since-midnight."""
            ts = ev.get("actual_time")
            if ts is None:
                return None
            try:
                epoch_ms = int(ts)
                dt = datetime.utcfromtimestamp(epoch_ms / 1000.0)
                return dt.hour * 60 + dt.minute
            except Exception:
                return None

        # Maximum window (minutes) between a scheduled time and the actual event
        # time for the event to be considered a valid match for that stop.
        # 120 min covers significant delays while excluding events from an entirely
        # different trip leg (e.g. a return service via the same station).
        _MAX_TIME_WINDOW = 120
        # Loop / out-and-back services visit the same location more than once
        # (e.g. Cannon Street at 14:45 and again at 16:21).  Matching greedily in
        # schedule order lets the first occurrence take an event that belongs to
        # a later one, so pre-assign each event to the occurrence whose
        # scheduled time is closest to it.
        def _sched_ref_mins(timing_obj: Any, kind: str) -> Optional[int]:
            if not isinstance(timing_obj, dict):
                return _hhmm_to_mins(self.format_timing_display(timing_obj))
            keys = {
                "arr": ("arrival", "public_arrival"),
                "dep": ("departure", "public_departure"),
            }.get(kind, ("pass", "arrival", "departure"))
            for k in keys:
                mins = _hhmm_to_mins(self.parse_time_str(timing_obj.get(k)))
                if mins is not None:
                    return mins
            return _hhmm_to_mins(self.format_timing_display(timing_obj))

        loc_occurrences: Dict[str, List[int]] = {}
        for i, t in enumerate(sched_tiplocs):
            tip_i = str(t).strip()
            loc_occurrences.setdefault(tiploc_to_stanox.get(tip_i, tip_i), []).append(i)

        event_owner: Dict[int, int] = {}
        for e_idx, ev in enumerate(visited_events):
            occ = loc_occurrences.get(ev["stanox"]) or []
            if len(occ) < 2:
                continue
            ev_mins = _event_time_mins(ev)
            if ev_mins is None:
                continue
            kind = "arr" if _is_arr(ev) else "dep" if _is_dep(ev) else "pass"
            best_i, best_d = None, None
            for i in occ:
                ref = _sched_ref_mins(sched_timings[i] if i < len(sched_timings) else None, kind)
                if ref is None:
                    continue
                d = _circular_dist(ev_mins, ref)
                if best_d is None or d < best_d:
                    best_i, best_d = i, d
            if best_i is not None:
                event_owner[e_idx] = best_i

        for idx, tiploc in enumerate(sched_tiplocs):
            tiploc = str(tiploc).strip()
            # Resolve STANOX from payload lookup, fall back to tiploc string
            stanox = tiploc_to_stanox.get(tiploc, tiploc)

            # Resolve station name from payload — tiploc preferred, then stanox, then code
            station_name = (
                tiploc_to_name.get(tiploc) or
                stanox_to_name.get(stanox) or
                tiploc or
                stanox
            )

            timing_obj   = sched_timings[idx] if idx < len(sched_timings) else None
            sched_time   = self.format_timing_display(timing_obj)
            sched_dep    = self.parse_time_str(timing_obj.get('departure') or timing_obj.get('public_departure')) if isinstance(timing_obj, dict) else None
            sched_arr    = self.parse_time_str(timing_obj.get('arrival') or timing_obj.get('public_arrival')) if isinstance(timing_obj, dict) else None
            sched_pass   = self.parse_time_str(timing_obj.get('pass')) if isinstance(timing_obj, dict) else None

            # Reference scheduled minutes for proximity gating.
            # For ARR events we compare against sched_arr (or sched_time as fallback).
            # For DEP events we compare against sched_dep (or sched_time as fallback).
            sched_arr_mins  = _hhmm_to_mins(sched_arr)  or _hhmm_to_mins(sched_time)
            sched_dep_mins  = _hhmm_to_mins(sched_dep)  or _hhmm_to_mins(sched_time)
            sched_pass_mins = _hhmm_to_mins(sched_pass) or _hhmm_to_mins(sched_time)

            # Find unmatched ARRIVAL and DEPARTURE events for this location.
            # We do two sequential passes through visited_events so that circular
            # routes (same stanox visited twice) are matched in schedule order.
            #
            # Time-proximity guard: when a station is visited more than once in the
            # same journey (e.g. origin == terminus on a circular route, or a train
            # that reverses direction), the Kafka payload contains multiple ARR/DEP
            # events for the same stanox.  We select the event whose actual_time is
            # closest to the scheduled time for this stop, rather than just taking
            # the first unconsumed event.  Events more than _MAX_TIME_WINDOW minutes
            # away from the scheduled time are rejected for this stop and left
            # available for a later stop in the schedule.
            arr_candidates:   List[Tuple[int, int, Dict[str, Any]]] = []  # (dist, e_idx, ev)
            dep_candidates:   List[Tuple[int, int, Dict[str, Any]]] = []
            other_candidates: List[Tuple[int, int, Dict[str, Any]]] = []

            for e_idx, ev in enumerate(visited_events):
                if e_idx in consumed_event_indices:
                    continue
                if event_owner.get(e_idx, idx) != idx:
                    continue
                if not _matches_location(ev, stanox, tiploc):
                    continue
                ev_mins = _event_time_mins(ev)
                if _is_arr(ev):
                    ref = sched_arr_mins
                    dist = _circular_dist(ev_mins, ref) if (ev_mins is not None and ref is not None) else 9999
                    if dist <= _MAX_TIME_WINDOW:
                        arr_candidates.append((dist, e_idx, ev))
                elif _is_dep(ev):
                    ref = sched_dep_mins
                    dist = _circular_dist(ev_mins, ref) if (ev_mins is not None and ref is not None) else 9999
                    if dist <= _MAX_TIME_WINDOW:
                        dep_candidates.append((dist, e_idx, ev))
                else:
                    ref = sched_pass_mins or sched_arr_mins or sched_dep_mins
                    dist = _circular_dist(ev_mins, ref) if (ev_mins is not None and ref is not None) else 9999
                    if dist <= _MAX_TIME_WINDOW:
                        other_candidates.append((dist, e_idx, ev))

            arr_event:   Optional[Dict[str, Any]] = None
            dep_event:   Optional[Dict[str, Any]] = None
            other_event: Optional[Dict[str, Any]] = None

            # Pick the best (closest) candidate for each slot and consume it.
            if arr_candidates:
                arr_candidates.sort(key=lambda x: x[0])
                _, best_idx, arr_event = arr_candidates[0]
                consumed_event_indices.add(best_idx)
            if dep_candidates:
                dep_candidates.sort(key=lambda x: x[0])
                _, best_idx, dep_event = dep_candidates[0]
                consumed_event_indices.add(best_idx)
            if other_candidates and arr_event is None and dep_event is None:
                other_candidates.sort(key=lambda x: x[0])
                _, best_idx, other_event = other_candidates[0]
                consumed_event_indices.add(best_idx)

            # Determine whether this stop was visited at all
            any_event = arr_event or dep_event or other_event

            if any_event is not None:
                found_count += 1
                # actual_time = arrival preferred, then departure, then other
                primary_event = arr_event or dep_event or other_event
                event_name    = primary_event.get("event", "") or "VISITED"  # type: ignore[union-attr]
                actual_arr_str = self.format_epoch(arr_event.get("actual_time"))   if arr_event   else None
                actual_dep_str = self.format_epoch(dep_event.get("actual_time"))   if dep_event   else None
                actual_time_str = actual_arr_str or actual_dep_str or (
                    self.format_epoch(other_event.get("actual_time")) if other_event else None
                )
                stations.append({
                    "station_index":        idx,
                    "station_name":         station_name,
                    "tiploc":               tiploc,
                    "stanox":               stanox,
                    "status":               "found",
                    "visited":              True,
                    "scheduled_time":       sched_time,
                    "scheduled_departure":  sched_dep,
                    "scheduled_arrival":    sched_arr,
                    "scheduled_pass":       sched_pass,
                    "actual_time":          actual_time_str,
                    "actual_arrival":       actual_arr_str,
                    "actual_departure":     actual_dep_str,
                    "event":                event_name,
                })
            else:
                missed_count += 1
                stations.append({
                    "station_index":        idx,
                    "station_name":         station_name,
                    "tiploc":               tiploc,
                    "stanox":               stanox,
                    "status":               "not found",
                    "visited":              False,
                    "scheduled_time":       sched_time,
                    "scheduled_departure":  sched_dep,
                    "scheduled_arrival":    sched_arr,
                    "scheduled_pass":       sched_pass,
                    "actual_time":          None,
                    "actual_arrival":       None,
                    "actual_departure":     None,
                    "event":                None,
                })

        # ------------------------------------------------------------------
        # 4. Check for cancellation & determine severity
        # ------------------------------------------------------------------
        canx_info = self.check_cancellation(train_id, schedule_start_date)
        is_cancelled = canx_info is not None and canx_info.get("msg_type") == "0002"

        if is_cancelled:
            severity = "CANCELLED"
        elif missed_count >= 4:
            severity = "HIGH"
        elif missed_count >= 2:
            severity = "MEDIUM"
        elif missed_count > 0:
            severity = "LOW"
        else:
            severity = "NONE"

        # ------------------------------------------------------------------
        # 5. Predict passing times for missed stops
        #    InfillPredictor mutates each missed station dict in-place,
        #    adding predicted_time, predicted_delay_minutes, prediction_method,
        #    prediction_confidence, and prediction_basis.
        # ------------------------------------------------------------------
        if missed_count > 0:
            predicted = self.predictor.predict_all_missed(stations, schedule_start_date)
            logger.debug(
                f"Train {train_id}: predicted times for {predicted}/{missed_count} missed stops"
            )

        # ------------------------------------------------------------------
        # 6. Publish
        # ------------------------------------------------------------------
        message = {
            "train_id":              train_id,
            "train_uid":             train_uid,
            "schedule_start_date":   schedule_start_date,
            "completion_time":       completion_time,
            "total_scheduled_stops": len(sched_tiplocs),
            "found_stops_count":     found_count,
            "missed_stops_count":    missed_count,
            "severity":              severity,
            "stations":              stations,
        }

        if self.producer:
            self.producer.send(OUTPUT_TOPIC, key=train_id, value=message)
            logger.info(
                f"Train {train_id} ({train_uid}): {len(sched_tiplocs)} scheduled, "
                f"{found_count} found, {missed_count} missed → severity={severity} → {OUTPUT_TOPIC}"
            )

    # ------------------------------------------------------------------
    # Poll loop
    # ------------------------------------------------------------------

    def run(self):
        logger.info(f"Polling {INPUT_TOPIC} for completed journeys...")
        while running:
            try:
                records = self.consumer.poll(timeout_ms=1000)
                if not records:
                    continue
                for tp, msgs in records.items():
                    for msg in msgs:
                        try:
                            self.process_message(msg.key, msg.value)
                        except Exception as e:
                            logger.error(f"Error processing key={msg.key}: {e}", exc_info=True)
                if self.producer:
                    self.producer.flush()
            except Exception as e:
                logger.error(f"Poll loop error: {e}", exc_info=True)
                time.sleep(2)

        if self.consumer:
            self.consumer.close()
        if self.producer:
            self.producer.flush()
            self.producer.close()
        logger.info("Processor stopped.")


if __name__ == "__main__":
    processor = CompletedJourneyGapProcessor()
    processor.run()
