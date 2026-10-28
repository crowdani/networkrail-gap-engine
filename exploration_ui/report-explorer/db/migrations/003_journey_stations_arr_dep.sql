-- =============================================================================
-- 003_journey_stations_arr_dep.sql
--
-- Adds separate scheduled and actual arrival / departure columns to the
-- journey_stations table.
--
-- These columns are populated by the Confluent JDBC Sink connector
-- (07-connector-journey-stations-sink.json) reading the ALL_STATIONS_FLAT
-- Kafka topic, which in turn is fed by the gap detector's updated payload
-- that separates ARR and DEP movement events per station stop.
--
-- Column semantics:
--   scheduled_arrival   — HH:MM from CIF schedule arrival / public_arrival
--   scheduled_departure — HH:MM from CIF schedule departure / public_departure
--   actual_arrival      — HH:MM:SS from the matched Network Rail ARRIVAL event
--   actual_departure    — HH:MM:SS from the matched Network Rail DEPARTURE event
--
-- Existing rows are unaffected (all four columns default to NULL).
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).
-- =============================================================================

BEGIN;

ALTER TABLE journey_stations
    ADD COLUMN IF NOT EXISTS scheduled_arrival  TEXT,
    ADD COLUMN IF NOT EXISTS scheduled_departure TEXT,
    ADD COLUMN IF NOT EXISTS actual_arrival      TEXT,
    ADD COLUMN IF NOT EXISTS actual_departure    TEXT;

COMMIT;
