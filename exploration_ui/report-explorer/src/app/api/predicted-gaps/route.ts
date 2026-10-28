import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// Normalise VARCHAR time strings from the JDBC sink ("HH:MM:SS") to "HH:MM".
// Also handles ISO timestamps from movement tables.
function normaliseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const hms = s.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (hms) return `${hms[1]}:${hms[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return s;
}

function normalisePredictedMs(ms: number | string | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * GET /api/predicted-gaps
 *
 * Returns journeys grouped with their predicted gap stops sourced from the
 * `predicted_gaps` table, which is populated by the Confluent JDBC Sink
 * connector (topic: PREDICTED_GAPS_FLAT).
 *
 * The primary key written by the sink is (train_id, station_index, schedule_start_date).
 * The optional approval columns (id, approval_status, approved_time, …) are added
 * by the migration in db/migrations/001_predicted_gaps_approval_columns.sql and may
 * not be present in older deployments — all references use COALESCE / column existence
 * checks handled at the query level.
 *
 * Query params:
 *   status       PENDING | APPROVED | REJECTED | all  (default: PENDING)
 *   page         1-based page number (default: 1)
 *   pageSize     rows per page (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const sp       = request.nextUrl.searchParams;
    const status   = sp.get('status') || 'PENDING';
    const search   = (sp.get('search') || '').trim();
    const severity = (sp.get('severity') || '').trim().toUpperCase();
    const page     = Math.max(1, parseInt(sp.get('page')     || '1'));
    const pageSize = Math.max(1, parseInt(sp.get('pageSize') || '20'));
    const offset   = (page - 1) * pageSize;

    const params: unknown[] = [];
    const clauses: string[] = [];

    // Always restrict to today/yesterday to exclude stale pipeline-replay data.
    clauses.push(`pg.schedule_start_date >= (CURRENT_DATE - 1)::text`);

    // Exclude pure junction gaps — they are not passenger stops and add noise.
    clauses.push(`COALESCE(pg.prediction_basis->>'stop_role', '') != 'JUNCTION'`);

    if (status !== 'all') {
      params.push(status.toUpperCase());
      clauses.push(`COALESCE(pg.approval_status, 'PENDING') = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      clauses.push(`(pg.train_id ILIKE $${params.length} OR pg.train_uid ILIKE $${params.length})`);
    }
    if (severity) {
      params.push(severity);
      clauses.push(`pg.severity = $${params.length}`);
    }

    const whereClause = `WHERE ${clauses.join(' AND ')}`;

    // Total distinct journeys that have at least one non-junction gap
    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM (
         SELECT DISTINCT pg.train_id, pg.schedule_start_date
         FROM predicted_gaps pg
         ${whereClause}
       ) _j`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Paginated journey list — aggregate per (train_id, schedule_start_date)
    params.push(pageSize, offset);
    const journeyRows = await pool.query(
      `SELECT
         pg.train_id,
         pg.train_uid,
         pg.schedule_start_date,
         pg.severity,
         pg.total_scheduled_stops,
         pg.found_stops_count,
         pg.missed_stops_count,
         MAX(COALESCE(pg.received_at::text, pg.predicted_time, ''))        AS received_at,
         COUNT(*)                                                            AS prediction_count,
         COUNT(*) FILTER (WHERE COALESCE(pg.approval_status, 'PENDING') = 'PENDING')  AS pending_count,
         COUNT(*) FILTER (WHERE pg.approval_status = 'APPROVED')            AS approved_count,
         COUNT(*) FILTER (WHERE pg.approval_status = 'REJECTED')            AS rejected_count
       FROM predicted_gaps pg
       ${whereClause}
       GROUP BY
         pg.train_id, pg.train_uid, pg.schedule_start_date,
         pg.severity, pg.total_scheduled_stops,
         pg.found_stops_count, pg.missed_stops_count
       ORDER BY MAX(COALESCE(pg.received_at::text, pg.predicted_time, '')) DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    if (journeyRows.rows.length === 0) {
      return NextResponse.json({ journeys: [], total, page, pageSize });
    }

    // Fetch all predictions for the returned (train_id, schedule_start_date) pairs,
    // enriching station_name from tiploc_reference where available.
    type JourneyKey = { train_id: string; schedule_start_date: string | null };
    const keys: JourneyKey[] = journeyRows.rows.map(r => ({
      train_id: r.train_id,
      schedule_start_date: r.schedule_start_date,
    }));

    const trainIds = keys.map(k => k.train_id);
    const predParams: unknown[] = [trainIds];
    const predClauses: string[] = [];
    if (status !== 'all') {
      predParams.push(status.toUpperCase());
      predClauses.push(`COALESCE(pg.approval_status, 'PENDING') = $${predParams.length}`);
    }
    const predWhere = predClauses.length > 0 ? `AND ${predClauses.join(' AND ')}` : '';

    const predRows = await pool.query(
      `SELECT
         COALESCE(pg.id::text, pg.train_id || '-' || pg.station_index || '-' || COALESCE(pg.schedule_start_date, ''))
                                                        AS id,
         pg.train_id,
         pg.station_index,
         COALESCE(
           NULLIF(pg.station_name, ''),
           NULLIF(tr.nlc_desc_16, ''),
           NULLIF(tr.nlc_desc, ''),
           tr.tiploc,
           pg.stanox
         )                                              AS station_name,
         COALESCE(tr.three_alpha, '')                   AS crs,
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
         END                                              AS prediction_basis,
         COALESCE(pg.approval_status, 'PENDING')        AS approval_status,
         pg.approved_time,
         pg.approved_by,
         pg.approved_at,
         pg.rejection_reason,
         pg.received_at
       FROM predicted_gaps pg
       LEFT JOIN LATERAL (
         SELECT nlc_desc_16, nlc_desc, tiploc, three_alpha
         FROM tiploc_reference
         WHERE stanox = pg.stanox
         LIMIT 1
       ) tr ON true
       WHERE pg.train_id = ANY($1)
         ${predWhere}
       ORDER BY pg.train_id, pg.station_index`,
      predParams
    );

    // Group predictions by train_id, normalising times on the way out
    const predByTrain = new Map<string, unknown[]>();
    for (const row of predRows.rows) {
      const list = predByTrain.get(row.train_id) ?? [];
      list.push({
        ...row,
        scheduled_time: normaliseTime(row.scheduled_time),
        actual_time:    normaliseTime(row.actual_time),
        predicted_arrival:   normaliseTime(row.predicted_arrival),
        predicted_departure: normaliseTime(row.predicted_departure),
        predicted_time:      normaliseTime(row.predicted_time) ?? normalisePredictedMs(row.predicted_time_ms),
        approved_time:  normaliseTime(row.approved_time),
      });
      predByTrain.set(row.train_id, list);
    }

    const journeys = journeyRows.rows.map(j => ({
      ...j,
      predictions: predByTrain.get(j.train_id) ?? [],
    }));

    return NextResponse.json({ journeys, total, page, pageSize });
  } catch (error) {
    const msg    = error instanceof Error ? error.message : String(error);
    const code   = (error as Record<string, unknown>)?.code;
    const detail = (error as Record<string, unknown>)?.detail;
    console.error('GET /api/predicted-gaps error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch predicted gaps', details: msg, code, detail },
      { status: 500 }
    );
  }
}
