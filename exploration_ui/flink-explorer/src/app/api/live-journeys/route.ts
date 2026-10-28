import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/live-journeys
 *
 * Reads from the ksqlDB LIVE_JOURNEY_CHANGES stream.
 * Topic: LIVE_JOURNEY_STATE  (VALUE_FORMAT=JSON, no schema registry envelope)
 *
 * Schema (from DESCRIBE LIVE_JOURNEY_CHANGES):
 *   TRAIN_ID          VARCHAR  (Kafka message key)
 *   TRAIN_UID         VARCHAR
 *   CURRENT_STANOX    VARCHAR
 *   LAST_UPDATED      VARCHAR
 *   STATUS            VARCHAR
 *   STATIONS_VISITED  ARRAY<STRUCT<STANOX, ACTUAL_TIME, EVENT>>
 *   SCHEDULED_TIPLOCS VARCHAR
 *   SCHEDULED_TIMINGS VARCHAR
 */
export async function GET(request: NextRequest) {
  try {
    const sp     = request.nextUrl.searchParams;
    const limit  = Math.min(parseInt(sp.get('limit') ?? '100'), 500);
    const search = sp.get('search')?.toLowerCase() ?? '';
    const status = sp.get('status') ?? '';

    const [records, offsets] = await Promise.all([
      fetchLatest('LIVE_JOURNEY_STATE', limit),
      topicOffsets('LIVE_JOURNEY_STATE'),
    ]);

    let journeys = records
      .map(r => {
        try {
          const v = typeof r.value === 'string' ? JSON.parse(r.value) : (r.value ?? {}) as Record<string, unknown>;
          const key = r.key != null ? String(r.key) : undefined;
          if (key && !v.TRAIN_ID) v.TRAIN_ID = key;
          return { ...v, _offset: r.offset, _ts: r.timestamp };
        } catch { return null; }
      })
      .filter(Boolean)
      .reverse();

    if (search) {
      journeys = journeys.filter((j: Record<string, unknown>) =>
        String(j.TRAIN_ID       ?? '').toLowerCase().includes(search) ||
        String(j.TRAIN_UID      ?? '').toLowerCase().includes(search) ||
        String(j.CURRENT_STANOX ?? '').toLowerCase().includes(search)
      );
    }
    if (status) {
      journeys = journeys.filter((j: Record<string, unknown>) =>
        String(j.STATUS ?? '') === status
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
