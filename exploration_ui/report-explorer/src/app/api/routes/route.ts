import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    // Get all unique routes from gaps table
    const query = `
      SELECT DISTINCT
        CONCAT(
          COALESCE(get_location_name(g.previous_station_stanox), g.previous_station_stanox),
          ' → ',
          COALESCE(get_location_name(g.next_station_stanox), g.next_station_stanox)
        ) as route
      FROM gaps g
      WHERE g.previous_station_stanox IS NOT NULL 
        AND g.next_station_stanox IS NOT NULL
      ORDER BY route
    `;
    
    const result = await pool.query(query);
    const routes = result.rows.map(row => row.route);

    return NextResponse.json({ routes });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch routes' },
      { status: 500 }
    );
  }
}