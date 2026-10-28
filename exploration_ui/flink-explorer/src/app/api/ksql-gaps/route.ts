import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ksql-gaps
 *
 * Reads from the `NR_JOURNEY_GAPS` Kafka topic — the output of the
 * gap_detector Python service.
 *
 * Query params:
 *   limit    — max records to fetch (default 100, max 500)
 *   search   — filter by train_id, train_uid, or missed_station_stanox
 *   severity — filter by severity value (HIGH / MEDIUM / LOW)
 *   method   — filter by prediction_method
 */
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
      gaps = gaps.filter((g: Record<string, unknown>) => {
        const trainId = String(g.train_id ?? '').toLowerCase();
        const trainUid = String(g.train_uid ?? '').toLowerCase();
        const missedStanox = String(g.missed_station_stanox ?? '').toLowerCase();
        const stations = Array.isArray(g.stations) ? g.stations : [];
        const matchesStation = stations.some((st: Record<string, unknown>) =>
          String(st.tiploc ?? '').toLowerCase().includes(search) ||
          String(st.stanox ?? '').toLowerCase().includes(search)
        );
        return trainId.includes(search) || trainUid.includes(search) || missedStanox.includes(search) || matchesStation;
      });
    }
    if (sev)    gaps = gaps.filter((g: Record<string, unknown>) => g.severity         === sev);
    if (method) gaps = gaps.filter((g: Record<string, unknown>) => g.prediction_method === method);

    return NextResponse.json({ gaps, total: offsets.count, fetched: records.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
