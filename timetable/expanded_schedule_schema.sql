-- Expanded Schedule Schema for Network Rail CIF Data
-- This replaces the simple active_schedule table with full CIF schedule support

-- Backup existing table only if it already exists (safe on fresh DB)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'active_schedule') THEN
        CREATE TABLE IF NOT EXISTS active_schedule_backup AS SELECT * FROM active_schedule;
        DROP TABLE active_schedule CASCADE;
    END IF;
END $$;

-- Create expanded schedule table
CREATE TABLE IF NOT EXISTS active_schedule (
    id SERIAL PRIMARY KEY,
    
    -- Schedule identification (unique key)
    cif_train_uid VARCHAR(6) NOT NULL,
    cif_stp_indicator VARCHAR(1) NOT NULL,  -- P=Permanent, O=Overlay, N=STP, C=Cancellation
    schedule_start_date DATE NOT NULL,
    schedule_end_date DATE NOT NULL,
    
    -- Days of operation (7 characters: 1=runs, 0=doesn't run, Mon-Sun)
    schedule_days_runs VARCHAR(7),  -- e.g., "1111100" = Mon-Fri only
    
    -- Train identification
    atoc_code VARCHAR(2),  -- Operator code (e.g., "EM" = East Midlands)
    train_status VARCHAR(1),  -- P=Passenger, F=Freight, B=Bus, S=Ship, T=Trip
    train_category VARCHAR(2),  -- OO=Ordinary Passenger, XX=Express, etc.
    signalling_id VARCHAR(4),  -- Headcode used in signalling
    headcode VARCHAR(4),
    service_code VARCHAR(8),  -- Train service code
    
    -- Train characteristics
    power_type VARCHAR(3),  -- EMU, DMU, HST, D (Diesel), E (Electric)
    timing_load VARCHAR(10),  -- Timing load (affects performance calculations)
    speed VARCHAR(3),  -- Maximum speed
    train_class VARCHAR(1),  -- B=Both classes, S=Standard only
    sleepers VARCHAR(1),  -- B=First and Standard, F=First only, S=Standard only
    reservations VARCHAR(1),  -- A=Compulsory, E=Bicycles essential, R=Recommended, S=Possible
    catering_code VARCHAR(4),  -- Catering facilities
    service_branding VARCHAR(4),  -- Service branding
    
    -- Route data (existing arrays)
    tiploc_array TEXT[] NOT NULL,
    stanox_array TEXT[],
    
    -- Timing data (NEW - stores all location timing details as JSON)
    timing_data JSONB,
    
    -- Metadata
    transaction_type VARCHAR(10) DEFAULT 'Create',  -- Create, Delete, Update
    applicable_timetable VARCHAR(1),  -- Y=Applicable, N=Not applicable
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint: A schedule is uniquely identified by UID + Start Date + STP Indicator
    CONSTRAINT active_schedule_unique UNIQUE (cif_train_uid, schedule_start_date, cif_stp_indicator)
);

-- Indexes for performance
CREATE INDEX idx_schedule_uid ON active_schedule(cif_train_uid);
CREATE INDEX idx_schedule_dates ON active_schedule(schedule_start_date, schedule_end_date);
CREATE INDEX idx_schedule_stp ON active_schedule(cif_stp_indicator);
CREATE INDEX idx_schedule_operator ON active_schedule(atoc_code);
CREATE INDEX idx_schedule_status ON active_schedule(train_status);
CREATE INDEX idx_schedule_category ON active_schedule(train_category);
CREATE INDEX idx_schedule_days ON active_schedule(schedule_days_runs);
CREATE INDEX idx_schedule_timing_data ON active_schedule USING gin(timing_data);

-- Create function to get active schedule for a train on a specific date
CREATE OR REPLACE FUNCTION get_active_schedule(
    p_train_uid VARCHAR(6),
    p_date DATE
) RETURNS TABLE (
    id INTEGER,
    cif_train_uid VARCHAR(6),
    cif_stp_indicator VARCHAR(1),
    tiploc_array TEXT[],
    stanox_array TEXT[],
    timing_data JSONB,
    atoc_code VARCHAR(2),
    train_category VARCHAR(2)
) AS $$
BEGIN
    -- Return the schedule with the highest priority STP indicator (C > O > N > P)
    -- that is valid on the given date and day of week
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
        AND SUBSTRING(s.schedule_days_runs, EXTRACT(ISODOW FROM p_date)::INTEGER, 1) = '1'
    ORDER BY 
        CASE s.cif_stp_indicator
            WHEN 'C' THEN 1  -- Cancellation (highest priority)
            WHEN 'O' THEN 2  -- Overlay
            WHEN 'N' THEN 3  -- New STP
            WHEN 'P' THEN 4  -- Permanent (lowest priority)
        END
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create view for easy querying of current schedules
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
    array_length(tiploc_array, 1) as num_stops,
    tiploc_array[1] as origin_tiploc,
    tiploc_array[array_length(tiploc_array, 1)] as destination_tiploc,
    stanox_array[1] as origin_stanox,
    stanox_array[array_length(stanox_array, 1)] as destination_stanox
FROM active_schedule
WHERE CURRENT_DATE BETWEEN schedule_start_date AND schedule_end_date
    AND transaction_type != 'Delete';

COMMENT ON TABLE active_schedule IS 'Complete CIF schedule data from Network Rail';
COMMENT ON COLUMN active_schedule.cif_stp_indicator IS 'P=Permanent, O=Overlay, N=New STP, C=Cancellation';
COMMENT ON COLUMN active_schedule.schedule_days_runs IS '7 chars: 1=runs, 0=no, Mon-Sun (e.g., 1111100=Mon-Fri)';
COMMENT ON COLUMN active_schedule.timing_data IS 'JSON array of location timing details';
COMMENT ON FUNCTION get_active_schedule IS 'Get the active schedule for a train UID on a specific date, respecting STP priorities';

-- Function to resolve a STANOX code to a human-readable location name.
-- Checks tiploc_reference (CORPUS data) first, then falls back to the STANOX itself.
CREATE OR REPLACE FUNCTION get_location_name(p_stanox VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    v_name VARCHAR;
BEGIN
    -- Primary: CORPUS reference table (populated by load_corpus.py)
    SELECT COALESCE(nlc_desc_16, nlc_desc, tiploc, p_stanox)
    INTO v_name
    FROM tiploc_reference
    WHERE stanox = p_stanox
    LIMIT 1;

    RETURN COALESCE(v_name, p_stanox);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_location_name IS 'Resolve a STANOX code to a location name; falls back to the STANOX itself';

