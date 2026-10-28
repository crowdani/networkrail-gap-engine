# Timetable → Confluent Cloud, without PostgreSQL

`publish_timetable.py` reads the Network Rail **CORPUS** and **CIF** files and
publishes them straight to two Confluent Cloud topics:

| Topic                   | Key          | Value                                                                                                                     |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `NR_TIPLOC_REFERENCE` | STANOX       | `{stanox, tiploc, three_alpha, station_name}`                                                                           |
| `NR_ACTIVE_SCHEDULE`  | service code | `{cif_train_uid, cif_stp_indicator, schedule_*, atoc_code, service_code, tiploc_array, stanox_array, timing_data, ...}` |

Key and field names match what the JDBC connectors produced, so
[`../../flink-cloud/01-reference-tables.sql`](../../flink-cloud/01-reference-tables.sql)
reads the topics unchanged.

## What it replaces

```
before:  files → timetable/load_corpus.py + load_cif_json_fast.py → PostgreSQL
                 → jdbc-tiploc-reference + jdbc-active-schedule connectors → topics
now:     files → publish_timetable.py → topics
```

In this mode **do not register** `jdbc-tiploc-reference` and
`jdbc-active-schedule` from `cloud/connectors.sh` (they would write the same
topics from an empty database). The sink connectors are still needed.

## Prerequisites

Create both topics as **compacted** (they hold "latest value per key"):

```
confluent kafka topic create NR_TIPLOC_REFERENCE --partitions 3 --config cleanup.policy=compact
confluent kafka topic create NR_ACTIVE_SCHEDULE  --partitions 3 --config cleanup.policy=compact
```

(`cloud/topics.sh` already does this.)

## Run

```
cd confluent-setup/cloud/timetable-to-kafka
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in, then:  set -a; source .env; set +a

python3 publish_timetable.py                    # download + publish, today (UK)
python3 publish_timetable.py --only tiploc      # CORPUS only (small, fast)
python3 publish_timetable.py --date 2026-06-10  # a specific timetable day
python3 publish_timetable.py --corpus corpus.json --cif cif.json.gz   # local files
python3 publish_timetable.py --dry-run out/     # write JSONL, publish nothing
```

The CIF full-daily file is several GB; the script streams it and keeps only
schedules that run on the chosen day, so memory use is modest but it takes
several minutes.

### Daily schedule

Run once a day shortly after the full CIF is published (e.g. 04:30 UK), e.g. with
cron or an OpenShift `CronJob` using the same env vars (put the credentials in
secrets):

```
30 4 * * *  cd /opt/timetable-to-kafka && . .venv/bin/activate && set -a && . ./.env && set +a && python3 publish_timetable.py
```

Each run publishes a newer version of every key. Service codes that no longer
run today are not tombstoned; their last record remains until it is compacted
away. Flink only looks up the service code of trains that are actually moving.

## Record selection

* **TIPLOC** – one record per STANOX. A location with a 3-alpha code wins, then
  the alphabetically first TIPLOC (same as the `active_locations` view).
  `station_name` = `NLCDESC16`, else `NLCDESC`, else TIPLOC, else STANOX.
* **Schedules** – only those running on `--date` (start ≤ date ≤ end and the
  weekday flag is `1`), one per service code. STP priority C > O > N > P; for
  equal priority the later CIF line wins. Schedules without a route (e.g.
  cancellations) and without a service code are skipped.

## Record timestamps

Records are stamped at **00:00 UK time on `--date`**, not "now". Flink joins
movements to reference data by event time (`FOR SYSTEM_TIME AS OF`), so a
reference row newer than the movements using it would not match. Stamping at
the start of the day means that day's live movements, and any replay of them,
join to that day's timetable; the next day's run is a strictly newer version.
If you backfill a past date, pass `--date` so the timestamp lines up.

## Caveat: the Python services still use PostgreSQL

This removes Postgres from the **Flink reference-data path** only.
`gap_detector/completed_journey_gap_detector.py` still queries Postgres directly
(`active_schedule` by UID / headcode, `tiploc_reference` for names,
`train_movements`). If the detector runs against Confluent Cloud, Postgres
must still be loaded for it (`timetable/` loaders), or the detector needs
changing to look schedules up from Kafka. That change is not part of this
folder; ask if you want it.

## Notes

* `schedule_start_date` / `schedule_end_date` are ISO strings; the JDBC
  connector emitted epoch-day integers. Nothing in `flink-cloud/` reads them.
* `id` / `power_type` / `speed` and the other unused columns of the old table
  are not published.
* `timetable/refresh_schedules.sh` has Network Rail credentials hard-coded;
  this script reads them from `NETWORK_RAIL_USERNAME` / `NETWORK_RAIL_PASSWORD`
  instead. Consider rotating the hard-coded ones.
* Tested: `--dry-run` against a small synthetic CORPUS/CIF (plain and gzip),
  including STP precedence, date filtering, blank handling and skipped
  route-less schedules. Not tested: a real publish to Confluent Cloud or a
  full-size CIF download.
