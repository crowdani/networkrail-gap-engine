import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

interface JourneyStop {
  stanox: string;
  tiploc: string | null;
  location_name: string | null;
  crs: string | null;
  actual_timestamp: string | null;
  planned_timestamp: string | null;
  event_type: string;
  platform: string | null;
  variation_status: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trainId: string }> }
) {
  try {
    const { trainId } = await params;
    console.log('Fetching journey for train:', trainId);

    // Get all movements for this train, ordered by time
    const query = `
      SELECT
        m.loc_stanox as stanox,
        m.tiploc_code as tiploc,
        get_location_name(m.loc_stanox) as location_name,
        al.three_alpha as crs,
        m.actual_timestamp,
        m.planned_timestamp,
        m.event_type,
        m.platform,
        m.variation_status
      FROM train_movements m
      LEFT JOIN active_locations al ON m.loc_stanox = al.stanox
      WHERE m.train_id = $1
      ORDER BY m.actual_timestamp ASC NULLS LAST, m.planned_timestamp ASC NULLS LAST
    `;

    const result = await pool.query<JourneyStop>(query, [trainId]);
    console.log('Query result rows:', result.rows.length);

    if (result.rows.length === 0) {
      console.log('No movements found for train:', trainId);
      return NextResponse.json(
        { error: 'Train not found or no movements recorded' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      trainId,
      stops: result.rows,
      totalStops: result.rows.length,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch train journey' },
      { status: 500 }
    );
  }
}

