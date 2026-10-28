# Flink SQL pipeline for Confluent Cloud (alternative to ksqlDB)

This folder is a **manual-deploy alternative** to the ksqlDB pipeline. It
re-implements the stream processing in
[`../03-ksqldb-streams-and-tables.sql`](../03-ksqldb-streams-and-tables.sql) and
[`../05-predicted-gaps-sink-pipeline.sql`](../05-predicted-gaps-sink-pipeline.sql)
as **Confluent Cloud for Apache Flink** SQL.

Nothing outside this folder was changed. The ksqlDB scripts, `cloud/*.sh`, the
connector configs, the Python services and the UI are untouched. Pick **either**
ksqlDB **or** Flink for a given cluster, not both. See
[Don't run both](#dont-run-both).

## Files

Run in this order. Run **each statement separately** in the Confluent Cloud Flink
SQL workspace (or `confluent flink statement create`). The `CREATE TABLE`
statements finish immediately. Each `INSERT INTO` becomes a long-running
streaming statement.

| File | Creates | Replaces (ksqlDB) |
|---|---|---|
| [`01-reference-tables.sql`](01-reference-tables.sql) | tables `TIPLOC_REFERENCE_TABLE`, `SCHEDULE_TABLE` + 2 inserts | `TIPLOC_REFERENCE_TABLE`, `SCHEDULE_STREAM_RAW`, `SCHEDULE_TABLE` |
| [`02-movement-pipeline.sql`](02-movement-pipeline.sql) | views `FLATTENED_RAIL_TEXT`, `MOVEMENT_STREAM`; table `TRAIN_ACTIVATION_TABLE` + 1 insert | `RAW_ACTIVEMQ_MESSAGES`, `FLATTENED_RAIL_TEXT`, `TRAIN_ACTIVATION_TABLE`, `MOVEMENT_STREAM` |
| [`03-live-journey-state.sql`](03-live-journey-state.sql) | tables `LIVE_JOURNEY_STATE`, `COMPLETED_JOURNEYS` + 2 inserts | `LIVE_JOURNEY_STATE`, `LIVE_JOURNEY_CHANGES`, `COMPLETED_JOURNEYS` |
| [`04-predicted-gaps-sink-pipeline.sql`](04-predicted-gaps-sink-pipeline.sql) | view `JOURNEY_GAPS_EXPLODED`; tables `PREDICTED_GAPS_FLAT`, `ALL_STATIONS_FLAT` + 2 inserts | `JOURNEY_GAPS_PREDICTED_STREAM`, `JOURNEY_GAPS_EXPLODED`, `PREDICTED_GAPS_FLAT`, `ALL_STATIONS_FLAT` |

Total: 7 long-running statements (`INSERT INTO`).

## Prerequisites

1. A Confluent Cloud environment with a Kafka cluster, a Flink compute pool in the
   same region, and **Schema Registry enabled** (the `json-registry` format needs it).
2. The source topics exist and are being fed by the existing connectors
   ([`../cloud/connectors.sh`](../cloud/connectors.sh)): `NR_TRAIN_MESSAGES`,
   `NR_TIPLOC_REFERENCE`, `NR_ACTIVE_SCHEDULE`. The Python infill predictor
   writes `NR_JOURNEY_GAPS_PREDICTED`, and the gap detector reads
   `COMPLETED_JOURNEYS` and writes `NR_JOURNEY_GAPS`.
3. In the Flink workspace, select the right catalog (environment) and database (cluster).
4. **Do not pre-create** `COMPLETED_JOURNEYS`, `PREDICTED_GAPS_FLAT`,
   `ALL_STATIONS_FLAT` or `LIVE_JOURNEY_STATE`. Flink creates the topics and Schema
   Registry subjects itself. If the ksqlDB-created topics of the same name exist
   (from `cloud/topics.sh`), delete them first. See [Cut-over](#cut-over).

The source topics have no Schema Registry schema except `NR_TRAIN_MESSAGES`:

* `NR_TIPLOC_REFERENCE`, `NR_ACTIVE_SCHEDULE` and `NR_JOURNEY_GAPS_PREDICTED` are
  plain JSON, so Confluent Cloud exposes them as tables with two `BYTES` columns,
  `key` and `val`. The scripts parse `val` with `JSON_VALUE`.
* `NR_TRAIN_MESSAGES` is written by the ActiveMQ source connector with a schema, so
  Flink exposes the envelope as real columns (`messageID`, `messageType`,
  `` `timestamp` ``, ..., `text`). `02-movement-pipeline.sql` reads `text` directly.

Check each with `SHOW CREATE TABLE <topic>` before running the scripts; if a topic
has the other shape, change the `val` / `text` access to match.

## How the ksqlDB constructs map to Flink

| ksqlDB | Flink SQL |
|---|---|
| `EXPLODE(JSON_ITEMS(text))` | `CROSS JOIN UNNEST(JSON_QUERY(text, '$' RETURNING ARRAY<STRING>))` |
| `EXTRACTJSONFIELD(x, '$.a.b')` | `JSON_VALUE(x, '$.a.b')` |
| `LATEST_BY_OFFSET(c)` (grouped) | `LAST_VALUE(c)` |
| `LATEST_BY_OFFSET` table (`SCHEDULE_TABLE`, `TRAIN_ACTIVATION_TABLE`) | keep-last-row dedup: `ROW_NUMBER() OVER (PARTITION BY k ORDER BY ts DESC) = 1` into an upsert table |
| `COLLECT_LIST(STRUCT(..))` | `ARRAY_AGG(CAST(ROW(..) AS ROW<..>)) FILTER (WHERE ..)` |
| stream-table `JOIN` | event-time temporal join `FOR SYSTEM_TIME AS OF m.event_time` |
| `PARTITION BY x` | handled by `GROUP BY` / `DISTRIBUTED BY` |
| `VALUE_FORMAT = 'JSON_SR'` | `'value.format' = 'json-registry'` |
| `RETENTION_MS = 604800000` | `'kafka.retention.time' = '7 d'` |
| `PARTITIONS = 3` | `DISTRIBUTED BY (..) INTO 3 BUCKETS` |
| `UCASE`, `CONCAT`, `COALESCE`, `->` | `UPPER`, `||`/`CONCAT`, `COALESCE`, `JSON_VALUE` on the element |

## Output compatibility with the existing consumers

* **Key column naming.** With `key.format = raw`, Confluent Cloud requires the key
  column to be named exactly `` `key` ``. Every table in this folder that sets a raw key
  therefore declares a `` `key` `` column (the STANOX, SERVICE_CODE or TRAIN_ID value) and
  uses `DISTRIBUTED BY (`key`)` / `PRIMARY KEY (`key`)`. Joins reference it as
  `s.`key``, `a.`key``. Since `` `key` `` is the Kafka key it isn't written into the JSON
  value, so the value fields are unchanged from the ksqlDB output.
* **`COMPLETED_JOURNEYS` is read by Python** (`json.loads`), not by Schema Registry
  clients. The table uses `key.format = raw` (TRAIN_ID as a plain UTF-8 key) and
  `value.json-registry.id-encoding = header`, which writes the schema ID into a Kafka
  **header** and leaves the payload as plain JSON with no 5-byte prefix. Field names are
  declared in UPPER CASE, so the JSON matches what ksqlDB produced and the detector needs
  no change. `STATIONS_VISITED` is a real JSON array of objects.
* **`PREDICTED_GAPS_FLAT` / `ALL_STATIONS_FLAT` are read by the managed PostgreSQL sink**
  with `JsonSchemaConverter`, which needs the Schema Registry wire format. These use the
  default payload encoding. Columns are declared in lower case. The Kafka key is the
  `` `key` `` column, and `train_id` is also kept as an ordinary value column, which is
  what `pk.mode=record_value` / `pk.fields=train_id,station_index,schedule_start_date`
  in `cloud/connectors.sh` read, so the connector settings work **unchanged**. The ksqlDB
  `TRAIN_ID_VAL` helper column is no longer needed and the rename transform becomes a
  harmless no-op. Don't add `value.fields-include = all`: it would put a `key` field in
  the JSON that the Postgres tables don't have.
* `prediction_basis` is emitted as a JSON **string** (the predictor emits an object, and
  ksqlDB declared it `VARCHAR`), which the `jsonb` column in Postgres accepts.

## Known differences from ksqlDB

1. **Temporal joins.** ksqlDB's stream-table join used whatever the table held at
   processing time. The Flink version uses event time (the Kafka record timestamp) and
   waits for the watermarks of both sides. `03-live-journey-state.sql` sets
   `sql.tables.scan.idle-timeout = '30 s'` so a quiet reference topic (these are bulk
   loaded hourly/daily) doesn't stall the join. The reference rows' `ts` is their
   original record timestamp, so replaying from the earliest offset behaves the same as
   live. Keep the `SET` in the same workspace session as that `INSERT`.
2. **`STATUS` is sticky.** In ksqlDB `STATUS` came from the *latest* message, so a later
   non-terminating message turned `TERMINATED` back into `ACTIVE`. In Flink, once any
   message is terminating, the journey stays `TERMINATED`. Without that,
   `COMPLETED_JOURNEYS` (an upsert table) would emit a delete for the journey, which
   shows up on the topic as a null-value tombstone.
3. **Empty visit entries are not stored.** ksqlDB stored type-0001 activation messages
   (no location) as empty structs, and the detector then dropped them (`if stanox:`).
   Flink filters them out earlier. The detector sees the same stations.
4. **Re-emits.** As in ksqlDB, a terminated journey is re-emitted each time another
   movement arrives for it. The detector upserts by `train_id + schedule_start_date`,
   so this is harmless.
5. **State.** `sql.state-ttl` defaults to 0 (never expire), so the `GROUP BY` state
   grows with each train. Add `SET 'sql.state-ttl' = '2 d';` before the `INSERT` in
   `03-live-journey-state.sql` if you want old trains evicted. Make sure it is longer than
   the longest journey.
6. **Not carried over:** `LIVE_JOURNEY_CHANGES` (not needed, Flink reads the table's
   changelog itself) and the `DROP ... DELETE TOPIC` statements. To reset, drop the
   statements and tables in the workspace.

## Cut-over

Don't run both pipelines against the same topics, because they would write to the same
topic names.

1. Stop the ksqlDB queries (`TERMINATE` each persistent query), or use a cluster where
   ksqlDB was never run.
2. Delete the ksqlDB-created topics that Flink will own: `COMPLETED_JOURNEYS`,
   `LIVE_JOURNEY_STATE`, `PREDICTED_GAPS_FLAT`, `ALL_STATIONS_FLAT` (the intermediate
   ksqlDB topics `FLATTENED_RAIL_TEXT`, `MOVEMENT_STREAM`, `SCHEDULE_TABLE`,
   `TRAIN_ACTIVATION_TABLE`, `JOURNEY_GAPS_EXPLODED` aren't used by Flink and can be left or deleted),
   and their `-value` / `-key` Schema Registry subjects.
3. Run `01` to `04` in order. Wait for the `INSERT` statements to show *Running*.
4. The gap detector and the sink connectors need no change. The detector will reprocess
   `COMPLETED_JOURNEYS` from its consumer offset.

## What was and wasn't tested

Tested locally on **open-source Apache Flink 1.20** against messages captured from the
running cluster (300 `NR_TRAIN_MESSAGES` records, 426 matching schedules, the matching
TIPLOC rows and 5 `NR_JOURNEY_GAPS_PREDICTED` records). The Confluent-specific tables
were replaced by file sources and each `INSERT INTO` by a view, so what ran was the real
SELECT logic: JSON flattening, both temporal joins, the `GROUP BY`, `ARRAY_AGG ... FILTER`,
`STATUS`, `COMPLETED_JOURNEYS`, and the predicted-gaps explode and filters. Counts matched an
independent Python calculation on the same data:

| Check | Flink | Python |
|---|---|---|
| Journeys | 2371 | 2371 |
| Movements joined to a schedule | 7589 | 7589 |
| Stations visited (all / terminated) | 7303 / 813 | 7303 / 813 |
| Terminated journeys | 294 | 294 |
| Stations in predicted-gaps input / missed / `PREDICTED_GAPS_FLAT` rows | 88 / 67 / 67 | 88 / 67 / 67 |

**Not tested (needs a Confluent Cloud account):** the `CREATE TABLE ... WITH (...)`
options and the Confluent connector itself (`DISTRIBUTED BY`, `changelog.mode`,
`key.format`, `value.json-registry.id-encoding = header`, `kafka.retention.time`,
`METADATA FROM 'timestamp'`), reading the `key`/`val` columns of an inferred table, and
the behaviour of the idle-timeout against live traffic. They were written from the
Confluent Cloud Flink reference
(<https://docs.confluent.io/cloud/current/flink/reference/overview.html>), but first
confirm after deploy that:

```sql
SHOW CREATE TABLE NR_TRAIN_MESSAGES;   -- has a `text` column (confirmed on a live cluster)
SHOW CREATE TABLE NR_TIPLOC_REFERENCE; -- expected: `key` and `val` BYTES columns
SELECT * FROM COMPLETED_JOURNEYS LIMIT 5;
```

and check one record on the `COMPLETED_JOURNEYS` topic: the value must start with `{`
(not a binary 0x00 byte), the key must be the train id, and the header must carry the
schema ID. If your inferred source tables differ (e.g. a registered schema), adjust the
`FROM NR_*` selects at the top of each file.

## Don't run both

The Flink and ksqlDB pipelines write to the same output topic names. Running both on
one cluster will interleave duplicate records. The existing automation
([`../deploy.sh`](../deploy.sh), `../cloud/ksqldb.sh`) still deploys ksqlDB only.
