import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/locations
 *
 * Returns missed-station frequency data aggregated from the `predicted_gaps`
 * table (Confluent JDBC Sink output).  Each row in predicted_gaps represents
 * one missed stop on one journey, so grouping by stanox gives us the number
 * of times each location has been a gap.
 *
 * Query params:
 *   startDate, endDate   ISO date strings for filtering by received_at
 *   minGaps              minimum gap count threshold (default: 0)
 *   search               text search against station_name / stanox
 *   sortBy               total_gaps | recent | gap_percentage (default: total_gaps)
 *   sortOrder            asc | desc (default: desc)
 */
export async function GET(request: NextRequest) {
  try {
    const sp         = request.nextUrl.searchParams;
    const startDate  = sp.get('startDate');
    const endDate    = sp.get('endDate');
    const minGaps    = Math.max(0, parseInt(sp.get('minGaps')  || '0'));
    const searchTerm = sp.get('search') || '';
    const sortBy     = sp.get('sortBy')    || 'total_gaps';
    const sortOrder  = (sp.get('sortOrder') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const params: unknown[] = [];
    let idx = 1;

    // Date filter — use received_at (TIMESTAMPTZ) not predicted_time (VARCHAR "HH:MM")
    let dateFilter = '';
    if (startDate && endDate) {
      dateFilter = `AND pg.received_at >= $${idx}::date AND pg.received_at < ($${idx + 1}::date + INTERVAL '1 day')`;
      params.push(startDate, endDate);
      idx += 2;
    }

    // Search filter
    let searchFilter = '';
    if (searchTerm) {
      searchFilter = `AND (LOWER(COALESCE(pg.station_name, '')) LIKE LOWER($${idx}) OR pg.stanox LIKE $${idx})`;
      params.push(`%${searchTerm}%`);
      idx++;
    }

    // minGaps placeholder
    params.push(minGaps);
    const minGapsIdx = idx;

    // Sort column — must reference CTE output column aliases, not raw aggregate expressions.
    const sortCol =
      sortBy === 'recent'         ? 'most_recent_gap'
      : sortBy === 'gap_percentage' ? 'gap_percentage'
      : 'total_trains';

    // Single query: compute per-location stats + overall summary via window functions.
    // Uses idx_pg_stanox_train covering index (stanox, train_id) to avoid heap fetches.
    const query = `
      WITH location_agg AS (
        SELECT
          pg.stanox                                                              AS location_stanox,
          COALESCE(
            NULLIF(MIN(pg.station_name), ''),
            NULLIF(tr.nlc_desc_16, ''),
            NULLIF(tr.nlc_desc, ''),
            pg.stanox
          )                                                                      AS location_name,
          COUNT(DISTINCT pg.train_id)                                            AS total_trains,
          COUNT(*)                                                               AS total_gaps,
          MAX(pg.received_at)                                                    AS most_recent_gap,
          COUNT(*) FILTER (WHERE UPPER(pg.severity) = 'CRITICAL')               AS critical_count,
          COUNT(*) FILTER (WHERE UPPER(pg.severity) = 'HIGH')                   AS high_count,
          COUNT(*) FILTER (WHERE UPPER(pg.severity) = 'MEDIUM')                 AS medium_count,
          COUNT(*) FILTER (WHERE UPPER(pg.severity) = 'LOW')                    AS low_count,
          ROUND(
            COUNT(*)::numeric
            / NULLIF(MAX(pg.total_scheduled_stops), 0) * 100,
            1
          )                                                                      AS gap_percentage
        FROM predicted_gaps pg
        LEFT JOIN LATERAL (
          SELECT nlc_desc_16, nlc_desc
          FROM tiploc_reference
          WHERE stanox = pg.stanox
          LIMIT 1
        ) tr ON true
        WHERE pg.stanox IS NOT NULL
          AND pg.schedule_start_date >= (CURRENT_DATE - 1)::text
          AND COALESCE(pg.prediction_basis->>'stop_role', '') != 'JUNCTION'
          ${dateFilter}
          ${searchFilter}
        GROUP BY pg.stanox, tr.nlc_desc_16, tr.nlc_desc
        HAVING COUNT(DISTINCT pg.train_id) >= $${minGapsIdx}
      )
      SELECT
        *,
        -- Summary totals computed in a single pass via window functions
        SUM(total_gaps)   OVER () AS summary_total_gaps,
        COUNT(*) OVER ()          AS summary_locations_affected
      FROM location_agg
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST
    `;

    const result = await pool.query(query, params);

    const summaryRow = result.rows[0];

    const locations = result.rows.map(row => ({
      location_stanox:  row.location_stanox,
      location_name:    row.location_name || row.location_stanox,
      total_gaps:       parseInt(row.total_gaps),
      total_trains:     parseInt(row.total_trains),
      gap_percentage:   parseFloat(row.gap_percentage ?? 0),
      most_recent_gap:  row.most_recent_gap ?? null,
      severity_breakdown: {
        CRITICAL: parseInt(row.critical_count || 0),
        HIGH:     parseInt(row.high_count     || 0),
        MEDIUM:   parseInt(row.medium_count   || 0),
        LOW:      parseInt(row.low_count      || 0),
      },
    }));

    return NextResponse.json({
      locations,
      summary: {
        total_gaps:         parseInt(summaryRow?.summary_total_gaps         || 0),
        locations_affected: parseInt(summaryRow?.summary_locations_affected || 0),
      },
    });
  } catch (error) {
    console.error('Error fetching location gap data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch location gap data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
