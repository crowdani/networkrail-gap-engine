-- =============================================================================
-- 03-live-journey-state.sql   (Confluent Cloud for Apache Flink)
--
-- Flink SQL equivalent of ksqlDB Steps 6, 7 and 8:
--
--   LIVE_JOURNEY_STATE   ->  TABLE LIVE_JOURNEY_STATE   (upsert, key TRAIN_ID)
--   LIVE_JOURNEY_CHANGES ->  not needed; Flink reads the table's changelog itself
--   COMPLETED_JOURNEYS   ->  TABLE COMPLETED_JOURNEYS   (upsert, key TRAIN_ID)
--
-- Prerequisites: 01-reference-tables.sql and 02-movement-pipeline.sql.
--
-- OUTPUT FORMAT (important - consumed by the Python gap detector)
-- ---------------------------------------------------------------
-- gap_detector/completed_journey_gap_detector.py does json.loads(record.value)
-- and reads UPPER-CASE field names (TRAIN_UID, COMPLETION_TIME, STATIONS_VISITED
-- [].STANOX ...).  The Kafka key must be the TRAIN_ID string.  Therefore:
--   * columns are declared in UPPER CASE (identical to the ksqlDB output),
--   * key.format = raw  (TRAIN_ID written as a plain UTF-8 string, not in the value),
--   * value.json-registry.id-encoding = header  -> the Schema Registry schema ID is
--     put in a Kafka record HEADER and the payload is clean JSON with no 5-byte
--     Confluent prefix.  Without this the Python json.loads() would fail.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- LIVE_JOURNEY_STATE
--
-- ksqlDB: GROUP BY train_id over MOVEMENT_STREAM
--           INNER JOIN SCHEDULE_TABLE          ON service code
--           LEFT  JOIN TRAIN_ACTIVATION_TABLE  ON train id
--
-- Flink: the same, using event-time temporal joins (FOR SYSTEM_TIME AS OF) so each
-- movement is enriched from the reference rows valid at its timestamp.  The join
-- output is append-only, so the GROUP BY works exactly like the ksqlDB aggregate.
--
-- Differences from ksqlDB, all deliberate:
--   * LATEST_BY_OFFSET(x)  ->  LAST_VALUE(x)
--   * COLLECT_LIST(STRUCT) ->  ARRAY_AGG(CAST(ROW(..) AS ROW<..>))
--     with FILTER (WHERE STANOX IS NOT NULL): activation (type 0001) messages have
--     no location, ksqlDB stored them as empty structs which the detector then
--     discarded (`if stanox:`).  They are simply not stored here.
--   * STATUS is sticky: once any movement is a terminating one (train_terminated =
--     'true' or event_type = 'DESTINATION') the journey stays TERMINATED.  In
--     ksqlDB STATUS came from the latest message only, so a later non-terminating
--     message flipped it back to ACTIVE.  An upsert table cannot do that
--     gracefully for COMPLETED_JOURNEYS (it would emit a tombstone), so it is
--     made monotonic.
-- -----------------------------------------------------------------------------
CREATE TABLE LIVE_JOURNEY_STATE (
    `key`                 STRING NOT NULL,   -- TRAIN_ID (raw key format requires the column to be named `key`)
    TRAIN_UID             STRING,
    TRAIN_SERVICE_CODE    STRING,
    CURRENT_STANOX        STRING,
    CURRENT_STATION_NAME  STRING,
    LAST_UPDATED          STRING,
    STATUS                STRING,
    STATIONS_VISITED      ARRAY<ROW<
                              STANOX        STRING,
                              STATION_NAME  STRING,
                              TIPLOC        STRING,
                              ACTUAL_TIME   STRING,
                              EVENT         STRING>>,
    SCHEDULED_TIPLOCS     STRING,
    SCHEDULED_TIMINGS     STRING,
    PRIMARY KEY (`key`) NOT ENFORCED
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode'                    = 'upsert',
    'kafka.cleanup-policy'              = 'compact',
    'key.format'                        = 'raw',
    'value.format'                      = 'json-registry',
    'value.json-registry.id-encoding'   = 'header'
);

-- Temporal joins wait for the watermark of BOTH inputs.  SCHEDULE_TABLE,
-- TIPLOC_REFERENCE_TABLE and TRAIN_ACTIVATION_TABLE can be quiet for long
-- periods, which would stall the join.  Idleness detection lets the movement
-- side's watermark drive the join once a reference partition has been quiet for
-- this long.  Run this SET in the same workspace session just before the INSERT.
SET 'sql.tables.scan.idle-timeout' = '30 s';

