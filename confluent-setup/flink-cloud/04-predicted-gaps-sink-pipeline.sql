-- =============================================================================
-- 04-predicted-gaps-sink-pipeline.sql   (Confluent Cloud for Apache Flink)
--
-- Flink SQL equivalent of 05-predicted-gaps-sink-pipeline.sql (ksqlDB):
--
--   JOURNEY_GAPS_PREDICTED_STREAM  ->  VIEW JOURNEY_GAPS_PREDICTED   (parse JSON)
--   JOURNEY_GAPS_EXPLODED          ->  VIEW JOURNEY_GAPS_EXPLODED    (UNNEST stations)
--   PREDICTED_GAPS_FLAT            ->  TABLE PREDICTED_GAPS_FLAT
--   ALL_STATIONS_FLAT              ->  TABLE ALL_STATIONS_FLAT
--
-- Source topic NR_JOURNEY_GAPS_PREDICTED is written by the Python infill
-- predictor as plain JSON (no Schema Registry entry) so Flink exposes it as
-- (`key` BYTES, `val` BYTES).
--
-- Unlike COMPLETED_JOURNEYS, the two flat topics are read by the Confluent Cloud
-- PostgreSQL sink connectors with JsonSchemaConverter, which REQUIRES the
-- Schema Registry wire format.  So they use the default id-encoding (payload).
--
-- Column names are lower case.  ksqlDB produced UPPER CASE names (and a
-- TRAIN_ID_VAL helper column) that the sink connector's ReplaceField transform
-- renamed to lower case.  Declaring lower-case columns directly makes that
-- transform a no-op, so the existing connector configs (cloud/connectors.sh) work
-- unchanged.  The Kafka key is the `key` column (a raw key format requires that
-- exact column name).  train_id is ALSO a normal value column, which the sink's
-- pk.mode=record_value / pk.fields needs (that is what the ksqlDB
-- CONCAT(train_id,'') trick achieved).  Do NOT set value.fields-include = all:
-- it would add a `key` field to the JSON value and the sink has no such column.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- JOURNEY_GAPS_EXPLODED
-- One row per station of every predicted-gaps record, fields already typed.
-- -----------------------------------------------------------------------------
CREATE VIEW JOURNEY_GAPS_EXPLODED AS
SELECT
    j.train_id,
    j.train_uid,
    j.schedule_start_date,
    j.completion_time,
    j.total_scheduled_stops,
    j.found_stops_count,
    j.missed_stops_count,
    j.severity,
    CAST(JSON_VALUE(st.station, '$.station_index') AS INT)     AS station_index,
    JSON_VALUE(st.station, '$.station_name')                               AS station_name,
    JSON_VALUE(st.station, '$.tiploc')                                     AS tiploc,
    JSON_VALUE(st.station, '$.stanox')                                     AS stanox,
    JSON_VALUE(st.station, '$.status')                                     AS status,
    CAST(JSON_VALUE(st.station, '$.visited') AS BOOLEAN) AS visited,
    JSON_VALUE(st.station, '$.scheduled_time')                             AS scheduled_time,
    JSON_VALUE(st.station, '$.scheduled_arrival')                          AS scheduled_arrival,
    JSON_VALUE(st.station, '$.scheduled_departure')                        AS scheduled_departure,
    JSON_VALUE(st.station, '$.actual_time')                                AS actual_time,
    JSON_VALUE(st.station, '$.actual_arrival')                             AS actual_arrival,
    JSON_VALUE(st.station, '$.actual_departure')                           AS actual_departure,
    JSON_VALUE(st.station, '$.event')                                      AS event,
    JSON_VALUE(st.station, '$.predicted_arrival')                          AS predicted_arrival,
    CAST(JSON_VALUE(st.station, '$.predicted_arrival_ms') AS BIGINT)  AS predicted_arrival_ms,
    JSON_VALUE(st.station, '$.predicted_departure')                        AS predicted_departure,
    CAST(JSON_VALUE(st.station, '$.predicted_departure_ms') AS BIGINT)  AS predicted_departure_ms,
    JSON_VALUE(st.station, '$.predicted_time')                             AS predicted_time,
    CAST(JSON_VALUE(st.station, '$.predicted_time_ms') AS BIGINT)  AS predicted_time_ms,
    CAST(JSON_VALUE(st.station, '$.predicted_delay_minutes') AS INT)     AS predicted_delay_minutes,
    CAST(JSON_VALUE(st.station, '$.prediction_confidence') AS DOUBLE)  AS prediction_confidence,
    JSON_VALUE(st.station, '$.prediction_method')                          AS prediction_method,
    -- ksqlDB declared prediction_basis as VARCHAR: for a JSON object it holds the
    -- object serialised as JSON text.  JSON_QUERY gives the same text.
    JSON_QUERY(st.station, '$.prediction_basis')                           AS prediction_basis
