-- =============================================================================
-- 03-ksqldb-streams-and-tables.sql
--
-- Complete ksqlDB DDL to ingest ActiveMQ rail messages, enrich movements with
-- station names from CORPUS reference table, attach scheduled route data from
-- SCHEDULE_TABLE, build LIVE_JOURNEY_STATE, and emit COMPLETED_JOURNEYS.
--
-- Active-Schedule Filter:
--   LIVE_JOURNEY_STATE uses an INNER JOIN with SCHEDULE_TABLE so ONLY journeys
--   whose TRAIN_SERVICE_CODE matches a record in NR_ACTIVE_SCHEDULE are ever
--   tracked.  COMPLETED_JOURNEYS is derived from LIVE_JOURNEY_STATE, so it
--   inherits this filter automatically — unmatched journeys never appear in
--   either stream/table.
--
-- Naming Conventions  (SCREAMING_SNAKE_CASE throughout):
--
--   Kafka Topics  (connector-produced — NR_ prefix, all SCREAMING_SNAKE_CASE):
--     NR_TRAIN_MESSAGES        — raw ActiveMQ envelopes from Network Rail
--     NR_TIPLOC_REFERENCE      — JDBC bulk-load of tiploc_reference (key: STANOX string, 3 partitions)
--     NR_ACTIVE_SCHEDULE       — JDBC timestamp-load of active_schedule  (key: SERVICE_CODE string)
--
--   Kafka Topics  (ksqlDB-produced — SCREAMING_SNAKE_CASE, no prefix):
--     FLATTENED_RAIL_TEXT      — exploded individual rail events                  (3 partitions)
--     SCHEDULE_TABLE           — compacted schedule lookup table                  (3 partitions, compact)
--     MOVEMENT_STREAM          — station-enriched movement events                 (3 partitions)
--     LIVE_JOURNEY_STATE       — stateful per-journey aggregate, active-sched only (3 partitions, compact)
--     COMPLETED_JOURNEYS       — emitted when journey STATUS = 'TERMINATED'       (3 partitions)
--
--   Kafka Topics  (application-produced — NR_ prefix):
--     NR_JOURNEY_GAPS          — gap analysis output from gap_detector
--     NR_JOURNEY_GAPS_PREDICTED — infill-predicted passing times from infill-predictor
--
--   ksqlDB Streams:
--     RAW_ACTIVEMQ_MESSAGES    — over NR_TRAIN_MESSAGES
--     FLATTENED_RAIL_TEXT      — over FLATTENED_RAIL_TEXT  (same name as backing topic)
--     SCHEDULE_STREAM_RAW      — over NR_ACTIVE_SCHEDULE
--     MOVEMENT_STREAM          — over MOVEMENT_STREAM      (same name as backing topic)
--     LIVE_JOURNEY_CHANGES     — over LIVE_JOURNEY_STATE
--     COMPLETED_JOURNEYS       — over COMPLETED_JOURNEYS   (same name as backing topic)
--
--   ksqlDB Tables:
--     TIPLOC_REFERENCE_TABLE   — over NR_TIPLOC_REFERENCE  (key: STANOX)
--     SCHEDULE_TABLE           — CSAS over SCHEDULE_STREAM_RAW (key: SERVICE_CODE)
--     LIVE_JOURNEY_STATE       — CSAS over MOVEMENT_STREAM ⨝ SCHEDULE_TABLE (key: TRAIN_ID)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Base reference table for Station Names (from NR_TIPLOC_REFERENCE)
--
-- NR_TIPLOC_REFERENCE MUST have 3 partitions to match FLATTENED_RAIL_TEXT
-- for the stream-table join in Step 5.  The topic CR sets partitionCount=3.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS TIPLOC_REFERENCE_TABLE DELETE TOPIC;
CREATE TABLE TIPLOC_REFERENCE_TABLE (
    STANOX        VARCHAR PRIMARY KEY,
    TIPLOC        VARCHAR,
    THREE_ALPHA   VARCHAR,
    STATION_NAME  VARCHAR
) WITH (
    KAFKA_TOPIC  = 'NR_TIPLOC_REFERENCE',
    VALUE_FORMAT = 'JSON'
);

