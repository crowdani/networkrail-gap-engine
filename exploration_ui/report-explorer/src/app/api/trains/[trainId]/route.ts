import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

function normaliseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const hms = s.match(/^(\d{2}):(\d{2})(?::\d{2})?/);
  if (hms) return `${hms[1]}:${hms[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  return s;
}

function normalisePredictedMs(ms: number | string | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * Convert a normalised "HH:MM" string to minutes since midnight.
 * Returns null when the string is missing or unparseable.
 */
function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Given an ordered list of normalised scheduled times for a journey,
 * return per-row day offsets (0 = start day, 1 = next calendar day).
 * A stop has crossed midnight when its time-of-day is earlier than
 * the first stop's time-of-day (and the offset of the previous stop).
 */
function computeDayOffsets(scheduledTimes: (string | null)[]): number[] {
  const offsets: number[] = new Array(scheduledTimes.length).fill(0);
  let prevMins: number | null = null;
  let currentOffset = 0;
  for (let i = 0; i < scheduledTimes.length; i++) {
    const mins = toMins(scheduledTimes[i]);
    if (mins !== null && prevMins !== null && mins < prevMins - 30) {
      // Time went backwards by >30 min — crossed midnight
      currentOffset += 1;
    }
    offsets[i] = currentOffset;
    if (mins !== null) prevMins = mins;
  }
  return offsets;
}

/**
 * GET /api/trains/[trainId]
 *
 * Returns all stops for a given train_id.
 * Primary source: `journey_stations` table (contains ALL stops — visited and missed).
 * Secondary source: `predicted_gaps` table (contains missed stops with predictions).
 * Legacy fallback: `gap_detection_results` table.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trainId: string }> }
) {
  try {
    const { trainId } = await params;

    // 1. Primary source: journey_stations (Confluent JDBC sink from ALL_STATIONS_FLAT)
    //    LEFT JOIN predicted_gaps to get the numeric id used by the approval PATCH route.
    //    journey_stations has no serial id — the PATCH /api/predicted-gaps/[id] endpoint
    //    only works reliably with the numeric predicted_gaps.id.
    const jsResult = await pool.query(
      `SELECT
         -- Prefer numeric predicted_gaps id (works with PATCH /api/predicted-gaps/[id]).
         -- Fall back to composite string only when pg row doesn't exist.
         COALESCE(
           pg.id::text,
           js.train_id || '-' || js.station_index || '-' || COALESCE(js.schedule_start_date, '')
         )                                               AS id,
         js.train_id,
         js.train_uid,
         js.schedule_start_date,
         js.severity,
         js.total_scheduled_stops,
         js.found_stops_count,
         js.missed_stops_count,
         js.station_index,
         COALESCE(
           NULLIF(js.station_name, ''),
           NULLIF(tr.nlc_desc_16, ''),
           NULLIF(tr.nlc_desc, ''),
           tr.tiploc,
           js.stanox
         )                                               AS station_name,
         COALESCE(tr.three_alpha, '')                    AS crs,
         js.tiploc,
         js.stanox,
         js.visited,
         js.status,
         js.scheduled_time,
         js.scheduled_arrival,
         js.scheduled_departure,
         js.actual_time,
         js.actual_arrival,
         js.actual_departure,
         js.event,
         COALESCE(js.predicted_arrival,  pg.predicted_arrival)          AS predicted_arrival,
         COALESCE(js.predicted_arrival_ms, pg.predicted_arrival_ms)     AS predicted_arrival_ms,
         COALESCE(js.predicted_departure, pg.predicted_departure)       AS predicted_departure,
         COALESCE(js.predicted_departure_ms, pg.predicted_departure_ms) AS predicted_departure_ms,
         COALESCE(js.predicted_time,  pg.predicted_time)                AS predicted_time,
         COALESCE(js.predicted_time_ms, pg.predicted_time_ms)           AS predicted_time_ms,
         COALESCE(js.predicted_delay_minutes, pg.predicted_delay_minutes) AS predicted_delay_minutes,
         COALESCE(js.prediction_confidence, pg.prediction_confidence)   AS prediction_confidence,
         COALESCE(js.prediction_method, pg.prediction_method)           AS prediction_method,
         COALESCE(js.prediction_basis, pg.prediction_basis::text)       AS prediction_basis,
         -- Use predicted_gaps approval_status as source of truth (that's what PATCH updates)
         COALESCE(pg.approval_status, js.approval_status, 'PENDING')    AS approval_status,
         COALESCE(pg.approved_time, js.approved_time)                   AS approved_time
       FROM journey_stations js
       LEFT JOIN predicted_gaps pg
         ON  pg.train_id      = js.train_id
         AND pg.station_index = js.station_index
         AND (
           pg.schedule_start_date = js.schedule_start_date
           OR (pg.schedule_start_date IS NULL AND js.schedule_start_date IS NULL)
         )
       LEFT JOIN LATERAL (
         SELECT nlc_desc_16, nlc_desc, tiploc, three_alpha
         FROM tiploc_reference
         WHERE stanox = js.stanox
         LIMIT 1
       ) tr ON true
       WHERE js.train_id = $1
         -- Hide junction gaps (missed passthrough points) — keep all visited stops.
         -- Match both compact JSON ("stop_role":"JUNCTION") and spaced form.
         AND NOT (
           js.visited = false
           AND (
             COALESCE(js.prediction_basis, pg.prediction_basis::text, '')
               LIKE '%"stop_role":"JUNCTION"%'
             OR
             COALESCE(js.prediction_basis, pg.prediction_basis::text, '')
               LIKE '%"stop_role": "JUNCTION"%'
           )
         )
       ORDER BY js.station_index ASC`,
     [trainId]
   ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    if (jsResult.rows.length > 0) {
      const first = jsResult.rows[0];

      // Normalise times first so we can compute day offsets from HH:MM strings.
      const normalised = jsResult.rows.map(r => {
        const schedArr = normaliseTime(r.scheduled_arrival as string);
        const actArr   = normaliseTime(r.actual_arrival   as string);
        const actDep   = normaliseTime(r.actual_departure as string);
        // Suppress actual_arrival when:
        //   a) The stop has no scheduled_arrival (ORIGIN stop — the train starts
        //      here; any actual_arrival is the return-leg arriving back), OR
        //   b) actual_arrival is later than actual_departure on the same stop
        //      (return-leg arrival event written onto the outbound origin row).
        const validActArr =
          !schedArr
            ? null
            : (actArr && actDep && actArr > actDep ? null : actArr);
        return {
          ...r,
          scheduled_time:       normaliseTime(r.scheduled_time as string),
          scheduled_arrival:    schedArr,
          scheduled_departure:  normaliseTime(r.scheduled_departure as string),
          actual_time:          normaliseTime(r.actual_time as string),
          actual_arrival:       validActArr,
          actual_departure:     actDep,
          predicted_arrival:    normaliseTime(r.predicted_arrival as string),
          predicted_departure:  normaliseTime(r.predicted_departure as string),
          predicted_time:       normaliseTime(r.predicted_time as string) ?? normalisePredictedMs(r.predicted_time_ms as number),
          approved_time:        normaliseTime(r.approved_time as string),
        };
      });

      // Use scheduled_arrival → scheduled_time as the reference sequence for
      // detecting midnight rollovers. Rows are already ordered by station_index.
      const refTimes = normalised.map(r =>
        (r.scheduled_arrival as string | null) ?? (r.scheduled_time as string | null)
      );
      const dayOffsets = computeDayOffsets(refTimes);

      const records = normalised.map((r, i) => ({
        ...r,
        day_offset: dayOffsets[i],
      }));

      return NextResponse.json({
        trainId,
        source: 'journey_stations',
        train_uid: first.train_uid,
        schedule_start_date: first.schedule_start_date,
        severity: first.severity,
        total_scheduled_stops: first.total_scheduled_stops,
        found_stops_count: first.found_stops_count,
        missed_stops_count: first.missed_stops_count,
        records,
        totalRecords: records.length,
      });
    }

    // 2. Secondary source: predicted_gaps (missed stops only)
    const pgResult = await pool.query(
      `SELECT
         COALESCE(pg.id::text, pg.train_id || '-' || pg.station_index || '-' || COALESCE(pg.schedule_start_date, ''))
                                                         AS id,
         pg.train_id,
         pg.train_uid,
         pg.schedule_start_date,
         pg.severity,
         pg.total_scheduled_stops,
         pg.found_stops_count,
         pg.missed_stops_count,
         pg.station_index,
         COALESCE(
           NULLIF(pg.station_name, ''),
           NULLIF(tr.nlc_desc_16, ''),
           NULLIF(tr.nlc_desc, ''),
           tr.tiploc,
           pg.stanox
         )                                               AS station_name,
         COALESCE(tr.three_alpha, '')                    AS crs,
         pg.tiploc,
         pg.stanox,
         false                                           AS visited,
         pg.scheduled_time,
         pg.actual_time,
         pg.predicted_arrival,
         pg.predicted_arrival_ms,
         pg.predicted_departure,
         pg.predicted_departure_ms,
         pg.predicted_time,
         pg.predicted_time_ms,
         pg.predicted_delay_minutes,
         pg.prediction_confidence,
         pg.prediction_method,
         pg.prediction_basis,
         COALESCE(pg.approval_status, 'PENDING')         AS approval_status
       FROM predicted_gaps pg
       LEFT JOIN LATERAL (
         SELECT nlc_desc_16, nlc_desc, tiploc, three_alpha
         FROM tiploc_reference
         WHERE stanox = pg.stanox
         LIMIT 1
       ) tr ON true
       WHERE pg.train_id = $1
         AND COALESCE(pg.prediction_basis->>'stop_role', '') != 'JUNCTION'
       ORDER BY pg.station_index ASC`,
     [trainId]
   ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    if (pgResult.rows.length > 0) {
      const first = pgResult.rows[0];
      const records = pgResult.rows.map(r => ({
        ...r,
        scheduled_time:      normaliseTime(r.scheduled_time as string),
        actual_time:         normaliseTime(r.actual_time as string),
        predicted_arrival:   normaliseTime(r.predicted_arrival as string),
        predicted_departure: normaliseTime(r.predicted_departure as string),
        predicted_time:      normaliseTime(r.predicted_time as string) ?? normalisePredictedMs(r.predicted_time_ms as number),
      }));

      return NextResponse.json({
        trainId,
        source: 'predicted_gaps',
        train_uid: first.train_uid,
        schedule_start_date: first.schedule_start_date,
        severity: first.severity,
        total_scheduled_stops: first.total_scheduled_stops,
        found_stops_count: first.found_stops_count,
        missed_stops_count: first.missed_stops_count,
        records,
        totalRecords: records.length,
      });
    }

    // 3. Legacy fallback: gap_detection_results (pre-Confluent pipeline)
    const legacyResult = await pool.query(
      `SELECT
         gdr.msg_type,
         gdr.train_id,
         gdr.train_uid,
         gdr.msg_queue_timestamp,
         gdr.actual_ts,
         gdr.loc_stanox,
         t_loc.tiploc_code   AS loc_tiploc_code,
         gdr.stanox_array,
         gdr.tiploc_array,
         gdr.position_in_schedule,
         gdr.total_stops,
         gdr.prev_stanox,
         gdr.expected_prev_stanox,
         t_prev.tiploc_code  AS prev_tiploc_code,
         t_exp.tiploc_code   AS expected_tiploc_code,
         gdr.is_gap
       FROM gap_detection_results gdr
       LEFT JOIN tiploc t_loc  ON gdr.loc_stanox           = t_loc.stanox
       LEFT JOIN tiploc t_prev ON gdr.prev_stanox          = t_prev.stanox
       LEFT JOIN tiploc t_exp  ON gdr.expected_prev_stanox = t_exp.stanox
       WHERE gdr.train_id = $1
       ORDER BY gdr.actual_ts ASC`,
      [trainId]
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    if (legacyResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Train not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      trainId,
      source: 'gap_detection_results',
      records: legacyResult.rows,
      totalRecords: legacyResult.rows.length,
    });
  } catch (error) {
    console.error('Database error in /api/trains/[trainId]:', error);
    return NextResponse.json(
      { error: 'Failed to fetch train details' },
      { status: 500 }
    );
  }
}
