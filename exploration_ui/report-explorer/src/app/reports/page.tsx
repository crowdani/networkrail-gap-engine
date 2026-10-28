'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Document, ChevronLeft, ChevronRight, Renew, Warning } from '@carbon/icons-react';
import PageRefreshCountdown from '@/components/PageRefreshCountdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Summary {
  total_journeys: string;
  journeys_with_gaps: string;
  total_gaps: string;
  journeys_today: string;
  unique_stations_affected: string;
  avg_gaps_per_journey: string | null;
  high_severity_gaps: string;
  gaps_with_prediction: string;
  gaps_resolved: string;
}

interface Station {
  stanox: string;
  station_name: string | null;
  total_gaps: string;
  affected_trains: string;
  high_severity: string;
  resolved: string;
  predicted: string;
  last_seen: string;
}

interface TrainRow {
  journey_id: number;
  train_id: string;
  train_uid: string | null;
  operator_code: string | null;
  analyzed_at: string;
  total_movements: number | null;
  gaps_detected: number;
  route_summary: string | null;
  scheduled_stops: number | null;
  actual_stops: number | null;
  missed_stations: string;
  worst_severity: string | null;
  predictions_count: string;
  resolved_count: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityColor(s: string | null) {
  switch (s?.toUpperCase()) {
    case 'HIGH':   return { bg: '#ffd7d9', text: '#750e13' };
    case 'MEDIUM': return { bg: '#ffd6a0', text: '#8a3800' };
    case 'LOW':    return { bg: '#d0e2ff', text: '#0043ce' };
    default:       return { bg: '#e0e0e0', text: '#525252' };
  }
}

function formatDate(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const REFRESH_SECONDS = 60;
const PAGE_SIZES = [10, 25, 50];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const [summary, setSummary]             = useState<Summary | null>(null);
  const [stations, setStations]           = useState<Station[]>([]);
  const [trains, setTrains]               = useState<TrainRow[]>([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [pageSize, setPageSize]           = useState(25);
  const [days, setDays]                   = useState(7);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<'stations' | 'trains'>('stations');

  const totalPages = Math.ceil(total / pageSize);

  const fetchData = useCallback(async (pg = page, ps = pageSize, d = days) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?page=${pg}&pageSize=${ps}&days=${d}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSummary(data.summary ?? null);
      setStations(data.top_stations ?? []);
      setTrains(data.trains ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, days]);

  useEffect(() => { fetchData(page, pageSize, days); }, [page, pageSize, days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => fetchData(page, pageSize, days), REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
  }, [page, pageSize, days, fetchData]);

  // ── Stat card helper
  const Stat = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
    <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', borderRadius: 6, padding: '0.9rem 1rem' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: accent ?? '#161616' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: accent ?? '#161616' }}>{label}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Document size={28} style={{ color: '#0f62fe' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: '#161616' }}>Reports</h1>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#6f6f6f' }}>Trains &amp; stations summary from PostgreSQL</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Days filter */}
          {[1, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => { setDays(d); setPage(1); }}
              style={{
                padding: '0.4rem 0.75rem',
                border: `1px solid ${days === d ? '#0f62fe' : '#e0e0e0'}`,
                borderRadius: 4,
                background: days === d ? '#e8f4ff' : '#fff',
                color: days === d ? '#0f62fe' : '#525252',
                fontSize: '0.8rem',
                fontWeight: days === d ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {d}d
            </button>
          ))}
          <PageRefreshCountdown refreshInterval={REFRESH_SECONDS * 1000} onRefresh={() => fetchData(page, pageSize, days)} />
          <button
            onClick={() => fetchData(page, pageSize, days)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Renew size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#ffd7d9', border: '1px solid #fa4d56', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#750e13', fontSize: '0.875rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Warning size={16} /> {error}
        </div>
      )}

      {/* ── Summary cards ── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <Stat label="Total Journeys"       value={parseInt(summary.total_journeys).toLocaleString()}           sub={`last ${days} days`} />
          <Stat label="Journeys with Gaps"   value={parseInt(summary.journeys_with_gaps).toLocaleString()}       sub="have ≥1 missed stop" accent="#8a3800" />
          <Stat label="Total Gaps"           value={parseInt(summary.total_gaps).toLocaleString()}               sub="missed stops" />
          <Stat label="Journeys Today"       value={parseInt(summary.journeys_today).toLocaleString()}           sub="since midnight" accent="#0043ce" />
          <Stat label="Stations Affected"    value={parseInt(summary.unique_stations_affected).toLocaleString()} sub="unique locations" />
          <Stat label="High Severity"        value={parseInt(summary.high_severity_gaps).toLocaleString()}       sub="gaps" accent="#750e13" />
          <Stat label="With Prediction"      value={parseInt(summary.gaps_with_prediction).toLocaleString()}     sub="infill predicted" accent="#0e6027" />
          <Stat label="Resolved"             value={parseInt(summary.gaps_resolved).toLocaleString()}            sub="gaps closed" />
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e0e0e0', marginBottom: '1.25rem' }}>
        {(['stations', 'trains'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.6rem 1.25rem',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #0f62fe' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab ? '#0f62fe' : '#525252',
              fontSize: '0.875rem',
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: 'pointer',
              marginBottom: '-2px',
            }}
          >
            {tab === 'stations' ? `Top Stations (${stations.length})` : `Trains (${total.toLocaleString()})`}
          </button>
        ))}
      </div>

      {/* ── Stations table ── */}
      {activeTab === 'stations' && (
        loading && stations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>Loading…</div>
        ) : stations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>No station data for this period.</div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f4f4f4', borderBottom: '2px solid #e0e0e0' }}>
                  {['#', 'Station', 'STANOX', 'Total Gaps', 'Affected Trains', 'High Severity', 'Predicted', 'Resolved', 'Last Seen'].map(h => (
                    <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#161616', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stations.map((s, i) => (
                  <tr key={s.stanox} style={{ borderBottom: '1px solid #f4f4f4', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '0.55rem 0.75rem', color: '#6f6f6f', fontWeight: 600 }}>{i + 1}</td>
                    <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: '#161616' }}>{s.station_name ?? '—'}</td>
                    <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', color: '#525252' }}>{s.stanox}</td>
                    <td style={{ padding: '0.55rem 0.75rem', fontWeight: 700, color: '#161616' }}>{parseInt(s.total_gaps).toLocaleString()}</td>
                    <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{parseInt(s.affected_trains).toLocaleString()}</td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      {parseInt(s.high_severity) > 0 && (
                        <span style={{ background: '#ffd7d9', color: '#750e13', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>
                          {parseInt(s.high_severity).toLocaleString()}
                        </span>
                      )}
                      {parseInt(s.high_severity) === 0 && <span style={{ color: '#6f6f6f' }}>0</span>}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      {parseInt(s.predicted) > 0
                        ? <span style={{ background: '#a7f0ba', color: '#0e6027', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>{parseInt(s.predicted).toLocaleString()}</span>
                        : <span style={{ color: '#6f6f6f' }}>0</span>}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{parseInt(s.resolved).toLocaleString()}</td>
                    <td style={{ padding: '0.55rem 0.75rem', color: '#6f6f6f', whiteSpace: 'nowrap' }}>{formatDate(s.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Trains table ── */}
      {activeTab === 'trains' && (
        <>
          {loading && trains.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>Loading…</div>
          ) : trains.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>No train data for this period.</div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#f4f4f4', borderBottom: '2px solid #e0e0e0' }}>
                    {['Train ID', 'UID', 'Op', 'Route', 'Analysed', 'Movements', 'Gaps', 'Severity', 'Predicted', 'Resolved', 'Missed Stations'].map(h => (
                      <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#161616', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trains.map((t, i) => {
                    const sc = severityColor(t.worst_severity);
                    return (
                      <tr key={t.journey_id} style={{ borderBottom: '1px solid #f4f4f4', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', fontWeight: 600, color: '#161616' }}>{t.train_id}</td>
                        <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{t.train_uid ?? '—'}</td>
                        <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{t.operator_code ?? '—'}</td>
                        <td style={{ padding: '0.55rem 0.75rem', color: '#525252', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.route_summary ?? '—'}
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', color: '#6f6f6f', whiteSpace: 'nowrap' }}>{formatDate(t.analyzed_at)}</td>
                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center', color: '#525252' }}>
                          {t.total_movements != null
                            ? <>{t.total_movements}{t.scheduled_stops != null && <span style={{ color: '#6f6f6f' }}> /{t.scheduled_stops}</span>}</>
                            : '—'}
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center', fontWeight: 700, color: t.gaps_detected > 0 ? '#750e13' : '#0e6027' }}>
                          {t.gaps_detected}
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>
                          {t.worst_severity
                            ? <span style={{ background: sc.bg, color: sc.text, padding: '1px 7px', borderRadius: 10, fontWeight: 600, fontSize: '0.75rem' }}>{t.worst_severity}</span>
                            : <span style={{ color: '#6f6f6f' }}>—</span>}
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center', color: '#525252' }}>
                          {parseInt(t.predictions_count) > 0
                            ? <span style={{ background: '#a7f0ba', color: '#0e6027', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>{t.predictions_count}</span>
                            : <span style={{ color: '#6f6f6f' }}>0</span>}
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center', color: '#525252' }}>{t.resolved_count}</td>
                        <td style={{ padding: '0.55rem 0.75rem', color: '#6f6f6f', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.missed_stations}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#525252' }}>
                Rows per page:
                {PAGE_SIZES.map(ps => (
                  <button
                    key={ps}
                    onClick={() => { setPageSize(ps); setPage(1); }}
                    style={{
                      padding: '0.3rem 0.6rem',
                      border: `1px solid ${pageSize === ps ? '#0f62fe' : '#e0e0e0'}`,
                      borderRadius: 3,
                      background: pageSize === ps ? '#e8f4ff' : '#fff',
                      color: pageSize === ps ? '#0f62fe' : '#525252',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    {ps}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#525252' }}>
                Page {page} of {totalPages} · {total.toLocaleString()} journeys
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{ padding: '0.3rem', border: '1px solid #e0e0e0', borderRadius: 3, background: '#fff', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{ padding: '0.3rem', border: '1px solid #e0e0e0', borderRadius: 3, background: '#fff', cursor: page === totalPages ? 'default' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#6f6f6f' }}>
        Data window: last {days} day{days !== 1 ? 's' : ''} · Auto-refreshes every {REFRESH_SECONDS}s
      </p>
    </div>
  );
}
