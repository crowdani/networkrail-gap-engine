import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp     = request.nextUrl.searchParams;
    const limit  = Math.min(parseInt(sp.get('limit') ?? '100'), 500);
    const search = sp.get('search')?.toLowerCase() ?? '';
    const sev    = sp.get('severity') ?? '';
    const method = sp.get('method') ?? '';

    const [records, offsets] = await Promise.all([
      fetchLatest('NR_JOURNEY_GAPS', limit),
      topicOffsets('NR_JOURNEY_GAPS'),
    ]);

    let gaps = records
      .map(r => {
        try {
          const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
          return { ...v, _offset: r.offset, _ts: r.timestamp };
        } catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // newest first

    if (search) {
      gaps = gaps.filter((g: Record<string,unknown>) =>
        String(g.train_id ?? '').toLowerCase().includes(search) ||
        String(g.missed_station_stanox ?? '').toLowerCase().includes(search) ||
        String(g.train_uid ?? '').toLowerCase().includes(search)
      );
    }
    if (sev)    gaps = gaps.filter((g: Record<string,unknown>) => g.severity === sev);
    if (method) gaps = gaps.filter((g: Record<string,unknown>) => g.prediction_method === method);

    return NextResponse.json({ gaps, total: offsets.count, fetched: records.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
