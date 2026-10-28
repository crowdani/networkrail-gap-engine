import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'ANALYZED';
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam) : null;

  try {
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM train_journeys
      WHERE status = $1
    `;
    const countResult = await pool.query(countQuery, [status]);
    const totalCount = parseInt(countResult.rows[0].total);

    // Get journeys - with optional limit
    const query = `
      SELECT
        j.id,
        j.train_id,
        j.train_uid,
        j.status,
        j.activated_at,
        j.terminated_at,
        j.analyzed_at,
        j.scheduled_route,
        j.actual_route,
        j.total_movements,
        j.gaps_detected,
        j.operator_code,
        j.service_code,
        array_length(j.scheduled_route, 1) as scheduled_stops,
        array_length(j.actual_route, 1) as actual_stops,
        EXTRACT(EPOCH FROM (j.terminated_at - j.activated_at))/60 as journey_duration_minutes,
        CASE
          WHEN array_length(j.scheduled_route, 1) >= 2 THEN
            get_location_name(j.scheduled_route[1]) || ' → ' || get_location_name(j.scheduled_route[array_length(j.scheduled_route, 1)])
          ELSE NULL
        END as route_summary
      FROM train_journeys j
      WHERE j.status = $1
      ORDER BY j.analyzed_at DESC NULLS LAST, j.terminated_at DESC NULLS LAST
      ${limit ? 'LIMIT $2' : ''}
    `;

    const result = limit
      ? await pool.query(query, [status, limit])
      : await pool.query(query, [status]);

    return NextResponse.json({
      journeys: result.rows,
      count: totalCount,
      returned: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching journeys:', error);
    return NextResponse.json(
      { error: 'Failed to fetch journeys' },
      { status: 500 }
    );
  }
}


