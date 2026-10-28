-- =============================================================================
-- 006_ml_training_tables.sql
--
-- ML Training Data — two tables populated automatically from journey_stations.
--
-- ml_stop_features
--   One row per VISITED stop with full timing context and derived features.
--   This is ground-truth data: we know both scheduled and actual times for
--   every dimension.  Features are pre-computed at insert time so the table
--   can be exported directly to a training pipeline (CSV, Parquet, etc.)
--   without any further transformation.
--
-- ml_prediction_log
--   One row per MISSED stop with the infill prediction that was made.
--   When the same train is later re-observed (or ground truth arrives from
--   another source), the actual_* fields can be backfilled and the
--   prediction error computed.  This becomes the evaluation corpus.
--
-- Both tables are populated by the function populate_ml_tables() which is
-- called by an AFTER INSERT OR UPDATE trigger on journey_stations.
-- The function is idempotent (INSERT … ON CONFLICT DO UPDATE).
--
-- Schema notes:
--   • All times stored as SMALLINT minutes-since-midnight (0–1439) for easy
--     arithmetic in Python/sklearn without string parsing.
--   • NULL = not applicable for that stop role (e.g. arrival_mins for ORIGIN).
--   • delay columns: positive = late, negative = early, NULL = no data.
--   • stop_role: ORIGIN | DESTINATION | JUNCTION | INTERMEDIATE
--   • Operator code = first 2 chars of train_uid (NR ATOC convention).
-- =============================================================================

-- =============================================================================
-- 1. ml_stop_features  — ground-truth visited stops
-- =============================================================================

CREATE TABLE IF NOT EXISTS ml_stop_features (
    id                          BIGSERIAL PRIMARY KEY,

    -- ── Identity ────────────────────────────────────────────────────────────
    train_id                    VARCHAR(50)  NOT NULL,
    train_uid                   VARCHAR(50)  NOT NULL,
    operator_code               VARCHAR(2),          -- first 2 chars of train_uid
    schedule_start_date         DATE,
    service_date_dow            SMALLINT,            -- 0=Mon … 6=Sun
    station_index               INTEGER      NOT NULL,
    total_scheduled_stops       INTEGER,
    stanox                      VARCHAR(20),
    tiploc                      VARCHAR(20),
    station_name                VARCHAR(255),
    stop_role                   VARCHAR(20),         -- ORIGIN|DESTINATION|JUNCTION|INTERMEDIATE

    -- ── Position features ───────────────────────────────────────────────────
    journey_position_pct        NUMERIC(5,3),        -- station_index / (total_stops-1)  0.0–1.0
    stops_before                INTEGER,             -- station_index
    stops_remaining             INTEGER,             -- total_stops - station_index - 1

    -- ── Scheduled times (minutes since midnight, 0–1439) ────────────────────
    sched_arrival_mins          SMALLINT,            -- NULL for ORIGIN
    sched_departure_mins        SMALLINT,            -- NULL for DESTINATION
    sched_dwell_mins            SMALLINT,            -- departure_mins - arrival_mins (0 for JUNCTION)
    sched_hour                  SMALLINT,            -- hour of scheduled arrival (for time-of-day)

    -- ── Actual times (minutes since midnight) ───────────────────────────────
    actual_arrival_mins         SMALLINT,            -- NULL for ORIGIN or if not reported
    actual_departure_mins       SMALLINT,            -- NULL for DESTINATION or if not reported

    -- ── Delay labels (target variables) ─────────────────────────────────────
    arrival_delay_mins          NUMERIC(6,2),        -- actual_arrival - sched_arrival
    departure_delay_mins        NUMERIC(6,2),        -- actual_departure - sched_departure

    -- ── Journey-level context ────────────────────────────────────────────────
    journey_severity            VARCHAR(20),         -- LOW|MEDIUM|HIGH|CRITICAL
    missed_stops_count          INTEGER,
    found_stops_count           INTEGER,
    gap_ratio                   NUMERIC(5,3),        -- missed / total

    -- ── Neighbour delay context (computed at insert time from journey data) ──
    -- These are the "before" and "after" visited neighbours, giving the ML
    -- model the same context the heuristic predictor uses.
    prev_visited_index          INTEGER,
    prev_sched_arrival_mins     SMALLINT,
    prev_actual_arrival_mins    SMALLINT,
    prev_arrival_delay_mins     NUMERIC(6,2),
    prev_actual_departure_mins  SMALLINT,
    prev_departure_delay_mins   NUMERIC(6,2),

    next_visited_index          INTEGER,
    next_sched_arrival_mins     SMALLINT,
    next_actual_arrival_mins    SMALLINT,
    next_arrival_delay_mins     NUMERIC(6,2),
    next_actual_departure_mins  SMALLINT,
    next_departure_delay_mins   NUMERIC(6,2),

    -- ── Audit ────────────────────────────────────────────────────────────────
    source_received_at          TIMESTAMP,
    inserted_at                 TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT ml_stop_features_unique
        UNIQUE (train_id, station_index, schedule_start_date)
);

CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_train      ON ml_stop_features(train_id);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_stanox     ON ml_stop_features(stanox);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_operator   ON ml_stop_features(operator_code);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_date       ON ml_stop_features(schedule_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_dow        ON ml_stop_features(service_date_dow);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_role       ON ml_stop_features(stop_role);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_inserted   ON ml_stop_features(inserted_at DESC);
-- Partial index for training queries: rows that have full ground truth
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_complete ON ml_stop_features(schedule_start_date)
    WHERE arrival_delay_mins IS NOT NULL OR departure_delay_mins IS NOT NULL;

COMMENT ON TABLE ml_stop_features IS
    'Ground-truth ML training features: one row per visited stop with pre-computed timing context and delay labels. Export directly for model training.';


-- =============================================================================
-- 2. ml_prediction_log  — missed-stop predictions + evaluation audit
-- =============================================================================

CREATE TABLE IF NOT EXISTS ml_prediction_log (
    id                          BIGSERIAL PRIMARY KEY,

    -- ── Identity ────────────────────────────────────────────────────────────
    train_id                    VARCHAR(50)  NOT NULL,
    train_uid                   VARCHAR(50)  NOT NULL,
    operator_code               VARCHAR(2),
    schedule_start_date         DATE,
    service_date_dow            SMALLINT,
    station_index               INTEGER      NOT NULL,
    total_scheduled_stops       INTEGER,
    stanox                      VARCHAR(20),
    tiploc                      VARCHAR(20),
    station_name                VARCHAR(255),
    stop_role                   VARCHAR(20),

    -- ── Position features (same as ml_stop_features) ────────────────────────
    journey_position_pct        NUMERIC(5,3),
    stops_before                INTEGER,
    stops_remaining             INTEGER,

    -- ── Scheduled times ─────────────────────────────────────────────────────
    sched_arrival_mins          SMALLINT,
    sched_departure_mins        SMALLINT,
    sched_dwell_mins            SMALLINT,
    sched_hour                  SMALLINT,

    -- ── What the heuristic predicted (model input → compare to ML output) ───
    predicted_arrival_mins      SMALLINT,            -- NULL for ORIGIN
    predicted_departure_mins    SMALLINT,            -- NULL for DESTINATION
    predicted_arrival_delay_mins  NUMERIC(6,2),
    predicted_departure_delay_mins NUMERIC(6,2),
    prediction_method           VARCHAR(64),
    prediction_confidence       NUMERIC(5,3),

    -- ── Neighbour context at prediction time ─────────────────────────────────
    before_visited_index        INTEGER,
    before_sched_arrival_mins   SMALLINT,
    before_actual_arrival_mins  SMALLINT,
    before_arrival_delay_mins   NUMERIC(6,2),
    before_actual_departure_mins SMALLINT,
    before_departure_delay_mins NUMERIC(6,2),

    after_visited_index         INTEGER,
    after_sched_arrival_mins    SMALLINT,
    after_actual_arrival_mins   SMALLINT,
    after_arrival_delay_mins    NUMERIC(6,2),
    after_actual_departure_mins SMALLINT,
    after_departure_delay_mins  NUMERIC(6,2),

    -- ── Journey-level context ────────────────────────────────────────────────
    journey_severity            VARCHAR(20),
    missed_stops_count          INTEGER,
    found_stops_count           INTEGER,
    gap_ratio                   NUMERIC(5,3),

    -- ── Ground truth (filled in later if/when actual data arrives) ───────────
    actual_arrival_mins         SMALLINT     DEFAULT NULL,
    actual_departure_mins       SMALLINT     DEFAULT NULL,
    actual_arrival_delay_mins   NUMERIC(6,2) DEFAULT NULL,
    actual_departure_delay_mins NUMERIC(6,2) DEFAULT NULL,
    ground_truth_source         VARCHAR(50)  DEFAULT NULL, -- 'approval'|'backfill'|'operator'

    -- ── Evaluation metrics (filled in after ground truth is known) ───────────
    arrival_error_mins          NUMERIC(6,2) DEFAULT NULL, -- predicted - actual (arrival)
    departure_error_mins        NUMERIC(6,2) DEFAULT NULL, -- predicted - actual (departure)

    -- ── Approval workflow link ───────────────────────────────────────────────
    approval_status             VARCHAR(20),

    -- ── Audit ────────────────────────────────────────────────────────────────
    source_received_at          TIMESTAMP,
    inserted_at                 TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT ml_prediction_log_unique
        UNIQUE (train_id, station_index, schedule_start_date)
);

CREATE INDEX IF NOT EXISTS idx_ml_pred_log_train      ON ml_prediction_log(train_id);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_stanox     ON ml_prediction_log(stanox);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_operator   ON ml_prediction_log(operator_code);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_date       ON ml_prediction_log(schedule_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_method     ON ml_prediction_log(prediction_method);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_inserted   ON ml_prediction_log(inserted_at DESC);
-- Partial index for evaluation queries: rows with ground truth
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_evaluated ON ml_prediction_log(schedule_start_date)
    WHERE ground_truth_source IS NOT NULL;

COMMENT ON TABLE ml_prediction_log IS
    'ML evaluation corpus: one row per missed-stop prediction with heuristic output and neighbour context. Ground truth columns are backfilled when operator approves or actual data arrives.';


-- =============================================================================
-- 3. Helper: time string → minutes-since-midnight
--    Accepts "HH:MM", "HH:MM:SS", "HH:MM:SS.mmm"
-- =============================================================================

CREATE OR REPLACE FUNCTION time_to_mins(t TEXT)
RETURNS SMALLINT
LANGUAGE plpgsql IMMUTABLE CALLED ON NULL INPUT AS $$
DECLARE
    h SMALLINT;
    m SMALLINT;
BEGIN
    IF t IS NULL OR t = '' THEN RETURN NULL; END IF;
    BEGIN
        h := SPLIT_PART(t, ':', 1)::SMALLINT;
        m := SPLIT_PART(t, ':', 2)::SMALLINT;
        RETURN (h * 60 + m)::SMALLINT;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
END;
$$;

COMMENT ON FUNCTION time_to_mins IS
    'Convert HH:MM or HH:MM:SS time string to minutes since midnight (0–1439). Returns NULL on bad input.';


-- =============================================================================
-- 4. Core population function
--    Called by the trigger on journey_stations after each insert/update.
--    Derives neighbour context by querying other rows in journey_stations
--    for the same (train_id, schedule_start_date).
-- =============================================================================

CREATE OR REPLACE FUNCTION populate_ml_tables()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_operator       VARCHAR(2);
    v_dow            SMALLINT;
    v_sched_date     DATE;
    v_pos_pct        NUMERIC(5,3);
    v_total          INTEGER;
    v_gap_ratio      NUMERIC(5,3);

    -- Scheduled times (mins)
    v_sched_arr      SMALLINT;
    v_sched_dep      SMALLINT;
    v_sched_dwell    SMALLINT;
    v_sched_hour     SMALLINT;

    -- Actual times (mins)
    v_act_arr        SMALLINT;
    v_act_dep        SMALLINT;

    -- Predicted times (mins) — for missed stops
    v_pred_arr       SMALLINT;
    v_pred_dep       SMALLINT;

    -- Delay labels
    v_arr_delay      NUMERIC(6,2);
    v_dep_delay      NUMERIC(6,2);
    v_pred_arr_delay NUMERIC(6,2);
    v_pred_dep_delay NUMERIC(6,2);

    -- Stop role (derive same logic as Python infill_predictor)
    v_stop_role      VARCHAR(20);
    v_min_idx        INTEGER;
    v_max_idx        INTEGER;

    -- Neighbour rows
    prev_row         RECORD;
    next_row         RECORD;

    -- Neighbour feature variables
    v_prev_idx              INTEGER;
    v_prev_sched_arr        SMALLINT;
    v_prev_act_arr          SMALLINT;
    v_prev_arr_delay        NUMERIC(6,2);
    v_prev_act_dep          SMALLINT;
    v_prev_dep_delay        NUMERIC(6,2);

    v_next_idx              INTEGER;
    v_next_sched_arr        SMALLINT;
    v_next_act_arr          SMALLINT;
    v_next_arr_delay        NUMERIC(6,2);
    v_next_act_dep          SMALLINT;
    v_next_dep_delay        NUMERIC(6,2);
BEGIN
    -- ── Skip junction stops — no useful training signal ──────────────────────
    IF NEW.prediction_basis LIKE '%"stop_role":"JUNCTION"%'
    OR NEW.prediction_basis LIKE '%"stop_role": "JUNCTION"%' THEN
        RETURN NEW;
    END IF;

    -- ── Basic derived values ─────────────────────────────────────────────────
    v_operator := LEFT(COALESCE(NEW.train_uid, ''), 2);

    BEGIN
        v_sched_date := NEW.schedule_start_date::DATE;
    EXCEPTION WHEN OTHERS THEN
        v_sched_date := NULL;
    END;

    v_dow := CASE WHEN v_sched_date IS NOT NULL
                  THEN EXTRACT(ISODOW FROM v_sched_date)::SMALLINT - 1  -- 0=Mon
                  ELSE NULL END;

    v_total := COALESCE(NEW.total_scheduled_stops, 0);
    v_pos_pct := CASE WHEN v_total > 1
                      THEN ROUND(NEW.station_index::NUMERIC / (v_total - 1), 3)
                      ELSE 0 END;

    v_gap_ratio := CASE WHEN v_total > 0
                        THEN ROUND(COALESCE(NEW.missed_stops_count, 0)::NUMERIC / v_total, 3)
                        ELSE 0 END;

    -- ── Time conversions ─────────────────────────────────────────────────────
    v_sched_arr   := time_to_mins(NEW.scheduled_arrival);
    v_sched_dep   := time_to_mins(NEW.scheduled_departure);
    v_sched_dwell := CASE WHEN v_sched_arr IS NOT NULL AND v_sched_dep IS NOT NULL
                          THEN GREATEST(0, v_sched_dep - v_sched_arr)
                          ELSE 0 END;
    v_sched_hour  := CASE WHEN v_sched_arr IS NOT NULL THEN (v_sched_arr / 60)::SMALLINT
                          WHEN v_sched_dep IS NOT NULL THEN (v_sched_dep / 60)::SMALLINT
                          ELSE NULL END;

    v_act_arr  := time_to_mins(NEW.actual_arrival);
    v_act_dep  := time_to_mins(NEW.actual_departure);
    v_pred_arr := time_to_mins(NEW.predicted_arrival);
    v_pred_dep := time_to_mins(NEW.predicted_departure);

    -- ── Delay labels ─────────────────────────────────────────────────────────
    v_arr_delay := CASE WHEN v_act_arr  IS NOT NULL AND v_sched_arr IS NOT NULL
                        THEN (v_act_arr  - v_sched_arr)::NUMERIC(6,2)
                        ELSE NULL END;
    v_dep_delay := CASE WHEN v_act_dep  IS NOT NULL AND v_sched_dep IS NOT NULL
                        THEN (v_act_dep  - v_sched_dep)::NUMERIC(6,2)
                        ELSE NULL END;

    v_pred_arr_delay := CASE WHEN v_pred_arr IS NOT NULL AND v_sched_arr IS NOT NULL
                             THEN (v_pred_arr - v_sched_arr)::NUMERIC(6,2)
                             ELSE NULL END;
    v_pred_dep_delay := CASE WHEN v_pred_dep IS NOT NULL AND v_sched_dep IS NOT NULL
                             THEN (v_pred_dep - v_sched_dep)::NUMERIC(6,2)
                             ELSE NULL END;

    -- ── Stop role ─────────────────────────────────────────────────────────────
    SELECT MIN(station_index), MAX(station_index)
    INTO   v_min_idx, v_max_idx
    FROM   journey_stations
    WHERE  train_id            = NEW.train_id
      AND  schedule_start_date = NEW.schedule_start_date;

    v_stop_role :=
        CASE WHEN NEW.station_index = v_min_idx THEN 'ORIGIN'
             WHEN NEW.station_index = v_max_idx THEN 'DESTINATION'
             WHEN NEW.scheduled_arrival IS NOT NULL AND NEW.scheduled_departure IS NOT NULL
               THEN 'INTERMEDIATE'
             ELSE 'JUNCTION'
        END;

    -- ── Skip junctions again (those without separate arr/dep times) ───────────
    IF v_stop_role = 'JUNCTION' THEN RETURN NEW; END IF;

    -- ── Nearest visited neighbour BEFORE this stop ────────────────────────────
    SELECT js.*
    INTO   prev_row
    FROM   journey_stations js
    WHERE  js.train_id            = NEW.train_id
      AND  js.schedule_start_date = NEW.schedule_start_date
      AND  js.station_index       < NEW.station_index
      AND  js.visited             = true
    ORDER  BY js.station_index DESC
    LIMIT  1;

    IF prev_row IS NOT NULL THEN
        v_prev_idx       := prev_row.station_index;
        v_prev_sched_arr := time_to_mins(prev_row.scheduled_arrival);
        v_prev_act_arr   := time_to_mins(prev_row.actual_arrival);
        v_prev_act_dep   := time_to_mins(prev_row.actual_departure);
        v_prev_arr_delay := CASE WHEN v_prev_act_arr IS NOT NULL AND v_prev_sched_arr IS NOT NULL
                                 THEN (v_prev_act_arr - v_prev_sched_arr)::NUMERIC(6,2)
                                 ELSE NULL END;
        v_prev_dep_delay := CASE WHEN v_prev_act_dep IS NOT NULL
                                       AND time_to_mins(prev_row.scheduled_departure) IS NOT NULL
                                 THEN (v_prev_act_dep - time_to_mins(prev_row.scheduled_departure))::NUMERIC(6,2)
                                 ELSE NULL END;
    END IF;

    -- ── Nearest visited neighbour AFTER this stop ──────────────────────────────
    SELECT js.*
    INTO   next_row
    FROM   journey_stations js
    WHERE  js.train_id            = NEW.train_id
      AND  js.schedule_start_date = NEW.schedule_start_date
      AND  js.station_index       > NEW.station_index
      AND  js.visited             = true
    ORDER  BY js.station_index ASC
    LIMIT  1;

    IF next_row IS NOT NULL THEN
        v_next_idx       := next_row.station_index;
        v_next_sched_arr := time_to_mins(next_row.scheduled_arrival);
        v_next_act_arr   := time_to_mins(next_row.actual_arrival);
        v_next_act_dep   := time_to_mins(next_row.actual_departure);
        v_next_arr_delay := CASE WHEN v_next_act_arr IS NOT NULL AND v_next_sched_arr IS NOT NULL
                                 THEN (v_next_act_arr - v_next_sched_arr)::NUMERIC(6,2)
                                 ELSE NULL END;
        v_next_dep_delay := CASE WHEN v_next_act_dep IS NOT NULL
                                       AND time_to_mins(next_row.scheduled_departure) IS NOT NULL
                                 THEN (v_next_act_dep - time_to_mins(next_row.scheduled_departure))::NUMERIC(6,2)
                                 ELSE NULL END;
    END IF;

    -- ── Route to the right table ───────────────────────────────────────────────
    IF NEW.visited = true THEN
        -- Ground-truth row → ml_stop_features
        INSERT INTO ml_stop_features (
            train_id, train_uid, operator_code,
            schedule_start_date, service_date_dow,
            station_index, total_scheduled_stops, stanox, tiploc, station_name, stop_role,
            journey_position_pct, stops_before, stops_remaining,
            sched_arrival_mins, sched_departure_mins, sched_dwell_mins, sched_hour,
            actual_arrival_mins, actual_departure_mins,
            arrival_delay_mins, departure_delay_mins,
            journey_severity, missed_stops_count, found_stops_count, gap_ratio,
            prev_visited_index, prev_sched_arrival_mins,
            prev_actual_arrival_mins, prev_arrival_delay_mins,
            prev_actual_departure_mins, prev_departure_delay_mins,
            next_visited_index, next_sched_arrival_mins,
            next_actual_arrival_mins, next_arrival_delay_mins,
            next_actual_departure_mins, next_departure_delay_mins,
            source_received_at
        ) VALUES (
            NEW.train_id, NEW.train_uid, v_operator,
            v_sched_date, v_dow,
            NEW.station_index, NEW.total_scheduled_stops, NEW.stanox, NEW.tiploc, NEW.station_name, v_stop_role,
            v_pos_pct,
            NEW.station_index,
            GREATEST(0, v_total - NEW.station_index - 1),
            v_sched_arr, v_sched_dep, v_sched_dwell, v_sched_hour,
            v_act_arr, v_act_dep,
            v_arr_delay, v_dep_delay,
            NEW.severity, NEW.missed_stops_count, NEW.found_stops_count, v_gap_ratio,
            v_prev_idx, v_prev_sched_arr,
            v_prev_act_arr, v_prev_arr_delay,
            v_prev_act_dep, v_prev_dep_delay,
            v_next_idx, v_next_sched_arr,
            v_next_act_arr, v_next_arr_delay,
            v_next_act_dep, v_next_dep_delay,
            NEW.received_at
        )
        ON CONFLICT (train_id, station_index, schedule_start_date) DO UPDATE SET
            actual_arrival_mins        = EXCLUDED.actual_arrival_mins,
            actual_departure_mins      = EXCLUDED.actual_departure_mins,
            arrival_delay_mins         = EXCLUDED.arrival_delay_mins,
            departure_delay_mins       = EXCLUDED.departure_delay_mins,
            prev_visited_index         = EXCLUDED.prev_visited_index,
            prev_sched_arrival_mins    = EXCLUDED.prev_sched_arrival_mins,
            prev_actual_arrival_mins   = EXCLUDED.prev_actual_arrival_mins,
            prev_arrival_delay_mins    = EXCLUDED.prev_arrival_delay_mins,
            prev_actual_departure_mins = EXCLUDED.prev_actual_departure_mins,
            prev_departure_delay_mins  = EXCLUDED.prev_departure_delay_mins,
            next_visited_index         = EXCLUDED.next_visited_index,
            next_sched_arrival_mins    = EXCLUDED.next_sched_arrival_mins,
            next_actual_arrival_mins   = EXCLUDED.next_actual_arrival_mins,
            next_arrival_delay_mins    = EXCLUDED.next_arrival_delay_mins,
            next_actual_departure_mins = EXCLUDED.next_actual_departure_mins,
            next_departure_delay_mins  = EXCLUDED.next_departure_delay_mins,
            journey_severity           = EXCLUDED.journey_severity,
            gap_ratio                  = EXCLUDED.gap_ratio,
            updated_at                 = NOW();

    ELSE
        -- Missed-stop prediction → ml_prediction_log
        -- Only insert if a prediction was made (skip INSUFFICIENT_DATA rows)
        IF NEW.predicted_arrival IS NOT NULL OR NEW.predicted_departure IS NOT NULL THEN
            INSERT INTO ml_prediction_log (
                train_id, train_uid, operator_code,
                schedule_start_date, service_date_dow,
                station_index, total_scheduled_stops, stanox, tiploc, station_name, stop_role,
                journey_position_pct, stops_before, stops_remaining,
                sched_arrival_mins, sched_departure_mins, sched_dwell_mins, sched_hour,
                predicted_arrival_mins, predicted_departure_mins,
                predicted_arrival_delay_mins, predicted_departure_delay_mins,
                prediction_method, prediction_confidence,
                before_visited_index, before_sched_arrival_mins,
                before_actual_arrival_mins, before_arrival_delay_mins,
                before_actual_departure_mins, before_departure_delay_mins,
                after_visited_index, after_sched_arrival_mins,
                after_actual_arrival_mins, after_arrival_delay_mins,
                after_actual_departure_mins, after_departure_delay_mins,
                journey_severity, missed_stops_count, found_stops_count, gap_ratio,
                approval_status, source_received_at
            ) VALUES (
                NEW.train_id, NEW.train_uid, v_operator,
                v_sched_date, v_dow,
                NEW.station_index, NEW.total_scheduled_stops, NEW.stanox, NEW.tiploc, NEW.station_name, v_stop_role,
                v_pos_pct,
                NEW.station_index,
                GREATEST(0, v_total - NEW.station_index - 1),
                v_sched_arr, v_sched_dep, v_sched_dwell, v_sched_hour,
                v_pred_arr, v_pred_dep,
                v_pred_arr_delay, v_pred_dep_delay,
                NEW.prediction_method, NEW.prediction_confidence,
                v_prev_idx, v_prev_sched_arr,
                v_prev_act_arr, v_prev_arr_delay,
                v_prev_act_dep, v_prev_dep_delay,
                v_next_idx, v_next_sched_arr,
                v_next_act_arr, v_next_arr_delay,
                v_next_act_dep, v_next_dep_delay,
                NEW.severity, NEW.missed_stops_count, NEW.found_stops_count, v_gap_ratio,
                COALESCE(NEW.approval_status, 'PENDING'), NEW.received_at
            )
            ON CONFLICT (train_id, station_index, schedule_start_date) DO UPDATE SET
                predicted_arrival_mins         = EXCLUDED.predicted_arrival_mins,
                predicted_departure_mins       = EXCLUDED.predicted_departure_mins,
                predicted_arrival_delay_mins   = EXCLUDED.predicted_arrival_delay_mins,
                predicted_departure_delay_mins = EXCLUDED.predicted_departure_delay_mins,
                prediction_method              = EXCLUDED.prediction_method,
                prediction_confidence          = EXCLUDED.prediction_confidence,
                before_visited_index           = EXCLUDED.before_visited_index,
                before_sched_arrival_mins      = EXCLUDED.before_sched_arrival_mins,
                before_actual_arrival_mins     = EXCLUDED.before_actual_arrival_mins,
                before_arrival_delay_mins      = EXCLUDED.before_arrival_delay_mins,
                before_actual_departure_mins   = EXCLUDED.before_actual_departure_mins,
                before_departure_delay_mins    = EXCLUDED.before_departure_delay_mins,
                after_visited_index            = EXCLUDED.after_visited_index,
                after_sched_arrival_mins       = EXCLUDED.after_sched_arrival_mins,
                after_actual_arrival_mins      = EXCLUDED.after_actual_arrival_mins,
                after_arrival_delay_mins       = EXCLUDED.after_arrival_delay_mins,
                after_actual_departure_mins    = EXCLUDED.after_actual_departure_mins,
                after_departure_delay_mins     = EXCLUDED.after_departure_delay_mins,
                approval_status                = EXCLUDED.approval_status,
                journey_severity               = EXCLUDED.journey_severity,
                gap_ratio                      = EXCLUDED.gap_ratio,
                updated_at                     = NOW();
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION populate_ml_tables IS
    'Trigger function: populates ml_stop_features (visited) or ml_prediction_log (missed) from each journey_stations row. Skips JUNCTION stops. Idempotent via ON CONFLICT DO UPDATE.';


-- =============================================================================
-- 5. Trigger on journey_stations
-- =============================================================================

DROP TRIGGER IF EXISTS trg_ml_populate ON journey_stations;
CREATE TRIGGER trg_ml_populate
    AFTER INSERT OR UPDATE ON journey_stations
    FOR EACH ROW
    EXECUTE FUNCTION populate_ml_tables();


-- =============================================================================
-- 6. Backfill existing data
--    Touch every journey_stations row in journey order to fire the trigger.
--    Processing in (train_id, schedule_start_date, station_index) order ensures
--    that when the trigger looks up prev/next neighbours, earlier stops are
--    already present in ml_stop_features.
-- =============================================================================

DO $$
DECLARE
    r         RECORD;
    processed INTEGER := 0;
BEGIN
    RAISE NOTICE 'Backfilling ML tables from existing journey_stations rows…';
    FOR r IN
        SELECT ctid
        FROM   journey_stations
        ORDER  BY train_id, schedule_start_date, station_index
    LOOP
        UPDATE journey_stations
        SET    updated_at = NOW()
        WHERE  ctid = r.ctid;
        processed := processed + 1;
    END LOOP;
    RAISE NOTICE 'Backfill complete: % rows processed', processed;
END;
$$;


-- =============================================================================
-- 7. Convenience view: ready-to-export training dataset
--    Joins ml_stop_features with operator reference and filters to rows
--    that have at least one delay label (usable for supervised learning).
-- =============================================================================

CREATE OR REPLACE VIEW ml_training_export AS
SELECT
    -- Identity
    f.train_id,
    f.operator_code,
    f.schedule_start_date,
    f.service_date_dow,
    f.stanox,
    f.station_name,
    f.stop_role,

    -- Position features
    f.journey_position_pct,
    f.stops_before,
    f.stops_remaining,
    f.total_scheduled_stops,

    -- Scheduled time features
    f.sched_arrival_mins,
    f.sched_departure_mins,
    f.sched_dwell_mins,
    f.sched_hour,

    -- Journey context
    f.journey_severity,
    f.gap_ratio,
    f.missed_stops_count,
    f.found_stops_count,

    -- Neighbour delays (the same features the heuristic uses)
    f.prev_arrival_delay_mins,
    f.prev_departure_delay_mins,
    f.next_arrival_delay_mins,
    f.next_departure_delay_mins,

    -- Target labels
    f.arrival_delay_mins,
    f.departure_delay_mins

FROM   ml_stop_features f
WHERE  (f.arrival_delay_mins IS NOT NULL OR f.departure_delay_mins IS NOT NULL)
  AND  f.stop_role != 'JUNCTION'
ORDER  BY f.schedule_start_date DESC, f.train_id, f.station_index;

COMMENT ON VIEW ml_training_export IS
    'Ready-to-export ML training rows: visited stops with complete delay labels. Export with COPY or \copy for sklearn/XGBoost training.';


-- =============================================================================
-- 8. Stats view for monitoring training data growth
-- =============================================================================

CREATE OR REPLACE VIEW ml_data_stats AS
SELECT
    'ml_stop_features'                AS table_name,
    COUNT(*)                          AS total_rows,
    COUNT(DISTINCT train_id)          AS unique_trains,
    COUNT(DISTINCT stanox)            AS unique_stations,
    COUNT(DISTINCT operator_code)     AS unique_operators,
    COUNT(*) FILTER (WHERE arrival_delay_mins   IS NOT NULL) AS with_arrival_label,
    COUNT(*) FILTER (WHERE departure_delay_mins IS NOT NULL) AS with_departure_label,
    MIN(schedule_start_date)          AS earliest_date,
    MAX(schedule_start_date)          AS latest_date
FROM ml_stop_features
UNION ALL
SELECT
    'ml_prediction_log',
    COUNT(*),
    COUNT(DISTINCT train_id),
    COUNT(DISTINCT stanox),
    COUNT(DISTINCT operator_code),
    COUNT(*) FILTER (WHERE actual_arrival_mins   IS NOT NULL),
    COUNT(*) FILTER (WHERE actual_departure_mins IS NOT NULL),
    MIN(schedule_start_date),
    MAX(schedule_start_date)
FROM ml_prediction_log;

COMMENT ON VIEW ml_data_stats IS
    'Quick summary of ML training data volume — check after deployment to verify backfill and ongoing ingestion.';


SELECT 'ML training tables created successfully' AS status;
