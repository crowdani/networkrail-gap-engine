-- =============================================================================
-- 002_journey_stations_table.sql
--
-- Creates the journey_stations table to receive ALL scheduled stops for every
-- journey (both VISITED and MISSED), sinked from the JOURNEY_GAPS_EXPLODED
-- Kafka topic via connector 07-connector-journey-stations-sink.json.
--
-- Unlike predicted_gaps (which only contains missed stops with predictions),
-- journey_stations contains every stop in the journey's scheduled route,
-- making it the primary source for the full stop timeline in the Approvals UI.
--
-- The JDBC Sink upserts by the composite key:
--   (train_id, station_index, schedule_start_date)
--
-- Schema mirrors the JOURNEY_GAPS_EXPLODED struct fields:
--   train_id, train_uid, schedule_start_date, completion_time,
--   total_scheduled_stops, found_stops_count, missed_stops_count, severity,
--   station_index, station_name, tiploc, stanox,
--   status        ('found' | 'not found')
--   visited       BOOLEAN
--   scheduled_time, actual_time, event,
--   predicted_time, predicted_time_ms, predicted_delay_minutes,
--   prediction_confidence, prediction_method, prediction_basis
--
-- Safe to run multiple times.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS journey_stations (
    -- Composite natural key (matches JDBC Sink pk.fields)
    train_id              TEXT        NOT NULL,
    station_index         INTEGER     NOT NULL,
    schedule_start_date   TEXT,

    -- Journey-level fields (repeated on every row for denormalised access)
    train_uid             TEXT,
    completion_time       BIGINT,
    total_scheduled_stops INTEGER,
    found_stops_count     INTEGER,
    missed_stops_count    INTEGER,
    severity              TEXT,

    -- Station fields
    station_name          TEXT,
    tiploc                TEXT,
    stanox                TEXT,
    status                TEXT,        -- 'found' | 'not found'
    visited               BOOLEAN,

    -- Timing fields (stored as VARCHAR strings from ksqlDB pipeline)
    scheduled_time        TEXT,
    actual_time           TEXT,
    event                 TEXT,

    -- Prediction fields (null for visited stops)
    predicted_time        TEXT,
    predicted_time_ms     BIGINT,
    predicted_delay_minutes INTEGER,
    prediction_confidence DOUBLE PRECISION,
    prediction_method     TEXT,
    prediction_basis      TEXT,

    -- Approval fields (populated by the UI workflow)
    approval_status       TEXT        NOT NULL DEFAULT 'PENDING',
    approved_time         TEXT,
    approved_by           TEXT,
    approved_at           TIMESTAMPTZ,
    rejection_reason      TEXT,
    received_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),

    -- Natural key constraint (JDBC Sink requires this for upsert)
    CONSTRAINT journey_stations_pkey PRIMARY KEY (train_id, station_index, schedule_start_date)
);

-- Approval status constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journey_stations_approval_status_check'
  ) THEN
    ALTER TABLE journey_stations
      ADD CONSTRAINT journey_stations_approval_status_check
      CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
  END IF;
END
$$;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS journey_stations_train_id_idx
    ON journey_stations (train_id, schedule_start_date);

CREATE INDEX IF NOT EXISTS journey_stations_stanox_idx
    ON journey_stations (stanox);

CREATE INDEX IF NOT EXISTS journey_stations_visited_idx
    ON journey_stations (train_id, visited);

CREATE INDEX IF NOT EXISTS journey_stations_approval_idx
    ON journey_stations (approval_status, train_id);

CREATE INDEX IF NOT EXISTS journey_stations_received_at_idx
    ON journey_stations (received_at DESC NULLS LAST);

COMMIT;
