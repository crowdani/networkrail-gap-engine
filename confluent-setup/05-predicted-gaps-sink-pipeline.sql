-- =============================================================================
-- 05-predicted-gaps-sink-pipeline.sql
--
-- Flattens NR_JOURNEY_GAPS_PREDICTED (one record per journey, stations[] array)
-- into PREDICTED_GAPS_FLAT (one record per missed station with a prediction).
-- The JDBC Sink connector then writes PREDICTED_GAPS_FLAT to the
-- predicted_gaps PostgreSQL table.
--
-- ksqlDB does not support CROSS JOIN UNNEST.  Array explosion uses EXPLODE()
-- as a scalar in the SELECT list.  Because you cannot filter on the exploded
-- struct in the same CSAS WHERE clause, we use two steps:
--   Step 2a — JOURNEY_GAPS_EXPLODED  : one row per station (all statuses)
--   Step 2b — PREDICTED_GAPS_FLAT    : filter to missed stops with a prediction
--
-- Run this in ksqlDB after the main pipeline (03-ksqldb-streams-and-tables.sql).
-- =============================================================================

SET 'auto.offset.reset' = 'earliest';

-- -----------------------------------------------------------------------------
-- Step 1: Stream over NR_JOURNEY_GAPS_PREDICTED
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS JOURNEY_GAPS_PREDICTED_STREAM;
CREATE STREAM JOURNEY_GAPS_PREDICTED_STREAM (
    train_id               VARCHAR KEY,
    train_uid              VARCHAR,
    schedule_start_date    VARCHAR,
    completion_time        BIGINT,
    total_scheduled_stops  INTEGER,
    found_stops_count      INTEGER,
    missed_stops_count     INTEGER,
    severity               VARCHAR,
    stations               ARRAY<STRUCT<
        station_index           INTEGER,
        station_name            VARCHAR,
        tiploc                  VARCHAR,
        stanox                  VARCHAR,
        status                  VARCHAR,
        visited                 BOOLEAN,
        scheduled_time          VARCHAR,
        scheduled_arrival       VARCHAR,
        scheduled_departure     VARCHAR,
        actual_time             VARCHAR,
        actual_arrival          VARCHAR,
        actual_departure        VARCHAR,
        event                   VARCHAR,
        predicted_arrival       VARCHAR,
        predicted_arrival_ms    BIGINT,
        predicted_departure     VARCHAR,
        predicted_departure_ms  BIGINT,
        predicted_time          VARCHAR,
        predicted_time_ms       BIGINT,
        predicted_delay_minutes INTEGER,
        prediction_confidence   DOUBLE,
        prediction_method       VARCHAR,
        prediction_basis        VARCHAR
    >>
) WITH (
    KAFKA_TOPIC  = 'NR_JOURNEY_GAPS_PREDICTED',
    VALUE_FORMAT = 'JSON'
);

