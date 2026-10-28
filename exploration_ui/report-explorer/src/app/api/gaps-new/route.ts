import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export interface Gap {
  id: number;
  train_id: string;
  train_uid: string;
  detected_at: string;
  missed_station_stanox: string;
  missed_station_tiploc: string | null;
  missed_station_name: string | null;
  previous_station_stanox: string;
  previous_station_tiploc: string | null;
  previous_station_name: string | null;
  previous_station_crs: string | null;
  next_station_stanox: string;
  next_station_tiploc: string | null;
  next_station_name: string | null;
  next_station_crs: string | null;
  severity: string;
  confidence_score: number;
  gap_type: string;
  scheduled_route: string[];
  actual_route: string[];
  timing_data: any;
  operator_code: string | null;
  service_code: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const severity = searchParams.get('severity');
    const trainId = searchParams.get('trainId');
    const location = searchParams.get('location');
    const routes = searchParams.get('routes'); // Changed to support multiple routes
    const before = searchParams.get('before'); // Time filter for historical comparison
    const offset = (page - 1) * pageSize;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (severity) {
      whereClause += ` AND severity = $${paramIndex}`;
      params.push(severity);
      paramIndex++;
    }

    if (trainId) {
      whereClause += ` AND (g.train_id ILIKE $${paramIndex} OR g.train_uid ILIKE $${paramIndex})`;
      params.push(`%${trainId}%`);
      paramIndex++;
    }

    if (location) {
      whereClause += ` AND (
        get_location_name(g.previous_station_stanox) ILIKE $${paramIndex} OR
        get_location_name(g.missed_station_stanox) ILIKE $${paramIndex} OR
        get_location_name(g.next_station_stanox) ILIKE $${paramIndex}
      )`;
      params.push(`%${location}%`);
      paramIndex++;
    }

    if (routes) {
      // Route filter: support multiple routes separated by comma
      const routeList = routes.split(',').map(r => r.trim()).filter(r => r);
      if (routeList.length > 0) {
        const routePlaceholders = routeList.map((_, i) => `$${paramIndex + i}`).join(',');
        whereClause += ` AND (
          CONCAT(
            COALESCE(get_location_name(g.previous_station_stanox), g.previous_station_stanox),
            ' → ',
            COALESCE(get_location_name(g.next_station_stanox), g.next_station_stanox)
          ) IN (${routePlaceholders})
        )`;
        params.push(...routeList);
        paramIndex += routeList.length;
      }
    }

    if (before) {
      // Filter gaps detected before a specific time (for historical comparison)
      whereClause += ` AND g.detected_at < $${paramIndex}`;
      params.push(before);
      paramIndex++;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM gaps g ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results with location names from CORPUS
    params.push(pageSize, offset);
    const dataQuery = `
      SELECT
        g.id, g.train_id, g.train_uid, g.detected_at,
        g.missed_station_stanox, g.missed_station_tiploc,
        g.journey_id,
        CASE
          WHEN g.missed_station_stanox IS NULL THEN 'Station between ' || get_location_name(g.previous_station_stanox) || ' and ' || get_location_name(g.next_station_stanox)
          ELSE get_location_name(g.missed_station_stanox)
        END as missed_station_name,
        g.previous_station_stanox, g.previous_station_tiploc,
        get_location_name(g.previous_station_stanox) as previous_station_name,
        prev_loc.three_alpha as previous_station_crs,
        g.next_station_stanox, g.next_station_tiploc,
        get_location_name(g.next_station_stanox) as next_station_name,
        next_loc.three_alpha as next_station_crs,
        g.severity, g.confidence_score, g.gap_type,
        g.scheduled_route, g.actual_route, g.timing_data,
        g.operator_code, g.service_code
      FROM gaps g
      LEFT JOIN active_locations prev_loc ON g.previous_station_stanox = prev_loc.stanox
      LEFT JOIN active_locations next_loc ON g.next_station_stanox = next_loc.stanox
      ${whereClause}
      ORDER BY g.detected_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const dataResult = await pool.query<Gap>(dataQuery, params);

    return NextResponse.json({
      gaps: dataResult.rows,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gaps' },
      { status: 500 }
    );
  }
}