-- -----------------------------------------------------------------------------
-- Step 2: Base stream & table for Schedules (from NR_ACTIVE_SCHEDULE)
--
-- auto.offset.reset=earliest is REQUIRED here.  NR_ACTIVE_SCHEDULE is
-- pre-populated by the JDBC connector before ksqlDB runs.  Without this,
-- CTAS_SCHEDULE_TABLE reads from the end of the topic and sees nothing,
-- leaving SCHEDULE_TABLE empty and causing LIVE_JOURNEY_STATE INNER JOINs
-- to match zero rows.
--
-- The jdbc-active-schedule connector keys NR_ACTIVE_SCHEDULE by SERVICE_CODE
-- (plain string, via ValueToKey + ExtractField$Key).  The stream declares
-- SERVICE_CODE as the KEY column so ksqlDB propagates it correctly and the
-- CTAS GROUP BY SERVICE_CODE uses the physical Kafka key.
-- -----------------------------------------------------------------------------
SET 'auto.offset.reset' = 'earliest';

DROP STREAM IF EXISTS SCHEDULE_STREAM_RAW DELETE TOPIC;
CREATE STREAM SCHEDULE_STREAM_RAW (
    SERVICE_CODE       VARCHAR KEY,
    CIF_TRAIN_UID      VARCHAR,
    TIPLOC_ARRAY       VARCHAR,
    STANOX_ARRAY       VARCHAR,
    TIMING_DATA        VARCHAR
) WITH (
    KAFKA_TOPIC  = 'NR_ACTIVE_SCHEDULE',
    VALUE_FORMAT = 'JSON'
);

