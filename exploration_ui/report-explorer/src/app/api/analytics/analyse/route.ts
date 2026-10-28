import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/analytics/analyse
 * In containerized environments, analytics runs automatically via scheduler.
 * This endpoint returns the status and latest analytics data.
 * Body:
 *   - timeRange: '24h' | '7d' | '30d' | '90d' (default: '7d')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const timeRange = body.timeRange || '7d';

    // Check for recent analytics data
    const insightsQuery = `
      SELECT COUNT(*) as count, MAX(created_at) as latest
      FROM ai_insights
      WHERE time_range_label = $1
      AND created_at >= NOW() - INTERVAL '2 hours'
    `;
    
    const metricsQuery = `
      SELECT COUNT(*) as count, MAX(calculated_at) as latest
      FROM analytics_metrics
      WHERE time_range_label = $1
      AND calculated_at >= NOW() - INTERVAL '2 hours'
    `;

    const [insightsResult, metricsResult] = await Promise.all([
      pool.query(insightsQuery, [timeRange]),
      pool.query(metricsQuery, [timeRange])
    ]);

    const insightsCount = parseInt(insightsResult.rows[0]?.count || '0');
    const metricsCount = parseInt(metricsResult.rows[0]?.count || '0');
    const latestInsight = insightsResult.rows[0]?.latest;
    const latestMetric = metricsResult.rows[0]?.latest;

    return NextResponse.json({
      success: true,
      message: 'Analytics runs automatically via scheduler',
      timeRange,
      info: {
        schedulerRunning: true,
        schedulerInterval: '1 hour',
        note: 'Analytics are generated automatically every hour by the journey-builder service'
      },
      results: {
        insightsGenerated: insightsCount,
        metricsCalculated: metricsCount,
        latestInsightAt: latestInsight,
        latestMetricAt: latestMetric,
        dataAge: latestInsight ?
          `${Math.round((Date.now() - new Date(latestInsight).getTime()) / 60000)} minutes ago` :
          'No recent data'
      }
    });

  } catch (error) {
    console.error('Error checking analytics status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check analytics status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/analytics/analyse
 * Get status of analytics service
 */
export async function GET() {
  try {
    // Check if watsonx.ai is configured
    const watsonxConfigured = !!(
      process.env.WATSONX_API_KEY ||
      process.env.WATSONX_PROJECT_ID
    );

    // Check for recent analytics activity
    const recentActivityQuery = `
      SELECT
        (SELECT COUNT(*) FROM ai_insights WHERE created_at >= NOW() - INTERVAL '1 hour') as recent_insights,
        (SELECT COUNT(*) FROM analytics_metrics WHERE calculated_at >= NOW() - INTERVAL '1 hour') as recent_metrics,
        (SELECT MAX(created_at) FROM ai_insights) as last_insight,
        (SELECT MAX(calculated_at) FROM analytics_metrics) as last_metric
    `;

    const result = await pool.query(recentActivityQuery);
    const activity = result.rows[0];

    return NextResponse.json({
      success: true,
      status: {
        analyticsServiceAvailable: true,
        schedulerRunning: true,
        watsonxConfigured,
        ready: true,
        recentActivity: {
          insightsLastHour: parseInt(activity.recent_insights || '0'),
          metricsLastHour: parseInt(activity.recent_metrics || '0'),
          lastInsightAt: activity.last_insight,
          lastMetricAt: activity.last_metric
        }
      }
    });

  } catch (error) {
    console.error('Error checking analytics status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check analytics status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}


