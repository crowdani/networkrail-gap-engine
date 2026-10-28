import { NextResponse } from 'next/server';

const KSQL_URL = (
  process.env.KSQL_URL ?? 'https://ksqldb.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com'
).replace(/\/$/, '');

/**
 * Derive a short operator name from the Network Rail TRAIN_SERVICE_CODE.
 * The first two digits map to an Allocating Group code (TOC/FOC).
 * This is a best-effort lookup — only common passenger TOCs are listed.
 */
function operatorFromSvcCode(svcCode: string | null): string | null {
  if (!svcCode || svcCode.length < 2) return null;
  // NR service code format: TTTTNNNx where first 2 digits = allocating group
  const prefix = svcCode.slice(0, 2);
  const map: Record<string, string> = {
    '20': 'Avanti',    '21': 'Avanti',
    '22': 'XC',        '23': 'XC',
    '24': 'EMR',       '25': 'EMR',
    '26': 'GWR',       '27': 'GWR',
    '28': 'LNER',      '29': 'LNER',
    '30': 'Northern',  '31': 'Northern',
    '32': 'TPE',       '33': 'TPE',
    '34': 'Caledonian','35': 'Caledonian',
    '36': 'ScotRail',  '37': 'ScotRail',
    '38': 'c2c',       '39': 'c2c',
    '40': 'Chiltern',  '41': 'Chiltern',
    '42': 'GTR',       '43': 'GTR',
    '44': 'SE',        '45': 'SE',
    '46': 'SWR',       '47': 'SWR',
    '48': 'TfL Rail',  '49': 'TfL Rail',
    '50': 'Merseyrail','51': 'Merseyrail',
    '52': 'Greater Anglia','53': 'Greater Anglia',
    '54': 'WMR',       '55': 'WMR',
    '56': 'Eurostar',  '57': 'Eurostar',
    '58': 'Hull Trains','59': 'Lumo',
    '60': 'GBRf',      '61': 'GBRf',
    '62': 'DB Cargo',  '63': 'Freightliner',
    '64': 'Colas Rail','65': 'DRS',
    '66': 'Network Rail','67': 'Network Rail',
    '70': 'LNWR',      '71': 'LNWR',
    '72': 'London Overground','73': 'London Overground',
    '74': 'Elizabeth line','75': 'Elizabeth line',
    '76': 'London Underground','77': 'London Underground',
    '80': 'Irish Rail', '81': 'Eurostar',
  };
  return map[prefix] ?? null;
}

export interface LiveStreamEvent {
  TRAIN_ID:             string;
  TRAIN_UID:            string | null;
  TRAIN_SERVICE_CODE:   string | null;
  CURRENT_STANOX:       string | null;
  CURRENT_STATION_NAME: string | null;
  LAST_UPDATED:         string | null;
  STATUS:               string | null;
  ORIGIN_TIPLOC:        string | null;
  ORIGIN_TIME:          string | null;
  DEST_TIPLOC:          string | null;
  DEST_TIME:            string | null;
  VISITED_COUNT:        number;
  OPERATOR:             string | null;
  _ts:                  number;
}

function extractOriginDest(scheduledTimings: string | null): {
  originTiploc: string | null; originTime: string | null;
  destTiploc: string | null;   destTime:   string | null;
} {
  if (!scheduledTimings) return { originTiploc: null, originTime: null, destTiploc: null, destTime: null };
  try {
    const timings: Array<{
      tiploc: string; location_type: string;
      departure?: string | null; arrival?: string | null;
      public_departure?: string | null; public_arrival?: string | null;
    }> = typeof scheduledTimings === 'string' ? JSON.parse(scheduledTimings) : scheduledTimings;

    const lo = timings.find(t => t.location_type === 'LO');
    const lt = [...timings].reverse().find(t => t.location_type === 'LT');
    return {
      originTiploc: lo?.tiploc ?? null,
      originTime:   lo?.public_departure ?? lo?.departure ?? null,
      destTiploc:   lt?.tiploc ?? null,
      destTime:     lt?.public_arrival   ?? lt?.arrival   ?? null,
    };
  } catch {
    return { originTiploc: null, originTime: null, destTiploc: null, destTime: null };
  }
}

