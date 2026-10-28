'use client';

import { useState, useEffect, useCallback } from 'react';
import AppHeader from '@/components/Header';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  total_gaps:          string;
  journeys_with_gaps:  string;
  pending:             string;
  approved:            string;
  rejected:            string;
  high_severity:       string;
  medium_severity:     string;
  low_severity:        string;
  total_delay_minutes: string;
  avg_confidence:      string;
}

interface SeverityRow   { severity: string;  gap_count: string; journey_count: string; }
interface MethodRow     { method: string;    gap_count: string; avg_confidence: string; }
interface DailyRow      { day: string;       gap_count: string; journey_count: string; }
interface ScheduleRow   { train_uid: string; gap_count: string; journey_count: string; max_missed_stops: string; avg_delay_min: string; worst_severity: string; last_seen: string; }
interface DelayedRow    { train_uid: string; train_id: string; schedule_start_date: string | null; gap_count: string; total_delay_min: string; max_delay_min: string; severity: string; approval_status: string; received_at: string; }
interface StationRow    { station_name: string; gap_count: string; affected_trains: string; avg_delay_min: string; worst_severity: string; }

interface AnalyticsData {
  summary:           Summary;
  severityBreakdown: SeverityRow[];
  methodBreakdown:   MethodRow[];
  dailyTrend:        DailyRow[];
  topSchedules:      ScheduleRow[];
  mostDelayed:       DelayedRow[];
  topStations:       StationRow[];
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const SEV_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  HIGH:    { bg: '#ffd7d9', text: '#750e13', bar: '#da1e28' },
  MEDIUM:  { bg: '#ffd6a0', text: '#8a3800', bar: '#f1620a' },
  LOW:     { bg: '#d0e2ff', text: '#0043ce', bar: '#4589ff' },
  UNKNOWN: { bg: '#e0e0e0', text: '#525252', bar: '#8d8d8d' },
};

const METHOD_COLORS: Record<string, string> = {
  ON_TIME_INTERPOLATION:          '#24a148',
  LINEAR_INTERPOLATION:           '#0f62fe',
  SINGLE_STATION_EXTRAPOLATION:   '#f1620a',
  SCHEDULE_ONLY:                  '#8d8d8d',
  UNKNOWN:                        '#c1c7cd',
};

const METHOD_LABELS: Record<string, string> = {
  ON_TIME_INTERPOLATION:          'On-time interpolation',
  LINEAR_INTERPOLATION:           'Linear interpolation',
  SINGLE_STATION_EXTRAPOLATION:   'Extrapolation',
  SCHEDULE_ONLY:                  'Schedule only',
  UNKNOWN:                        'Unknown',
};

function fmtN(v: string | number): string {
  return Number(v).toLocaleString('en-GB');
}

