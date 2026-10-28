import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const offset = (page - 1) * pageSize;
    const location = searchParams.get('location');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const archived = searchParams.get('archived'); // 'true', 'false', or null (all)

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (location) {
      whereClause += ` AND g.missed_station_stanox = $${paramIndex}`;
      queryParams.push(location);
      paramIndex++;
    }

    if (startDate && endDate) {
      whereClause += ` AND g.detected_at BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    }

    // Filter by archived status
    if (archived === 'true') {
      whereClause += ` AND g.archived = true`;
    } else if (archived === 'false') {
      whereClause += ` AND g.archived = false`;
    }
    // If archived is null, show all gaps (no filter)

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM gaps g ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results - include infill fields for UI display
    const dataQuery = `
      SELECT
        g.id,
        g.train_id,
        g.train_uid,
        g.detected_at,
        g.missed_station_stanox,
        COALESCE(g.missed_station_tiploc, g.missed_station_stanox) as missed_station_name,
        g.severity,
        g.infill_time,
        g.infill_status
      FROM gaps g
      ${whereClause}
      ORDER BY g.detected_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(pageSize, offset);
    const dataResult = await pool.query(dataQuery, queryParams);

    return NextResponse.json({
      results: dataResult.rows,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch gap detection results',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
