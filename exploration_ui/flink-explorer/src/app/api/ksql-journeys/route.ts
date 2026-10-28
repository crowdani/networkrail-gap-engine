import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ksql-journeys
 *
 * Reads from the ksqlDB COMPLETED_JOURNEYS stream.
 * Topic: COMPLETED_JOURNEYS  (VALUE_FORMAT=JSON, no schema registry envelope)
 *
 * Schema (from DESCRIBE COMPLETED_JOURNEYS):
 *   TRAIN_ID          VARCHAR  (Kafka message key)
 *   TRAIN_UID         VARCHAR
 *   COMPLETION_TIME   VARCHAR
 *   STATIONS_VISITED  ARRAY<STRUCT<STANOX, ACTUAL_TIME, EVENT>>
 *   SCHEDULED_TIPLOCS VARCHAR
 *   SCHEDULED_TIMINGS VARCHAR
 */
export async function GET(request: NextRequest) {
  try {
    const sp     = request.nextUrl.searchParams;
    const limit  = Math.min(parseInt(sp.get('limit') ?? '100'), 500);
    const search = sp.get('search')?.toLowerCase() ?? '';

    const [records, offsets] = await Promise.all([
      fetchLatest('COMPLETED_JOURNEYS', limit),
      topicOffsets('COMPLETED_JOURNEYS'),
    ]);

    let journeys = records
      .map(r => {
        try {
          // ksqlDB JSON format — value is already a parsed object from the REST proxy.
          // The Kafka message key holds TRAIN_ID; the REST proxy surfaces it as r.key.
          const v = typeof r.value === 'string' ? JSON.parse(r.value) : (r.value ?? {}) as Record<string, unknown>;
          // Merge the key into the row so TRAIN_ID is available even if absent from value
          const key = r.key != null ? String(r.key) : undefined;
          if (key && !v.TRAIN_ID) v.TRAIN_ID = key;
          return { ...v, _offset: r.offset, _ts: r.timestamp };
        } catch { return null; }
      })
      .filter(Boolean)
      .reverse();

    if (search) {
      journeys = journeys.filter((j: Record<string, unknown>) =>
        String(j.TRAIN_ID  ?? '').toLowerCase().includes(search) ||
        String(j.TRAIN_UID ?? '').toLowerCase().includes(search)
      );
    }

    return NextResponse.json({ journeys, total: offsets.count, fetched: records.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