function fmtDelayHrs(minutes: string | number): string {
  const m = Number(minutes);
  if (isNaN(m) || m <= 0) return '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function rttUrl(uid: string, date: string | null): string | null {
  if (!uid || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `https://www.realtimetrains.co.uk/service/gb-nr:${uid.trim()}/${date}/detailed`;
}

function BarChart({ rows, labelKey, valueKey, colorFn, maxValue }: {
  rows:     Record<string, string>[];
  labelKey: string;
  valueKey: string;
  colorFn:  (row: Record<string, string>) => string;
  maxValue: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {rows.map(row => {
        const pct = maxValue > 0 ? (Number(row[valueKey]) / maxValue) * 100 : 0;
        return (
          <div key={row[labelKey]} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ minWidth: 200, fontSize: '0.78rem', color: '#161616', textAlign: 'right' }}>
              {row[labelKey]}
            </span>
            <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 3, height: 20, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%',
                background: colorFn(row),
                borderRadius: 3,
                transition: 'width 0.6s ease',
              }} />
            </div>
            <span style={{ minWidth: 48, fontSize: '0.78rem', fontWeight: 600, color: '#161616', textAlign: 'right' }}>
              {fmtN(row[valueKey])}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ rows }: { rows: DailyRow[] }) {
  if (rows.length === 0) return null;
  const vals = rows.map(r => Number(r.gap_count));
  const max  = Math.max(...vals, 1);
  const W = 320, H = 60;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1 || 1)) * W;
    const y = H - (v / max) * (H - 8) - 4;
    return `${x},${y}`;
  });

  return (
    <div>
      <svg width={W} height={H} style={{ display: 'block' }}>
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke="#0f62fe"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {vals.map((v, i) => {
          const x = (i / (vals.length - 1 || 1)) * W;
          const y = H - (v / max) * (H - 8) - 4;
          return <circle key={i} cx={x} cy={y} r={3} fill="#0f62fe" />;
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#8d8d8d', marginTop: '0.2rem' }}>
        <span>{rows[0]?.day?.slice(5)}</span>
        <span>{rows[rows.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/** Trigger a browser file-save of any object as pretty-printed JSON. */
function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GapAnalyticsPage() {
  const [data,     setData]     = useState<AnalyticsData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null); // train_id being fetched

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/gap-analytics', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastFetch(new Date());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Download the full journey (all stops + predictions) for a single train_id. */
  const downloadJourney = useCallback(async (trainId: string, scheduleDate: string | null) => {
    setDownloading(trainId);
    try {
      const res = await fetch(`/api/trains/${encodeURIComponent(trainId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const journey = await res.json();
      const dateTag  = scheduleDate ?? new Date().toISOString().slice(0, 10);
      downloadJson(journey, `journey-${trainId}-${dateTag}.json`);
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setDownloading(null);
    }
  }, []);

  /** Download the full analytics snapshot currently on screen. */
  const downloadAnalytics = useCallback(() => {
    if (!data) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    downloadJson({ exported_at: new Date().toISOString(), ...data }, `gap-analytics-${ts}.json`);
  }, [data]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const s   = data?.summary;
  const sevMax  = data ? Math.max(...data.severityBreakdown.map(r => Number(r.gap_count)), 1) : 1;
  const methMax = data ? Math.max(...data.methodBreakdown.map(r => Number(r.gap_count)), 1)  : 1;

  return (
    <>
      <AppHeader />
      <main style={{ marginTop: 48, padding: '2rem', background: '#f4f4f4', minHeight: 'calc(100vh - 48px)' }}>
        <div style={{ maxWidth: 1340, margin: '0 auto' }}>

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 300, color: '#161616', margin: 0 }}>
                Gap Analytics
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#525252', margin: '0.25rem 0 0' }}>
                Predicted infill gaps from <code>predicted_gaps</code> — volume, severity, delay impact and top offenders
                {lastFetch && (
                  <span style={{ marginLeft: '0.75rem', color: '#8d8d8d' }}>
                    · updated {lastFetch.toLocaleTimeString('en-GB')}
                  </span>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {data && (
                <button
                  onClick={downloadAnalytics}
                  style={{ padding: '0.4rem 1rem', background: '#fff', color: '#161616', border: '1px solid #8d8d8d', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  ↓ Export analytics JSON
                </button>
              )}
              <button
                onClick={() => { setLoading(true); fetchData(); }}
                style={{ padding: '0.4rem 1rem', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
              >
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: '#fff1f1', border: '1px solid #da1e28', color: '#750e13', padding: '0.875rem 1rem', marginBottom: '1.5rem', borderRadius: 4 }}>
              {error}
            </div>
          )}

          {loading && !data && (
            <div style={{ textAlign: 'center', padding: '4rem', color: '#525252' }}>Loading…</div>
          )}

          {data && (
            <>
              {/* ── KPI cards ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                  { label: 'Total Gaps',         value: fmtN(s!.total_gaps),          sub: `across ${fmtN(s!.journeys_with_gaps)} journeys`,     color: '#161616' },
                  { label: 'Pending Approval',   value: fmtN(s!.pending),             sub: `${fmtN(s!.approved)} approved · ${fmtN(s!.rejected)} rejected`, color: '#0043ce' },
                  { label: 'High Severity',      value: fmtN(s!.high_severity),       sub: `${fmtN(s!.medium_severity)} medium · ${fmtN(s!.low_severity)} low`, color: '#da1e28' },
                  { label: 'Total Delay Impact', value: fmtDelayHrs(s!.total_delay_minutes), sub: 'accumulated across all gaps',               color: '#f1620a' },
                  { label: 'Avg Confidence',     value: `${Math.round(Number(s!.avg_confidence) * 100)}%`, sub: 'prediction confidence score',  color: '#24a148' },
                ].map(card => (
                  <div key={card.label} style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '1.25rem 1.5rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.4rem' }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 300, color: card.color, lineHeight: 1 }}>
                      {card.value}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#8d8d8d', marginTop: '0.35rem' }}>
                      {card.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Row 2: Severity + Method + Daily Trend ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>

                {/* Severity breakdown */}
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '1.25rem 1.5rem' }}>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#161616', margin: '0 0 1rem' }}>Gaps by Severity</h2>
                  <BarChart
                    rows={data.severityBreakdown as unknown as Record<string, string>[]}
                    labelKey="severity"
                    valueKey="gap_count"
                    colorFn={r => SEV_COLORS[r.severity]?.bar ?? '#8d8d8d'}
                    maxValue={sevMax}
                  />
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {data.severityBreakdown.map(r => (
                      <span key={r.severity} style={{ background: SEV_COLORS[r.severity]?.bg ?? '#e0e0e0', color: SEV_COLORS[r.severity]?.text ?? '#525252', padding: '0.15rem 0.6rem', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600 }}>
                        {r.severity}: {fmtN(r.journey_count)} journeys
                      </span>
                    ))}
                  </div>
                </div>

                {/* Prediction method */}
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '1.25rem 1.5rem' }}>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#161616', margin: '0 0 1rem' }}>Gaps by Prediction Method</h2>
                  <BarChart
                    rows={data.methodBreakdown as unknown as Record<string, string>[]}
                    labelKey="method"
                    valueKey="gap_count"
                    colorFn={r => METHOD_COLORS[r.method] ?? '#8d8d8d'}
                    maxValue={methMax}
                  />
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {data.methodBreakdown.map(r => (
                      <div key={r.method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#525252' }}>
                        <span>{METHOD_LABELS[r.method] ?? r.method}</span>
                        <span style={{ fontWeight: 600, color: '#161616' }}>{Math.round(Number(r.avg_confidence) * 100)}% conf.</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Daily trend */}
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '1.25rem 1.5rem' }}>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#161616', margin: '0 0 1rem' }}>Daily Gap Volume (14 days)</h2>
                  <Sparkline rows={data.dailyTrend} />
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 160, overflowY: 'auto' }}>
                    {[...data.dailyTrend].reverse().map(r => (
                      <div key={r.day} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', color: '#525252', borderBottom: '1px solid #f4f4f4', padding: '0.2rem 0' }}>
                        <span style={{ fontFamily: 'monospace', color: '#161616' }}>{r.day}</span>
                        <span><strong style={{ color: '#0f62fe' }}>{fmtN(r.gap_count)}</strong> gaps</span>
                        <span><strong>{fmtN(r.journey_count)}</strong> journeys</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Row 3: Top Schedules + Top Stations ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>

                {/* Top schedules */}
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                  <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e0e0e0' }}>
                    <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#161616', margin: 0 }}>Top Schedules by Gap Count</h2>
                    <p style={{ fontSize: '0.75rem', color: '#525252', margin: '0.2rem 0 0' }}>Train UIDs with the most predicted gaps across all journeys</p>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ background: '#f4f4f4', borderBottom: '1px solid #e0e0e0' }}>
                          {['Train UID', 'Gaps', 'Journeys', 'Max missed', 'Avg delay', 'Severity'].map(h => (
                            <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.topSchedules.map((r, i) => (
                          <tr key={r.train_uid} style={{ borderBottom: '1px solid #f4f4f4', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'monospace', fontWeight: 700, color: '#0f62fe' }}>
                              <Link href={`/delayed-trains`} style={{ color: '#0f62fe', textDecoration: 'none' }}>
                                {r.train_uid}
                              </Link>
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem', fontWeight: 700, color: '#161616' }}>{fmtN(r.gap_count)}</td>
                            <td style={{ padding: '0.55rem 0.875rem', color: '#525252' }}>{fmtN(r.journey_count)}</td>
                            <td style={{ padding: '0.55rem 0.875rem', color: '#525252' }}>{r.max_missed_stops}</td>
                            <td style={{ padding: '0.55rem 0.875rem', color: '#525252', fontFamily: 'monospace' }}>
                              {Number(r.avg_delay_min) > 0 ? `+${r.avg_delay_min} min` : '—'}
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <span style={{ background: SEV_COLORS[r.worst_severity]?.bg ?? '#e0e0e0', color: SEV_COLORS[r.worst_severity]?.text ?? '#525252', padding: '0.1rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700 }}>
                                {r.worst_severity}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top stations */}
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                  <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e0e0e0' }}>
                    <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#161616', margin: 0 }}>Top Gap Locations</h2>
                    <p style={{ fontSize: '0.75rem', color: '#525252', margin: '0.2rem 0 0' }}>Stations/junctions appearing most frequently as missed reporting points</p>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ background: '#f4f4f4', borderBottom: '1px solid #e0e0e0' }}>
                          {['Station / Junction', 'Gaps', 'Trains', 'Avg delay', 'Severity'].map(h => (
                            <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.topStations.map((r, i) => (
                          <tr key={r.station_name} style={{ borderBottom: '1px solid #f4f4f4', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '0.55rem 0.875rem', fontWeight: 600, color: '#161616', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.station_name}
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem', fontWeight: 700, color: '#161616' }}>{fmtN(r.gap_count)}</td>
                            <td style={{ padding: '0.55rem 0.875rem', color: '#525252' }}>{fmtN(r.affected_trains)}</td>
                            <td style={{ padding: '0.55rem 0.875rem', color: '#525252', fontFamily: 'monospace' }}>
                              {Number(r.avg_delay_min) > 0 ? `+${r.avg_delay_min} min` : '—'}
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <span style={{ background: SEV_COLORS[r.worst_severity]?.bg ?? '#e0e0e0', color: SEV_COLORS[r.worst_severity]?.text ?? '#525252', padding: '0.1rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700 }}>
                                {r.worst_severity}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* ── Most delayed journeys ── */}
              <div style={{ background: '#fff', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e0e0e0' }}>
                  <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#161616', margin: 0 }}>Journeys with Greatest Gap-Attributed Delay</h2>
                  <p style={{ fontSize: '0.75rem', color: '#525252', margin: '0.2rem 0 0' }}>
                    Journeys where predicted infill gaps add up to the most accumulated delay minutes
                  </p>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#f4f4f4', borderBottom: '1px solid #e0e0e0' }}>
                        {['Train UID', 'Train ID', 'Date', 'Gaps', 'Total delay', 'Max single gap', 'Severity', 'Approval', '', ''].map(h => (
                          <th key={h} style={{ padding: '0.6rem 0.875rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.mostDelayed.map((r, i) => {
                        const sev = SEV_COLORS[r.severity] ?? SEV_COLORS.UNKNOWN;
                        const appBg = r.approval_status === 'APPROVED' ? '#a7f0ba' : r.approval_status === 'REJECTED' ? '#ffd7d9' : '#d0e2ff';
                        const appTx = r.approval_status === 'APPROVED' ? '#0e6027' : r.approval_status === 'REJECTED' ? '#750e13' : '#0043ce';
                        const url   = rttUrl(r.train_uid, r.schedule_start_date);
                        return (
                          <tr key={`${r.train_id}-${r.schedule_start_date}`} style={{ borderBottom: '1px solid #f4f4f4', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f62fe', fontSize: '0.8rem' }}>{r.train_uid || '—'}</div>
                              {url && (
                                <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.68rem', color: '#0f62fe', textDecoration: 'none' }}>
                                  Realtime Trains ↗
                                </a>
                              )}
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'monospace', color: '#161616', fontSize: '0.78rem' }}>
                              <Link href={`/trains/${r.train_id}`} style={{ color: '#161616', textDecoration: 'none' }}>
                                {r.train_id}
                              </Link>
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem', color: '#525252', whiteSpace: 'nowrap' }}>{r.schedule_start_date || '—'}</td>
                            <td style={{ padding: '0.55rem 0.875rem', fontWeight: 700, color: '#161616' }}>{fmtN(r.gap_count)}</td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#da1e28', fontSize: '0.85rem' }}>
                                {fmtDelayHrs(r.total_delay_min)}
                              </span>
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'monospace', color: '#525252' }}>
                              +{r.max_delay_min} min
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <span style={{ background: sev.bg, color: sev.text, padding: '0.1rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700 }}>
                                {r.severity}
                              </span>
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <span style={{ background: appBg, color: appTx, padding: '0.1rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', fontWeight: 700 }}>
                                {r.approval_status}
                              </span>
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <Link href={`/trains/${r.train_id}`} style={{ color: '#0f62fe', textDecoration: 'none', fontWeight: 500, fontSize: '0.78rem' }}>
                                View
                              </Link>
                            </td>
                            <td style={{ padding: '0.55rem 0.875rem' }}>
                              <button
                                onClick={() => downloadJourney(r.train_id, r.schedule_start_date)}
                                disabled={downloading === r.train_id}
                                title="Download full journey JSON including all stops and predicted corrections"
                                style={{
                                  padding: '0.2rem 0.55rem',
                                  fontSize: '0.72rem',
                                  fontWeight: 600,
                                  background: downloading === r.train_id ? '#e0e0e0' : '#fff',
                                  color: downloading === r.train_id ? '#8d8d8d' : '#161616',
                                  border: '1px solid #8d8d8d',
                                  borderRadius: 3,
                                  cursor: downloading === r.train_id ? 'wait' : 'pointer',
                                  whiteSpace: 'nowrap',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                }}
                              >
                                {downloading === r.train_id ? '…' : '↓ JSON'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </>
          )}
        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        code { font-family: 'IBM Plex Mono', monospace; font-size: 0.8em; background: #e0e0e0; padding: 1px 4px; border-radius: 2px; }
      `}</style>
    </>
  );
}
