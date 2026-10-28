import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/delayed-trains
 *
 * Returns completed journeys where the actual time at the first visited stop
 * is later than the scheduled time (i.e. the train ran late at some point).
 *
 * Query params:
 *   min_delay  — minimum delay in minutes to include (default: 1)
 *   hours      — look-back window in hours (default: 24)
 *   limit      — max rows returned (default: 200)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minDelay = parseInt(searchParams.get('min_delay') || '1');
  const hours    = parseInt(searchParams.get('hours')     || '24');
  const limit    = parseInt(searchParams.get('limit')     || '200');

  try {
    const result = await pool.query(
      `
      WITH first_arrival AS (
        -- One row per journey: the earliest visited stop that has an actual
        -- ARRIVAL time.  Delay is always measured arrival vs scheduled arrival.
        -- Only stops with both actual_arrival and scheduled_arrival are eligible.
        -- Uses idx_js_sched_date_visited so the planner scans only recent rows.
        SELECT DISTINCT ON (train_id, schedule_start_date)
          train_id,
          train_uid,
          schedule_start_date,
          total_scheduled_stops,
          found_stops_count,
          missed_stops_count,
          severity,
          station_name       AS origin_station,
          event              AS origin_event,
          scheduled_arrival,
          scheduled_departure,
          actual_arrival,
          actual_departure,
          received_at
        FROM journey_stations
        WHERE visited = true
          AND schedule_start_date >= (CURRENT_DATE - 1)::text
          AND received_at > NOW() - ($2 || ' hours')::INTERVAL
          AND actual_arrival    LIKE '__:__%'
          AND scheduled_arrival LIKE '__:__%'
        ORDER BY train_id, schedule_start_date, station_index ASC
      ),
      first_gap_reason AS (
        -- Read only predicted_gaps (already indexed by train_id) instead of
        -- doing a full UNION ALL scan of journey_stations missed stops too.
        SELECT DISTINCT ON (train_id, schedule_start_date)
          train_id,
          schedule_start_date,
          prediction_method,
          COALESCE(
            NULLIF(prediction_basis->>'reasoning', ''),
            NULLIF(prediction_basis->>'reason', ''),
            NULLIF(prediction_method, '')
          ) AS predicted_reason
        FROM (
          SELECT
            train_id,
            schedule_start_date,
            station_index,
            prediction_method,
            CASE
              WHEN prediction_basis IS NULL THEN NULL
              WHEN prediction_basis::text LIKE '{%' THEN prediction_basis::jsonb
              ELSE NULL
            END AS prediction_basis
          FROM predicted_gaps
          WHERE (prediction_basis IS NOT NULL OR prediction_method IS NOT NULL)
            AND COALESCE(prediction_basis->>'stop_role', '') != 'JUNCTION'
        ) gap_reasons
        ORDER BY train_id, schedule_start_date, station_index ASC
      ),
      with_delay AS (
        SELECT
          fa.*,
          fgr.predicted_reason,
          -- Delay = actual_arrival − scheduled_arrival, in minutes.
          -- Wraps into (−720, +720] to handle midnight-crossing.
          (
            (SPLIT_PART(fa.actual_arrival,    ':', 1)::int * 60 +
             SPLIT_PART(fa.actual_arrival,    ':', 2)::int)
            -
            (SPLIT_PART(fa.scheduled_arrival, ':', 1)::int * 60 +
             SPLIT_PART(fa.scheduled_arrival, ':', 2)::int)
            + 720
            + 1440
          ) % 1440 - 720
          AS delay_minutes,
          -- crosses_midnight: true when the actual arrival time-of-day is
          -- earlier than the scheduled arrival time-of-day AND the wrapped
          -- delay is positive — i.e. the train ran into the next calendar day.
          (
            (SPLIT_PART(fa.actual_arrival, ':', 1)::int * 60 +
             SPLIT_PART(fa.actual_arrival, ':', 2)::int)
            <
            (SPLIT_PART(fa.scheduled_arrival, ':', 1)::int * 60 +
             SPLIT_PART(fa.scheduled_arrival, ':', 2)::int)
          ) AS crosses_midnight
        FROM first_arrival fa
        LEFT JOIN first_gap_reason fgr
          ON fa.train_id = fgr.train_id
          AND COALESCE(fa.schedule_start_date, '') = COALESCE(fgr.schedule_start_date, '')
      )
      SELECT *
      FROM with_delay
      WHERE delay_minutes >= $1
      ORDER BY delay_minutes DESC, received_at DESC
      LIMIT $3
      `,
      [minDelay, hours, limit]
    );

    return NextResponse.json({ trains: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching delayed trains:', error);
    return NextResponse.json({ error: 'Failed to fetch delayed trains' }, { status: 500 });
  }
}
