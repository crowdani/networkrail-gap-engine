import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/analytics/insights
 * Retrieve AI-generated insights with optional filtering
 * Query params:
 *   - timeRange: '24h' | '7d' | '30d' | '90d' (default: '7d')
 *   - type: 'trend' | 'anomaly' | 'prediction' | 'recommendation' (optional)
 *   - severity: 'critical' | 'high' | 'medium' | 'low' | 'info' (optional)
 *   - actionable: 'true' | 'false' (optional)
 *   - limit: number (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const timeRange = searchParams.get('timeRange') || '7d';
    const type = searchParams.get('type');
    const severity = searchParams.get('severity');
    const actionable = searchParams.get('actionable');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Calculate time boundaries
    const endTime = new Date();
    const startTime = calculateStartTime(endTime, timeRange);

    // Build query - get recent insights matching the time range label
    let query = `
      SELECT
        id,
        type,
        severity,
        title,
        description,
        confidence_score as confidence,
        impact,
        metrics,
        related_locations as "relatedLocations",
        related_trains as "relatedTrains",
        actionable,
        created_at as timestamp
      FROM ai_insights
      WHERE time_range_label = $1
      AND created_at >= NOW() - INTERVAL '7 days'
    `;

    const params: any[] = [timeRange];
    let paramIndex = 2;

    // Add filters
    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (severity) {
      query += ` AND severity = $${paramIndex}`;
      params.push(severity);
      paramIndex++;
    }

    if (actionable !== null) {
      query += ` AND actionable = $${paramIndex}`;
      params.push(actionable === 'true');
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);

    // Transform metrics from JSONB to expected format
    const insights = result.rows.map(row => ({
      ...row,
      id: row.id.toString(),
      metrics: row.metrics || [],
      relatedLocations: row.relatedLocations || [],
      relatedTrains: row.relatedTrains || []
    }));

    return NextResponse.json({
      success: true,
      timeRange,
      count: insights.length,
      insights
    });

  } catch (error) {
    console.error('Error fetching insights:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch insights',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Calculate start time based on time range
 */
function calculateStartTime(endTime: Date, timeRange: string): Date {
  const start = new Date(endTime);
  
  switch (timeRange) {
    case '24h':
      start.setHours(start.getHours() - 24);
      break;
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '90d':
      start.setDate(start.getDate() - 90);
      break;
    default:
      start.setDate(start.getDate() - 7);
  }
  
  return start;
}


