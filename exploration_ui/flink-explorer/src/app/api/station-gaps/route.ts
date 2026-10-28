import { NextRequest, NextResponse } from 'next/server';
import { fetchLatest, topicOffsets } from '@/lib/kafka-rest';

export const dynamic = 'force-dynamic';

/**
 * GET /api/station-gaps
 *
 * Aggregates missed station reads across messages in the `NR_JOURNEY_GAPS` Kafka topic.
 *
 * Query params:
 *   limit  — max messages to scan (default 200, max 500)
 *   search — filter by TIPLOC or STANOX
 */
export async function GET(request: NextRequest) {
  try {
    const sp     = request.nextUrl.searchParams;
    const limit  = Math.min(parseInt(sp.get('limit') ?? '200'), 500);
    const search = sp.get('search')?.toLowerCase() ?? '';

    const [records, offsets] = await Promise.all([
      fetchLatest('NR_JOURNEY_GAPS', limit),
      topicOffsets('NR_JOURNEY_GAPS'),
    ]);

    const stationMap: Record<string, {
      station_name: string;
      tiploc: string;
      stanox: string;
      missed_count: number;
      scheduled_count: number;
      found_count: number;
      affected_trains: Set<string>;
      recent_misses: Array<{
        train_id: string;
        train_uid: string;
        scheduled_time?: string;
        completion_time?: string | number;
      }>;
    }> = {};

    records.forEach(r => {
      try {
        const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
        if (!v) return;

        const trainId = String(v.train_id ?? '');
        const trainUid = String(v.train_uid ?? '');
        const compTime = v.completion_time ?? r.timestamp;

        // Structured journey stations array
        if (Array.isArray(v.stations)) {
          v.stations.forEach((st: Record<string, unknown>) => {
            const tiploc = String(st.tiploc ?? '').trim();
            const stanox = String(st.stanox ?? '').trim();
            const stationName = String(st.station_name ?? '').trim() || tiploc || stanox;
            const key = stanox || tiploc;
            if (!key) return;

            if (!stationMap[key]) {
              stationMap[key] = {
                station_name: stationName,
                tiploc: tiploc || key,
                stanox: stanox || key,
                missed_count: 0,
                scheduled_count: 0,
                found_count: 0,
                affected_trains: new Set<string>(),
                recent_misses: [],
              };
            } else if (!stationMap[key].station_name || stationMap[key].station_name === key) {
              stationMap[key].station_name = stationName;
            }

            const item = stationMap[key];
            item.scheduled_count += 1;

            const isVisited = st.visited === true || st.status === 'found';
            if (isVisited) {
              item.found_count += 1;
            } else {
              item.missed_count += 1;
              if (trainId) item.affected_trains.add(trainId);
              if (item.recent_misses.length < 10) {
                item.recent_misses.push({
                  train_id: trainId,
                  train_uid: trainUid,
                  scheduled_time: st.scheduled_time ? String(st.scheduled_time) : undefined,
                  completion_time: compTime,
                });
              }
            }
          });
        } 
        // Fallback for flat single-gap events
        else if (v.missed_station_stanox || v.missed_tiploc) {
          const stanox = String(v.missed_station_stanox ?? '').trim();
          const tiploc = String(v.missed_tiploc ?? '').trim();
          const key = stanox || tiploc;
          if (!key) return;

          if (!stationMap[key]) {
            stationMap[key] = {
              station_name: tiploc || stanox || key,
              tiploc: tiploc || key,
              stanox: stanox || key,
              missed_count: 0,
              scheduled_count: 0,
              found_count: 0,
              affected_trains: new Set<string>(),
              recent_misses: [],
            };
          }

          const item = stationMap[key];
          item.scheduled_count += 1;
          item.missed_count += 1;
          if (trainId) item.affected_trains.add(trainId);
          if (item.recent_misses.length < 10) {
            item.recent_misses.push({
              train_id: trainId,
              train_uid: trainUid,
              completion_time: compTime,
            });
          }
        }
      } catch {
        // Skip malformed records
      }
    });

    // Convert map to array and compute missed rate
    let stations = Object.values(stationMap).map(s => {
      const missedRate = s.scheduled_count > 0 ? (s.missed_count / s.scheduled_count) : 0;
      return {
        station_name: s.station_name || s.tiploc || s.stanox,
        tiploc: s.tiploc,
        stanox: s.stanox,
        missed_count: s.missed_count,
        scheduled_count: s.scheduled_count,
        found_count: s.found_count,
        affected_trains_count: s.affected_trains.size,
        missed_rate_pct: Math.round(missedRate * 100),
        recent_misses: s.recent_misses,
      };
    });

    // Sort by largest amount of missed reads descending
    stations.sort((a, b) => b.missed_count - a.missed_count || b.missed_rate_pct - a.missed_rate_pct);

    if (search) {
      stations = stations.filter(s =>
        s.station_name.toLowerCase().includes(search) ||
        s.tiploc.toLowerCase().includes(search) ||
        s.stanox.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({
      stations,
      total_journeys_scanned: records.length,
      topic_total_count: offsets.count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
