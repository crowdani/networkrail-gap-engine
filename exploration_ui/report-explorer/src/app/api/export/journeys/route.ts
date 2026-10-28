import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

function normaliseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const hms = s.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
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
  return new Date(n).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function computeDayOffsets(scheduledTimes: (string | null)[]): number[] {
  const offsets: number[] = new Array(scheduledTimes.length).fill(0);
  let prevMins: number | null = null;
  let currentOffset = 0;
  for (let i = 0; i < scheduledTimes.length; i++) {
    const mins = toMins(scheduledTimes[i]);
    if (mins !== null && prevMins !== null && mins < prevMins - 30) {
      currentOffset += 1;
    }
    offsets[i] = currentOffset;
    if (mins !== null) prevMins = mins;
  }
  return offsets;
}

/**
 * GET /api/export/journeys
 *
 * Exports all journeys that have at least one predicted gap correction.
 * Primary source: journey_stations LEFT JOIN predicted_gaps (full stop timeline).
 * Falls back to predicted_gaps-only rows for journeys not yet in journey_stations.
 *
 * Query params:
 *   approval  — PENDING | APPROVED | REJECTED | all  (default: all)
 *   days      — how many calendar days back to include  (default: 7)
 *
 * Returns:
 * {
 *   exported_at: ISO string,
 *   journey_count: number,
 *   filters: { approval, days },
 *   journeys: [
 *     {
 *       train_id, train_uid, schedule_start_date, severity,
 *       total_scheduled_stops, found_stops_count, missed_stops_count,
 *       stops: [
 *         { station_index, station_name, crs, stanox, tiploc,
 *           status, visited,
 *           scheduled_arrival, scheduled_departure,
 *           actual_arrival, actual_departure,
 *           predicted_time, predicted_delay_minutes,
 *           prediction_confidence, prediction_method, prediction_basis,
 *           approval_status, approved_time,
 *           day_offset }
 *       ]
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const sp       = request.nextUrl.searchParams;
    const approval = (sp.get('approval') || 'all').toUpperCase();
    const days     = Math.min(Math.max(1, parseInt(sp.get('days') || '7')), 90);

    // ── 1. Primary: journey_stations (full timeline) ──────────────────────────
    // Only include journeys that have at least one predicted correction
    // (LEFT JOIN predicted_gaps, filter to those with a pg row).
    const approvalClause = approval !== 'ALL'
      ? `AND COALESCE(pg.approval_status, 'PENDING') = '${approval.replace(/'/g, "''")}'`
      : '';

    const jsRows = await pool.query(
      `SELECT
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
         js.event,
         js.scheduled_time,
         js.scheduled_arrival,
         js.scheduled_departure,
         js.actual_time,
         js.actual_arrival,
         js.actual_departure,
         COALESCE(js.predicted_arrival,  pg.predicted_arrival)            AS predicted_arrival,
         COALESCE(js.predicted_arrival_ms, pg.predicted_arrival_ms)       AS predicted_arrival_ms,
         COALESCE(js.predicted_departure, pg.predicted_departure)         AS predicted_departure,
         COALESCE(js.predicted_departure_ms, pg.predicted_departure_ms)   AS predicted_departure_ms,
         COALESCE(js.predicted_time,  pg.predicted_time)                  AS predicted_time,
         COALESCE(js.predicted_time_ms, pg.predicted_time_ms)             AS predicted_time_ms,
         COALESCE(js.predicted_delay_minutes, pg.predicted_delay_minutes) AS predicted_delay_minutes,
         COALESCE(js.prediction_confidence, pg.prediction_confidence)     AS prediction_confidence,
         COALESCE(js.prediction_method, pg.prediction_method)             AS prediction_method,
         COALESCE(js.prediction_basis, pg.prediction_basis::text)         AS prediction_basis,
         COALESCE(pg.approval_status, js.approval_status, 'PENDING')      AS approval_status,
         COALESCE(pg.approved_time, js.approved_time)                     AS approved_time,
         pg.id                                                             AS gap_id
       FROM journey_stations js
       -- Restrict to journeys that have at least one predicted gap row
       INNER JOIN (
         SELECT DISTINCT train_id, schedule_start_date
         FROM predicted_gaps
         WHERE received_at >= NOW() - ($1 || ' days')::INTERVAL
       ) has_gap
         ON has_gap.train_id = js.train_id
         AND COALESCE(has_gap.schedule_start_date, '') = COALESCE(js.schedule_start_date, '')
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
       WHERE js.schedule_start_date >= (CURRENT_DATE - $1)::text
         ${approvalClause}
       ORDER BY js.train_id, js.schedule_start_date, js.station_index`,
      [days]
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    // ── 2. Fallback: predicted_gaps-only (journeys not yet in journey_stations) ─
    const jsTrainIds = new Set(jsRows.rows.map(r => `${r.train_id}|${r.schedule_start_date ?? ''}`));

    const pgRows = await pool.query(
      `SELECT
         COALESCE(pg.id::text, pg.train_id || '-' || pg.station_index || '-' || COALESCE(pg.schedule_start_date, ''))
                                                          AS gap_id,
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
         'MISSED'                                        AS status,
         pg.scheduled_time,
         NULL                                            AS scheduled_arrival,
         NULL                                            AS scheduled_departure,
         pg.actual_time,
         NULL                                            AS actual_arrival,
         NULL                                            AS actual_departure,
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
         COALESCE(pg.approval_status, 'PENDING')         AS approval_status,
         pg.approved_time
       FROM predicted_gaps pg
       LEFT JOIN LATERAL (
         SELECT nlc_desc_16, nlc_desc, tiploc, three_alpha
         FROM tiploc_reference
         WHERE stanox = pg.stanox
         LIMIT 1
       ) tr ON true
       WHERE pg.received_at >= NOW() - ($1 || ' days')::INTERVAL
         AND pg.schedule_start_date >= (CURRENT_DATE - $1)::text
       ORDER BY pg.train_id, pg.schedule_start_date, pg.station_index`,
      [days]
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    // Filter out pg rows whose journey is already covered by journey_stations
    const fallbackRows = pgRows.rows.filter(
      r => !jsTrainIds.has(`${r.train_id}|${r.schedule_start_date ?? ''}`)
    );

    // ── 3. Combine & group by (train_id, schedule_start_date) ─────────────────
    type StopRow = Record<string, unknown>;
    const allRows: StopRow[] = [...jsRows.rows, ...fallbackRows];

    const journeyMap = new Map<string, {
      train_id: string;
      train_uid: string | null;
      schedule_start_date: string | null;
      severity: string | null;
      total_scheduled_stops: number | null;
      found_stops_count: number | null;
      missed_stops_count: number | null;
      stops: StopRow[];
    }>();

    for (const row of allRows) {
      const key = `${row.train_id}|${row.schedule_start_date ?? ''}`;
      if (!journeyMap.has(key)) {
        journeyMap.set(key, {
          train_id:             row.train_id as string,
          train_uid:            row.train_uid as string | null,
          schedule_start_date:  row.schedule_start_date as string | null,
          severity:             row.severity as string | null,
          total_scheduled_stops: row.total_scheduled_stops as number | null,
          found_stops_count:    row.found_stops_count as number | null,
          missed_stops_count:   row.missed_stops_count as number | null,
          stops: [],
        });
      }
      journeyMap.get(key)!.stops.push(row);
    }

    // ── 4. Normalise times, compute day_offset, shape output ──────────────────
    const journeys = Array.from(journeyMap.values()).map(j => {
      const normStops = j.stops.map(s => ({
        station_index:          s.station_index,
        station_name:           s.station_name,
        crs:                    s.crs,
        stanox:                 s.stanox,
        tiploc:                 s.tiploc,
        visited:                s.visited,
        status:                 s.status,
        event:                  s.event ?? null,
        scheduled_time:         normaliseTime(s.scheduled_time as string),
        scheduled_arrival:      normaliseTime(s.scheduled_arrival as string),
        scheduled_departure:    normaliseTime(s.scheduled_departure as string),
        actual_time:            normaliseTime(s.actual_time as string),
        actual_arrival:         normaliseTime(s.actual_arrival as string),
        actual_departure:       normaliseTime(s.actual_departure as string),
        predicted_arrival:      normaliseTime(s.predicted_arrival as string),
        predicted_departure:    normaliseTime(s.predicted_departure as string),
        predicted_time:         normaliseTime(s.predicted_time as string)
                                  ?? normalisePredictedMs(s.predicted_time_ms as number),
        predicted_delay_minutes: s.predicted_delay_minutes,
        prediction_confidence:  s.prediction_confidence,
        prediction_method:      s.prediction_method,
        prediction_basis:       (() => {
          const raw = s.prediction_basis;
          if (!raw) return null;
          if (typeof raw === 'object') return raw;
          const str = String(raw).trim();
          if (str.startsWith('{')) { try { return JSON.parse(str); } catch { /* fall through */ } }
          return str;
        })(),
        approval_status:        s.approval_status,
        approved_time:          normaliseTime(s.approved_time as string),
        gap_id:                 s.gap_id ?? null,
      }));

      const refTimes = normStops.map(s => s.scheduled_arrival ?? s.scheduled_time);
      const dayOffsets = computeDayOffsets(refTimes);
      const stopsWithOffset = normStops.map((s, i) => ({ ...s, day_offset: dayOffsets[i] }));

      return {
        train_id:             j.train_id,
        train_uid:            j.train_uid,
        schedule_start_date:  j.schedule_start_date,
        severity:             j.severity,
        total_scheduled_stops: j.total_scheduled_stops,
        found_stops_count:    j.found_stops_count,
        missed_stops_count:   j.missed_stops_count,
        stops:                stopsWithOffset,
      };
    });

    // Sort: most missed stops first, then by train_id
    journeys.sort((a, b) =>
      (b.missed_stops_count ?? 0) - (a.missed_stops_count ?? 0)
      || a.train_id.localeCompare(b.train_id)
    );

    const payload = {
      exported_at:   new Date().toISOString(),
      journey_count: journeys.length,
      filters:       { approval: approval === 'ALL' ? 'all' : approval, days },
      journeys,
    };

    return NextResponse.json(payload, {
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="journeys-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[export/journeys]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
