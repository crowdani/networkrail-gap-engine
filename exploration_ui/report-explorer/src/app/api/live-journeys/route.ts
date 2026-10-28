import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/live-journeys
 *
 * Reads from the LIVE_JOURNEY_STATE Kafka topic via the Confluent REST Proxy.
 * Returns the latest N records, each representing the current state of one journey.
 *
 * Query params:
 *   limit   max records to fetch from topic (default 100, max 500)
 *   search  filter by TRAIN_ID, TRAIN_UID, or CURRENT_STANOX (case-insensitive)
 *   status  filter by STATUS field (ACTIVE | TERMINATED)
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

    type JourneyRecord = Record<string, unknown> & { _offset: number; _ts: number };

    let journeys: JourneyRecord[] = records
      .map(r => {
        try {
          const v = typeof r.value === 'string'
            ? JSON.parse(r.value) as Record<string, unknown>
            : ((r.value ?? {}) as Record<string, unknown>);
          const key = r.key != null ? String(r.key) : undefined;
          if (key && !v.TRAIN_ID) v.TRAIN_ID = key;
          return { ...v, _offset: r.offset, _ts: r.timestamp };
        } catch { return null; }
      })
      .filter((j): j is JourneyRecord => j !== null)
      .reverse(); // most recent first

    if (search) {
      journeys = journeys.filter(j =>
        String(j.TRAIN_ID              ?? '').toLowerCase().includes(search) ||
        String(j.TRAIN_UID             ?? '').toLowerCase().includes(search) ||
        String(j.CURRENT_STANOX        ?? '').toLowerCase().includes(search) ||
        String(j.CURRENT_STATION_NAME  ?? '').toLowerCase().includes(search)
      );
    }
    if (status) {
      journeys = journeys.filter(j => String(j.STATUS ?? '') === status.toUpperCase());
    }

    return NextResponse.json({ journeys, total: offsets.count, fetched: records.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
