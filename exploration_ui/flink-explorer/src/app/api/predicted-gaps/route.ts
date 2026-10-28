import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/predicted-gaps
 *
 * Reads from NR_JOURNEY_GAPS_PREDICTED — the output of the infill-predictor
 * service.  Each record is an NR_JOURNEY_GAPS record whose missed stops have
 * been enriched with predicted_time, prediction_method, prediction_confidence
 * and prediction_basis fields.
 *
 * Query params:
 *   limit    — max records to fetch (default 100, max 500)
 *   search   — filter by train_id, train_uid, or station name / tiploc
 *   severity — HIGH | MEDIUM | LOW | NONE
 *   method   — prediction_method filter (ON_TIME_INTERPOLATION | LINEAR_INTERPOLATION | …)
 */
export async function GET(request: NextRequest) {
  try {
    const sp     = request.nextUrl.searchParams;
    const limit  = Math.min(parseInt(sp.get('limit') ?? '100'), 500);
    const search = sp.get('search')?.toLowerCase() ?? '';
    const sev    = sp.get('severity') ?? '';
    const method = sp.get('method')   ?? '';

    const [records, offsets] = await Promise.all([
      fetchLatest('NR_JOURNEY_GAPS_PREDICTED', limit),
      topicOffsets('NR_JOURNEY_GAPS_PREDICTED'),
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
        const haystack = [
          String(g.train_id  ?? ''),
          String(g.train_uid ?? ''),
        ].join(' ').toLowerCase();
        const stationMatch = Array.isArray(g.stations) &&
          (g.stations as Record<string, unknown>[]).some(st =>
            String(st.station_name ?? '').toLowerCase().includes(search) ||
            String(st.tiploc       ?? '').toLowerCase().includes(search) ||
            String(st.stanox       ?? '').toLowerCase().includes(search)
          );
        return haystack.includes(search) || stationMatch;
      });
    }

    if (sev) {
      gaps = gaps.filter((g: Record<string, unknown>) => g.severity === sev);
    }

    // Filter by any prediction method present on the missed stops
    if (method) {
      gaps = gaps.filter((g: Record<string, unknown>) =>
        Array.isArray(g.stations) &&
        (g.stations as Record<string, unknown>[]).some(
          st => !st.visited && st.prediction_method === method
        )
      );
    }

    return NextResponse.json({ gaps, total: offsets.count, fetched: records.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
