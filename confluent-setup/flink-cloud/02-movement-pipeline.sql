-- =============================================================================
-- 02-movement-pipeline.sql   (Confluent Cloud for Apache Flink)
--
-- Flink SQL equivalent of ksqlDB Steps 3, 4, 5a and 5b:
--
--   RAW_ACTIVEMQ_MESSAGES + FLATTENED_RAIL_TEXT  ->  VIEW FLATTENED_RAIL_TEXT
--   TRAIN_ACTIVATION_TABLE                       ->  TABLE TRAIN_ACTIVATION_TABLE
--   MOVEMENT_STREAM                              ->  VIEW MOVEMENT_STREAM
--
-- Prerequisite: 01-reference-tables.sql has been run (TIPLOC_REFERENCE_TABLE).
--
-- CREATE VIEW statements run instantly and create no running job; the views are
-- expanded into whichever streaming statement reads them (03-live-journey-state.sql).
-- Only the INSERT INTO below is a long-running job.
--
-- NR_TRAIN_MESSAGES is written by the ActiveMQ source connector with a Schema
-- Registry schema, so Flink exposes the ActiveMQ envelope as real columns
-- (`key`, messageID, messageType, `timestamp`, ..., `text`).  `text` is a *string*
-- holding a JSON array of Network Rail messages.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- FLATTENED_RAIL_TEXT
--
-- ksqlDB:  EXPLODE(JSON_ITEMS(text))
-- Flink:   JSON_QUERY(text, '$' RETURNING ARRAY<STRING>) + CROSS JOIN UNNEST
--
-- Rows whose `text` is not a JSON array are skipped (ksqlDB JSON_ITEMS returned
-- NULL for those, which produced no output rows).
-- event_time is the Kafka record timestamp of the envelope; it is the time
-- attribute used by the temporal joins in 03-live-journey-state.sql.
-- -----------------------------------------------------------------------------
CREATE VIEW FLATTENED_RAIL_TEXT AS
SELECT
    blk.MSG_BLOCK,
    m.event_time
FROM (
    SELECT
        `text`      AS text,
        `$rowtime`  AS event_time
    FROM NR_TRAIN_MESSAGES
    WHERE `text` IS NOT NULL
) AS m
CROSS JOIN UNNEST(
    JSON_QUERY(m.text, '$' RETURNING ARRAY<STRING>)
) AS blk(MSG_BLOCK)
WHERE m.text IS JSON ARRAY;


-- -----------------------------------------------------------------------------
-- TRAIN_ACTIVATION_TABLE   (key: TRAIN_ID)
--
-- Type-0001 (activation) messages carry the exact CIF_TRAIN_UID for a TRAIN_ID.
-- ksqlDB: GROUP BY train_id with LATEST_BY_OFFSET.  Flink: keep-last-row dedup.
-- -----------------------------------------------------------------------------
CREATE TABLE TRAIN_ACTIVATION_TABLE (
    `key`               STRING NOT NULL,   -- TRAIN_ID (raw key format requires the column to be named `key`)
    TRAIN_UID           STRING,
    TRAIN_SERVICE_CODE  STRING,
    ts                  TIMESTAMP_LTZ(3) NOT NULL METADATA FROM 'timestamp',
    PRIMARY KEY (`key`) NOT ENFORCED
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode' = 'upsert',
    'key.format'     = 'raw',
    'value.format'   = 'json-registry'
);

INSERT INTO TRAIN_ACTIVATION_TABLE (`key`, TRAIN_UID, TRAIN_SERVICE_CODE, ts)
SELECT TRAIN_ID, TRAIN_UID, TRAIN_SERVICE_CODE, event_time
FROM (
    SELECT
        TRAIN_ID, TRAIN_UID, TRAIN_SERVICE_CODE, event_time,
        ROW_NUMBER() OVER (PARTITION BY TRAIN_ID ORDER BY event_time DESC) AS rn
    FROM (
        SELECT
            COALESCE(JSON_VALUE(MSG_BLOCK, '$.body.train_id'), '')            AS TRAIN_ID,
            JSON_VALUE(MSG_BLOCK, '$.body.train_uid')                         AS TRAIN_UID,
            JSON_VALUE(MSG_BLOCK, '$.body.train_service_code')                AS TRAIN_SERVICE_CODE,
            event_time
        FROM FLATTENED_RAIL_TEXT
        WHERE JSON_VALUE(MSG_BLOCK, '$.header.msg_type') = '0001'
          AND JSON_VALUE(MSG_BLOCK, '$.body.train_id') IS NOT NULL
    )
)
WHERE rn = 1;


-- -----------------------------------------------------------------------------
-- MOVEMENT_STREAM
--
-- Every rail message (all msg_types, as in ksqlDB) enriched with the station name
-- and TIPLOC from TIPLOC_REFERENCE_TABLE.
--
-- ksqlDB: stream-table LEFT JOIN, then PARTITION BY train_id.
-- Flink:  event-time temporal LEFT JOIN (FOR SYSTEM_TIME AS OF) - the closest
--         equivalent of a stream-table join: each movement sees the reference row
--         that was current at the movement's timestamp, and the result stays
--         append-only (no duplicate rows when the reference table is reloaded).
--         Repartitioning by train_id is done by the GROUP BY in the next file.
--
-- Rows without a train_id are dropped (ksqlDB dropped them at GROUP BY / PARTITION BY).
-- -----------------------------------------------------------------------------
CREATE VIEW MOVEMENT_STREAM AS
SELECT
    f.TRAIN_ID,
    f.STANOX,
    COALESCE(s.STATION_NAME, f.STANOX)  AS STATION_NAME,
    COALESCE(s.TIPLOC, '')              AS TIPLOC,
    f.ACTUAL_TIME,
    f.MSG_TYPE,
    f.IS_TERMINATED,
    f.EVENT_TYPE,
    f.TRAIN_SERVICE_CODE,
    f.event_time
FROM (
    SELECT
        JSON_VALUE(MSG_BLOCK, '$.body.train_id')            AS TRAIN_ID,
        JSON_VALUE(MSG_BLOCK, '$.body.loc_stanox')          AS STANOX,
        JSON_VALUE(MSG_BLOCK, '$.body.actual_timestamp')    AS ACTUAL_TIME,
        JSON_VALUE(MSG_BLOCK, '$.header.msg_type')          AS MSG_TYPE,
        JSON_VALUE(MSG_BLOCK, '$.body.train_terminated')    AS IS_TERMINATED,
        JSON_VALUE(MSG_BLOCK, '$.body.event_type')          AS EVENT_TYPE,
        JSON_VALUE(MSG_BLOCK, '$.body.train_service_code')  AS TRAIN_SERVICE_CODE,
        event_time
    FROM FLATTENED_RAIL_TEXT
    WHERE JSON_VALUE(MSG_BLOCK, '$.body.train_id') IS NOT NULL
) AS f
LEFT JOIN TIPLOC_REFERENCE_TABLE FOR SYSTEM_TIME AS OF f.event_time AS s
    ON f.STANOX = s.`key`;
