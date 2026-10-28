import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * PATCH /api/predicted-gaps/[id]
 *
 * Approve or reject a single predicted gap row.
 *
 * The `id` segment may be:
 *   - An integer: matches the `id` serial column (added by migration)
 *   - A composite string "<train_id>-<station_index>-<schedule_start_date>": used as
 *     a fallback when the serial column is not present (pre-migration deployments)
 *
 * Body:
 *   { action: 'approve', approved_time?: 'HH:MM', approved_by?: string }
 *   { action: 'reject',  rejection_reason?: string, approved_by?: string }
 *   { action: 'reset' }   — returns row to PENDING
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numericId = parseInt(id);
  const isNumeric = !isNaN(numericId);

  // Parse composite key format: "<train_id>-<station_index>-<schedule_start_date>"
  // station_index is always an integer, so we split from the right to be safe
  let compositeWhere = '';
  let compositeParams: unknown[] = [];
  if (!isNumeric) {
    // Find last two dashes (station_index and schedule_start_date at the end)
    const lastDash = id.lastIndexOf('-');
    const secondLastDash = id.lastIndexOf('-', lastDash - 1);
    if (secondLastDash === -1 || lastDash === -1) {
      return NextResponse.json({ error: 'Invalid id format' }, { status: 400 });
    }
    const trainId          = id.substring(0, secondLastDash);
    const stationIndex     = parseInt(id.substring(secondLastDash + 1, lastDash));
    const schedStartDate   = id.substring(lastDash + 1);
    if (!trainId || isNaN(stationIndex)) {
      return NextResponse.json({ error: 'Invalid composite id' }, { status: 400 });
    }
    compositeWhere  = 'train_id = $1 AND station_index = $2 AND schedule_start_date = $3';
    compositeParams = [trainId, stationIndex, schedStartDate || null];
  }

  let body: { action?: string; approved_time?: string; approved_by?: string; rejection_reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, approved_time, approved_by, rejection_reason } = body;

  // Build the WHERE clause — prefer numeric id, fall back to composite key
  const whereClause = isNumeric ? 'id = $1' : compositeWhere;
  const baseParams: unknown[] = isNumeric ? [numericId] : compositeParams;

  try {
    let result;

    if (action === 'approve') {
      result = await pool.query(
        `UPDATE predicted_gaps
         SET approval_status  = 'APPROVED',
             approved_time    = COALESCE($${baseParams.length + 1}, predicted_time),
             approved_by      = $${baseParams.length + 2},
             approved_at      = NOW(),
             rejection_reason = NULL,
             updated_at       = NOW()
         WHERE ${whereClause}
         RETURNING *`,
        [...baseParams, approved_time ?? null, approved_by ?? 'operator']
      );
    } else if (action === 'reject') {
      result = await pool.query(
        `UPDATE predicted_gaps
         SET approval_status  = 'REJECTED',
             rejection_reason = $${baseParams.length + 1},
             approved_by      = $${baseParams.length + 2},
             approved_at      = NOW(),
             approved_time    = NULL,
             updated_at       = NOW()
         WHERE ${whereClause}
         RETURNING *`,
        [...baseParams, rejection_reason ?? null, approved_by ?? 'operator']
      );
    } else if (action === 'reset') {
      result = await pool.query(
        `UPDATE predicted_gaps
         SET approval_status  = 'PENDING',
             approved_time    = NULL,
             approved_by      = NULL,
             approved_at      = NULL,
             rejection_reason = NULL,
             updated_at       = NOW()
         WHERE ${whereClause}
         RETURNING *`,
        baseParams
      );
    } else {
      return NextResponse.json(
        { error: 'action must be "approve", "reject", or "reset"' },
        { status: 400 }
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Prediction not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, prediction: result.rows[0] });
  } catch (error) {
    console.error(`PATCH /api/predicted-gaps/${id} error:`, error);
    return NextResponse.json(
      { error: 'Failed to update prediction', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