INSERT INTO LIVE_JOURNEY_STATE
SELECT
    COALESCE(m.TRAIN_ID, '')                                           AS `key`,
    -- Prefer the UID from the activation message (exact per train); fall back to
    -- the SCHEDULE_TABLE UID only when no activation record exists yet.
    COALESCE(LAST_VALUE(a.TRAIN_UID), LAST_VALUE(s.CIF_TRAIN_UID))     AS TRAIN_UID,
    LAST_VALUE(m.TRAIN_SERVICE_CODE)                                   AS TRAIN_SERVICE_CODE,
    LAST_VALUE(m.STANOX)                                               AS CURRENT_STANOX,
    LAST_VALUE(m.STATION_NAME)                                         AS CURRENT_STATION_NAME,
    LAST_VALUE(m.ACTUAL_TIME)                                          AS LAST_UPDATED,
    CASE
        WHEN MAX(CASE WHEN m.IS_TERMINATED = 'true'
                        OR UPPER(m.EVENT_TYPE) = 'DESTINATION'
                      THEN 1 ELSE 0 END) = 1
        THEN 'TERMINATED'
        ELSE 'ACTIVE'
    END                                                                AS STATUS,
    ARRAY_AGG(
        CAST(ROW(m.STANOX, m.STATION_NAME, m.TIPLOC, m.ACTUAL_TIME, m.EVENT_TYPE) AS
             ROW<STANOX STRING, STATION_NAME STRING, TIPLOC STRING,
                 ACTUAL_TIME STRING, EVENT STRING>)
    ) FILTER (WHERE m.STANOX IS NOT NULL)                              AS STATIONS_VISITED,
    LAST_VALUE(s.TIPLOC_ARRAY)                                         AS SCHEDULED_TIPLOCS,
    LAST_VALUE(s.TIMING_DATA)                                          AS SCHEDULED_TIMINGS
FROM MOVEMENT_STREAM AS m
JOIN SCHEDULE_TABLE FOR SYSTEM_TIME AS OF m.event_time AS s
    ON m.TRAIN_SERVICE_CODE = s.`key`
LEFT JOIN TRAIN_ACTIVATION_TABLE FOR SYSTEM_TIME AS OF m.event_time AS a
    ON m.TRAIN_ID = a.`key`
GROUP BY m.TRAIN_ID;


-- -----------------------------------------------------------------------------
-- COMPLETED_JOURNEYS
--
-- One record (keyed by TRAIN_ID) per journey that reached STATUS = 'TERMINATED'.
-- Like the ksqlDB stream, a record is re-emitted whenever a terminated journey
-- receives another movement; the detector is idempotent (it upserts by
-- train_id + schedule_start_date).
--
-- Retention: 7 days, as in ksqlDB (RETENTION_MS = 604800000).
-- Field names, types and order are identical to the ksqlDB COMPLETED_JOURNEYS.
-- -----------------------------------------------------------------------------
CREATE TABLE COMPLETED_JOURNEYS (
    `key`                     STRING NOT NULL,   -- TRAIN_ID (raw key format requires the column to be named `key`)
    TRAIN_UID                 STRING,
    TRAIN_SERVICE_CODE        STRING,
    COMPLETION_TIME           STRING,
    TERMINATION_STANOX        STRING,
    TERMINATION_STATION_NAME  STRING,
    STATIONS_VISITED          ARRAY<ROW<
                                  STANOX        STRING,
                                  STATION_NAME  STRING,
                                  TIPLOC        STRING,
                                  ACTUAL_TIME   STRING,
                                  EVENT         STRING>>,
    SCHEDULED_TIPLOCS         STRING,
    SCHEDULED_TIMINGS         STRING,
    PRIMARY KEY (`key`) NOT ENFORCED
) DISTRIBUTED BY (`key`) INTO 3 BUCKETS
WITH (
    'changelog.mode'                    = 'upsert',
    'kafka.cleanup-policy'              = 'delete',
    'kafka.retention.time'              = '7 d',
    'key.format'                        = 'raw',
    'value.format'                      = 'json-registry',
    'value.json-registry.id-encoding'   = 'header'
);

INSERT INTO COMPLETED_JOURNEYS
SELECT
    `key`,
    TRAIN_UID,
    TRAIN_SERVICE_CODE,
    LAST_UPDATED          AS COMPLETION_TIME,
    CURRENT_STANOX        AS TERMINATION_STANOX,
    CURRENT_STATION_NAME  AS TERMINATION_STATION_NAME,
    STATIONS_VISITED,
    SCHEDULED_TIPLOCS,
    SCHEDULED_TIMINGS
FROM LIVE_JOURNEY_STATE
WHERE STATUS = 'TERMINATED';
