-- =============================================================================
-- 01-reference-tables.sql   (Confluent Cloud for Apache Flink)
--
-- Flink SQL equivalent of ksqlDB Steps 1 and 2 in 03-ksqldb-streams-and-tables.sql:
--
--   ksqlDB TIPLOC_REFERENCE_TABLE  ->  Flink TIPLOC_REFERENCE_TABLE
--   ksqlDB SCHEDULE_TABLE          ->  Flink SCHEDULE_TABLE
--
-- Run each statement separately in the Confluent Cloud Flink SQL workspace
-- (or `confluent flink statement create`).  Run the CREATE TABLE first, then the
-- INSERT INTO.  Each INSERT INTO is a long-running streaming statement.
--
-- Source topics NR_TIPLOC_REFERENCE and NR_ACTIVE_SCHEDULE are written by the
-- JDBC source connectors as plain JSON with a plain string key and NO Schema
-- Registry entry.  Confluent Cloud exposes such a topic automatically as a table
-- with two BYTES columns:  `key` and `val`.  The JSON is parsed here with
-- JSON_VALUE().
--
-- Why these are separate tables (not read directly):
--   The reference data is joined to the movement stream with a temporal join
--   (FOR SYSTEM_TIME AS OF).  That needs a table with a PRIMARY KEY and a time
--   attribute.  `ts` is written as the Kafka record timestamp so that $rowtime of
--   the new table equals the original $rowtime of the source record, regardless
--   of when this statement is started or replayed.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TIPLOC_REFERENCE_TABLE   (key: STANOX)
-- -----------------------------------------------------------------------------
CREATE TABLE TIPLOC_REFERENCE_TABLE (
    `key`         STRING NOT NULL,   -- STANOX (raw key format requires the column to be named `key`)
    TIPLOC        STRING,
    THREE_ALPHA   STRING,
    STATION_NAME  STRING,
    ts            TIMESTAMP_LTZ(3) NOT NULL METADATA FROM 'timestamp',
    PRIMARY KEY (`key`) NOT ENFORCED
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode' = 'upsert',
    'key.format'     = 'raw',
    'value.format'   = 'json-registry'
);

INSERT INTO TIPLOC_REFERENCE_TABLE (`key`, TIPLOC, THREE_ALPHA, STATION_NAME, ts)
SELECT STANOX, TIPLOC, THREE_ALPHA, STATION_NAME, event_time
FROM (
    SELECT
        STANOX, TIPLOC, THREE_ALPHA, STATION_NAME, event_time,
        -- latest record per STANOX  (== ksqlDB table semantics / LATEST_BY_OFFSET)
        ROW_NUMBER() OVER (PARTITION BY STANOX ORDER BY event_time DESC) AS rn
    FROM (
        SELECT
            COALESCE(CAST(`key` AS STRING), '')                      AS STANOX,
            JSON_VALUE(CAST(val AS STRING), '$.tiploc')              AS TIPLOC,
            JSON_VALUE(CAST(val AS STRING), '$.three_alpha')         AS THREE_ALPHA,
            JSON_VALUE(CAST(val AS STRING), '$.station_name')        AS STATION_NAME,
            `$rowtime`                                               AS event_time
        FROM NR_TIPLOC_REFERENCE
        WHERE `key` IS NOT NULL AND val IS NOT NULL
    )
)
WHERE rn = 1;


-- -----------------------------------------------------------------------------
-- SCHEDULE_TABLE   (key: SERVICE_CODE)
--
-- ksqlDB: LATEST_BY_OFFSET() per SERVICE_CODE.  Flink: keep-last-row dedup.
-- NR_ACTIVE_SCHEDULE is keyed by service_code, but the connector's query orders
-- rows P, N, O, C so the LAST row for a service code wins - exactly as in ksqlDB.
-- TIPLOC_ARRAY / STANOX_ARRAY / TIMING_DATA are JSON *text* inside a JSON string,
-- so they are carried through as STRING unchanged.
-- -----------------------------------------------------------------------------
CREATE TABLE SCHEDULE_TABLE (
    `key`          STRING NOT NULL,   -- SERVICE_CODE (raw key format requires the column to be named `key`)
    CIF_TRAIN_UID  STRING,
    TIPLOC_ARRAY   STRING,
    STANOX_ARRAY   STRING,
    TIMING_DATA    STRING,
    ts             TIMESTAMP_LTZ(3) NOT NULL METADATA FROM 'timestamp',
    PRIMARY KEY (`key`) NOT ENFORCED
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode' = 'upsert',
    'key.format'     = 'raw',
    'value.format'   = 'json-registry'
);

INSERT INTO SCHEDULE_TABLE (`key`, CIF_TRAIN_UID, TIPLOC_ARRAY, STANOX_ARRAY, TIMING_DATA, ts)
SELECT SERVICE_CODE, CIF_TRAIN_UID, TIPLOC_ARRAY, STANOX_ARRAY, TIMING_DATA, event_time
FROM (
    SELECT
        SERVICE_CODE, CIF_TRAIN_UID, TIPLOC_ARRAY, STANOX_ARRAY, TIMING_DATA, event_time,
        ROW_NUMBER() OVER (PARTITION BY SERVICE_CODE ORDER BY event_time DESC) AS rn
    FROM (
        SELECT
            COALESCE(CAST(`key` AS STRING), '')                      AS SERVICE_CODE,
            JSON_VALUE(CAST(val AS STRING), '$.cif_train_uid')       AS CIF_TRAIN_UID,
            JSON_VALUE(CAST(val AS STRING), '$.tiploc_array')        AS TIPLOC_ARRAY,
            JSON_VALUE(CAST(val AS STRING), '$.stanox_array')        AS STANOX_ARRAY,
            JSON_VALUE(CAST(val AS STRING), '$.timing_data')         AS TIMING_DATA,
            `$rowtime`                                               AS event_time
        FROM NR_ACTIVE_SCHEDULE
        WHERE `key` IS NOT NULL AND val IS NOT NULL
    )
)
WHERE rn = 1;