-- -----------------------------------------------------------------------------
-- Step 2a: Explode stations[] — one row per station, all statuses
-- EXPLODE() is the supported ksqlDB array-to-rows function.
-- The exploded STRUCT is aliased as a single column (station).
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS JOURNEY_GAPS_EXPLODED DELETE TOPIC;
CREATE STREAM JOURNEY_GAPS_EXPLODED
WITH (
    KAFKA_TOPIC  = 'JOURNEY_GAPS_EXPLODED',
    VALUE_FORMAT = 'JSON_SR',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    train_id,
    train_uid,
    schedule_start_date,
    completion_time,
    total_scheduled_stops,
    found_stops_count,
    missed_stops_count,
    severity,
    EXPLODE(stations) AS station
FROM JOURNEY_GAPS_PREDICTED_STREAM
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 2b: Filter to missed stops that have a prediction, extract struct fields
-- Now that each row is a single station struct, we can reference station->field.
-- JSON_SR causes ksqlDB to register a schema in the Schema Registry for this
-- stream. The JDBC Sink then receives a proper Struct (not a raw HashMap),
-- which is required for the upsert with pk.mode=record_value to work.
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS PREDICTED_GAPS_FLAT DELETE TOPIC;
CREATE STREAM PREDICTED_GAPS_FLAT
WITH (
    KAFKA_TOPIC  = 'PREDICTED_GAPS_FLAT',
    VALUE_FORMAT = 'JSON_SR',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    train_id,
    -- JDBC Sink pk.mode=record_value requires train_id in the value schema.
    -- The stream key (train_id) is not automatically included in the value;
    -- CONCAT forces ksqlDB to emit it as a value field TRAIN_ID_VAL which
    -- the lowerFields SMT renames to train_id before the sink writes to PG.
    CONCAT(train_id, '')             AS TRAIN_ID_VAL,
    train_uid,
    schedule_start_date,
    completion_time,
    total_scheduled_stops,
    found_stops_count,
    missed_stops_count,
    severity,
    station->station_index           AS station_index,
    station->station_name            AS station_name,
    station->tiploc                  AS tiploc,
    station->stanox                  AS stanox,
    station->scheduled_time          AS scheduled_time,
    station->scheduled_arrival       AS scheduled_arrival,
    station->scheduled_departure     AS scheduled_departure,
    station->actual_time             AS actual_time,
    station->actual_arrival          AS actual_arrival,
    station->actual_departure        AS actual_departure,
    station->predicted_arrival       AS predicted_arrival,
    station->predicted_arrival_ms    AS predicted_arrival_ms,
    station->predicted_departure     AS predicted_departure,
    station->predicted_departure_ms  AS predicted_departure_ms,
    station->predicted_time          AS predicted_time,
    station->predicted_time_ms       AS predicted_time_ms,
    station->predicted_delay_minutes AS predicted_delay_minutes,
    station->prediction_confidence   AS prediction_confidence,
    station->prediction_method       AS prediction_method,
    station->prediction_basis        AS prediction_basis
FROM JOURNEY_GAPS_EXPLODED
WHERE station->visited = false
  AND (station->predicted_arrival IS NOT NULL OR station->predicted_departure IS NOT NULL)
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 2c: ALL stations flat — visited + missed, for the journey_stations sink.
-- This is the same flattening as PREDICTED_GAPS_FLAT but without the
-- visited=false filter, so every scheduled stop appears here.
-- The JDBC Sink connector 07-connector-journey-stations-sink.json reads this
-- topic and writes to the journey_stations PostgreSQL table.
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS ALL_STATIONS_FLAT DELETE TOPIC;
CREATE STREAM ALL_STATIONS_FLAT
WITH (
    KAFKA_TOPIC  = 'ALL_STATIONS_FLAT',
    VALUE_FORMAT = 'JSON_SR',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    -- ksqlDB requires the key column (train_id) to appear bare in the projection.
    -- To also get it into the value schema for the JDBC Sink pk.fields lookup,
    -- we add a second computed column using CONCAT(train_id, '') which forces
    -- ksqlDB to emit it as a genuine value field named TRAIN_ID_VAL.
    train_id,
    CONCAT(train_id, '')             AS TRAIN_ID_VAL,
    train_uid,
    schedule_start_date,
    completion_time,
    total_scheduled_stops,
    found_stops_count,
    missed_stops_count,
    severity,
    station->station_index           AS station_index,
    station->station_name            AS station_name,
    station->tiploc                  AS tiploc,
    station->stanox                  AS stanox,
    station->status                  AS status,
    station->visited                 AS visited,
    station->scheduled_time          AS scheduled_time,
    station->scheduled_arrival       AS scheduled_arrival,
    station->scheduled_departure     AS scheduled_departure,
    station->actual_time             AS actual_time,
    station->actual_arrival          AS actual_arrival,
    station->actual_departure        AS actual_departure,
    station->event                   AS event,
    station->predicted_arrival       AS predicted_arrival,
    station->predicted_arrival_ms    AS predicted_arrival_ms,
    station->predicted_departure     AS predicted_departure,
    station->predicted_departure_ms  AS predicted_departure_ms,
    station->predicted_time          AS predicted_time,
    station->predicted_time_ms       AS predicted_time_ms,
    station->predicted_delay_minutes AS predicted_delay_minutes,
    station->prediction_confidence   AS prediction_confidence,
    station->prediction_method       AS prediction_method,
    station->prediction_basis        AS prediction_basis
FROM JOURNEY_GAPS_EXPLODED
EMIT CHANGES;
