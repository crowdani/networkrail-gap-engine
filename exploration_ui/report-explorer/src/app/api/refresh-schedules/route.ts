import { NextResponse } from 'next/server';
import pool from '@/lib/db';

async function ensureScheduleMetadataTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_refresh_metadata (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_started_at TIMESTAMP,
      last_completed_at TIMESTAMP,
      last_status VARCHAR(20),
      last_message TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO schedule_refresh_metadata (id, updated_at)
    VALUES (1, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function updateScheduleMetadata(fields: {
  last_started_at?: boolean;
  last_completed_at?: boolean;
  last_status?: string;
  last_message?: string;
}) {
  await ensureScheduleMetadataTable();

  const updates: string[] = ['updated_at = NOW()'];
  const values: Array<string> = [];
  let index = 1;

  if (fields.last_started_at) {
    updates.push('last_started_at = NOW()');
  }

  if (fields.last_completed_at) {
    updates.push('last_completed_at = NOW()');
  }

  if (typeof fields.last_status === 'string') {
    updates.push(`last_status = $${index++}`);
    values.push(fields.last_status);
  }

  if (typeof fields.last_message === 'string') {
    updates.push(`last_message = $${index++}`);
    values.push(fields.last_message);
  }

  await pool.query(
    `UPDATE schedule_refresh_metadata SET ${updates.join(', ')} WHERE id = 1`,
    values
  );
}

export async function POST() {
  try {
    console.log('Schedule refresh request received');

    // In containerized environments, schedule refreshes are handled by Kubernetes CronJobs
    // This endpoint returns information about the automated schedule refresh system
    
    await updateScheduleMetadata({
      last_started_at: true,
      last_status: 'info',
      last_message: 'Schedule refreshes are handled automatically by Kubernetes CronJob'
    });

    // Check when schedules were last updated
    const scheduleCheckQuery = `
      SELECT
        COUNT(*) as schedule_count,
        MAX(created_at) as last_schedule_update
      FROM active_schedule
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `;

    const result = await pool.query(scheduleCheckQuery);
    const scheduleInfo = result.rows[0];

    return NextResponse.json({
      success: true,
      message: 'Schedule refreshes are automated via Kubernetes CronJob',
      info: {
        automatedRefresh: true,
        cronJobName: 'schedule-refresh-job',
        schedule: 'Daily at 3:00 AM UTC',
        note: 'Schedules are automatically refreshed daily. Manual refresh is not available in containerized environments.'
      },
      currentSchedules: {
        count: parseInt(scheduleInfo.schedule_count || '0'),
        lastUpdate: scheduleInfo.last_schedule_update,
        dataAge: scheduleInfo.last_schedule_update ?
          `${Math.round((Date.now() - new Date(scheduleInfo.last_schedule_update).getTime()) / (1000 * 60 * 60))} hours ago` :
          'No recent data'
      }
    });

  } catch (error: any) {
    console.error('Schedule refresh check failed:', error);

    await updateScheduleMetadata({
      last_status: 'failed',
      last_message: error?.message || 'Unknown error'
    });

    return NextResponse.json({
      success: false,
      message: 'Failed to check schedule refresh status',
      error: error?.message || 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    await ensureScheduleMetadataTable();

    const result = await pool.query(`
      SELECT last_started_at, last_completed_at, last_status, last_message, updated_at
      FROM schedule_refresh_metadata
      WHERE id = 1
    `);

    return NextResponse.json({
      message: 'Use POST to trigger schedule refresh',
      endpoint: '/api/refresh-schedules',
      metadata: result.rows[0] || null
    });
  } catch (error: any) {
    return NextResponse.json({
      message: 'Use POST to trigger schedule refresh',
      endpoint: '/api/refresh-schedules',
      metadata: null,
      error: error?.message || 'Failed to load schedule metadata'
    });
  }
}
