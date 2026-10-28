import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import pool from '@/lib/db';

const execAsync = promisify(exec);

/**
 * GET /api/system-status
 *
 * Returns health information for:
 *  - Docker containers (postgres, broker, kafka-ui, gap_engine)
 *  - PostgreSQL database (connectivity + row counts)
 *  - Confluent REST Proxy (LIVE_JOURNEY_STATE topic offset check)
 *  - Host processes (stomp_client, store_movements)
 *  - This web interface (always running)
 */
export async function GET() {
  try {
    const status = {
      timestamp: new Date().toISOString(),
      services: [] as {
        name: string;
        container: string;
        status: 'running' | 'degraded' | 'offline';
        statusText: string;
        type: string;
        detail?: string;
      }[],
      database: {} as Record<string, unknown>,
      kafka: {} as Record<string, unknown>,
    };

    // ── Docker containers ──────────────────────────────────────────────────────
    try {
      const { stdout } = await execAsync('docker ps --format "{{.Names}}|{{.Status}}|{{.State}}"');
      const containers = stdout.trim().split('\n').filter(Boolean);

      const serviceMap: Record<string, string> = {
        'postgres':   'PostgreSQL',
        'broker':     'Kafka Broker',
        'kafka-ui':   'Kafka UI',
        'gap_engine': 'Gap Engine',
      };

      for (const container of containers) {
        const [name, statusText, state] = container.split('|');
        if (serviceMap[name]) {
          const isHealthy =
            state === 'running' &&
            (statusText.includes('healthy') || statusText.includes('Up') || !statusText.includes('unhealthy'));
          status.services.push({
            name:       serviceMap[name],
            container:  name,
            status:     isHealthy ? 'running' : 'degraded',
            statusText: statusText,
            type:       'docker',
          });
        }
      }
    } catch {
      // Docker may not be available in Kubernetes deployments — silently skip
    }

    // ── PostgreSQL ─────────────────────────────────────────────────────────────
    try {
      const dbStart = Date.now();
      // Run all DB stat queries in a single round-trip using one query
      const dbStats = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM train_movements)                                                AS movements,
          (SELECT COUNT(*) FROM gaps)                                                           AS gaps,
          (SELECT COUNT(*) FROM tiploc_reference)                                              AS locations,
          (SELECT COUNT(*) FROM predicted_gaps)                                                AS predicted_gaps,
          (SELECT COUNT(*) FROM train_movements WHERE actual_ts > NOW() - INTERVAL '5 minutes') AS recent_movements,
          (SELECT COUNT(*) FROM gaps         WHERE detected_at > NOW() - INTERVAL '1 hour')    AS recent_gaps,
          (SELECT COUNT(*) FROM predicted_gaps WHERE received_at > NOW() - INTERVAL '6 hours') AS recent_predicted_gaps
      `);
      const responseTime = Date.now() - dbStart;
      const r = dbStats.rows[0];

      status.database = {
        connected:           true,
        responseTime,
        movements:           r.movements,
        gaps:                r.gaps,
        locations:           r.locations,
        predictedGaps:       r.predicted_gaps,
        recentMovements:     r.recent_movements,
        recentGaps:          r.recent_gaps,
        recentPredictedGaps: r.recent_predicted_gaps,
      };
    } catch (error) {
      status.database = {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // ── Confluent REST Proxy (Kafka) ──────────────────────────────────────────
    const kafkaRestUrl = (
      process.env.KAFKA_REST_URL ??
      'https://kafkarestproxy.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com'
    ).replace(/\/$/, '');

    try {
      const clusterStart = Date.now();
      const clusterRes = await fetch(`${kafkaRestUrl}/v3/clusters`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });

      if (!clusterRes.ok) {
        throw new Error(`HTTP ${clusterRes.status}`);
      }

      const clusterData = await clusterRes.json() as { data: Array<{ cluster_id: string }> };
      const clusterId = clusterData.data?.[0]?.cluster_id;
      const probeMs   = Date.now() - clusterStart;

      // Sample the LIVE_JOURNEY_STATE end offset to confirm messages are flowing
      let topicOffsets: { beginning: number; end: number } | null = null;
      if (clusterId) {
        try {
          const topicEnc = encodeURIComponent('LIVE_JOURNEY_STATE');
          const [begRes, endRes] = await Promise.all([
            fetch(`${kafkaRestUrl}/v3/clusters/${clusterId}/topics/${topicEnc}/partitions/0/beginning-offset`, { cache: 'no-store', signal: AbortSignal.timeout(4000) }),
            fetch(`${kafkaRestUrl}/v3/clusters/${clusterId}/topics/${topicEnc}/partitions/0/end-offset`,       { cache: 'no-store', signal: AbortSignal.timeout(4000) }),
          ]);
          if (begRes.ok && endRes.ok) {
            topicOffsets = {
              beginning: (await begRes.json()).beginning_offset,
              end:       (await endRes.json()).end_offset,
            };
          }
        } catch {
          // Topic probe is non-critical
        }
      }

      status.kafka = {
        connected:   true,
        responseMs:  probeMs,
        clusterId,
        restProxyUrl: kafkaRestUrl,
        liveJourneyState: topicOffsets
          ? {
              beginningOffset: topicOffsets.beginning,
              endOffset:       topicOffsets.end,
              messageCount:    Math.max(0, topicOffsets.end - topicOffsets.beginning),
            }
          : null,
      };

      status.services.push({
        name:       'Confluent REST Proxy',
        container:  'kafka-rest',
        status:     'running',
        statusText: `Connected (${probeMs}ms)`,
        type:       'confluent',
        detail:     clusterId ?? undefined,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      status.kafka = { connected: false, error: msg, restProxyUrl: kafkaRestUrl };
      status.services.push({
        name:       'Confluent REST Proxy',
        container:  'kafka-rest',
        status:     'offline',
        statusText: msg,
        type:       'confluent',
      });
    }

    // ── Host processes ─────────────────────────────────────────────────────────
    try {
      const { stdout } = await execAsync('ps aux | grep -E "(stomp_client|store_movements)" | grep -v grep');
      const processes = stdout.trim().split('\n').filter(l => l.length > 0);

      if (processes.some(p => p.includes('stomp_client'))) {
        status.services.push({ name: 'STOMP Client', container: 'host', status: 'running', statusText: 'Data ingestion', type: 'host' });
      }
      if (processes.some(p => p.includes('store_movements'))) {
        status.services.push({ name: 'Movement Store', container: 'host', status: 'running', statusText: 'Database writer', type: 'host' });
      }
    } catch {
      // Processes might not be running
    }

    // ── This web interface ─────────────────────────────────────────────────────
    status.services.push({
      name:       'Web Interface',
      container:  'host',
      status:     'running',
      statusText: 'Application server',
      type:       'host',
    });

    return NextResponse.json(status);
  } catch (error) {
    console.error('Error getting system status:', error);
    return NextResponse.json(
      { error: 'Failed to get system status' },
      { status: 500 }
    );
  }
}
