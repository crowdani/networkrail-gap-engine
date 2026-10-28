import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/admin/reset-data
 *
 * Truncates the `predicted_gaps` and `journey_stations` tables so that only
 * new data flowing through the Confluent pipeline will be visible.
 * This is a destructive, irreversible operation — expose only to admin users.
 */
export async function POST(_req: NextRequest) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE predicted_gaps RESTART IDENTITY CASCADE');

    // journey_stations may not exist in all deployments — handle gracefully
    try {
      await client.query('TRUNCATE TABLE journey_stations RESTART IDENTITY CASCADE');
    } catch {
      // table doesn't exist — that's fine, keep going
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: 'predicted_gaps and journey_stations tables cleared. New data will flow in from the Confluent pipeline.',
      cleared_at: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const msg = error instanceof Error ? error.message : String(error);
    console.error('POST /api/admin/reset-data error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reset data', details: msg },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