DROP TABLE IF EXISTS SCHEDULE_TABLE DELETE TOPIC;
CREATE TABLE SCHEDULE_TABLE
WITH (
    KAFKA_TOPIC  = 'SCHEDULE_TABLE',
    VALUE_FORMAT = 'JSON',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    SERVICE_CODE,
    LATEST_BY_OFFSET(CIF_TRAIN_UID) AS CIF_TRAIN_UID,
    LATEST_BY_OFFSET(TIPLOC_ARRAY)  AS TIPLOC_ARRAY,
    LATEST_BY_OFFSET(STANOX_ARRAY)  AS STANOX_ARRAY,
    LATEST_BY_OFFSET(TIMING_DATA)   AS TIMING_DATA
FROM SCHEDULE_STREAM_RAW
GROUP BY SERVICE_CODE
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 3: Ingest raw ActiveMQ message stream
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS RAW_ACTIVEMQ_MESSAGES DELETE TOPIC;
CREATE STREAM RAW_ACTIVEMQ_MESSAGES (
    messageID     VARCHAR,
    messageType   VARCHAR,
    timestamp     BIGINT,
    text          VARCHAR       -- Raw escaped NR JSON array string
) WITH (
    KAFKA_TOPIC  = 'NR_TRAIN_MESSAGES',
    VALUE_FORMAT = 'JSON'
);

-- -----------------------------------------------------------------------------
-- Step 4: Explode raw arrays into individual rail events
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS FLATTENED_RAIL_TEXT DELETE TOPIC;
CREATE STREAM FLATTENED_RAIL_TEXT
WITH (
    KAFKA_TOPIC  = 'FLATTENED_RAIL_TEXT',
    VALUE_FORMAT = 'JSON',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    EXPLODE(JSON_ITEMS(text)) AS MSG_BLOCK
FROM RAW_ACTIVEMQ_MESSAGES
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 5a: TRAIN_ACTIVATION_TABLE
--
-- Captures type-0001 (activation) messages which carry the CIF_TRAIN_UID for
-- a specific running TRAIN_ID.  This is the only reliable source that maps a
-- live TRAIN_ID to its exact CIF_TRAIN_UID — SCHEDULE_TABLE (keyed by
-- SERVICE_CODE) only keeps one UID per service code and would overwrite all
-- but the last train sharing that code.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS TRAIN_ACTIVATION_TABLE DELETE TOPIC;
CREATE TABLE TRAIN_ACTIVATION_TABLE
WITH (
    KAFKA_TOPIC  = 'TRAIN_ACTIVATION_TABLE',
    VALUE_FORMAT = 'JSON',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_id')       AS TRAIN_ID,
    LATEST_BY_OFFSET(
        EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_uid')
    )                                                       AS TRAIN_UID,
    LATEST_BY_OFFSET(
        EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_service_code')
    )                                                       AS TRAIN_SERVICE_CODE
FROM FLATTENED_RAIL_TEXT f
WHERE EXTRACTJSONFIELD(f.MSG_BLOCK, '$.header.msg_type') = '0001'
GROUP BY EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_id')
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 5b: Movement stream enriched with human-readable Station Names,
--          partitioned by TRAIN_ID (not service code) so that LIVE_JOURNEY_STATE
--          can join against TRAIN_ACTIVATION_TABLE on the same key.
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS MOVEMENT_STREAM DELETE TOPIC;
CREATE STREAM MOVEMENT_STREAM
WITH (
    KAFKA_TOPIC  = 'MOVEMENT_STREAM',
    VALUE_FORMAT = 'JSON',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_id')           AS TRAIN_ID,
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.loc_stanox')         AS STANOX,
    COALESCE(s.STATION_NAME, EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.loc_stanox')) AS STATION_NAME,
    COALESCE(s.TIPLOC, '')                                     AS TIPLOC,
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.actual_timestamp')   AS ACTUAL_TIME,
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.header.msg_type')         AS MSG_TYPE,
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_terminated')   AS IS_TERMINATED,
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.event_type')         AS EVENT_TYPE,
    EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_service_code') AS TRAIN_SERVICE_CODE
FROM FLATTENED_RAIL_TEXT f
LEFT JOIN TIPLOC_REFERENCE_TABLE s ON EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.loc_stanox') = s.STANOX
PARTITION BY EXTRACTJSONFIELD(f.MSG_BLOCK, '$.body.train_id')
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 6: LIVE_JOURNEY_STATE Table
--
-- Joins MOVEMENT_STREAM against both SCHEDULE_TABLE (for the scheduled route)
-- and TRAIN_ACTIVATION_TABLE (for the correct CIF_TRAIN_UID).
--
-- Why two joins are needed:
--   - SCHEDULE_TABLE provides the tiploc/timing route data, joined by SERVICE_CODE.
--     It only holds one CIF_TRAIN_UID per service code — wrong for individual trains.
--   - TRAIN_ACTIVATION_TABLE provides the exact CIF_TRAIN_UID for THIS specific
--     running TRAIN_ID from its type-0001 activation message.  This is authoritative.
--
-- INNER JOIN with SCHEDULE_TABLE ensures ONLY journeys whose service code
-- exists in NR_ACTIVE_SCHEDULE are tracked (unscheduled trains are silently dropped).
-- LEFT JOIN with TRAIN_ACTIVATION_TABLE preserves journeys even if the activation
-- message hasn't yet been seen (falls back to SCHEDULE_TABLE UID as before).
--
-- Key note: do NOT alias the GROUP BY column as ROWKEY — ksqlDB derives the
-- table key automatically from the GROUP BY expression.
--
-- STATUS logic: a journey is TERMINATED when IS_TERMINATED = 'true' or EVENT_TYPE is 'DESTINATION'.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS LIVE_JOURNEY_STATE DELETE TOPIC;
CREATE TABLE LIVE_JOURNEY_STATE
WITH (
    KAFKA_TOPIC  = 'LIVE_JOURNEY_STATE',
    VALUE_FORMAT = 'JSON',
    PARTITIONS   = 3,
    REPLICAS     = 3
) AS
SELECT
    m.TRAIN_ID                                               AS TRAIN_ID,
    -- Prefer the UID from the activation message (exact per-train); fall back to
    -- SCHEDULE_TABLE UID only when no activation record exists yet.
    COALESCE(
        LATEST_BY_OFFSET(a.TRAIN_UID),
        LATEST_BY_OFFSET(s.CIF_TRAIN_UID)
    )                                                        AS TRAIN_UID,
    LATEST_BY_OFFSET(m.TRAIN_SERVICE_CODE)                   AS TRAIN_SERVICE_CODE,
    LATEST_BY_OFFSET(m.STANOX)                               AS CURRENT_STANOX,
    LATEST_BY_OFFSET(m.STATION_NAME)                         AS CURRENT_STATION_NAME,
    LATEST_BY_OFFSET(m.ACTUAL_TIME)                          AS LAST_UPDATED,
    CASE
        WHEN LATEST_BY_OFFSET(m.IS_TERMINATED) = 'true'
          OR UCASE(LATEST_BY_OFFSET(m.EVENT_TYPE)) = 'DESTINATION'
        THEN 'TERMINATED'
        ELSE 'ACTIVE'
    END AS STATUS,
    -- Collect all visited stations enriched with human-readable station names.
    -- Only journeys in NR_ACTIVE_SCHEDULE appear here (INNER JOIN with SCHEDULE_TABLE).
    COLLECT_LIST(
        STRUCT(
            STANOX       := m.STANOX,
            STATION_NAME := m.STATION_NAME,
            TIPLOC       := m.TIPLOC,
            ACTUAL_TIME  := m.ACTUAL_TIME,
            EVENT        := m.EVENT_TYPE
        )
    ) AS STATIONS_VISITED,
    LATEST_BY_OFFSET(s.TIPLOC_ARRAY)                         AS SCHEDULED_TIPLOCS,
    LATEST_BY_OFFSET(s.TIMING_DATA)                          AS SCHEDULED_TIMINGS
FROM MOVEMENT_STREAM m
INNER JOIN SCHEDULE_TABLE s        ON m.TRAIN_SERVICE_CODE = s.SERVICE_CODE
LEFT  JOIN TRAIN_ACTIVATION_TABLE a ON m.TRAIN_ID           = a.TRAIN_ID
GROUP BY m.TRAIN_ID
EMIT CHANGES;

-- -----------------------------------------------------------------------------
-- Step 7: Stream changes from LIVE_JOURNEY_STATE
--
-- This stream mirrors the LIVE_JOURNEY_STATE topic.  Because LIVE_JOURNEY_STATE
-- only contains active-schedule journeys (INNER JOIN above), this stream and
-- everything derived from it are also implicitly filtered to active schedules.
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS LIVE_JOURNEY_CHANGES;
CREATE STREAM LIVE_JOURNEY_CHANGES (
    TRAIN_ID               VARCHAR KEY,
    TRAIN_UID              VARCHAR,
    TRAIN_SERVICE_CODE     VARCHAR,
    CURRENT_STANOX         VARCHAR,
    CURRENT_STATION_NAME   VARCHAR,
    LAST_UPDATED           VARCHAR,
    STATUS                 VARCHAR,
    STATIONS_VISITED       ARRAY<STRUCT<STANOX VARCHAR, STATION_NAME VARCHAR, TIPLOC VARCHAR, ACTUAL_TIME VARCHAR, EVENT VARCHAR>>,
    SCHEDULED_TIPLOCS      VARCHAR,
    SCHEDULED_TIMINGS      VARCHAR
) WITH (
    KAFKA_TOPIC  = 'LIVE_JOURNEY_STATE',
    VALUE_FORMAT = 'JSON'
);

-- -----------------------------------------------------------------------------
-- Step 8: COMPLETED_JOURNEYS Stream
--
-- Emits a record for each journey that reaches STATUS = 'TERMINATED'.
-- Active-schedule filtering is inherited from LIVE_JOURNEY_STATE (Step 6):
-- only journeys in NR_ACTIVE_SCHEDULE ever appear here.
-- -----------------------------------------------------------------------------
DROP STREAM IF EXISTS COMPLETED_JOURNEYS DELETE TOPIC;
CREATE STREAM COMPLETED_JOURNEYS
WITH (
    KAFKA_TOPIC  = 'COMPLETED_JOURNEYS',
    VALUE_FORMAT = 'JSON',
    PARTITIONS   = 3,
    REPLICAS     = 3,
    RETENTION_MS = 604800000
) AS
SELECT
    TRAIN_ID,
    TRAIN_UID,
    TRAIN_SERVICE_CODE,
    LAST_UPDATED           AS COMPLETION_TIME,
    CURRENT_STANOX         AS TERMINATION_STANOX,
    CURRENT_STATION_NAME   AS TERMINATION_STATION_NAME,
    STATIONS_VISITED,
    SCHEDULED_TIPLOCS,
    SCHEDULED_TIMINGS
FROM LIVE_JOURNEY_CHANGES
WHERE STATUS = 'TERMINATED'
EMIT CHANGES;
