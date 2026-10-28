'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Train,
  Search,
  Renew,
  RadioButton,
  CheckmarkFilled,
  ChevronDown,
  ChevronUp,
  Time,
  Calendar,
  Location,
} from '@carbon/icons-react';
import PageRefreshCountdown from '@/components/PageRefreshCountdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Journey {
  TRAIN_ID?: string;
  TRAIN_UID?: string;
  STATUS?: string;
  CURRENT_STANOX?: string;
  CURRENT_STATION_NAME?: string;
  SCHEDULE_START_DATE?: string;
  ORIGIN_STANOX?: string;
  ORIGIN_STATION_NAME?: string;
  DESTINATION_STANOX?: string;
  DESTINATION_STATION_NAME?: string;
  MOVEMENT_COUNT?: number;
  TOTAL_SCHEDULED_STOPS?: number;
  LAST_UPDATED?: number | string;
  OPERATOR_CODE?: string;
  _offset: number;
  _ts: number;
}

interface ScheduleStop {
  station_index: number;
  tiploc: string;
  stanox: string;
  station_name: string;
  crs: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  scheduled_pass: string | null;
  display_time: string | null;
  platform: string | null;
  location_type: string | null;
}

interface ScheduleDetail {
  train_uid: string;
  service_code: string;
  stp_indicator: string;
  schedule_start_date: string;
  schedule_end_date: string;
  total_stops: number;
  stops: ScheduleStop[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string | undefined) {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':      return { bg: '#a7f0ba', text: '#0e6027' };
    case 'TERMINATED':  return { bg: '#e0e0e0', text: '#525252' };
    case 'CANCELLED':   return { bg: '#ffd7d9', text: '#750e13' };
    default:            return { bg: '#d0e2ff', text: '#0043ce' };
  }
}

