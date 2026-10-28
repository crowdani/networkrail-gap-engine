import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ journeyId: string }> }
) {
  const { journeyId } = await params;

  try {
    // Get journey details
    const journeyQuery = `
      SELECT 
        j.*,
        array_length(j.scheduled_route, 1) as scheduled_stops,
        array_length(j.actual_route, 1) as actual_stops
      FROM train_journeys j
      WHERE j.id = $1
    `;
    
    const journeyResult = await pool.query(journeyQuery, [journeyId]);
    
    if (journeyResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Journey not found' },
        { status: 404 }
      );
    }
    
    const journey = journeyResult.rows[0];

    // Get gaps for this journey
    const gapsQuery = `
      SELECT 
        g.*,
        t.nlc_desc as missed_station_name,
        t.three_alpha as missed_station_crs,
        prev_t.nlc_desc as previous_station_name,
        next_t.nlc_desc as next_station_name
      FROM gaps g
      LEFT JOIN tiploc_reference t ON g.missed_station_stanox = t.stanox
      LEFT JOIN tiploc_reference prev_t ON g.previous_station_stanox = prev_t.stanox
      LEFT JOIN tiploc_reference next_t ON g.next_station_stanox = next_t.stanox
      WHERE g.journey_id = $1
      ORDER BY g.detected_at
    `;
    
    const gapsResult = await pool.query(gapsQuery, [journeyId]);

    // Get station names and movement times for the route
    const getStationNames = async (stanoxList: string[]) => {
      if (!stanoxList || stanoxList.length === 0) return [];
      
      const placeholders = stanoxList.map((_, i) => `$${i + 1}`).join(',');
      const query = `
        SELECT stanox, nlc_desc, three_alpha, tiploc
        FROM tiploc_reference
        WHERE stanox IN (${placeholders})
      `;
      
      const result = await pool.query(query, stanoxList);
      const stationMap = new Map(result.rows.map(r => [r.stanox, r]));
      
      // First try to get movement times from journey_movements table (new system)
      const journeyMovementsQuery = `
        SELECT
          stanox,
          scheduled_time,
          actual_time,
          delay_minutes,
          event_type
        FROM journey_movements
        WHERE journey_id = $1
        ORDER BY sequence_number
      `;
      
      const journeyMovementsResult = await pool.query(journeyMovementsQuery, [journeyId]);
      const movementMap = new Map();
      
      // If we have data from journey_movements, use it
      if (journeyMovementsResult.rows.length > 0) {
        journeyMovementsResult.rows.forEach(m => {
          const existing = movementMap.get(m.stanox);
          if (!existing || m.event_type === 'ARRIVAL') {
            movementMap.set(m.stanox, {
              actual_time: m.actual_time,
              scheduled_time: m.scheduled_time,
              delay_minutes: m.delay_minutes || 0
            });
          }
        });
      } else {
        // Fallback to train_movements table (old system)
        const trainMovementsQuery = `
          SELECT
            loc_stanox,
            actual_ts,
            planned_timestamp,
            event_type,
            timetable_variation
          FROM train_movements
          WHERE train_id = $1
          ORDER BY actual_ts
        `;
        
        const trainMovementsResult = await pool.query(trainMovementsQuery, [journey.train_id]);
        
        trainMovementsResult.rows.forEach(m => {
          const existing = movementMap.get(m.loc_stanox);
          if (!existing || m.event_type === 'ARRIVAL') {
            movementMap.set(m.loc_stanox, {
              actual_time: m.actual_ts,
              scheduled_time: m.planned_timestamp ? new Date(parseInt(m.planned_timestamp)).toISOString() : null,
              delay_minutes: m.timetable_variation || 0
            });
          }
        });
      }
      
      return stanoxList.map(stanox => {
        const movement = movementMap.get(stanox);
        return {
          stanox,
          name: stationMap.get(stanox)?.nlc_desc || stanox,
          crs: stationMap.get(stanox)?.three_alpha,
          tiploc: stationMap.get(stanox)?.tiploc,
          visited: journey.actual_route.includes(stanox),
          scheduled_time: movement?.scheduled_time || null,
          actual_time: movement?.actual_time || null,
          delay_minutes: movement?.delay_minutes || null
        };
      });
    };

    const scheduledStations = await getStationNames(journey.scheduled_route || []);
    
    return NextResponse.json({
      journey: {
        ...journey,
        scheduled_stations: scheduledStations
      },
      gaps: gapsResult.rows
    });
  } catch (error) {
    console.error('Error fetching journey gaps:', error);
    return NextResponse.json(
      { error: 'Failed to fetch journey gaps' },
      { status: 500 }
    );
  }
}


