-- =============================================================================
-- 005_predicted_gaps_sched_actual_arr_dep.sql
--
-- Adds scheduled and actual arrival/departure columns to predicted_gaps.
-- These fields were present in the PREDICTED_GAPS_FLAT ksqlDB stream but
-- were omitted from the original predicted_gaps table schema.
--
-- The JDBC sink connector requires all projected fields to exist in the
-- target table when auto.evolve is disabled.
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

BEGIN;

ALTER TABLE predicted_gaps
    ADD COLUMN IF NOT EXISTS scheduled_arrival   VARCHAR(10),
    ADD COLUMN IF NOT EXISTS scheduled_departure VARCHAR(10),
    ADD COLUMN IF NOT EXISTS actual_arrival      VARCHAR(10),
    ADD COLUMN IF NOT EXISTS actual_departure    VARCHAR(10);

COMMENT ON COLUMN predicted_gaps.scheduled_arrival   IS 'Timetabled arrival time HH:MM';
COMMENT ON COLUMN predicted_gaps.scheduled_departure IS 'Timetabled departure time HH:MM';
COMMENT ON COLUMN predicted_gaps.actual_arrival      IS 'Reported actual arrival time HH:MM';
COMMENT ON COLUMN predicted_gaps.actual_departure    IS 'Reported actual departure time HH:MM';

COMMIT;
