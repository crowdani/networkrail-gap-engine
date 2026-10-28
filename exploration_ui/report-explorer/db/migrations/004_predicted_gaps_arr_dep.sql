-- =============================================================================
-- 004_predicted_gaps_arr_dep.sql
--
-- Adds separate predicted arrival and departure columns to the predicted_gaps
-- table, and the same columns to journey_stations.
--
-- Column semantics:
--   predicted_arrival      — "HH:MM:SS" predicted arrival time (NULL for ORIGIN stops)
--   predicted_arrival_ms   — epoch ms UTC equivalent
--   predicted_departure    — "HH:MM:SS" predicted departure time (NULL for DESTINATION stops)
--   predicted_departure_ms — epoch ms UTC equivalent
--
-- The existing predicted_time / predicted_time_ms columns are kept for
-- backwards compatibility with existing queries and the approval workflow.
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

BEGIN;

ALTER TABLE predicted_gaps
    ADD COLUMN IF NOT EXISTS predicted_arrival       VARCHAR(20),
    ADD COLUMN IF NOT EXISTS predicted_arrival_ms    BIGINT,
    ADD COLUMN IF NOT EXISTS predicted_departure     VARCHAR(20),
    ADD COLUMN IF NOT EXISTS predicted_departure_ms  BIGINT;

ALTER TABLE journey_stations
    ADD COLUMN IF NOT EXISTS predicted_arrival       TEXT,
    ADD COLUMN IF NOT EXISTS predicted_arrival_ms    BIGINT,
    ADD COLUMN IF NOT EXISTS predicted_departure     TEXT,
    ADD COLUMN IF NOT EXISTS predicted_departure_ms  BIGINT;

COMMENT ON COLUMN predicted_gaps.predicted_arrival      IS 'HH:MM:SS UK local — predicted arrival (NULL for ORIGIN stops)';
COMMENT ON COLUMN predicted_gaps.predicted_departure    IS 'HH:MM:SS UK local — predicted departure (NULL for DESTINATION stops)';
COMMENT ON COLUMN journey_stations.predicted_arrival    IS 'HH:MM:SS UK local — predicted arrival (NULL for ORIGIN stops)';
COMMENT ON COLUMN journey_stations.predicted_departure  IS 'HH:MM:SS UK local — predicted departure (NULL for DESTINATION stops)';

COMMIT;