FROM (
    SELECT
        JSON_VALUE(v, '$.train_id')                                          AS train_id,
        JSON_VALUE(v, '$.train_uid')                                         AS train_uid,
        JSON_VALUE(v, '$.schedule_start_date')                               AS schedule_start_date,
        CAST(JSON_VALUE(v, '$.completion_time') AS BIGINT)         AS completion_time,
        CAST(JSON_VALUE(v, '$.total_scheduled_stops') AS INT)            AS total_scheduled_stops,
        CAST(JSON_VALUE(v, '$.found_stops_count') AS INT)            AS found_stops_count,
        CAST(JSON_VALUE(v, '$.missed_stops_count') AS INT)            AS missed_stops_count,
        JSON_VALUE(v, '$.severity')                                          AS severity,
        JSON_QUERY(v, '$.stations' RETURNING ARRAY<STRING>)                  AS stations
    FROM (
        SELECT CAST(val AS STRING) AS v
        FROM NR_JOURNEY_GAPS_PREDICTED
        WHERE val IS NOT NULL
    )
) AS j
CROSS JOIN UNNEST(j.stations) AS st(station)
WHERE j.train_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- PREDICTED_GAPS_FLAT   -> JDBC sink -> predicted_gaps
-- Missed stops (visited = false) that have a predicted arrival or departure.
-- -----------------------------------------------------------------------------
CREATE TABLE PREDICTED_GAPS_FLAT (
    `key`                     STRING NOT NULL,   -- Kafka key = train_id (raw key format requires the name `key`)
    train_id                  STRING NOT NULL,
    train_uid                 STRING,
    schedule_start_date       STRING,
    completion_time           BIGINT,
    total_scheduled_stops     INT,
    found_stops_count         INT,
    missed_stops_count        INT,
    severity                  STRING,
    station_index             INT,
    station_name              STRING,
    tiploc                    STRING,
    stanox                    STRING,
    scheduled_time            STRING,
    scheduled_arrival         STRING,
    scheduled_departure       STRING,
    actual_time               STRING,
    actual_arrival            STRING,
    actual_departure          STRING,
    predicted_arrival         STRING,
    predicted_arrival_ms      BIGINT,
    predicted_departure       STRING,
    predicted_departure_ms    BIGINT,
    predicted_time            STRING,
    predicted_time_ms         BIGINT,
    predicted_delay_minutes   INT,
    prediction_confidence     DOUBLE,
    prediction_method         STRING,
    prediction_basis          STRING
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode'          = 'append',
    'key.format'              = 'raw',
    'value.format'            = 'json-registry'
);

INSERT INTO PREDICTED_GAPS_FLAT
SELECT
    train_id, train_id, train_uid, schedule_start_date, completion_time,
    total_scheduled_stops, found_stops_count, missed_stops_count, severity,
    station_index, station_name, tiploc, stanox,
    scheduled_time, scheduled_arrival, scheduled_departure,
    actual_time, actual_arrival, actual_departure,
    predicted_arrival, predicted_arrival_ms,
    predicted_departure, predicted_departure_ms,
    predicted_time, predicted_time_ms,
    predicted_delay_minutes, prediction_confidence, prediction_method, prediction_basis
FROM JOURNEY_GAPS_EXPLODED
WHERE visited = FALSE
  AND (predicted_arrival IS NOT NULL OR predicted_departure IS NOT NULL);


-- -----------------------------------------------------------------------------
-- ALL_STATIONS_FLAT   -> JDBC sink -> journey_stations
-- Every scheduled stop, visited or missed.
-- -----------------------------------------------------------------------------
CREATE TABLE ALL_STATIONS_FLAT (
    `key`                     STRING NOT NULL,   -- Kafka key = train_id (raw key format requires the name `key`)
    train_id                  STRING NOT NULL,
    train_uid                 STRING,
    schedule_start_date       STRING,
    completion_time           BIGINT,
    total_scheduled_stops     INT,
    found_stops_count         INT,
    missed_stops_count        INT,
    severity                  STRING,
    station_index             INT,
    station_name              STRING,
    tiploc                    STRING,
    stanox                    STRING,
    status                    STRING,
    visited                   BOOLEAN,
    scheduled_time            STRING,
    scheduled_arrival         STRING,
    scheduled_departure       STRING,
    actual_time               STRING,
    actual_arrival            STRING,
    actual_departure          STRING,
    event                     STRING,
    predicted_arrival         STRING,
    predicted_arrival_ms      BIGINT,
    predicted_departure       STRING,
    predicted_departure_ms    BIGINT,
    predicted_time            STRING,
    predicted_time_ms         BIGINT,
    predicted_delay_minutes   INT,
    prediction_confidence     DOUBLE,
    prediction_method         STRING,
    prediction_basis          STRING
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode'          = 'append',
    'key.format'              = 'raw',
    'value.format'            = 'json-registry'
);

INSERT INTO ALL_STATIONS_FLAT
SELECT
    train_id, train_id, train_uid, schedule_start_date, completion_time,
    total_scheduled_stops, found_stops_count, missed_stops_count, severity,
    station_index, station_name, tiploc, stanox, status, visited,
    scheduled_time, scheduled_arrival, scheduled_departure,
    actual_time, actual_arrival, actual_departure, event,
    predicted_arrival, predicted_arrival_ms,
    predicted_departure, predicted_departure_ms,
    predicted_time, predicted_time_ms,
    predicted_delay_minutes, prediction_confidence, prediction_method, prediction_basis
FROM JOURNEY_GAPS_EXPLODED;
