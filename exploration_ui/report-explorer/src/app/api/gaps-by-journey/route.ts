import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { KENT_STANOX_CODES } from '@/lib/kent-locations';

interface JourneyWithGaps {
  journey_id: number;
  train_id: string;
  train_uid: string;
  operator_code: string;
  detected_at: string;
  analyzed_at: string;
  total_gaps: number;
  gap_severity: string;
  scheduled_route: string[];
  actual_route: string[];
  gaps: Array<{
    id: number;
    missed_station_stanox: string;
    missed_station_name: string;
    missed_station_crs: string | null;
    severity: string;
    detected_at: string;
    predicted_time: string | null;
    predicted_delay_minutes: number | null;
    prediction_confidence: number | null;
    prediction_method: string | null;
    infill_time: string | null;
    infill_status: 'Open' | 'Closed' | 'Investigation Required' | null;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const severity = searchParams.get('severity');
    const journeyId = searchParams.get('journeyId');
    const location = searchParams.get('location'); // 'all' or 'kent'
    const offset = (page - 1) * pageSize;

    // Build WHERE clause - exclude archived gaps by default
    let whereClause = `WHERE j.gaps_detected > 0
      AND EXISTS (
        SELECT 1 FROM gaps g_check
        WHERE g_check.journey_id = j.id
        AND (g_check.archived = false OR g_check.archived IS NULL)
      )`;
    const params: any[] = [];
    let paramIndex = 1;

    if (journeyId) {
      whereClause += ` AND j.id = $${paramIndex}`;
      params.push(parseInt(journeyId));
      paramIndex++;
    }

    if (severity) {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM gaps g2
        WHERE g2.journey_id = j.id
        AND g2.severity = $${paramIndex}
        AND (g2.archived = false OR g2.archived IS NULL)
      )`;
      params.push(severity);
      paramIndex++;
    }

    // Filter by location (Kent STANOX codes)
    if (location === 'kent') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM gaps g3
        WHERE g3.journey_id = j.id
        AND g3.missed_station_stanox = ANY($${paramIndex})
        AND (g3.archived = false OR g3.archived IS NULL)
      )`;
      params.push(KENT_STANOX_CODES);
      paramIndex++;
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT j.id) as count
      FROM train_journeys j
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Get journeys with gaps
    params.push(pageSize, offset);
    const dataQuery = `
      SELECT 
        j.id as journey_id,
        j.train_id,
        j.train_uid,
        j.operator_code,
        j.analyzed_at as detected_at,
        j.analyzed_at,
        j.gaps_detected as total_gaps,
        j.scheduled_route,
        j.actual_route,
        MAX(g.severity) as gap_severity,
        json_agg(
          json_build_object(
            'id', g.id,
            'missed_station_stanox', g.missed_station_stanox,
            'missed_station_name', COALESCE(t.nlc_desc, g.missed_station_stanox),
            'missed_station_crs', t.three_alpha,
            'severity', g.severity,
            'detected_at', g.detected_at,
            'predicted_time', g.predicted_time,
            'predicted_delay_minutes', g.predicted_delay_minutes,
            'prediction_confidence', g.prediction_confidence,
            'prediction_method', g.prediction_method,
            'infill_time', g.infill_time,
            'infill_status', g.infill_status
          ) ORDER BY g.detected_at
        ) as gaps
      FROM train_journeys j
      INNER JOIN gaps g ON g.journey_id = j.id AND (g.archived = false OR g.archived IS NULL)
      LEFT JOIN tiploc_reference t ON g.missed_station_stanox = t.stanox
      ${whereClause}
      GROUP BY j.id, j.train_id, j.train_uid, j.operator_code, j.analyzed_at, j.gaps_detected, j.scheduled_route, j.actual_route
      ORDER BY j.analyzed_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const dataResult = await pool.query<JourneyWithGaps>(dataQuery, params);

    return NextResponse.json({
      journeys: dataResult.rows,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gaps by journey' },
      { status: 500 }
    );
  }
}


