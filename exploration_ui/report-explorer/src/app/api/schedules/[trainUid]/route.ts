import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

function formatTiming(timingObj: any): string | null {
  if (!timingObj) return null;
  if (typeof timingObj === 'object') {
    const t =
      timingObj.public_departure ||
      timingObj.public_arrival ||
      timingObj.departure ||
      timingObj.arrival ||
      timingObj.pass;
    if (t) {
      const s = String(t).trim();
      if (s.includes(':')) {
        const parts = s.split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
      }
      const digits = s.replace(/\D/g, '');
      if (digits.length >= 4) {
        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
      }
      return s;
    }
  }
  return null;
}

/**
 * GET /api/schedules/[trainUid]
 *
 * Fetches the active schedule and stops for a given CIF train UID or service code.
 * Optional query param:
 *   date: YYYY-MM-DD (defaults to today)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trainUid: string }> }
) {
  try {
    const { trainUid } = await params;
    const sp = request.nextUrl.searchParams;
    const date = sp.get('date') || new Date().toISOString().slice(0, 10);

    // 1. Try lookup by cif_train_uid
    let res = await pool.query(
      `
      SELECT
        cif_train_uid,
        service_code,
        cif_stp_indicator,
        schedule_start_date,
        schedule_end_date,
        schedule_days_runs,
        array_to_json(tiploc_array)::text AS tiploc_json,
        array_to_json(stanox_array)::text AS stanox_json,
        timing_data::text                 AS timing_json
      FROM active_schedule
      WHERE cif_train_uid = $1
        AND schedule_start_date <= $2::date
        AND schedule_end_date   >= $2::date
        AND SUBSTRING(schedule_days_runs, EXTRACT(ISODOW FROM $2::date)::int, 1) = '1'
        AND cif_stp_indicator != 'C'
      ORDER BY
        CASE cif_stp_indicator
          WHEN 'O' THEN 1
          WHEN 'N' THEN 2
          WHEN 'P' THEN 3
          ELSE 4
        END
      LIMIT 1
      `,
      [trainUid, date]
    );

    // 2. Fallback without day-of-week check if not found
    if (res.rows.length === 0) {
      res = await pool.query(
        `
        SELECT
          cif_train_uid,
          service_code,
          cif_stp_indicator,
          schedule_start_date,
          schedule_end_date,
          schedule_days_runs,
          array_to_json(tiploc_array)::text AS tiploc_json,
          array_to_json(stanox_array)::text AS stanox_json,
          timing_data::text                 AS timing_json
        FROM active_schedule
        WHERE cif_train_uid = $1
          AND schedule_start_date <= $2::date
          AND schedule_end_date   >= $2::date
          AND cif_stp_indicator != 'C'
        ORDER BY
          CASE cif_stp_indicator
            WHEN 'O' THEN 1
            WHEN 'N' THEN 2
            WHEN 'P' THEN 3
            ELSE 4
          END
        LIMIT 1
        `,
        [trainUid, date]
      );
    }

    if (res.rows.length === 0) {
      return NextResponse.json(
        { error: `No active schedule found for UID ${trainUid} on ${date}` },
        { status: 404 }
      );
    }

    const row = res.rows[0];
    const tiplocs: string[] = JSON.parse(row.tiploc_json || '[]');
    const stanoxes: string[] = JSON.parse(row.stanox_json || '[]');
    const timings: any[] = JSON.parse(row.timing_json || '[]');

    // Enrich TIPLOCs with station names and CRS codes
    let tiplocRefMap: Record<string, { name: string; crs: string; stanox: string }> = {};
    if (tiplocs.length > 0) {
      const refRes = await pool.query(
        `
        SELECT tiploc, stanox, COALESCE(nlc_desc_16, nlc_desc) AS name, three_alpha AS crs
        FROM tiploc_reference
        WHERE tiploc = ANY($1)
        `,
        [tiplocs]
      );
      for (const r of refRes.rows) {
        tiplocRefMap[r.tiploc] = {
          name: r.name || r.tiploc,
          crs: r.crs || '',
          stanox: r.stanox || '',
        };
      }
    }

    const stops = tiplocs.map((tiploc, idx) => {
      const ref = tiplocRefMap[tiploc] || {};
      const timingObj = timings[idx] || {};
      const stanox = stanoxes[idx] || ref.stanox || '';
      return {
        station_index: idx,
        tiploc,
        stanox,
        station_name: ref.name || tiploc,
        crs: ref.crs || '',
        scheduled_departure: timingObj.departure || timingObj.public_departure || null,
        scheduled_arrival: timingObj.arrival || timingObj.public_arrival || null,
        scheduled_pass: timingObj.pass || null,
        display_time: formatTiming(timingObj),
        platform: timingObj.platform || null,
        location_type: timingObj.location_type || null,
      };
    });

    return NextResponse.json({
      train_uid: row.cif_train_uid,
      service_code: row.service_code,
      stp_indicator: row.cif_stp_indicator,
      schedule_start_date: row.schedule_start_date,
      schedule_end_date: row.schedule_end_date,
      total_stops: stops.length,
      stops,
    });
  } catch (error) {
    console.error('Error fetching schedule in /api/schedules/[trainUid]:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedule' },
      { status: 500 }
    );
  }
}
