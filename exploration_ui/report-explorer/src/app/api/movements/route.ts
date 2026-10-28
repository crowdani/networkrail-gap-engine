import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { TrainMovement } from '@/types/train-movements';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const trainId = searchParams.get('trainId');
    const trainUid = searchParams.get('trainUid');
    const stanox = searchParams.get('stanox');
    
    const offset = (page - 1) * pageSize;
    
    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (trainId) {
      conditions.push(`train_id = $${paramIndex++}`);
      params.push(trainId);
    }
    
    if (trainUid) {
      conditions.push(`train_uid = $${paramIndex++}`);
      params.push(trainUid);
    }
    
    if (stanox) {
      conditions.push(`loc_stanox = $${paramIndex++}`);
      params.push(stanox);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM train_movements ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    
    // Get paginated results with location names from CORPUS and train_uid from activations
    params.push(pageSize, offset);
    const result = await pool.query(
      `SELECT
        tm.id, tm.msg_type, tm.train_id,
        COALESCE(tm.train_uid, ta.train_uid) as train_uid,
        tm.train_service_code,
        tm.msg_queue_timestamp, tm.actual_timestamp, tm.actual_ts,
        tm.loc_stanox, tm.tiploc_code,
        get_location_name(tm.loc_stanox) as location_name,
        loc.three_alpha as location_crs,
        tm.event_type, tm.event_source,
        tm.planned_timestamp, tm.variation_status, tm.timetable_variation,
        tm.current_train_id, tm.delay_monitoring_point, tm.next_report_run_time,
        tm.reporting_stanox, tm.auto_expected, tm.direction_ind, tm.route,
        tm.platform, tm.line_ind, tm.created_at
      FROM train_movements tm
      LEFT JOIN active_locations loc ON tm.loc_stanox = loc.stanox
      LEFT JOIN train_activations ta ON tm.train_id = ta.train_id
      ${whereClause}
      ORDER BY tm.created_at DESC, tm.id DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );
    
    const movements: TrainMovement[] = result.rows;
    
    return NextResponse.json({
      movements,
      total,
      page,
      pageSize,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error fetching train movements:', error);
    return NextResponse.json(
      { error: 'Failed to fetch train movements' },
      { status: 500 }
    );
  }
}

