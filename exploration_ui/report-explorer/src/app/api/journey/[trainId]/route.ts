import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getStationInfo } from '@/lib/stanox-coordinates';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trainId: string }> }
) {
  try {
    const { trainId } = await params;
    
    // Get all movements for this train, ordered by time
    const movementsResult = await pool.query(
      `SELECT
        id, msg_type, train_id, train_uid, train_service_code,
        actual_timestamp, actual_ts, loc_stanox, tiploc_code,
        event_type, event_source, variation_status, timetable_variation,
        platform, created_at
      FROM train_movements
      WHERE train_id = $1
      ORDER BY actual_ts ASC NULLS LAST, created_at ASC`,
      [trainId]
    );
    
    // Enrich movements with station information from our coordinate database
    const enrichedMovements = movementsResult.rows.map(movement => {
      const stationInfo = getStationInfo(movement.loc_stanox);
      return {
        ...movement,
        location_info: stationInfo ? {
          stanox: stationInfo.stanox,
          name: stationInfo.name,
          crs_code: stationInfo.crs,
          lat: stationInfo.lat,
          lon: stationInfo.lon,
        } : null,
      };
    });
    
    return NextResponse.json({
      trainId,
      movements: enrichedMovements,
      totalStops: enrichedMovements.length,
    });
  } catch (error) {
    console.error('Error fetching train journey:', error);
    return NextResponse.json(
      { error: 'Failed to fetch train journey' },
      { status: 500 }
    );
  }
}

