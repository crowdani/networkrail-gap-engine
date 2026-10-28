import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ---------------------------------------------------------------------------
// Time normalisation helpers
// Times from the Confluent JDBC Sink are stored as VARCHAR.  The ksqlDB
// pipeline emits them as "HH:MM:SS" strings.  Movement tables use TIMESTAMPTZ.
// Always return clean "HH:MM" for display.
// ---------------------------------------------------------------------------

function normaliseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  // HH:MM:SS or HH:MM:SS.mmm — take first two parts
  const hms = s.match(/^(\d{2}):(\d{2})(?::\d{2})?/);
  if (hms) return `${hms[1]}:${hms[2]}`;
  // ISO 8601 / full timestamp from movement tables
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  return s; // return as-is rather than silently drop
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
 * GET /api/predicted-gaps/journey/[trainId]
 *
 * Returns a unified stop timeline for a journey, ordered by station_index.
 *
 * Primary source: journey_stations table (all stops — visited + missed)
 *   - Populated by Confluent JDBC Sink connector 07-connector-journey-stations-sink.json
 *   - Topic: JOURNEY_GAPS_EXPLODED (all stops from the gap detector)
 *
 * Fallback: predicted_gaps table (missed stops only) + movement tables (visited)
 *   - Used when journey_stations is empty (connector not yet deployed)
 *
 * Query params:
 *   scheduleStartDate   optional — narrows to one specific service date
 *
 * Response shape:
 * {
 *   train_id, train_uid, schedule_start_date, severity,
 *   total_scheduled_stops, found_stops_count, missed_stops_count,
 *   source: 'journey_stations' | 'predicted_gaps_merge',
 *   stops: Array<{
 *     id, station_index, station_name, crs, tiploc, stanox,
 *     status: 'VISITED' | 'MISSED' | 'UNKNOWN',
 *     scheduled_time, actual_time,
 *     predicted_time, predicted_delay_minutes, prediction_confidence,
 *     prediction_method, approval_status, approved_time
 *   }>
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trainId: string }> }
) {
  const { trainId } = await params;
  const sp = request.nextUrl.searchParams;
  const scheduleStartDate = sp.get('scheduleStartDate');

  try {
    // ── 1. Try journey_stations (all stops) ─────────────────────────────────
    const jsParams: unknown[] = [trainId];
    let jsDateFilter = '';
    if (scheduleStartDate) {
      jsParams.push(scheduleStartDate);
      jsDateFilter = `AND js.schedule_start_date = $${jsParams.length}`;
    }

    const jsResult = await pool.query(
      `SELECT
         -- Use numeric predicted_gaps.id so the approval PATCH route works.
         -- journey_stations has no serial id, so fall back to a composite key.
         COALESCE(
           pg.id::text,
           js.train_id || '-' || js.station_index || '-' || COALESCE(js.schedule_start_date, '')
         )                                                  AS id,
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
         )                                                  AS station_name,
         COALESCE(tr.three_alpha, '')                       AS crs,
         js.tiploc,
         js.stanox,
         js.visited,
         js.status                                          AS raw_status,
         js.scheduled_time,
         js.scheduled_arrival,
         js.scheduled_departure,
         js.actual_time,
         js.actual_arrival,
         js.actual_departure,
         js.event,
         COALESCE(js.predicted_arrival,  pg.predicted_arrival)        AS predicted_arrival,
         COALESCE(js.predicted_arrival_ms, pg.predicted_arrival_ms)   AS predicted_arrival_ms,
         COALESCE(js.predicted_departure, pg.predicted_departure)     AS predicted_departure,
         COALESCE(js.predicted_departure_ms, pg.predicted_departure_ms) AS predicted_departure_ms,
         COALESCE(js.predicted_time,  pg.predicted_time)              AS predicted_time,
         COALESCE(js.predicted_time_ms, pg.predicted_time_ms)         AS predicted_time_ms,
         COALESCE(js.predicted_delay_minutes, pg.predicted_delay_minutes) AS predicted_delay_minutes,
         COALESCE(js.prediction_confidence, pg.prediction_confidence) AS prediction_confidence,
         COALESCE(js.prediction_method, pg.prediction_method)         AS prediction_method,
         CASE
           WHEN COALESCE(js.prediction_basis, pg.prediction_basis::text) IS NULL THEN NULL
           WHEN COALESCE(js.prediction_basis, pg.prediction_basis::text) LIKE '{%'
             THEN COALESCE(js.prediction_basis, pg.prediction_basis::text)::jsonb
           ELSE NULL
         END                                                AS prediction_basis,
         -- predicted_gaps.approval_status is the authoritative source (PATCH updates it there)
         COALESCE(pg.approval_status, js.approval_status, 'PENDING') AS approval_status,
         COALESCE(pg.approved_time, js.approved_time)       AS approved_time,
         js.approved_by
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
         ${jsDateFilter}
         -- Suppress junction stops (passthrough timing points) — visited or not.
         -- Match both compact JSON ("stop_role":"JUNCTION") and spaced form.
         AND NOT (
           COALESCE(js.prediction_basis, pg.prediction_basis::text, '')
             LIKE '%"stop_role":"JUNCTION"%'
           OR
           COALESCE(js.prediction_basis, pg.prediction_basis::text, '')
             LIKE '%"stop_role": "JUNCTION"%'
         )
       ORDER BY js.station_index ASC`,
     jsParams
   ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    if (jsResult.rows.length > 0) {
      const first = jsResult.rows[0];

      const stops = jsResult.rows.map(r => {
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

        return ({
        id:                      r.id as string | null,
        station_index:           r.station_index as number,
        station_name:            r.station_name as string,
        crs:                     r.crs as string,
        tiploc:                  r.tiploc as string | null,
        stanox:                  r.stanox as string,
        // Map gap detector status ('found'/'not found') → UI status
        status:                  (r.visited === true || r.raw_status === 'found')
                                   ? ('VISITED' as const)
                                   : ('MISSED' as const),
        scheduled_time:          normaliseTime(r.scheduled_time as string),
        scheduled_arrival:       schedArr,
        predicted_arrival:       normaliseTime(r.predicted_arrival as string),
        predicted_departure:     normaliseTime(r.predicted_departure as string),
        scheduled_departure:     normaliseTime(r.scheduled_departure as string),
        actual_time:             normaliseTime(r.actual_time as string),
        actual_arrival:          validActArr,
        actual_departure:        actDep,
        event:                   r.event as string | null,
        predicted_time:          normaliseTime(r.predicted_time as string) ??
                                   normalisePredictedMs(r.predicted_time_ms as number),
        predicted_delay_minutes: r.predicted_delay_minutes as number | null,
        prediction_confidence:   r.prediction_confidence as number | null,
        prediction_method:       r.prediction_method as string | null,
        prediction_basis:        (r.prediction_basis as Record<string, unknown> | null) ?? null,
        approval_status:         r.approval_status as string,
        approved_time:           normaliseTime(r.approved_time as string),
        });
      });

      return NextResponse.json({
        train_id:              first.train_id,
        train_uid:             first.train_uid,
        schedule_start_date:   first.schedule_start_date,
        severity:              first.severity,
        total_scheduled_stops: first.total_scheduled_stops,
        found_stops_count:     first.found_stops_count,
        missed_stops_count:    first.missed_stops_count,
        source:                'journey_stations',
        stops,
      });
    }

    // ── 2. Fallback: predicted_gaps (missed only) + movement tables ──────────
    //    Used when the journey_stations sink connector is not yet deployed.
    const pgParams: unknown[] = [trainId];
    let pgDateFilter = '';
    if (scheduleStartDate) {
      pgParams.push(scheduleStartDate);
      pgDateFilter = `AND pg.schedule_start_date = $${pgParams.length}`;
    }

    const pgResult = await pool.query(
      `SELECT
         COALESCE(pg.id::text,
           pg.train_id || '-' || pg.station_index || '-' || COALESCE(pg.schedule_start_date, ''))
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
         )                                                   AS station_name,
         COALESCE(tr.three_alpha, '')                        AS crs,
         pg.tiploc,
         pg.stanox,
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
         CASE
           WHEN pg.prediction_basis IS NULL THEN NULL
           WHEN pg.prediction_basis::text LIKE '{%' THEN pg.prediction_basis::jsonb
           ELSE NULL
         END                                                 AS prediction_basis,
         COALESCE(pg.approval_status, 'PENDING')             AS approval_status,
         pg.approved_time,
         pg.approved_by
       FROM predicted_gaps pg
       LEFT JOIN LATERAL (
         SELECT nlc_desc_16, nlc_desc, tiploc, three_alpha
         FROM tiploc_reference
         WHERE stanox = pg.stanox
         LIMIT 1
       ) tr ON true
       WHERE pg.train_id = $1
         ${pgDateFilter}
         AND COALESCE(pg.prediction_basis->>'stop_role', '') != 'JUNCTION'
       ORDER BY pg.station_index ASC`,
     pgParams
   );

    if (pgResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'No stop data found for this train', source: 'none' },
        { status: 404 }
      );
    }

    const first = pgResult.rows[0];

    // Try to supplement with visited stops from movement tables
    let visitedStops: Array<{
      stanox: string;
      station_name: string | null;
      crs: string | null;
      actual_time: string | null;
      scheduled_time: string | null;
    }> = [];

    const jmResult = await pool.query(
      `SELECT
         jm.stanox,
         get_location_name(jm.stanox)        AS station_name,
         al.three_alpha                      AS crs,
         jm.actual_time::text                AS actual_time,
         jm.scheduled_time::text             AS scheduled_time
       FROM journey_movements jm
       LEFT JOIN active_locations al ON jm.stanox = al.stanox
       WHERE jm.train_id = $1
       ORDER BY jm.sequence_number`,
      [trainId]
    ).catch(() => ({ rows: [] }));

    if (jmResult.rows.length > 0) {
      visitedStops = jmResult.rows;
    } else {
      const tmResult = await pool.query(
        `SELECT
           m.loc_stanox                              AS stanox,
           get_location_name(m.loc_stanox)           AS station_name,
           al.three_alpha                            AS crs,
           m.actual_timestamp::text                  AS actual_time,
           m.planned_timestamp::text                 AS scheduled_time
         FROM train_movements m
         LEFT JOIN active_locations al ON m.loc_stanox = al.stanox
         WHERE m.train_id = $1
         ORDER BY m.actual_timestamp ASC NULLS LAST`,
        [trainId]
      ).catch(() => ({ rows: [] }));
      visitedStops = tmResult.rows;
    }

    const visitedStanoxMap = new Map(visitedStops.map(s => [s.stanox, s]));

    // Visited-only stops (in movement tables but not in predicted_gaps)
    const visitedNotMissed = visitedStops
      .filter(s => !pgResult.rows.some(r => r.stanox === s.stanox))
      .map((s, i) => ({
        id:                      null as string | null,
        station_index:           -(i + 1),
        station_name:            s.station_name ?? s.stanox,
        crs:                     s.crs ?? '',
        tiploc:                  null as string | null,
        stanox:                  s.stanox,
        status:                  'VISITED' as const,
        scheduled_time:          normaliseTime(s.scheduled_time),
        actual_time:             normaliseTime(s.actual_time),
        event:                   null as string | null,
        predicted_arrival:       null as string | null,
        predicted_departure:     null as string | null,
        predicted_time:          null as string | null,
        predicted_delay_minutes: null as number | null,
        prediction_confidence:   null as number | null,
        prediction_method:       null as string | null,
        approval_status:         null as string | null,
        approved_time:           null as string | null,
      }));

    // Gap stops from predicted_gaps — MISSED unless movement table confirms visited
    const gapStops = pgResult.rows.map(r => {
      const fromMovement = visitedStanoxMap.get(r.stanox);
      const isVisited = !!fromMovement || !!r.actual_time;
      return {
        id:                      r.id as string,
        station_index:           r.station_index as number,
        station_name:            r.station_name as string,
        crs:                     r.crs as string,
        tiploc:                  r.tiploc as string | null,
        stanox:                  r.stanox as string,
        status:                  isVisited ? ('VISITED' as const) : ('MISSED' as const),
        scheduled_time:          normaliseTime(r.scheduled_time),
        actual_time:             normaliseTime(fromMovement?.actual_time ?? r.actual_time),
        event:                   null as string | null,
        predicted_arrival:       normaliseTime(r.predicted_arrival as string),
        predicted_departure:     normaliseTime(r.predicted_departure as string),
        predicted_time:          normaliseTime(r.predicted_time) ?? normalisePredictedMs(r.predicted_time_ms),
        predicted_delay_minutes: r.predicted_delay_minutes as number | null,
        prediction_confidence:   r.prediction_confidence as number | null,
        prediction_method:       r.prediction_method as string | null,
        prediction_basis:        (r.prediction_basis as Record<string, unknown> | null) ?? null,
        approval_status:         r.approval_status as string,
        approved_time:           normaliseTime(r.approved_time),
      };
    });

    gapStops.sort((a, b) => a.station_index - b.station_index);
    const allStops = [...visitedNotMissed, ...gapStops];

    return NextResponse.json({
      train_id:              first.train_id,
      train_uid:             first.train_uid,
      schedule_start_date:   first.schedule_start_date,
      severity:              first.severity,
      total_scheduled_stops: first.total_scheduled_stops,
      found_stops_count:     first.found_stops_count,
      missed_stops_count:    first.missed_stops_count,
      source:                'predicted_gaps_merge',
      stops:                 allStops,
    });

  } catch (error) {
    console.error('Error in /api/predicted-gaps/journey/[trainId]:', error);
    return NextResponse.json(
      { error: 'Failed to fetch journey stops', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