/**
 * GET /api/live-stream
 *
 * Uses a ksqlDB pull query against the LIVE_JOURNEY_STATE table.
 * Returns the 50 most recently updated train journeys (by LAST_UPDATED epoch-ms),
 * enriched with origin/destination from SCHEDULED_TIMINGS and operator from service code.
 *
 * Previously this used the Kafka REST Proxy consumer API, but LIVE_JOURNEY_STATE is a
 * compacted ksqlDB table — the REST Proxy v3 end-offset API reports 0 for compacted topics,
 * so consumers always poll 0 records. ksqlDB pull query is the correct read path.
 */
export async function GET() {
  try {
    const res = await fetch(`${KSQL_URL}/query`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/vnd.ksql.v1+json',
        Accept:          'application/vnd.ksql.v1+json',
      },
      body: JSON.stringify({
        ksql: `SELECT TRAIN_ID, TRAIN_UID, TRAIN_SERVICE_CODE,
                      CURRENT_STANOX, CURRENT_STATION_NAME, LAST_UPDATED, STATUS,
                      SCHEDULED_TIMINGS, STATIONS_VISITED
               FROM LIVE_JOURNEY_STATE LIMIT 200;`,
        streamsProperties: { 'ksql.streams.auto.offset.reset': 'earliest' },
      }),
      // @ts-expect-error — Node 18 fetch accepts an agent option via undici
      agent: undefined,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ksqlDB query failed ${res.status}: ${body.slice(0, 300)}`);
    }

    const rows: Array<{ row?: { columns: unknown[] }; header?: unknown }> = await res.json();

    const events: LiveStreamEvent[] = rows
      .filter((r): r is { row: { columns: unknown[] } } => !!r.row)
      .map(r => {
        const c = r.row.columns;
        const trainId    = String(c[0] ?? '');
        const trainUid   = c[1] != null ? String(c[1]).trim() : null;
        const svcCode    = c[2] != null ? String(c[2]) : null;
        const stanox     = c[3] != null ? String(c[3]) : null;
        const stationName = c[4] != null ? String(c[4]) : null;
        const lastUpdRaw = c[5] != null ? String(c[5]) : null;
        const status     = c[6] != null ? String(c[6]) : null;
        const schedTimings = c[7] != null ? (typeof c[7] === 'string' ? c[7] : JSON.stringify(c[7])) : null;
        const visited    = Array.isArray(c[8]) ? (c[8] as unknown[]).length : 0;

        // Epoch-ms timestamp for sorting
        const tsMs = lastUpdRaw ? Number(lastUpdRaw) : 0;

        const { originTiploc, originTime, destTiploc, destTime } = extractOriginDest(schedTimings);

        return {
          TRAIN_ID:             trainId,
          TRAIN_UID:            trainUid,
          TRAIN_SERVICE_CODE:   svcCode,
          CURRENT_STANOX:       stanox,
          CURRENT_STATION_NAME: stationName,
          LAST_UPDATED:         lastUpdRaw,
          STATUS:               status,
          ORIGIN_TIPLOC:        originTiploc,
          ORIGIN_TIME:          originTime,
          DEST_TIPLOC:          destTiploc,
          DEST_TIME:            destTime,
          VISITED_COUNT:        visited,
          OPERATOR:             operatorFromSvcCode(svcCode),
          _ts:                  isFinite(tsMs) && tsMs > 1_000_000_000_000 ? tsMs : 0,
        } satisfies LiveStreamEvent;
      })
      // Sort newest LAST_UPDATED first; untouched trains (ts=0) go to the bottom
      .sort((a, b) => b._ts - a._ts)
      .slice(0, 50);

    return NextResponse.json(events, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma:  'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[live-stream] error:', msg);
    return NextResponse.json(
      { error: 'Failed to fetch live stream', detail: msg },
      { status: 500 },
    );
  }
}
