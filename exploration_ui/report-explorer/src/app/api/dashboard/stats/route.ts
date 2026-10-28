import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/stats
 *
 * Returns live aggregated statistics for the main dashboard counters:
 * - totalJourneys: count of distinct completed journeys analyzed (from journey_stations or predicted_gaps)
 * - totalGaps: count of missed stops detected
 * - locationsAffected: count of unique STANOX locations with gaps
 * - predictedGaps: total gap predictions generated
 * - pendingApprovals: pending gap approvals count
 */
export async function GET() {
  try {
    const [journeyStats, gapsStats, locationsStats, approvalsStats] = await Promise.all([
      // 1. Total journeys analysed
      pool.query(`
        SELECT COUNT(DISTINCT (train_id, schedule_start_date)) AS count
        FROM journey_stations
      `).catch(async () => {
        // Fallback to predicted_gaps or train_journeys
        return pool.query(`
          SELECT COUNT(DISTINCT (train_id, schedule_start_date)) AS count
          FROM predicted_gaps
        `);
      }),

      // 2. Total gaps detected (missed stops in journey_stations or predicted_gaps)
      pool.query(`
        SELECT COUNT(*) AS count
        FROM journey_stations
        WHERE visited = false OR status = 'not found'
      `).catch(async () => {
        return pool.query(`
          SELECT COUNT(*) AS count
          FROM predicted_gaps
        `);
      }),

      // 3. Locations affected
      pool.query(`
        SELECT COUNT(DISTINCT stanox) AS count
        FROM predicted_gaps
        WHERE stanox IS NOT NULL
      `).catch(() => ({ rows: [{ count: 0 }] })),

      // 4. Pending / predicted gaps
      pool.query(`
        SELECT
          COUNT(*) AS total_predicted,
          COUNT(*) FILTER (WHERE COALESCE(approval_status, 'PENDING') = 'PENDING') AS pending
        FROM predicted_gaps
      `).catch(() => ({ rows: [{ total_predicted: 0, pending: 0 }] })),
    ]);

    const totalJourneys = parseInt(journeyStats.rows[0]?.count || '0', 10);
    const totalGaps = parseInt(gapsStats.rows[0]?.count || '0', 10);
    const locationsAffected = parseInt(locationsStats.rows[0]?.count || '0', 10);
    const predictedGaps = parseInt(approvalsStats.rows[0]?.total_predicted || '0', 10);
    const pendingApprovals = parseInt(approvalsStats.rows[0]?.pending || '0', 10);

    return NextResponse.json({
      totalJourneys,
      totalGaps,
      locationsAffected,
      predictedGaps,
      pendingApprovals,
    });
  } catch (error) {
    console.error('Error in /api/dashboard/stats:', error);
    return NextResponse.json(
      {
        totalJourneys: 0,
        totalGaps: 0,
        locationsAffected: 0,
        predictedGaps: 0,
        pendingApprovals: 0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
