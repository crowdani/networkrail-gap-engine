import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/analytics/metrics
 * Retrieve calculated analytics metrics
 * Query params:
 *   - timeRange: '24h' | '7d' | '30d' | '90d' (default: '7d')
 *   - category: 'performance' | 'quality' | 'efficiency' | 'prediction' (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const timeRange = searchParams.get('timeRange') || '7d';
    const category = searchParams.get('category');

    // Calculate time boundaries
    const endTime = new Date();
    const startTime = calculateStartTime(endTime, timeRange);

    // Build query - get most recent metrics for the requested time range
    let query = `
      SELECT
        metric_name,
        metric_label as label,
        metric_category as category,
        metric_value as value,
        metric_unit as unit,
        trend,
        change_value as change,
        sparkline_data as sparkline,
        description,
        calculated_at
      FROM analytics_metrics
      WHERE time_range_label = $1
    `;

    const params: any[] = [timeRange];

    if (category) {
      query += ` AND metric_category = $${params.length + 1}`;
      params.push(category);
    }

    query += ` ORDER BY calculated_at DESC`;

    const result = await pool.query(query, params);

    // Get the most recent metrics (one per metric_name)
    const metricsMap = new Map();
    result.rows.forEach(row => {
      if (!metricsMap.has(row.metric_name)) {
        metricsMap.set(row.metric_name, {
          label: row.label,
          value: formatMetricValue(row.value, row.unit),
          trend: row.trend || 'stable',
          change: formatChange(row.change, row.unit),
          sparkline: row.sparkline || [],
          description: row.description
        });
      }
    });

    const metrics = Array.from(metricsMap.values());

    return NextResponse.json({
      success: true,
      timeRange,
      count: metrics.length,
      metrics
    });

  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch metrics',
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

/**
 * Format metric value with unit
 */
function formatMetricValue(value: any, unit: string | null): string {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue)) {
    return '0';
  }
  
  if (unit === '%') {
    return `${numValue.toFixed(1)}%`;
  } else if (unit === 'h') {
    return `${numValue.toFixed(1)}h`;
  } else if (unit === 'count') {
    return Math.round(numValue).toString();
  } else {
    return numValue.toFixed(2);
  }
}

/**
 * Format change value with unit
 */
function formatChange(change: any, unit: string | null): string {
  if (change === null || change === undefined) return '0';
  
  const numChange = typeof change === 'string' ? parseFloat(change) : change;
  
  if (isNaN(numChange)) return '0';
  
  const prefix = numChange > 0 ? '+' : '';
  
  if (unit === '%') {
    return `${prefix}${numChange.toFixed(1)}%`;
  } else if (unit === 'h') {
    return `${prefix}${numChange.toFixed(1)}h`;
  } else if (unit === 'count') {
    return `${prefix}${Math.round(numChange)}`;
  } else {
    return `${prefix}${numChange.toFixed(2)}`;
  }
}


