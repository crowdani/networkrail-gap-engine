import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

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
          const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
          return { ...v, _offset: r.offset, _ts: r.timestamp };
        } catch { return null; }
      })
      .filter(Boolean)
      .reverse();

    if (search) {
      journeys = journeys.filter((j: Record<string,unknown>) =>
        String(j.train_id ?? '').toLowerCase().includes(search) ||
        String(j.train_uid ?? '').toLowerCase().includes(search)
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
