-- =============================================================================
-- Network Rail Gap Engine — OpenShift PostgreSQL Init Script
-- Generated from live local database (network_rail)
-- Run once after the PostgreSQL pod is healthy.
--
-- Usage (from oc exec or a Kubernetes Job):
--   psql -U postgres -d network_rail -f init-db.sql
-- =============================================================================

-- =============================================================================
-- 1. CORPUS REFERENCE  (must exist before timetable + functions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tiploc_reference (
    id          SERIAL PRIMARY KEY,
    nlc         VARCHAR(6) UNIQUE,
    stanox      VARCHAR(7),
    tiploc      VARCHAR(7),
    three_alpha VARCHAR(3),
    uic         VARCHAR(7),
    nlc_desc    VARCHAR(255),
    nlc_desc_16 VARCHAR(32),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Widen nlc_desc_16 if it was created with the old VARCHAR(16) definition
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tiploc_reference'
          AND column_name = 'nlc_desc_16'
          AND character_maximum_length < 32
    ) THEN
        ALTER TABLE tiploc_reference ALTER COLUMN nlc_desc_16 TYPE VARCHAR(32);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tiploc_ref_stanox ON tiploc_reference(stanox);
CREATE INDEX IF NOT EXISTS idx_tiploc_ref_tiploc ON tiploc_reference(tiploc);
CREATE INDEX IF NOT EXISTS idx_tiploc_ref_crs    ON tiploc_reference(three_alpha);

CREATE OR REPLACE VIEW active_locations AS
SELECT DISTINCT ON (stanox)
    stanox,
    tiploc,
    three_alpha,
    COALESCE(nlc_desc_16, nlc_desc, tiploc, stanox) AS location_name,
    nlc_desc,
    nlc_desc_16
FROM tiploc_reference
WHERE stanox IS NOT NULL
ORDER BY stanox, three_alpha NULLS LAST, tiploc NULLS LAST;

COMMENT ON TABLE tiploc_reference IS 'Network Rail CORPUS reference data: TIPLOC/STANOX/CRS mappings';
COMMENT ON VIEW  active_locations  IS 'One row per STANOX with best available location name';

-- =============================================================================
-- 2. GAPS  (core gap records — no FK dependencies)
-- =============================================================================

CREATE TABLE IF NOT EXISTS gaps (
    id                      SERIAL PRIMARY KEY,
    train_id                VARCHAR(50)  NOT NULL,
    train_uid               VARCHAR(50)  NOT NULL,
    detected_at             TIMESTAMP    NOT NULL DEFAULT NOW(),

    -- Gap location
    missed_station_stanox   VARCHAR(20)  NOT NULL,
    missed_station_tiploc   VARCHAR(20),
    previous_station_stanox VARCHAR(20)  NOT NULL,
    previous_station_tiploc VARCHAR(20),
    next_station_stanox     VARCHAR(20)  NOT NULL,
    next_station_tiploc     VARCHAR(20),

    -- Classification
    severity                VARCHAR(20)  NOT NULL
        CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    confidence_score        DECIMAL(3,2) DEFAULT 1.0,
    gap_type                VARCHAR(50)  DEFAULT 'MISSED_STOP',

    -- Context
    scheduled_route         TEXT[],
    actual_route            TEXT[],
    timing_data             JSONB,

    -- Metadata
    operator_code           VARCHAR(10),
    service_code            VARCHAR(20),
    is_verified             BOOLEAN      DEFAULT FALSE,
    notes                   TEXT,

    -- Journey link (FK added after train_journeys is created)
    journey_id              INTEGER,

    -- Prediction / infill fields
    archived                BOOLEAN      DEFAULT FALSE,
    predicted_time          TIMESTAMP,
    predicted_delay_minutes INTEGER,
    prediction_confidence   NUMERIC,
    prediction_method       VARCHAR(64),
    infill_time             TIMESTAMP,
    infill_status           VARCHAR(32),

    -- Workflow / audit fields
    archived_at             TIMESTAMP,
    archived_by             VARCHAR(100),
    updated_at              TIMESTAMP    DEFAULT NOW(),

    CONSTRAINT gaps_train_id_idx UNIQUE (train_id, missed_station_stanox, detected_at)
);

CREATE INDEX IF NOT EXISTS idx_gaps_detected_at    ON gaps(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_gaps_train_id       ON gaps(train_id);
CREATE INDEX IF NOT EXISTS idx_gaps_severity       ON gaps(severity);
CREATE INDEX IF NOT EXISTS idx_gaps_missed_station ON gaps(missed_station_stanox);

-- =============================================================================
-- 3. TRAIN POSITIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS train_positions (
    train_id              VARCHAR(50) PRIMARY KEY,
    train_uid             VARCHAR(50) NOT NULL,

    -- Current position
    current_stanox        VARCHAR(20),
    current_tiploc        VARCHAR(20),
    last_update           TIMESTAMP   NOT NULL DEFAULT NOW(),

    -- Movement details
    event_type            VARCHAR(20),
    platform              VARCHAR(10),
    direction             VARCHAR(10),

    -- Status
    status                VARCHAR(20) DEFAULT 'ACTIVE',
    delay_minutes         INTEGER     DEFAULT 0,
    variation_status      VARCHAR(20),

    -- Route tracking
    origin_stanox         VARCHAR(20),
    destination_stanox    VARCHAR(20),
    scheduled_route       TEXT[],
    visited_stations      TEXT[],
    next_expected_stanox  VARCHAR(20),

    -- Metadata
    operator_code         VARCHAR(10),
    service_code          VARCHAR(20),
    activated_at          TIMESTAMP,
    on_time_performance   DECIMAL(5,2)
);

CREATE INDEX IF NOT EXISTS idx_train_positions_status        ON train_positions(status);
CREATE INDEX IF NOT EXISTS idx_train_positions_last_update   ON train_positions(last_update DESC);
CREATE INDEX IF NOT EXISTS idx_train_positions_current_stanox ON train_positions(current_stanox);

-- =============================================================================
-- 4. TRAIN JOURNEYS  (merged definition from all schema files + live columns)
-- =============================================================================

CREATE TABLE IF NOT EXISTS train_journeys (
    id                    SERIAL       PRIMARY KEY,
    train_id              VARCHAR(50)  NOT NULL,
    train_uid             VARCHAR(50)  NOT NULL,

    -- Journey status
    -- ACTIVE | IN_PROGRESS | COMPLETED | TIMEOUT | CANCELLED | ANALYZED
    status                VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',

    -- Timestamps
    activated_at          TIMESTAMP,
    first_movement_at     TIMESTAMP,
    last_movement_at      TIMESTAMP,
    terminated_at         TIMESTAMP,
    analyzed_at           TIMESTAMP,
    scheduled_start       TIMESTAMP,
    actual_start          TIMESTAMP,
    scheduled_end         TIMESTAMP,
    actual_end            TIMESTAMP,

    -- Location
    origin_stanox         VARCHAR(20),
    origin_tiploc         VARCHAR(20),
    destination_stanox    VARCHAR(20),
    destination_tiploc    VARCHAR(20),

    -- Route
    scheduled_route       TEXT[],
    actual_route          TEXT[],

    -- Performance
    total_gaps            INTEGER      DEFAULT 0,
    total_delay_minutes   INTEGER      DEFAULT 0,
    on_time_performance   DECIMAL(5,2),
    completion_percentage DECIMAL(5,2),

    -- Metadata
    operator_code         VARCHAR(10),
    service_code          VARCHAR(20),
    service_date          DATE,

    -- Analysis
    has_gaps              BOOLEAN      DEFAULT FALSE,
    gap_ids               INTEGER[],
    pattern_ids           INTEGER[],
    total_movements       INTEGER      DEFAULT 0,
    gaps_detected         INTEGER      DEFAULT 0,

    -- Timestamps
    created_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT train_journeys_train_id_unique UNIQUE (train_id),
    CONSTRAINT valid_status CHECK (
        status IN ('ACTIVE','IN_PROGRESS','COMPLETED','TIMEOUT','CANCELLED','ANALYZED')
    )
);

CREATE INDEX IF NOT EXISTS idx_journeys_status          ON train_journeys(status);
CREATE INDEX IF NOT EXISTS idx_journeys_train_id        ON train_journeys(train_id);
CREATE INDEX IF NOT EXISTS idx_journeys_train_uid       ON train_journeys(train_uid);
CREATE INDEX IF NOT EXISTS idx_journeys_activated       ON train_journeys(activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_journeys_last_movement   ON train_journeys(last_movement_at DESC);
CREATE INDEX IF NOT EXISTS idx_journeys_status_analyzed ON train_journeys(status, analyzed_at)
    WHERE analyzed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_train_journeys_status      ON train_journeys(status);
CREATE INDEX IF NOT EXISTS idx_train_journeys_train_id    ON train_journeys(train_id);
CREATE INDEX IF NOT EXISTS idx_train_journeys_has_gaps    ON train_journeys(has_gaps);
CREATE INDEX IF NOT EXISTS idx_train_journeys_actual_start ON train_journeys(actual_start DESC);

-- Now add the FK from gaps → train_journeys
ALTER TABLE gaps ADD CONSTRAINT gaps_journey_id_fkey
    FOREIGN KEY (journey_id) REFERENCES train_journeys(id);

CREATE INDEX IF NOT EXISTS idx_gaps_journey_id ON gaps(journey_id);

-- =============================================================================
-- 5. JOURNEY MOVEMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS journey_movements (
    journey_id      BIGINT       NOT NULL,
    train_id        VARCHAR(32)  NOT NULL,
    stanox          VARCHAR(16)  NOT NULL,
    tiploc          VARCHAR(16),
    scheduled_time  TIMESTAMP,
    actual_time     TIMESTAMP    NOT NULL,
    delay_minutes   INTEGER      DEFAULT 0,
    event_type      VARCHAR(16),
    platform        VARCHAR(16),
    sequence_number INTEGER,

    PRIMARY KEY (journey_id, stanox, actual_time)
);

-- =============================================================================
-- 6. AI PATTERN DETECTION
-- =============================================================================

CREATE TABLE IF NOT EXISTS station_patterns (
    id                    SERIAL       PRIMARY KEY,
    stanox                VARCHAR(20)  NOT NULL,
    tiploc                VARCHAR(20),

    pattern_type          VARCHAR(50)  NOT NULL,
    description           TEXT         NOT NULL,

    occurrence_count      INTEGER      DEFAULT 0,
    first_detected        TIMESTAMP    NOT NULL,
    last_detected         TIMESTAMP    NOT NULL,

    confidence_score      DECIMAL(3,2) NOT NULL,
    ai_insights           JSONB,
    recommendations       TEXT,

    time_of_day_pattern   JSONB,
    day_of_week_pattern   JSONB,

    severity_distribution JSONB,
    affected_operators    TEXT[],
    affected_services     TEXT[],

    is_active             BOOLEAN      DEFAULT TRUE,
    reviewed_by           VARCHAR(100),
    reviewed_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_station_patterns_stanox     ON station_patterns(stanox);
CREATE INDEX IF NOT EXISTS idx_station_patterns_type       ON station_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_station_patterns_active     ON station_patterns(is_active);
CREATE INDEX IF NOT EXISTS idx_station_patterns_confidence ON station_patterns(confidence_score DESC);

CREATE TABLE IF NOT EXISTS route_patterns (
    id               SERIAL       PRIMARY KEY,
    route_segment    TEXT         NOT NULL,

    pattern_type     VARCHAR(50)  NOT NULL,
    description      TEXT         NOT NULL,

    occurrence_count INTEGER      DEFAULT 0,
    first_detected   TIMESTAMP    NOT NULL,
    last_detected    TIMESTAMP    NOT NULL,

    confidence_score DECIMAL(3,2) NOT NULL,
    ai_insights      JSONB,
    recommendations  TEXT,

    affected_operators       TEXT[],
    average_delay_minutes    DECIMAL(5,2),

    is_active        BOOLEAN      DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_route_patterns_segment ON route_patterns(route_segment);
CREATE INDEX IF NOT EXISTS idx_route_patterns_active  ON route_patterns(is_active);

-- =============================================================================
-- 7. ANALYTICS TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_insights (
    id                    SERIAL       PRIMARY KEY,

    type                  VARCHAR(50)  NOT NULL
        CHECK (type IN ('trend','anomaly','prediction','recommendation')),
    severity              VARCHAR(20)  NOT NULL
        CHECK (severity IN ('critical','high','medium','low','info')),

    title                 VARCHAR(500) NOT NULL,
    description           TEXT         NOT NULL,
    impact                TEXT         NOT NULL,

    confidence_score      DECIMAL(5,2) NOT NULL
        CHECK (confidence_score >= 0 AND confidence_score <= 100),
    model_version         VARCHAR(50),
    analysis_method       VARCHAR(100),

    metrics               JSONB,

    related_locations     TEXT[],
    related_trains        TEXT[],
    related_journey_ids   INTEGER[],
    related_gap_ids       INTEGER[],

    actionable            BOOLEAN      DEFAULT FALSE,
    action_taken          BOOLEAN      DEFAULT FALSE,
    action_notes          TEXT,

    analysis_start_time   TIMESTAMP    NOT NULL,
    analysis_end_time     TIMESTAMP    NOT NULL,
    time_range_label      VARCHAR(20),

    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at            TIMESTAMP,

    reviewed              BOOLEAN      DEFAULT FALSE,
    reviewed_by           VARCHAR(100),
    reviewed_at           TIMESTAMP,

    metadata              JSONB
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_type        ON ai_insights(type);
CREATE INDEX IF NOT EXISTS idx_ai_insights_severity    ON ai_insights(severity);
CREATE INDEX IF NOT EXISTS idx_ai_insights_created_at  ON ai_insights(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_confidence  ON ai_insights(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_actionable  ON ai_insights(actionable) WHERE actionable = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_insights_time_range  ON ai_insights(analysis_start_time, analysis_end_time);
CREATE INDEX IF NOT EXISTS idx_ai_insights_expires     ON ai_insights(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_metrics (
    id                    SERIAL        PRIMARY KEY,

    metric_name           VARCHAR(100)  NOT NULL,
    metric_label          VARCHAR(200)  NOT NULL,
    metric_category       VARCHAR(50)   NOT NULL,

    metric_value          DECIMAL(15,4) NOT NULL,
    metric_unit           VARCHAR(20),
    trend                 VARCHAR(10)   CHECK (trend IN ('up','down','stable')),
    change_value          DECIMAL(15,4),
    change_percentage     DECIMAL(5,2),

    sparkline_data        DECIMAL(15,4)[],

    description           TEXT,
    calculation_method    TEXT,

    period_start          TIMESTAMP     NOT NULL,
    period_end            TIMESTAMP     NOT NULL,
    time_range_label      VARCHAR(20),

    baseline_value        DECIMAL(15,4),
    baseline_period_start TIMESTAMP,
    baseline_period_end   TIMESTAMP,

    calculated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    metadata              JSONB
);

CREATE INDEX IF NOT EXISTS idx_analytics_metrics_name       ON analytics_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_analytics_metrics_category   ON analytics_metrics(metric_category);
CREATE INDEX IF NOT EXISTS idx_analytics_metrics_calculated ON analytics_metrics(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_metrics_period     ON analytics_metrics(period_start, period_end);

CREATE TABLE IF NOT EXISTS gap_patterns (
    id                          SERIAL       PRIMARY KEY,

    pattern_type                VARCHAR(50)  NOT NULL,
    pattern_name                VARCHAR(200) NOT NULL,
    pattern_description         TEXT         NOT NULL,
    pattern_signature           JSONB        NOT NULL,

    occurrence_count            INTEGER      DEFAULT 0,
    affected_gaps_count         INTEGER      DEFAULT 0,
    affected_journeys_count     INTEGER      DEFAULT 0,

    first_detected              TIMESTAMP    NOT NULL,
    last_detected               TIMESTAMP    NOT NULL,
    detection_frequency         JSONB,

    confidence_score            DECIMAL(5,2) NOT NULL
        CHECK (confidence_score >= 0 AND confidence_score <= 100),
    statistical_significance    DECIMAL(5,4),
    correlation_strength        DECIMAL(3,2),

    severity_distribution       JSONB,
    average_impact_score        DECIMAL(5,2),
    estimated_passenger_impact  INTEGER,

    affected_locations          TEXT[],
    affected_operators          TEXT[],
    affected_services           TEXT[],
    related_gap_ids             INTEGER[],

    predicted_next_occurrence   TIMESTAMP,
    prediction_confidence       DECIMAL(5,2),

    recommendations             TEXT,
    mitigation_strategies       TEXT[],

    is_active                   BOOLEAN      DEFAULT TRUE,
    is_recurring                BOOLEAN      DEFAULT FALSE,
    requires_attention          BOOLEAN      DEFAULT FALSE,

    reviewed                    BOOLEAN      DEFAULT FALSE,
    reviewed_by                 VARCHAR(100),
    reviewed_at                 TIMESTAMP,
    review_notes                TEXT,

    created_at                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    metadata                    JSONB
);

CREATE INDEX IF NOT EXISTS idx_gap_patterns_type          ON gap_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_gap_patterns_active        ON gap_patterns(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_gap_patterns_recurring     ON gap_patterns(is_recurring) WHERE is_recurring = TRUE;
CREATE INDEX IF NOT EXISTS idx_gap_patterns_confidence    ON gap_patterns(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_gap_patterns_last_detected ON gap_patterns(last_detected DESC);
CREATE INDEX IF NOT EXISTS idx_gap_patterns_attention     ON gap_patterns(requires_attention)
    WHERE requires_attention = TRUE;

-- =============================================================================
-- 8. SCHEDULE REFRESH METADATA
-- =============================================================================

CREATE TABLE IF NOT EXISTS schedule_refresh_metadata (
    id                INTEGER      NOT NULL DEFAULT 1,
    last_started_at   TIMESTAMP,
    last_completed_at TIMESTAMP,
    last_status       VARCHAR(20),
    last_message      TEXT,
    updated_at        TIMESTAMP    DEFAULT NOW(),

    PRIMARY KEY (id)
);

-- Seed a single control row so UPDATE always finds it
INSERT INTO schedule_refresh_metadata (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 9. TIMETABLE / ACTIVE SCHEDULE
-- =============================================================================

CREATE TABLE IF NOT EXISTS active_schedule (
    id                   SERIAL       PRIMARY KEY,

    -- Schedule identification
    cif_train_uid        VARCHAR(6)   NOT NULL,
    cif_stp_indicator    VARCHAR(1)   NOT NULL,
    schedule_start_date  DATE         NOT NULL,
    schedule_end_date    DATE         NOT NULL,

    -- Days of operation
    schedule_days_runs   VARCHAR(7),

    -- Train identification
    atoc_code            VARCHAR(2),
    train_status         VARCHAR(1),
    train_category       VARCHAR(2),
    signalling_id        VARCHAR(4),
    headcode             VARCHAR(4),
    service_code         VARCHAR(8),

    -- Train characteristics
    power_type           VARCHAR(3),
    timing_load          VARCHAR(10),
    speed                VARCHAR(3),
    train_class          VARCHAR(1),
    sleepers             VARCHAR(1),
    reservations         VARCHAR(1),
    catering_code        VARCHAR(4),
    service_branding     VARCHAR(4),

    -- Route data
    tiploc_array         TEXT[]       NOT NULL,
    stanox_array         TEXT[],

    -- Timing data
    timing_data          JSONB,

    -- Metadata
    transaction_type     VARCHAR(10)  DEFAULT 'Create',
    applicable_timetable VARCHAR(1),

    created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT active_schedule_unique
        UNIQUE (cif_train_uid, schedule_start_date, cif_stp_indicator)
);

CREATE INDEX IF NOT EXISTS idx_schedule_uid         ON active_schedule(cif_train_uid);
CREATE INDEX IF NOT EXISTS idx_schedule_dates       ON active_schedule(schedule_start_date, schedule_end_date);
CREATE INDEX IF NOT EXISTS idx_schedule_stp         ON active_schedule(cif_stp_indicator);
-- Headcode lookup used by the gap detector to verify/replace the UID-derived schedule
CREATE INDEX IF NOT EXISTS idx_active_schedule_signalling ON active_schedule(signalling_id, schedule_start_date, schedule_end_date);

CREATE INDEX IF NOT EXISTS idx_schedule_operator    ON active_schedule(atoc_code);
CREATE INDEX IF NOT EXISTS idx_schedule_status      ON active_schedule(train_status);
CREATE INDEX IF NOT EXISTS idx_schedule_category    ON active_schedule(train_category);
CREATE INDEX IF NOT EXISTS idx_schedule_days        ON active_schedule(schedule_days_runs);
CREATE INDEX IF NOT EXISTS idx_schedule_timing_data ON active_schedule USING gin(timing_data);

CREATE OR REPLACE VIEW current_schedules AS
SELECT
    cif_train_uid,
    cif_stp_indicator,
    schedule_start_date,
    schedule_end_date,
    schedule_days_runs,
    atoc_code,
    train_status,
    train_category,
    array_length(tiploc_array, 1)                          AS num_stops,
    tiploc_array[1]                                        AS origin_tiploc,
    tiploc_array[array_length(tiploc_array, 1)]            AS destination_tiploc,
    stanox_array[1]                                        AS origin_stanox,
    stanox_array[array_length(stanox_array, 1)]            AS destination_stanox
FROM active_schedule
WHERE CURRENT_DATE BETWEEN schedule_start_date AND schedule_end_date
  AND transaction_type != 'Delete';

COMMENT ON TABLE  active_schedule IS 'Complete CIF schedule data from Network Rail';
COMMENT ON COLUMN active_schedule.cif_stp_indicator    IS 'P=Permanent, O=Overlay, N=New STP, C=Cancellation';
COMMENT ON COLUMN active_schedule.schedule_days_runs   IS '7 chars: 1=runs, 0=no, Mon-Sun (e.g., 1111100=Mon-Fri)';
COMMENT ON COLUMN active_schedule.timing_data          IS 'JSON array of location timing details';

-- =============================================================================
-- 10. FUNCTIONS
-- =============================================================================

-- Auto-update updated_at on train_journeys
CREATE OR REPLACE FUNCTION update_journey_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_journey_timestamp ON train_journeys;
CREATE TRIGGER trigger_update_journey_timestamp
    BEFORE UPDATE ON train_journeys
    FOR EACH ROW EXECUTE FUNCTION update_journey_timestamp();

-- Auto-update updated_at on ai_insights / gap_patterns
CREATE OR REPLACE FUNCTION update_analytics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ai_insights_timestamp ON ai_insights;
CREATE TRIGGER trigger_update_ai_insights_timestamp
    BEFORE UPDATE ON ai_insights
    FOR EACH ROW EXECUTE FUNCTION update_analytics_timestamp();

DROP TRIGGER IF EXISTS trigger_update_gap_patterns_timestamp ON gap_patterns;
CREATE TRIGGER trigger_update_gap_patterns_timestamp
    BEFORE UPDATE ON gap_patterns
    FOR EACH ROW EXECUTE FUNCTION update_analytics_timestamp();

-- Resolve STANOX → human-readable location name
CREATE OR REPLACE FUNCTION get_location_name(p_stanox VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    v_name VARCHAR;
BEGIN
    SELECT COALESCE(nlc_desc_16, nlc_desc, tiploc, p_stanox)
    INTO   v_name
    FROM   tiploc_reference
    WHERE  stanox = p_stanox
    LIMIT  1;

    RETURN COALESCE(v_name, p_stanox);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_location_name IS
    'Resolve a STANOX code to a location name; falls back to the STANOX itself';

-- Get active schedule for a train UID on a specific date (STP priority)
CREATE OR REPLACE FUNCTION get_active_schedule(
    p_train_uid VARCHAR(6),
    p_date      DATE
) RETURNS TABLE (
    id                INTEGER,
    cif_train_uid     VARCHAR(6),
    cif_stp_indicator VARCHAR(1),
    tiploc_array      TEXT[],
    stanox_array      TEXT[],
    timing_data       JSONB,
    atoc_code         VARCHAR(2),
    train_category    VARCHAR(2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.cif_train_uid,
        s.cif_stp_indicator,
        s.tiploc_array,
        s.stanox_array,
        s.timing_data,
        s.atoc_code,
        s.train_category
    FROM active_schedule s
    WHERE s.cif_train_uid = p_train_uid
      AND p_date BETWEEN s.schedule_start_date AND s.schedule_end_date
      AND SUBSTRING(s.schedule_days_runs,
                    EXTRACT(ISODOW FROM p_date)::INTEGER, 1) = '1'
    ORDER BY
        CASE s.cif_stp_indicator
            WHEN 'C' THEN 1
            WHEN 'O' THEN 2
            WHEN 'N' THEN 3
            WHEN 'P' THEN 4
        END
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_active_schedule IS
    'Get the active schedule for a train UID on a specific date, respecting STP priorities';

-- Mark stale/terminated journeys
CREATE OR REPLACE FUNCTION mark_stale_journeys()
RETURNS INTEGER AS $$
DECLARE
    timeout_count   INTEGER;
    completed_count INTEGER;
    total_count     INTEGER;
BEGIN
    UPDATE train_journeys
    SET    status = 'COMPLETED'
    WHERE  status = 'ACTIVE'
      AND  terminated_at IS NOT NULL
      AND  terminated_at <= CURRENT_TIMESTAMP;

    GET DIAGNOSTICS completed_count = ROW_COUNT;

    UPDATE train_journeys
    SET    status        = 'TIMEOUT',
           terminated_at = COALESCE(terminated_at, CURRENT_TIMESTAMP)
    WHERE  status = 'ACTIVE'
      AND (
          (last_movement_at IS NOT NULL
           AND last_movement_at < CURRENT_TIMESTAMP - INTERVAL '2 hours')
          OR
          (last_movement_at IS NULL
           AND activated_at  < CURRENT_TIMESTAMP - INTERVAL '2 hours')
      );

    GET DIAGNOSTICS timeout_count = ROW_COUNT;

    total_count := completed_count + timeout_count;
    RETURN total_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh legacy materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY station_gap_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY operator_performance;
END;
$$ LANGUAGE plpgsql;

-- Refresh all analytics materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY hourly_gap_statistics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_gap_statistics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY location_performance_stats;

    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'station_gap_stats') THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY station_gap_stats;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'operator_performance') THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY operator_performance;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Clean up expired insights
CREATE OR REPLACE FUNCTION cleanup_expired_insights()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ai_insights
    WHERE  expires_at IS NOT NULL
      AND  expires_at < CURRENT_TIMESTAMP;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 11. JOURNEY VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW active_journeys AS
SELECT
    j.*,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - j.last_movement_at)) / 60 AS minutes_since_last_movement,
    array_length(j.actual_route, 1)    AS stops_visited,
    array_length(j.scheduled_route, 1) AS stops_scheduled
FROM train_journeys j
WHERE j.status = 'ACTIVE'
ORDER BY j.last_movement_at DESC;

CREATE OR REPLACE VIEW journeys_ready_for_analysis AS
SELECT
    j.*,
    array_length(j.actual_route, 1)    AS stops_visited,
    array_length(j.scheduled_route, 1) AS stops_scheduled
FROM train_journeys j
WHERE j.status IN ('COMPLETED','TIMEOUT')
  AND j.analyzed_at IS NULL
  AND (j.terminated_at IS NULL OR j.terminated_at <= CURRENT_TIMESTAMP)
ORDER BY j.terminated_at DESC NULLS LAST, j.last_movement_at DESC;

CREATE OR REPLACE VIEW journey_statistics AS
SELECT
    status,
    COUNT(*)             AS count,
    AVG(total_movements) AS avg_movements,
    AVG(gaps_detected)   AS avg_gaps,
    MIN(activated_at)    AS earliest,
    MAX(activated_at)    AS latest
FROM train_journeys
GROUP BY status;

COMMENT ON TABLE  train_journeys                   IS 'Tracks complete train journeys for post-journey gap analysis';
COMMENT ON COLUMN train_journeys.status            IS 'ACTIVE=running, COMPLETED=terminated, TIMEOUT=stale, ANALYZED=gaps detected';
COMMENT ON COLUMN train_journeys.scheduled_route   IS 'Expected STANOX sequence from CIF schedule';
COMMENT ON COLUMN train_journeys.actual_route      IS 'Actual STANOX sequence from movement messages';
COMMENT ON VIEW   journeys_ready_for_analysis      IS 'Journeys that are complete but not yet analyzed for gaps';

-- =============================================================================
-- 12. MATERIALIZED VIEWS  (must be last — depend on gaps and train_journeys)
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS station_gap_stats AS
SELECT
    missed_station_stanox                                              AS stanox,
    missed_station_tiploc                                             AS tiploc,
    COUNT(*)                                                          AS total_gaps,
    COUNT(DISTINCT train_id)                                          AS affected_trains,
    COUNT(DISTINCT operator_code)                                     AS affected_operators,
    AVG(CASE severity
        WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
        WHEN 'MEDIUM'   THEN 2 ELSE 1
    END)                                                              AS avg_severity_score,
    MIN(detected_at)                                                  AS first_gap,
    MAX(detected_at)                                                  AS last_gap,
    COUNT(*) FILTER (WHERE detected_at > NOW() - INTERVAL '24 hours') AS gaps_last_24h,
    COUNT(*) FILTER (WHERE detected_at > NOW() - INTERVAL '7 days')   AS gaps_last_7d
FROM gaps
GROUP BY missed_station_stanox, missed_station_tiploc;

CREATE UNIQUE INDEX IF NOT EXISTS idx_station_gap_stats_stanox ON station_gap_stats(stanox);

CREATE MATERIALIZED VIEW IF NOT EXISTS operator_performance AS
SELECT
    operator_code,
    COUNT(DISTINCT train_id)                                               AS total_trains,
    COUNT(*) FILTER (WHERE has_gaps = TRUE)                                AS trains_with_gaps,
    ROUND(100.0 * COUNT(*) FILTER (WHERE has_gaps = TRUE)
          / NULLIF(COUNT(DISTINCT train_id), 0), 2)                        AS gap_percentage,
    AVG(on_time_performance)                                               AS avg_on_time_performance,
    AVG(total_delay_minutes)                                               AS avg_delay_minutes,
    COUNT(*) FILTER (WHERE status = 'COMPLETED')                           AS completed_journeys,
    COUNT(*) FILTER (WHERE status = 'CANCELLED')                           AS cancelled_journeys
FROM train_journeys
WHERE operator_code IS NOT NULL
GROUP BY operator_code;

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_performance_code ON operator_performance(operator_code);

CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_gap_statistics AS
SELECT
    DATE_TRUNC('hour', detected_at)                               AS hour,
    COUNT(*)                                                      AS total_gaps,
    COUNT(DISTINCT train_id)                                      AS affected_trains,
    COUNT(DISTINCT missed_station_stanox)                         AS affected_stations,
    COUNT(*) FILTER (WHERE severity = 'critical')                 AS critical_gaps,
    COUNT(*) FILTER (WHERE severity = 'high')                     AS high_gaps,
    COUNT(*) FILTER (WHERE severity = 'medium')                   AS medium_gaps,
    COUNT(*) FILTER (WHERE severity = 'low')                      AS low_gaps,
    AVG(CASE severity
        WHEN 'critical' THEN 4 WHEN 'high' THEN 3
        WHEN 'medium'   THEN 2 ELSE 1
    END)                                                          AS avg_severity_score
FROM gaps
WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'
GROUP BY DATE_TRUNC('hour', detected_at)
ORDER BY hour DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hourly_gap_stats_hour ON hourly_gap_statistics(hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_gap_statistics AS
SELECT
    DATE_TRUNC('day', detected_at)                                AS day,
    EXTRACT(DOW FROM detected_at)                                 AS day_of_week,
    COUNT(*)                                                      AS total_gaps,
    COUNT(DISTINCT train_id)                                      AS affected_trains,
    COUNT(DISTINCT missed_station_stanox)                         AS affected_stations,
    COUNT(DISTINCT operator_code)                                 AS affected_operators,
    COUNT(*) FILTER (WHERE severity IN ('critical','high'))       AS high_priority_gaps,
    AVG(CASE severity
        WHEN 'critical' THEN 4 WHEN 'high' THEN 3
        WHEN 'medium'   THEN 2 ELSE 1
    END)                                                          AS avg_severity_score
FROM gaps
WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', detected_at), EXTRACT(DOW FROM detected_at)
ORDER BY day DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_gap_stats_day ON daily_gap_statistics(day);

CREATE MATERIALIZED VIEW IF NOT EXISTS location_performance_stats AS
SELECT
    missed_station_stanox                                                AS stanox,
    COALESCE(missed_station_tiploc, missed_station_stanox)              AS station_name,
    COUNT(*)                                                             AS total_gaps,
    COUNT(DISTINCT train_id)                                             AS affected_trains,
    COUNT(*) FILTER (WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours') AS gaps_24h,
    COUNT(*) FILTER (WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')   AS gaps_7d,
    COUNT(*) FILTER (WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '30 days')  AS gaps_30d,
    COUNT(*) FILTER (WHERE severity = 'critical')                        AS critical_count,
    COUNT(*) FILTER (WHERE severity = 'high')                            AS high_count,
    AVG(CASE severity
        WHEN 'critical' THEN 4 WHEN 'high' THEN 3
        WHEN 'medium'   THEN 2 ELSE 1
    END)                                                                 AS avg_severity_score,
    MIN(detected_at)                                                     AS first_gap,
    MAX(detected_at)                                                     AS last_gap,
    EXTRACT(EPOCH FROM (MAX(detected_at) - MIN(detected_at))) / 86400   AS days_span
FROM gaps
WHERE detected_at >= CURRENT_TIMESTAMP - INTERVAL '90 days'
GROUP BY missed_station_stanox,
         COALESCE(missed_station_tiploc, missed_station_stanox)
HAVING COUNT(*) >= 3
ORDER BY total_gaps DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_location_perf_stanox ON location_performance_stats(stanox);

-- =============================================================================
-- 13. PREDICTED GAPS  (sink target for NR_JOURNEY_GAPS_PREDICTED Kafka topic)
--
-- Populated by the Confluent JDBC Sink connector reading NR_JOURNEY_GAPS_PREDICTED.
-- One row per missed station per journey.  The approval_status column drives the
-- operator review workflow: PENDING → APPROVED or REJECTED.
-- =============================================================================

CREATE TABLE IF NOT EXISTS predicted_gaps (
    id                      SERIAL        PRIMARY KEY,

    -- Train / journey identity (from Kafka message key / payload)
    train_id                VARCHAR(50)   NOT NULL,
    train_uid               VARCHAR(50)   NOT NULL,
    schedule_start_date     VARCHAR(20),
    completion_time         BIGINT,          -- epoch ms from ksqlDB payload

    -- Journey-level summary
    total_scheduled_stops   INTEGER,
    found_stops_count       INTEGER,
    missed_stops_count      INTEGER,
    severity                VARCHAR(20),

    -- Per-stop gap fields
    station_index           INTEGER,
    station_name            VARCHAR(255),
    tiploc                  VARCHAR(20),
    stanox                  VARCHAR(20),
    scheduled_time          VARCHAR(20),     -- "HH:MM" or "HH:MM:SS" from schedule
    scheduled_arrival       VARCHAR(10),     -- timetabled arrival time
    scheduled_departure     VARCHAR(10),     -- timetabled departure time
    actual_time             VARCHAR(20),     -- "HH:MM:SS" if visited
    actual_arrival          VARCHAR(10),     -- reported actual arrival
    actual_departure        VARCHAR(10),     -- reported actual departure

    -- InfillPredictor output
    predicted_arrival       VARCHAR(20),     -- "HH:MM:SS" UK local — predicted arrival time
    predicted_arrival_ms    BIGINT,          -- epoch ms UTC
    predicted_departure     VARCHAR(20),     -- "HH:MM:SS" UK local — predicted departure time
    predicted_departure_ms  BIGINT,          -- epoch ms UTC
    predicted_time          VARCHAR(20),     -- "HH:MM:SS" UK local (legacy: arrival for INTERMEDIATE/DESTINATION, departure for ORIGIN)
    predicted_time_ms       BIGINT,          -- epoch ms UTC (legacy)
    predicted_delay_minutes INTEGER,
    prediction_confidence   DOUBLE PRECISION, -- 0.0–1.0  (sink sends float64)
    prediction_method       VARCHAR(64),     -- ON_TIME_INTERPOLATION etc.
    prediction_basis        TEXT,            -- JSON string from ksqlDB VARCHAR field

    -- Approval workflow
    approval_status         VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approved_time           VARCHAR(20),     -- operator-overridden time if amended before approval
    approved_by             VARCHAR(100),
    approved_at             TIMESTAMP,
    rejection_reason        TEXT,

    -- Audit
    received_at             TIMESTAMP     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP     NOT NULL DEFAULT NOW(),

    -- Deduplication: one prediction row per train + station index + schedule date
    CONSTRAINT predicted_gaps_unique
        UNIQUE (train_id, station_index, schedule_start_date)
);

CREATE INDEX IF NOT EXISTS idx_predicted_gaps_train_id        ON predicted_gaps(train_id);
CREATE INDEX IF NOT EXISTS idx_predicted_gaps_approval_status ON predicted_gaps(approval_status);
CREATE INDEX IF NOT EXISTS idx_predicted_gaps_received_at     ON predicted_gaps(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_predicted_gaps_stanox          ON predicted_gaps(stanox);
CREATE INDEX IF NOT EXISTS idx_predicted_gaps_schedule_date   ON predicted_gaps(schedule_start_date DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_predicted_gaps_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_predicted_gaps_updated_at ON predicted_gaps;
CREATE TRIGGER trg_predicted_gaps_updated_at
    BEFORE UPDATE ON predicted_gaps
    FOR EACH ROW EXECUTE FUNCTION update_predicted_gaps_timestamp();

COMMENT ON TABLE  predicted_gaps IS 'Per-station infill predictions sinked from NR_JOURNEY_GAPS_PREDICTED; approval_status drives operator review';
COMMENT ON COLUMN predicted_gaps.approval_status IS 'PENDING=awaiting review, APPROVED=accepted by operator, REJECTED=operator discarded';

-- =============================================================================
-- 14. ML TRAINING TABLES
-- =============================================================================

CREATE OR REPLACE FUNCTION time_to_mins(t TEXT)
RETURNS SMALLINT
LANGUAGE plpgsql IMMUTABLE CALLED ON NULL INPUT AS $$
DECLARE h SMALLINT; m SMALLINT;
BEGIN
    IF t IS NULL OR t = '' THEN RETURN NULL; END IF;
    BEGIN
        h := SPLIT_PART(t, ':', 1)::SMALLINT;
        m := SPLIT_PART(t, ':', 2)::SMALLINT;
        RETURN (h * 60 + m)::SMALLINT;
    EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
END;
$$;

CREATE TABLE IF NOT EXISTS ml_stop_features (
    id                          BIGSERIAL PRIMARY KEY,
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
    journey_position_pct        NUMERIC(5,3),
    stops_before                INTEGER,
    stops_remaining             INTEGER,
    sched_arrival_mins          SMALLINT,
    sched_departure_mins        SMALLINT,
    sched_dwell_mins            SMALLINT,
    sched_hour                  SMALLINT,
    actual_arrival_mins         SMALLINT,
    actual_departure_mins       SMALLINT,
    arrival_delay_mins          NUMERIC(6,2),
    departure_delay_mins        NUMERIC(6,2),
    journey_severity            VARCHAR(20),
    missed_stops_count          INTEGER,
    found_stops_count           INTEGER,
    gap_ratio                   NUMERIC(5,3),
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
    source_received_at          TIMESTAMP,
    inserted_at                 TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT ml_stop_features_unique UNIQUE (train_id, station_index, schedule_start_date)
);

CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_train    ON ml_stop_features(train_id);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_stanox   ON ml_stop_features(stanox);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_operator ON ml_stop_features(operator_code);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_date     ON ml_stop_features(schedule_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_dow      ON ml_stop_features(service_date_dow);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_role     ON ml_stop_features(stop_role);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_inserted ON ml_stop_features(inserted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_stop_feat_complete ON ml_stop_features(schedule_start_date)
    WHERE arrival_delay_mins IS NOT NULL OR departure_delay_mins IS NOT NULL;

CREATE TABLE IF NOT EXISTS ml_prediction_log (
    id                              BIGSERIAL PRIMARY KEY,
    train_id                        VARCHAR(50)  NOT NULL,
    train_uid                       VARCHAR(50)  NOT NULL,
    operator_code                   VARCHAR(2),
    schedule_start_date             DATE,
    service_date_dow                SMALLINT,
    station_index                   INTEGER      NOT NULL,
    total_scheduled_stops           INTEGER,
    stanox                          VARCHAR(20),
    tiploc                          VARCHAR(20),
    station_name                    VARCHAR(255),
    stop_role                       VARCHAR(20),
    journey_position_pct            NUMERIC(5,3),
    stops_before                    INTEGER,
    stops_remaining                 INTEGER,
    sched_arrival_mins              SMALLINT,
    sched_departure_mins            SMALLINT,
    sched_dwell_mins                SMALLINT,
    sched_hour                      SMALLINT,
    predicted_arrival_mins          SMALLINT,
    predicted_departure_mins        SMALLINT,
    predicted_arrival_delay_mins    NUMERIC(6,2),
    predicted_departure_delay_mins  NUMERIC(6,2),
    prediction_method               VARCHAR(64),
    prediction_confidence           NUMERIC(5,3),
    before_visited_index            INTEGER,
    before_sched_arrival_mins       SMALLINT,
    before_actual_arrival_mins      SMALLINT,
    before_arrival_delay_mins       NUMERIC(6,2),
    before_actual_departure_mins    SMALLINT,
    before_departure_delay_mins     NUMERIC(6,2),
    after_visited_index             INTEGER,
    after_sched_arrival_mins        SMALLINT,
    after_actual_arrival_mins       SMALLINT,
    after_arrival_delay_mins        NUMERIC(6,2),
    after_actual_departure_mins     SMALLINT,
    after_departure_delay_mins      NUMERIC(6,2),
    journey_severity                VARCHAR(20),
    missed_stops_count              INTEGER,
    found_stops_count               INTEGER,
    gap_ratio                       NUMERIC(5,3),
    actual_arrival_mins             SMALLINT     DEFAULT NULL,
    actual_departure_mins           SMALLINT     DEFAULT NULL,
    actual_arrival_delay_mins       NUMERIC(6,2) DEFAULT NULL,
    actual_departure_delay_mins     NUMERIC(6,2) DEFAULT NULL,
    ground_truth_source             VARCHAR(50)  DEFAULT NULL,
    arrival_error_mins              NUMERIC(6,2) DEFAULT NULL,
    departure_error_mins            NUMERIC(6,2) DEFAULT NULL,
    approval_status                 VARCHAR(20),
    source_received_at              TIMESTAMP,
    inserted_at                     TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT ml_prediction_log_unique UNIQUE (train_id, station_index, schedule_start_date)
);

CREATE INDEX IF NOT EXISTS idx_ml_pred_log_train    ON ml_prediction_log(train_id);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_stanox   ON ml_prediction_log(stanox);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_operator ON ml_prediction_log(operator_code);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_date     ON ml_prediction_log(schedule_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_method   ON ml_prediction_log(prediction_method);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_inserted ON ml_prediction_log(inserted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_pred_log_evaluated ON ml_prediction_log(schedule_start_date)
    WHERE ground_truth_source IS NOT NULL;

-- The populate_ml_tables() trigger function and trg_ml_populate trigger
-- are defined in migration 006_ml_training_tables.sql.
-- On a fresh install, that migration is run after this script.

CREATE OR REPLACE VIEW ml_training_export AS
SELECT
    f.train_id, f.operator_code, f.schedule_start_date, f.service_date_dow,
    f.stanox, f.station_name, f.stop_role,
    f.journey_position_pct, f.stops_before, f.stops_remaining, f.total_scheduled_stops,
    f.sched_arrival_mins, f.sched_departure_mins, f.sched_dwell_mins, f.sched_hour,
    f.journey_severity, f.gap_ratio, f.missed_stops_count, f.found_stops_count,
    f.prev_arrival_delay_mins, f.prev_departure_delay_mins,
    f.next_arrival_delay_mins, f.next_departure_delay_mins,
    f.arrival_delay_mins, f.departure_delay_mins
FROM   ml_stop_features f
WHERE  (f.arrival_delay_mins IS NOT NULL OR f.departure_delay_mins IS NOT NULL)
  AND  f.stop_role != 'JUNCTION'
ORDER  BY f.schedule_start_date DESC, f.train_id, f.station_index;

CREATE OR REPLACE VIEW ml_data_stats AS
SELECT 'ml_stop_features' AS table_name,
    COUNT(*) AS total_rows, COUNT(DISTINCT train_id) AS unique_trains,
    COUNT(DISTINCT stanox) AS unique_stations, COUNT(DISTINCT operator_code) AS unique_operators,
    COUNT(*) FILTER (WHERE arrival_delay_mins IS NOT NULL) AS with_arrival_label,
    COUNT(*) FILTER (WHERE departure_delay_mins IS NOT NULL) AS with_departure_label,
    MIN(schedule_start_date) AS earliest_date, MAX(schedule_start_date) AS latest_date
FROM ml_stop_features
UNION ALL
SELECT 'ml_prediction_log',
    COUNT(*), COUNT(DISTINCT train_id), COUNT(DISTINCT stanox), COUNT(DISTINCT operator_code),
    COUNT(*) FILTER (WHERE actual_arrival_mins IS NOT NULL),
    COUNT(*) FILTER (WHERE actual_departure_mins IS NOT NULL),
    MIN(schedule_start_date), MAX(schedule_start_date)
FROM ml_prediction_log;

-- =============================================================================
-- DONE
-- =============================================================================

COMMENT ON TABLE gaps                       IS 'Detected train gaps with full context and classification';
COMMENT ON TABLE train_positions            IS 'Real-time positions of active trains';
COMMENT ON TABLE station_patterns          IS 'AI-identified patterns of recurring gaps at stations';
COMMENT ON TABLE route_patterns             IS 'AI-identified patterns along route segments';
COMMENT ON TABLE ai_insights               IS 'AI-generated insights including trends, anomalies, predictions, and recommendations';
COMMENT ON TABLE analytics_metrics         IS 'Time-series metrics for analytics dashboard with sparkline data';
COMMENT ON TABLE gap_patterns              IS 'Detected patterns in gap occurrences with AI analysis and predictions';
COMMENT ON TABLE schedule_refresh_metadata IS 'Singleton row tracking the last CIF schedule refresh job status';
COMMENT ON TABLE ml_stop_features          IS 'Ground-truth ML training features: one row per visited stop';
COMMENT ON TABLE ml_prediction_log         IS 'ML evaluation corpus: one row per missed-stop prediction';
COMMENT ON MATERIALIZED VIEW station_gap_stats         IS 'Aggregated gap statistics by station';
COMMENT ON MATERIALIZED VIEW operator_performance      IS 'Performance metrics by train operator';
COMMENT ON MATERIALIZED VIEW hourly_gap_statistics     IS 'Hourly aggregated gap statistics for trend analysis';
COMMENT ON MATERIALIZED VIEW daily_gap_statistics      IS 'Daily aggregated gap statistics including day-of-week patterns';
COMMENT ON MATERIALIZED VIEW location_performance_stats IS 'Performance statistics by location with time-based breakdowns';

SELECT 'network_rail schema initialised successfully' AS status;
