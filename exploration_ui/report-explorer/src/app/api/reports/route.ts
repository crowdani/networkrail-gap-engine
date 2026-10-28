import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports
 *
 * Returns a combined trains + stations report from PostgreSQL:
 *
 *   summary       — headline counts (total journeys, gaps, trains today, etc.)
 *   top_stations  — stations with the most missed stops
 *   trains        — paginated list of journeys with gap counts
 *
 * Query params:
 *   page      (default 1)
 *   pageSize  (default 25)
 *   days      look-back window in days (default 7)
 */
export async function GET(request: Request) {
  try {
    const sp       = new URL(request.url).searchParams;
    const page     = Math.max(1, parseInt(sp.get('page')     ?? '1'));
    const pageSize = Math.max(1, parseInt(sp.get('pageSize') ?? '25'));
    const days     = Math.max(1, parseInt(sp.get('days')     ?? '7'));
    const offset   = (page - 1) * pageSize;

    const since = `NOW() - INTERVAL '${days} days'`;

    // ── Summary ──────────────────────────────────────────────────────────────
    const summaryResult = await pool.query(`
      SELECT
        COUNT(DISTINCT j.id)                                                          AS total_journeys,
        COUNT(DISTINCT j.id) FILTER (WHERE j.gaps_detected > 0)                      AS journeys_with_gaps,
        COALESCE(SUM(j.gaps_detected), 0)                                             AS total_gaps,
        COUNT(DISTINCT j.id) FILTER (WHERE j.analyzed_at >= ${since})                AS journeys_today,
        COUNT(DISTINCT g.missed_station_stanox)                                       AS unique_stations_affected,
        ROUND(AVG(j.gaps_detected) FILTER (WHERE j.gaps_detected > 0), 2)            AS avg_gaps_per_journey,
        COUNT(DISTINCT g.id) FILTER (WHERE g.severity = 'HIGH')                      AS high_severity_gaps,
        COUNT(DISTINCT g.id) FILTER (WHERE g.prediction_method IS NOT NULL)           AS gaps_with_prediction,
        COUNT(DISTINCT g.id) FILTER (WHERE g.infill_status = 'Closed')               AS gaps_resolved
      FROM train_journeys j
      LEFT JOIN gaps g ON g.journey_id = j.id
      WHERE j.analyzed_at >= ${since}
    `);
    const summary = summaryResult.rows[0];

    // ── Top stations ─────────────────────────────────────────────────────────
    const stationsResult = await pool.query(`
      SELECT
        g.missed_station_stanox                                        AS stanox,
        get_location_name(g.missed_station_stanox)                     AS station_name,
        COUNT(*)                                                        AS total_gaps,
        COUNT(DISTINCT g.train_id)                                      AS affected_trains,
        COUNT(*) FILTER (WHERE g.severity = 'HIGH')                    AS high_severity,
        COUNT(*) FILTER (WHERE g.infill_status = 'Closed')             AS resolved,
        COUNT(*) FILTER (WHERE g.prediction_method IS NOT NULL)        AS predicted,
        MAX(g.detected_at)                                              AS last_seen
      FROM gaps g
      WHERE g.detected_at >= ${since}
      GROUP BY g.missed_station_stanox
      ORDER BY total_gaps DESC
      LIMIT 20
    `);

    // ── Trains list ───────────────────────────────────────────────────────────
    const countResult = await pool.query(`
      SELECT COUNT(*) AS count
      FROM train_journeys j
      WHERE j.analyzed_at >= ${since}
    `);
    const totalJourneys = parseInt(countResult.rows[0].count);

    const trainsResult = await pool.query(`
      SELECT
        j.id                                                                          AS journey_id,
        j.train_id,
        j.train_uid,
        j.operator_code,
        j.analyzed_at,
        j.total_movements,
        j.gaps_detected,
        CASE
          WHEN array_length(j.scheduled_route, 1) >= 2
          THEN get_location_name(j.scheduled_route[1])
               || ' → '
               || get_location_name(j.scheduled_route[array_length(j.scheduled_route, 1)])
          ELSE NULL
        END                                                                           AS route_summary,
        array_length(j.scheduled_route, 1)                                           AS scheduled_stops,
        array_length(j.actual_route, 1)                                              AS actual_stops,
        COALESCE(
          (SELECT string_agg(get_location_name(g.missed_station_stanox), ', ' ORDER BY g.detected_at)
           FROM gaps g WHERE g.journey_id = j.id LIMIT 5),
          '—'
        )                                                                             AS missed_stations,
        (SELECT MAX(g.severity) FROM gaps g WHERE g.journey_id = j.id)              AS worst_severity,
        (SELECT COUNT(*) FROM gaps g WHERE g.journey_id = j.id
           AND g.prediction_method IS NOT NULL)                                       AS predictions_count,
        (SELECT COUNT(*) FROM gaps g WHERE g.journey_id = j.id
           AND g.infill_status = 'Closed')                                            AS resolved_count
      FROM train_journeys j
      WHERE j.analyzed_at >= ${since}
      ORDER BY j.gaps_detected DESC, j.analyzed_at DESC
      LIMIT $1 OFFSET $2
    `, [pageSize, offset]);

    return NextResponse.json({
      summary,
      top_stations: stationsResult.rows,
      trains:       trainsResult.rows,
      total:        totalJourneys,
      page,
      pageSize,
      days,
    });
  } catch (error) {
    console.error('GET /api/reports error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch report', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
