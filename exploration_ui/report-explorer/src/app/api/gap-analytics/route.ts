import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/gap-analytics
 *
 * Returns all data needed for the Gap Analytics screen in one round-trip:
 *   summary        — headline KPIs
 *   severityBreakdown  — gap count + journeys by severity
 *   methodBreakdown    — gap count + avg confidence by prediction method
 *   dailyTrend         — gaps + journeys per calendar day (last 14 days)
 *   topSchedules       — top 15 train UIDs by total gap count
 *   mostDelayed        — top 15 journeys by total accumulated delay (minutes)
 *   topStations        — top 15 stations by gap count
 */
export async function GET() {
  try {
    const [
      summaryRes,
      severityRes,
      methodRes,
      dailyRes,
      topSchedulesRes,
      mostDelayedRes,
      topStationsRes,
    ] = await Promise.all([

      // ── Summary KPIs ───────────────────────────────────────────────────────
      pool.query(`
        SELECT
          COUNT(*)                                           AS total_gaps,
          COUNT(DISTINCT train_id)                           AS journeys_with_gaps,
          COUNT(*) FILTER (WHERE approval_status = 'PENDING')   AS pending,
          COUNT(*) FILTER (WHERE approval_status = 'APPROVED')  AS approved,
          COUNT(*) FILTER (WHERE approval_status = 'REJECTED')  AS rejected,
          COUNT(*) FILTER (WHERE severity = 'HIGH')             AS high_severity,
          COUNT(*) FILTER (WHERE severity = 'MEDIUM')           AS medium_severity,
          COUNT(*) FILTER (WHERE severity = 'LOW')              AS low_severity,
          COALESCE(SUM(GREATEST(predicted_delay_minutes, 0)), 0) AS total_delay_minutes,
          COALESCE(AVG(prediction_confidence) FILTER (WHERE prediction_confidence IS NOT NULL), 0)::numeric(4,2)
                                                             AS avg_confidence
        FROM predicted_gaps
      `),

      // ── Severity breakdown ─────────────────────────────────────────────────
      pool.query(`
        SELECT
          COALESCE(severity, 'UNKNOWN') AS severity,
          COUNT(*)                       AS gap_count,
          COUNT(DISTINCT train_id)       AS journey_count
        FROM predicted_gaps
        GROUP BY severity
        ORDER BY gap_count DESC
      `),

      // ── Prediction method breakdown ────────────────────────────────────────
      pool.query(`
        SELECT
          COALESCE(prediction_method, 'UNKNOWN')                     AS method,
          COUNT(*)                                                    AS gap_count,
          COALESCE(AVG(prediction_confidence), 0)::numeric(4,2)      AS avg_confidence
        FROM predicted_gaps
        GROUP BY prediction_method
        ORDER BY gap_count DESC
      `),

      // ── Daily trend (last 14 days) ─────────────────────────────────────────
      pool.query(`
        SELECT
          DATE(received_at)            AS day,
          COUNT(*)                     AS gap_count,
          COUNT(DISTINCT train_id)     AS journey_count
        FROM predicted_gaps
        WHERE received_at >= NOW() - INTERVAL '14 days'
        GROUP BY DATE(received_at)
        ORDER BY day ASC
      `),

      // ── Top schedules by gap count ─────────────────────────────────────────
      pool.query(`
        SELECT
          TRIM(train_uid)                                          AS train_uid,
          COUNT(*)                                                 AS gap_count,
          COUNT(DISTINCT train_id)                                 AS journey_count,
          MAX(missed_stops_count)                                  AS max_missed_stops,
          COALESCE(AVG(predicted_delay_minutes) FILTER (WHERE predicted_delay_minutes > 0), 0)::int
                                                                   AS avg_delay_min,
          MAX(severity)                                            AS worst_severity,
          MAX(received_at)                                         AS last_seen
        FROM predicted_gaps
        WHERE train_uid IS NOT NULL AND TRIM(train_uid) <> ''
        GROUP BY TRIM(train_uid)
        ORDER BY gap_count DESC
        LIMIT 15
      `),

      // ── Journeys with most accumulated delay from gaps ─────────────────────
      pool.query(`
        SELECT
          TRIM(train_uid)                                          AS train_uid,
          train_id,
          schedule_start_date,
          COUNT(*)                                                 AS gap_count,
          SUM(GREATEST(predicted_delay_minutes, 0))               AS total_delay_min,
          MAX(predicted_delay_minutes)                             AS max_delay_min,
          severity,
          approval_status,
          MAX(received_at)                                         AS received_at
        FROM predicted_gaps
        WHERE predicted_delay_minutes > 0
        GROUP BY TRIM(train_uid), train_id, schedule_start_date, severity, approval_status
        ORDER BY total_delay_min DESC
        LIMIT 15
      `),

      // ── Top stations by gap count ──────────────────────────────────────────
      pool.query(`
        SELECT
          station_name,
          COUNT(*)                                                        AS gap_count,
          COUNT(DISTINCT train_id)                                        AS affected_trains,
          COALESCE(AVG(GREATEST(predicted_delay_minutes, 0)), 0)::int     AS avg_delay_min,
          MAX(severity)                                                    AS worst_severity
        FROM predicted_gaps
        WHERE station_name IS NOT NULL AND station_name <> ''
        GROUP BY station_name
        ORDER BY gap_count DESC
        LIMIT 15
      `),
    ]);

    return NextResponse.json({
      summary:           summaryRes.rows[0],
      severityBreakdown: severityRes.rows,
      methodBreakdown:   methodRes.rows,
      dailyTrend:        dailyRes.rows,
      topSchedules:      topSchedulesRes.rows,
      mostDelayed:       mostDelayedRes.rows,
      topStations:       topStationsRes.rows,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[gap-analytics]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
