-- =============================================================================
-- 001_predicted_gaps_approval_columns.sql
--
-- Adds approval workflow columns and a serial primary key to the predicted_gaps
-- table that is populated by the Confluent JDBC Sink connector.
--
-- The JDBC Sink connector creates predicted_gaps with the composite natural key:
--   (train_id, station_index, schedule_start_date)
-- and writes the following data columns:
--   train_id, train_uid, schedule_start_date, completion_time,
--   total_scheduled_stops, found_stops_count, missed_stops_count, severity,
--   station_index, station_name, tiploc, stanox,
--   scheduled_time, actual_time, predicted_time, predicted_time_ms,
--   predicted_delay_minutes, prediction_confidence, prediction_method,
--   prediction_basis
--
-- This migration adds:
--   id              SERIAL — surrogate PK for the approvals UI
--   approval_status TEXT   — PENDING | APPROVED | REJECTED
--   approved_time   TEXT   — operator-confirmed infill time (HH:MM or ISO8601)
--   approved_by     TEXT   — operator identifier
--   approved_at     TIMESTAMPTZ
--   rejection_reason TEXT
--   received_at     TIMESTAMPTZ — timestamp when the row was sinked
--   updated_at      TIMESTAMPTZ — last modification timestamp
--
-- Safe to run multiple times (all statements use IF NOT EXISTS / DO … END).
-- =============================================================================

BEGIN;

-- 1. Add id SERIAL as a surrogate key (does NOT replace the natural PK).
--    The JDBC Sink upserts by (train_id, station_index, schedule_start_date),
--    so we leave the existing UNIQUE constraint intact and add a separate SERIAL.
ALTER TABLE predicted_gaps
    ADD COLUMN IF NOT EXISTS id SERIAL;

-- Create a unique index on id so it can be used as a lookup key from the UI.
CREATE UNIQUE INDEX IF NOT EXISTS predicted_gaps_id_idx ON predicted_gaps (id);

-- 2. Approval workflow columns
ALTER TABLE predicted_gaps
    ADD COLUMN IF NOT EXISTS approval_status  TEXT    NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS approved_time    TEXT,
    ADD COLUMN IF NOT EXISTS approved_by      TEXT,
    ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS received_at      TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- 3. Constrain approval_status to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predicted_gaps_approval_status_check'
  ) THEN
    ALTER TABLE predicted_gaps
      ADD CONSTRAINT predicted_gaps_approval_status_check
      CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
  END IF;
END
$$;

-- 4. Index for common query patterns used by the Approvals page
CREATE INDEX IF NOT EXISTS predicted_gaps_approval_status_idx
    ON predicted_gaps (approval_status, train_id);

CREATE INDEX IF NOT EXISTS predicted_gaps_received_at_idx
    ON predicted_gaps (received_at DESC NULLS LAST);

COMMIT;
