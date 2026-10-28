import { NextResponse } from 'next/server';
import { topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

const KSQLDB_URL = process.env.KSQLDB_URL ?? 'http://ksqldb-0.ksqldb.confluent.svc:8088';

// ksqlDB persistent query IDs to report status for.
// These are the CSAS/CTAS query names from 03-ksqldb-streams-and-tables.sql.
const QUERY_NAMES = [
  'CSAS_FLATTENED_RAIL_TEXT',
  'CTAS_SCHEDULE_TABLE',
  'CTAS_TRAIN_ACTIVATION_TABLE',
  'CSAS_MOVEMENT_STREAM',
  'CTAS_LIVE_JOURNEY_STATE',
  'CSAS_COMPLETED_JOURNEYS',
];

// All Kafka topics used or produced by the pipeline (NR_* = connector-produced).
const TOPICS = [
  'NR_TRAIN_MESSAGES',
  'NR_TIPLOC_REFERENCE',
  'NR_ACTIVE_SCHEDULE',
  'FLATTENED_RAIL_TEXT',
  'SCHEDULE_TABLE',
  'MOVEMENT_STREAM',
  'LIVE_JOURNEY_STATE',
  'COMPLETED_JOURNEYS',
  'NR_JOURNEY_GAPS',
  'NR_JOURNEY_GAPS_PREDICTED',
];

async function ksqlQueryStatus(queryId: string) {
  try {
    const res = await fetch(`${KSQLDB_URL}/queries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.ksql.v1+json' },
      body: JSON.stringify({ ksql: 'SHOW QUERIES;', streamsProperties: {} }),
      cache: 'no-store',
    });
    if (!res.ok) return { name: queryId, phase: 'UNKNOWN', detail: `HTTP ${res.status}` };
    const data = await res.json();
    const queries: { id: string; state: string; statusCount?: Record<string, number> }[] =
      data?.[0]?.queries ?? [];
    // Match on prefix — ksqlDB appends a numeric suffix like _57
    const match = queries.find(q => q.id.startsWith(queryId));
    if (!match) return { name: queryId, phase: 'STOPPED', detail: 'Not found' };
    return {
      name: match.id,
      phase: match.state === 'RUNNING' ? 'RUNNING' : match.state ?? 'UNKNOWN',
      detail: match.statusCount ? JSON.stringify(match.statusCount) : '',
    };
  } catch (e) {
    return { name: queryId, phase: 'UNREACHABLE', detail: String(e) };
  }
}

export async function GET() {
  // Fetch all query statuses with a single ksqlDB call, then fan-out offsets
  const [statements, offsets] = await Promise.all([
    // We call ksqlQueryStatus per query ID but they each call SHOW QUERIES —
    // acceptable at this polling frequency (20 s); could be optimised to one call.
    Promise.all(QUERY_NAMES.map(ksqlQueryStatus)),
    Promise.all(TOPICS.map(async t => {
      const o = await topicOffsets(t).catch(() => ({ beginning: 0, end: 0, count: 0 }));
      return { topic: t, ...o };
    })),
  ]);

  return NextResponse.json({ statements, topics: offsets, ts: Date.now() });
}