function formatTs(ts: number | string | undefined) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'string' ? Number(ts) : ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelative(ts: number | undefined) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const REFRESH_SECONDS = 15;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LiveJourneysPage() {
  const [journeys, setJourneys]                 = useState<Journey[]>([]);
  const [total, setTotal]                       = useState(0);
  const [fetched, setFetched]                   = useState(0);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [search, setSearch]                     = useState('');
  const [statusFilter, setStatusFilter]         = useState('');
  const [lastRefresh, setLastRefresh]           = useState<Date | null>(null);

  // Accordion / Expanded schedule state
  const [expandedTrainId, setExpandedTrainId]   = useState<string | null>(null);
  const [schedulesCache, setSchedulesCache]     = useState<Record<string, ScheduleDetail>>({});
  const [loadingSchedule, setLoadingSchedule]   = useState<string | null>(null);
  const [scheduleError, setScheduleError]       = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (search)       params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/live-journeys?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setJourneys(data.journeys ?? []);
      setTotal(data.total ?? 0);
      setFetched(data.fetched ?? 0);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  // Initial + auto-refresh
  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const t = setInterval(fetchData, REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
  }, [fetchData]);

  // Handle accordion toggle to fetch and show schedule
  const toggleExpand = async (journey: Journey) => {
    const trainId = journey.TRAIN_ID;
    if (!trainId) return;

    if (expandedTrainId === trainId) {
      setExpandedTrainId(null);
      return;
    }

    setExpandedTrainId(trainId);
    const trainUid = journey.TRAIN_UID?.trim();

    if (!trainUid) {
      setScheduleError(prev => ({ ...prev, [trainId]: 'No CIF train UID available for this journey' }));
      return;
    }

    if (schedulesCache[trainUid]) {
      return; // Already loaded
    }

    setLoadingSchedule(trainId);
    setScheduleError(prev => ({ ...prev, [trainId]: '' }));

    try {
      const date = journey.SCHEDULE_START_DATE || new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/schedules/${encodeURIComponent(trainUid)}?date=${encodeURIComponent(date)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Schedule not found' }));
        throw new Error(errData.error || 'Failed to fetch schedule');
      }
      const data: ScheduleDetail = await res.json();
      setSchedulesCache(prev => ({ ...prev, [trainUid]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScheduleError(prev => ({ ...prev, [trainId]: msg }));
    } finally {
      setLoadingSchedule(null);
    }
  };

  // Counts
  const activeCount     = journeys.filter(j => j.STATUS?.toUpperCase() === 'ACTIVE').length;
  const terminatedCount = journeys.filter(j => j.STATUS?.toUpperCase() === 'TERMINATED').length;
  const cancelledCount  = journeys.filter(j => j.STATUS?.toUpperCase() === 'CANCELLED').length;

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Train size={28} style={{ color: '#0f62fe' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: '#161616' }}>Live Journeys</h1>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#6f6f6f' }}>
              Real-time from <code style={{ background: '#f4f4f4', padding: '1px 4px', borderRadius: 3 }}>LIVE_JOURNEY_STATE</code> topic
              {lastRefresh && (
                <span style={{ marginLeft: '0.5rem' }}>· refreshed {formatRelative(lastRefresh.getTime())}</span>
              )}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <PageRefreshCountdown refreshInterval={REFRESH_SECONDS * 1000} onRefresh={fetchData} />
          <button
            onClick={fetchData}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Renew size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Topic Messages', value: total.toLocaleString(), sub: 'total offsets' },
          { label: 'Fetched', value: fetched.toLocaleString(), sub: 'latest records' },
          { label: 'Showing', value: journeys.length.toLocaleString(), sub: 'after filters' },
          { label: 'Active', value: activeCount.toLocaleString(), sub: 'in progress', accent: '#0e6027', accentBg: '#a7f0ba' },
          { label: 'Terminated', value: terminatedCount.toLocaleString(), sub: 'completed' },
          { label: 'Cancelled', value: cancelledCount.toLocaleString(), sub: 'cancelled/withdrawn', accent: '#750e13', accentBg: '#ffd7d9' },
        ].map(card => (
          <div key={card.label} style={{ background: card.accentBg ?? '#f4f4f4', border: '1px solid #e0e0e0', borderRadius: 6, padding: '0.9rem 1rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: card.accent ?? '#161616' }}>{card.value}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: card.accent ?? '#161616' }}>{card.label}</div>
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#6f6f6f' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search train ID, UID or station…"
            style={{ width: '100%', paddingLeft: '2rem', padding: '0.5rem 0.75rem 0.5rem 2.1rem', border: '1px solid #e0e0e0', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }}
          />
        </div>

        {['', 'ACTIVE', 'TERMINATED', 'CANCELLED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '0.45rem 0.85rem',
              border: `1px solid ${statusFilter === s ? '#0f62fe' : '#e0e0e0'}`,
              borderRadius: 4,
              background: statusFilter === s ? '#e8f4ff' : '#fff',
              color: statusFilter === s ? '#0f62fe' : '#525252',
              fontSize: '0.8rem',
              fontWeight: statusFilter === s ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {s === '' ? 'All' : s}
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#ffd7d9', border: '1px solid #fa4d56', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#750e13', fontSize: '0.875rem' }}>
          Error: {error}
        </div>
      )}

      {/* ── Table ── */}
      {loading && journeys.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>Loading journeys…</div>
      ) : journeys.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>
          No journeys found{search || statusFilter ? ' matching filters' : ''}.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f4f4f4', borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ width: '40px', padding: '0.6rem 0.5rem' }}></th>
                {['Status', 'Train ID', 'UID', 'Operator', 'Origin', 'Destination', 'Current Station', 'Movements', 'Last Update'].map(h => (
                  <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#161616', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journeys.map((j, i) => {
                const sc = statusColor(j.STATUS);
                const isExpanded = expandedTrainId === j.TRAIN_ID;
                const trainUid = j.TRAIN_UID?.trim() || '';
                const schedule = schedulesCache[trainUid];
                const isSchedLoading = loadingSchedule === j.TRAIN_ID;
                const schedErr = j.TRAIN_ID ? scheduleError[j.TRAIN_ID] : '';

                return (
                  <React.Fragment key={`${j.TRAIN_ID}-${j._offset}`}>
                    <tr
                      onClick={() => toggleExpand(j)}
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid #f4f4f4',
                        background: isExpanded ? '#edf5ff' : (i % 2 === 0 ? '#fff' : '#fafafa'),
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '0.55rem 0.5rem', textAlign: 'center', color: '#0f62fe' }}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: sc.bg, color: sc.text, padding: '2px 8px', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem' }}>
                          {j.STATUS?.toUpperCase() === 'ACTIVE'
                            ? <RadioButton size={12} />
                            : <CheckmarkFilled size={12} />}
                          {j.STATUS ?? 'UNKNOWN'}
                        </span>
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', fontWeight: 600, color: '#161616' }}>
                        {j.TRAIN_ID ?? '—'}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252', fontWeight: 500 }}>{j.TRAIN_UID ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{j.OPERATOR_CODE ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{j.ORIGIN_STATION_NAME ?? j.ORIGIN_STANOX ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{j.DESTINATION_STATION_NAME ?? j.DESTINATION_STANOX ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#161616', fontWeight: 500 }}>
                        {j.CURRENT_STATION_NAME ?? j.CURRENT_STANOX ?? '—'}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center', color: '#525252' }}>
                        {j.MOVEMENT_COUNT != null ? (
                          <span>
                            {j.MOVEMENT_COUNT}
                            {j.TOTAL_SCHEDULED_STOPS != null && (
                              <span style={{ color: '#6f6f6f' }}> / {j.TOTAL_SCHEDULED_STOPS}</span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#6f6f6f', whiteSpace: 'nowrap' }}>
                        {formatTs(j.LAST_UPDATED ?? j._ts)}
                      </td>
                    </tr>

                    {/* ── Expanded Schedule Row ── */}
                    {isExpanded && (
                      <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #0f62fe' }}>
                        <td colSpan={10} style={{ padding: '1rem 1.5rem' }}>
                          <div style={{ background: '#ffffff', border: '1px solid #d0e2ff', borderRadius: 6, padding: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Calendar size={18} style={{ color: '#0f62fe' }} />
                                <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#161616' }}>
                                  Timetable Schedule for {j.TRAIN_ID} (UID: {trainUid || 'Unknown'})
                                </span>
                              </div>
                              {schedule && (
                                <div style={{ fontSize: '0.75rem', color: '#525252', display: 'flex', gap: '1rem' }}>
                                  <span><strong>Service:</strong> {schedule.service_code || '—'}</span>
                                  <span><strong>STP:</strong> {schedule.stp_indicator}</span>
                                  <span><strong>Stops:</strong> {schedule.total_stops}</span>
                                </div>
                              )}
                            </div>

                            {isSchedLoading ? (
                              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#6f6f6f', fontSize: '0.85rem' }}>
                                Loading schedule timetable…
                              </div>
                            ) : schedErr ? (
                              <div style={{ padding: '1rem', background: '#fff1f1', border: '1px solid #ffd7d9', borderRadius: 4, color: '#750e13', fontSize: '0.8rem' }}>
                                {schedErr}
                              </div>
                            ) : schedule?.stops && schedule.stops.length > 0 ? (
                              <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 4 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                  <thead>
                                    <tr style={{ background: '#f4f4f4', borderBottom: '1px solid #e0e0e0', position: 'sticky', top: 0, zIndex: 1 }}>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, width: '40px' }}>#</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600 }}>Station</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, width: '70px' }}>CRS</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, width: '80px' }}>TIPLOC</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, width: '70px' }}>STANOX</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, width: '60px' }}>Platform</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 600, width: '90px' }}>Sched Time</th>
                                      <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, width: '70px' }}>Type</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {schedule.stops.map((stop, sIdx) => {
                                      const isCurrent = j.CURRENT_STANOX && stop.stanox === j.CURRENT_STANOX;
                                      return (
                                        <tr
                                          key={sIdx}
                                          style={{
                                            borderBottom: '1px solid #f0f0f0',
                                            background: isCurrent ? '#defbe6' : (sIdx % 2 === 0 ? '#fff' : '#fbfbfb'),
                                            fontWeight: isCurrent ? 600 : 'normal',
                                          }}
                                        >
                                          <td style={{ padding: '0.35rem 0.6rem', color: '#6f6f6f' }}>{sIdx + 1}</td>
                                          <td style={{ padding: '0.35rem 0.6rem', color: isCurrent ? '#0e6027' : '#161616' }}>
                                            {isCurrent && <Location size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />}
                                            {stop.station_name}
                                          </td>
                                          <td style={{ padding: '0.35rem 0.6rem', color: '#525252' }}>{stop.crs || '—'}</td>
                                          <td style={{ padding: '0.35rem 0.6rem', fontFamily: 'monospace', color: '#525252' }}>{stop.tiploc}</td>
                                          <td style={{ padding: '0.35rem 0.6rem', fontFamily: 'monospace', color: '#525252' }}>{stop.stanox || '—'}</td>
                                          <td style={{ padding: '0.35rem 0.6rem', color: '#525252' }}>{stop.platform || '—'}</td>
                                          <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#0f62fe' }}>
                                            {stop.display_time || stop.scheduled_departure || stop.scheduled_arrival || stop.scheduled_pass || '—'}
                                          </td>
                                          <td style={{ padding: '0.35rem 0.6rem', color: '#6f6f6f', fontSize: '0.7rem' }}>
                                            {stop.location_type === 'LO' ? 'Origin' : stop.location_type === 'LT' ? 'Terminus' : stop.scheduled_pass ? 'Pass' : 'Stop'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div style={{ padding: '1rem', color: '#6f6f6f', fontSize: '0.8rem', textAlign: 'center' }}>
                                No stops found for this timetable schedule.
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#6f6f6f' }}>
        Showing {journeys.length} journey{journeys.length !== 1 ? 's' : ''}
        {statusFilter ? ` · Status: ${statusFilter}` : ''}
        {search ? ` · Search: "${search}"` : ''}
        {' '}· Auto-refreshes every {REFRESH_SECONDS}s
      </p>
    </div>
  );
}
