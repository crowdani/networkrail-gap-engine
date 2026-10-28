-- =============================================================================
-- 003_predicted_gaps_type_fixes.sql
--
-- Fixes column type mismatches that cause the Confluent JDBC Sink to fail with
-- BatchUpdateException when inserting into predicted_gaps.
--
-- Root causes:
--   1. prediction_basis JSONB — the sink sends this as a VARCHAR string (ksqlDB
--      emits prediction_basis as VARCHAR from station->prediction_basis).
--      PostgreSQL rejects the implicit string → jsonb cast in a batch INSERT.
--      Fix: change to TEXT so the string is stored as-is.
--
--   2. prediction_confidence NUMERIC(4,3) — the sink sends float64 (DOUBLE
--      PRECISION). Values like 0.7 are fine, but NUMERIC(4,3) only allows
--      values with at most 1 digit before the decimal point (e.g. 0.700).
--      Any value ≥ 1.000 would overflow, and the precision mismatch causes
--      silent rounding issues. Fix: change to DOUBLE PRECISION to match the
--      sink schema (connect.type=float64).
--
--   3. scheduled_time / actual_time / predicted_time VARCHAR(10) — the gap
--      engine produces "HH:MM:SS" (8 chars) which fits, but some values like
--      "HH:MM:SS.mmm" could exceed 10 chars. Widen to VARCHAR(20) to be safe.
--
-- Safe to run multiple times.
-- =============================================================================

BEGIN;

-- 1. prediction_basis: JSONB → TEXT
--    The JDBC sink sends this as a plain JSON string; TEXT accepts it directly.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'predicted_gaps'
          AND column_name = 'prediction_basis'
          AND data_type = 'jsonb'
    ) THEN
        ALTER TABLE predicted_gaps
            ALTER COLUMN prediction_basis TYPE TEXT
            USING prediction_basis::text;
        RAISE NOTICE 'predicted_gaps.prediction_basis changed from JSONB to TEXT';
    ELSE
        RAISE NOTICE 'predicted_gaps.prediction_basis already TEXT (or absent) — skipped';
    END IF;
END $$;

-- 2. prediction_confidence: NUMERIC(4,3) → DOUBLE PRECISION
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'predicted_gaps'
          AND column_name = 'prediction_confidence'
          AND data_type = 'numeric'
    ) THEN
        ALTER TABLE predicted_gaps
            ALTER COLUMN prediction_confidence TYPE DOUBLE PRECISION
            USING prediction_confidence::double precision;
        RAISE NOTICE 'predicted_gaps.prediction_confidence changed from NUMERIC to DOUBLE PRECISION';
    ELSE
        RAISE NOTICE 'predicted_gaps.prediction_confidence already DOUBLE PRECISION — skipped';
    END IF;
END $$;

-- 3. Widen time columns to VARCHAR(20)
DO $$
DECLARE
    col TEXT;
BEGIN
    FOREACH col IN ARRAY ARRAY['scheduled_time','actual_time','predicted_time','approved_time']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name  = 'predicted_gaps'
              AND column_name = col
              AND character_maximum_length < 20
        ) THEN
            EXECUTE format(
                'ALTER TABLE predicted_gaps ALTER COLUMN %I TYPE VARCHAR(20)',
                col
            );
            RAISE NOTICE 'predicted_gaps.% widened to VARCHAR(20)', col;
        END IF;
    END LOOP;
END $$;

COMMIT;
