import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/analysed-gaps
 *
 * Reads from NR_JOURNEY_GAPS_ANALYSED — the output of delay_cause_analyser.py.
 * Each record is a fully enriched journey with:
 *   - stations[] with visited/missed stops and delay_minutes per stop
 *   - journey_delay summary (is_delayed, max_delay_minutes, avg_delay_minutes)
 *   - delay_analysis (LLM cause, category, confidence, detail, approval_status)
 *
 * Query params:
 *   limit    — max records to fetch (default 100, max 500)
 *   search   — filter by train_id, train_uid, or station name
 *   severity — HIGH | MEDIUM | LOW | NONE
 *   delayed  — true | false  (filter by journey_delay.is_delayed)
 *   category — INFRASTRUCTURE | TIMETABLING | OPERATIONAL | EXTERNAL | ROLLING_STOCK | UNKNOWN
 */
export async function GET(request: NextRequest) {
  try {
    const sp       = request.nextUrl.searchParams;
    const limit    = Math.min(parseInt(sp.get('limit') ?? '100'), 500);
    const search   = sp.get('search')?.toLowerCase() ?? '';
    const sev      = sp.get('severity') ?? '';
    const delayed  = sp.get('delayed') ?? '';
    const category = sp.get('category') ?? '';

    const [records, offsets] = await Promise.all([
      fetchLatest('NR_JOURNEY_GAPS_ANALYSED', limit),
      topicOffsets('NR_JOURNEY_GAPS_ANALYSED'),
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
            String(st.tiploc       ?? '').toLowerCase().includes(search)
          );
        return haystack.includes(search) || stationMatch;
      });
    }

    if (sev) {
      gaps = gaps.filter((g: Record<string, unknown>) => g.severity === sev);
    }

    if (delayed !== '') {
      const wantDelayed = delayed === 'true';
      gaps = gaps.filter((g: Record<string, unknown>) => {
        const jd = g.journey_delay as Record<string, unknown> | null;
        return (jd?.is_delayed ?? false) === wantDelayed;
      });
    }

    if (category) {
      gaps = gaps.filter((g: Record<string, unknown>) => {
        const da = g.delay_analysis as Record<string, unknown> | null;
        return da?.category === category;
      });
    }

    return NextResponse.json({ gaps, total: offsets.count, fetched: records.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
