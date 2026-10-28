import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const trainId = id;

    // Get detailed information for a specific train
    const result = await pool.query(
      `SELECT
        msg_type,
        train_id,
        train_uid,
        msg_queue_timestamp,
        actual_ts,
        loc_stanox,
        stanox_array,
        tiploc_array,
        position_in_schedule,
        total_stops,
        prev_stanox,
        expected_prev_stanox,
        is_gap
      FROM gap_detection_results
      WHERE train_id = $1
      ORDER BY actual_ts ASC`,
      [trainId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Train not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      train: result.rows,
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch train details' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gapId = parseInt(id);
  let body;
  let action;
  
  try {
    body = await request.json();
    const { action: bodyAction, infill_time, archived_by } = body;
    action = bodyAction;

    if (action === 'accept') {
      // Accept the predicted time - set infill_time to predicted_time (stays Open for review)
      const result = await pool.query(
        `UPDATE gaps
         SET infill_time = predicted_time,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [gapId]
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Gap not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        gap: result.rows[0],
      });
    } else if (action === 'amend') {
      // Amend with custom time (stays Open for review)
      if (!infill_time) {
        return NextResponse.json(
          { error: 'infill_time is required for amend action' },
          { status: 400 }
        );
      }

      const result = await pool.query(
        `UPDATE gaps
         SET infill_time = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [infill_time, gapId]
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Gap not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        gap: result.rows[0],
      });
    } else if (action === 'approve') {
      // Approve - set infill_time to predicted_time (if not already set), mark as closed and archive
      const result = await pool.query(
        `UPDATE gaps
         SET infill_time = COALESCE(infill_time, predicted_time),
             infill_status = 'Closed',
             archived = true,
             archived_at = NOW(),
             archived_by = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [gapId, archived_by || 'system']
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Gap not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        gap: result.rows[0],
      });
    } else if (action === 'archive') {
      // Archive without infilling (for manual review later)
      const result = await pool.query(
        `UPDATE gaps
         SET archived = true,
             archived_at = NOW(),
             archived_by = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [gapId, archived_by || 'system']
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Gap not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        gap: result.rows[0],
      });
    } else if (action === 'unarchive') {
      // Unarchive a gap to bring it back to active view
      const result = await pool.query(
        `UPDATE gaps
         SET archived = false,
             archived_at = NULL,
             archived_by = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [gapId]
      );

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Gap not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        gap: result.rows[0],
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Must be "accept", "amend", "approve", "archive", or "unarchive"' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Database error in PATCH /api/gaps/[id]:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      gapId,
      action,
      body
    });
    return NextResponse.json(
      {
        error: 'Failed to update gap',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

