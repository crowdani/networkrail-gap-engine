import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

function normaliseTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const hms = s.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (hms) return `${hms[1]}:${hms[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return s;
}

/**
 * GET /api/locations/[stanox]
 *
 * Returns all predicted gaps for a specific missed station STANOX.
 * Each row is one journey where this station was missed, including the
 * prediction data sinked from Confluent.
 *
 * Query params:
 *   page      (default: 1)
 *   pageSize  (default: 50)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stanox: string }> }
) {
  const { stanox } = await params;
  const sp       = request.nextUrl.searchParams;
  const page     = Math.max(1, parseInt(sp.get('page')     || '1'));
  const pageSize = Math.max(1, parseInt(sp.get('pageSize') || '50'));
  const offset   = (page - 1) * pageSize;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM predicted_gaps
       WHERE stanox = $1
         AND schedule_start_date >= (CURRENT_DATE - 1)::text
         AND COALESCE(prediction_basis->>'stop_role', '') != 'JUNCTION'`,
      [stanox]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
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
           pg.stanox
         )                                              AS station_name,
         COALESCE(tr.three_alpha, '')                   AS crs,
         pg.tiploc,
         pg.stanox,
         pg.scheduled_time,
         pg.actual_time,
         pg.predicted_arrival,
         pg.predicted_departure,
         pg.predicted_time,
         pg.predicted_delay_minutes,
         pg.prediction_confidence,
         pg.prediction_method,
         COALESCE(pg.approval_status, 'PENDING')        AS approval_status,
         pg.received_at
       FROM predicted_gaps pg
       LEFT JOIN LATERAL (
         SELECT nlc_desc_16, nlc_desc, tiploc, three_alpha
         FROM tiploc_reference
         WHERE stanox = pg.stanox
         LIMIT 1
       ) tr ON true
       WHERE pg.stanox = $1
         AND pg.schedule_start_date >= (CURRENT_DATE - 1)::text
         AND COALESCE(pg.prediction_basis->>'stop_role', '') != 'JUNCTION'
       ORDER BY COALESCE(pg.predicted_time, '') DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [stanox, pageSize, offset]
    );

    const gaps = result.rows.map(row => ({
      ...row,
      scheduled_time:      normaliseTime(row.scheduled_time),
      actual_time:         normaliseTime(row.actual_time),
      predicted_arrival:   normaliseTime(row.predicted_arrival),
      predicted_departure: normaliseTime(row.predicted_departure),
      predicted_time:      normaliseTime(row.predicted_time),
    }));

    return NextResponse.json({ gaps, total, page, pageSize });
  } catch (error) {
    console.error('Error in /api/locations/[stanox]:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gaps for location', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
