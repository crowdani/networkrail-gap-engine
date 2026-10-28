'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Close, Checkmark, Search, Renew, ChevronDown, ChevronUp } from '@carbon/icons-react';
import PageRefreshCountdown from '@/components/PageRefreshCountdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Prediction {
  id: string;
  train_id: string;
  station_index: number;
  station_name: string;
  crs: string;
  tiploc: string;
  stanox: string;
  scheduled_time: string | null;
  actual_time: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_confidence: number | null;
  prediction_method: string | null;
  prediction_basis: Record<string, unknown> | null;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  received_at: string | null;
}

interface JourneyRow {
  train_id: string;
  train_uid: string;
  schedule_start_date: string | null;
  severity: string | null;
  total_scheduled_stops: number | null;
  found_stops_count: number | null;
  missed_stops_count: number | null;
  received_at: string | null;
  prediction_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  predictions: Prediction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceLabel(v: number | null | undefined): 'High' | 'Medium' | 'Low' {
  if (v == null) return 'Low';
  if (v >= 0.8)  return 'High';
  if (v >= 0.6)  return 'Medium';
  return 'Low';
}

function confidenceStyle(label: string) {
  switch (label) {
    case 'High':   return { background: '#a7f0ba', color: '#0e6027' };
    case 'Medium': return { background: '#ffd6a0', color: '#8a3800' };
    default:       return { background: '#ffd7d9', color: '#750e13' };
  }
}

function severityStyle(s: string | null) {
  switch ((s ?? '').toUpperCase()) {
    case 'CRITICAL': return { background: '#ffd7d9', color: '#750e13' };
    case 'HIGH':     return { background: '#ffd6a0', color: '#8a3800' };
    case 'MEDIUM':   return { background: '#d0e2ff', color: '#0043ce' };
    default:         return { background: '#e0e0e0', color: '#525252' };
  }
}

function approvalStyle(s: string) {
  switch (s) {
    case 'APPROVED': return { background: '#a7f0ba', color: '#0e6027' };
    case 'REJECTED': return { background: '#ffd7d9', color: '#750e13' };
    default:         return { background: '#d0e2ff', color: '#0043ce' };
  }
}

function formatRelative(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

const REFRESH_MS = 60_000;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GapView() {
  const [journeys, setJourneys]         = useState<JourneyRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const pageSize                        = 20;

  // Filters
  const [searchTrain, setSearchTrain]   = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  // Detail drawer
  const [expanded, setExpanded]         = useState<string | null>(null);

  // Inline approval
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast]               = useState<{ msg: string; ok: boolean } | null>(null);

  // Reset confirm
  const [resetOpen, setResetOpen]       = useState(false);
  const [resetting, setResetting]       = useState(false);

  const fetchJourneys = useCallback(async (pg = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        page: String(pg),
        pageSize: String(pageSize),
      });
      if (searchTrain) params.set('search', searchTrain);
      if (severityFilter !== 'all') params.set('severity', severityFilter);
      const res = await fetch(`/api/predicted-gaps?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setJourneys(data.journeys ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, severityFilter, searchTrain]);

  useEffect(() => { fetchJourneys(page); }, [fetchJourneys]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Approve / Reject a single prediction ──────────────────────────────────
  const handleAction = async (pred: Prediction, action: 'APPROVE' | 'REJECT') => {
    const key = `${pred.train_id}-${pred.station_index}-${pred.id}`;
    setActionLoading(key);
    try {
      const res = await fetch(`/api/predicted-gaps/${encodeURIComponent(pred.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast(`Gap ${action.toLowerCase()}d`, true);
      await fetchJourneys(page);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Data reset ────────────────────────────────────────────────────────────
  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/admin/reset-data', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      showToast('Pipeline data cleared — only new data will flow in', true);
      setResetOpen(false);
      setPage(1);
      await fetchJourneys(1);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setResetting(false);
    }
  };

  // ── Stats derived from loaded page ────────────────────────────────────────
  const totalPreds   = journeys.reduce((a, j) => a + Number(j.prediction_count), 0);
  const pendingPreds = journeys.reduce((a, j) => a + Number(j.pending_count), 0);
  const highConf     = journeys.flatMap(j => j.predictions)
    .filter(p => confidenceLabel(p.prediction_confidence) === 'High').length;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px' }}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
          background: toast.ok ? '#24a148' : '#da1e28', color: '#fff',
          padding: '0.75rem 1.25rem', borderRadius: 4, fontSize: '0.875rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          {toast.ok ? <Checkmark size={16} /> : <Close size={16} />}
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: '#161616' }}>Gap Dashboard</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#6f6f6f' }}>
            Predicted gaps from <code style={{ background: '#f4f4f4', padding: '1px 4px', borderRadius: 3 }}>predicted_gaps</code>
            {' '}· {total.toLocaleString()} journeys with gaps
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <PageRefreshCountdown refreshInterval={REFRESH_MS} onRefresh={() => fetchJourneys(page)} isPaused={!!expanded} />
          <button
            onClick={() => fetchJourneys(page)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.9rem', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Renew size={16} /> Refresh
          </button>
          <button
            onClick={() => setResetOpen(true)}
            style={{ padding: '0.5rem 0.9rem', background: '#fff', color: '#da1e28', border: '1px solid #da1e28', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            Reset Data
          </button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Journeys', value: total.toLocaleString(), sub: 'with gaps detected' },
          { label: 'Predictions (page)', value: totalPreds.toLocaleString(), sub: 'gap predictions loaded' },
          { label: 'Pending', value: pendingPreds.toLocaleString(), sub: 'awaiting approval', accent: '#0043ce', accentBg: '#d0e2ff' },
          { label: 'High Confidence', value: highConf.toLocaleString(), sub: '≥80% confidence', accent: '#0e6027', accentBg: '#a7f0ba' },
        ].map(c => (
          <div key={c.label} style={{ background: c.accentBg ?? '#f4f4f4', border: '1px solid #e0e0e0', borderRadius: 4, padding: '1rem' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 300, color: c.accent ?? '#161616', lineHeight: 1.2 }}>{loading ? '…' : c.value}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: c.accent ?? '#161616' }}>{c.label}</div>
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#6f6f6f', pointerEvents: 'none' }} />
          <input
            value={searchTrain}
            onChange={e => { setSearchTrain(e.target.value); setPage(1); }}
            placeholder="Search train ID or UID…"
            style={{ width: '100%', paddingLeft: '2.1rem', padding: '0.5rem 0.75rem 0.5rem 2.1rem', border: '1px solid #e0e0e0', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#525252' }}>Status:</span>
          {['all', 'PENDING', 'APPROVED', 'REJECTED'].map(s => (
            <button key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              style={{ padding: '0.4rem 0.75rem', border: `1px solid ${statusFilter === s ? '#0f62fe' : '#e0e0e0'}`, borderRadius: 4, background: statusFilter === s ? '#e8f4ff' : '#fff', color: statusFilter === s ? '#0f62fe' : '#525252', fontSize: '0.75rem', fontWeight: statusFilter === s ? 600 : 400, cursor: 'pointer' }}
            >{s === 'all' ? 'All' : s}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#525252' }}>Severity:</span>
          {['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => (
            <button key={s}
              onClick={() => { setSeverityFilter(s); setPage(1); }}
              style={{ padding: '0.4rem 0.75rem', border: `1px solid ${severityFilter === s ? '#0f62fe' : '#e0e0e0'}`, borderRadius: 4, background: severityFilter === s ? '#e8f4ff' : '#fff', color: severityFilter === s ? '#0f62fe' : '#525252', fontSize: '0.75rem', fontWeight: severityFilter === s ? 600 : 400, cursor: 'pointer' }}
            >{s === 'all' ? 'All' : s}</button>
          ))}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#ffd7d9', border: '1px solid #fa4d56', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#750e13', fontSize: '0.875rem' }}>
          Error: {error}
        </div>
      )}

      {/* ── Table ── */}
      {loading && journeys.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>Loading gaps…</div>
      ) : journeys.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6f6f6f', fontSize: '0.875rem' }}>
          No gaps found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f4f4f4', borderBottom: '2px solid #e0e0e0' }}>
                {['', 'Train ID', 'UID', 'Date', 'Severity', 'Stops', 'Gaps', 'Pending', 'Top Confidence', 'Detected', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#161616', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journeys.map((j, i) => {
                const key = `${j.train_id}-${j.schedule_start_date ?? i}`;
                const isExpanded = expanded === key;
                const topConf = j.predictions.length > 0
                  ? Math.max(...j.predictions.map(p => p.prediction_confidence ?? 0))
                  : null;
                const confLabel = confidenceLabel(topConf);

                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : key)}
                      style={{ borderBottom: isExpanded ? 'none' : '1px solid #f4f4f4', background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', fontWeight: 600, color: '#161616' }}>{j.train_id}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{j.train_uid ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252' }}>{j.schedule_start_date ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.75rem' }}>
                        <span style={{ ...severityStyle(j.severity), padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
                          {j.severity ?? 'UNKNOWN'}
                        </span>
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#525252', textAlign: 'center' }}>
                        {j.found_stops_count ?? '?'}/{j.total_scheduled_stops ?? '?'}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center', fontWeight: 600, color: '#da1e28' }}>
                        {j.missed_stops_count ?? j.prediction_count}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center' }}>
                        {j.pending_count > 0 && (
                          <span style={{ background: '#d0e2ff', color: '#0043ce', padding: '2px 6px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
                            {j.pending_count}
                          </span>
                        )}
                        {j.pending_count === 0 && <span style={{ color: '#6f6f6f' }}>—</span>}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem' }}>
                        <span style={{ ...confidenceStyle(confLabel), padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
                          {confLabel}{topConf != null ? ` (${Math.round(topConf * 100)}%)` : ''}
                        </span>
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#6f6f6f', whiteSpace: 'nowrap' }}>
                        {formatRelative(j.received_at)}
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem' }}>
                        <a
                          href={`/approvals?train=${encodeURIComponent(j.train_id)}`}
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: '0.75rem', color: '#0f62fe', textDecoration: 'none' }}
                        >
                          Review →
                        </a>
                      </td>
                    </tr>

                    {/* ── Expanded prediction rows ── */}
                    {isExpanded && (
                      <tr style={{ background: '#f7f8fa', borderBottom: '2px solid #e0e0e0' }}>
                        <td colSpan={11} style={{ padding: '0.75rem 1rem' }}>
                          {j.predictions.length === 0 ? (
                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#6f6f6f' }}>No prediction detail available.</p>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                                  {['Station', 'CRS', 'STANOX', 'Scheduled', 'Actual', 'Predicted', 'Delay', 'Confidence', 'Method', 'Status', ''].map(h => (
                                    <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, color: '#525252', whiteSpace: 'nowrap' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {j.predictions.map(p => {
                                  const cl = confidenceLabel(p.prediction_confidence);
                                  const actionKey = `${p.train_id}-${p.station_index}-${p.id}`;
                                  const busy = actionLoading === actionKey;
                                  return (
                                    <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 500, color: '#161616' }}>{p.station_name}</td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: '#525252' }}>{p.crs || '—'}</td>
                                      <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', color: '#525252' }}>{p.stanox}</td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: '#525252' }}>{p.scheduled_time ?? '—'}</td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: p.actual_time ? '#0e6027' : '#6f6f6f' }}>{p.actual_time ?? '—'}</td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: '#da1e28', fontWeight: 500 }}>{p.predicted_time ?? '—'}</td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: p.predicted_delay_minutes != null && p.predicted_delay_minutes > 0 ? '#da1e28' : '#6f6f6f' }}>
                                        {p.predicted_delay_minutes != null ? `${p.predicted_delay_minutes > 0 ? '+' : ''}${p.predicted_delay_minutes}m` : '—'}
                                      </td>
                                      <td style={{ padding: '0.4rem 0.6rem' }}>
                                        <span style={{ ...confidenceStyle(cl), padding: '1px 6px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 }}>
                                          {cl}{p.prediction_confidence != null ? ` ${Math.round(p.prediction_confidence * 100)}%` : ''}
                                        </span>
                                      </td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: '#525252' }}>{p.prediction_method ?? '—'}</td>
                                      <td style={{ padding: '0.4rem 0.6rem' }}>
                                        <span style={{ ...approvalStyle(p.approval_status), padding: '1px 6px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 }}>
                                          {p.approval_status}
                                        </span>
                                      </td>
                                      <td style={{ padding: '0.4rem 0.6rem', whiteSpace: 'nowrap' }}>
                                        {p.approval_status === 'PENDING' && (
                                          <span style={{ display: 'flex', gap: '0.4rem' }}>
                                            <button
                                              disabled={busy}
                                              onClick={() => handleAction(p, 'APPROVE')}
                                              style={{ padding: '2px 8px', background: '#24a148', color: '#fff', border: 'none', borderRadius: 3, fontSize: '0.7rem', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                                            >✓</button>
                                            <button
                                              disabled={busy}
                                              onClick={() => handleAction(p, 'REJECT')}
                                              style={{ padding: '2px 8px', background: '#da1e28', color: '#fff', border: 'none', borderRadius: 3, fontSize: '0.7rem', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                                            >✗</button>
                                          </span>
                                        )}
                                        {p.approval_status !== 'PENDING' && (
                                          <span style={{ fontSize: '0.7rem', color: '#6f6f6f' }}>
                                            {p.approved_by ? `by ${p.approved_by}` : '—'}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
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

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', justifyContent: 'center' }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{ padding: '0.4rem 0.75rem', border: '1px solid #e0e0e0', borderRadius: 4, background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? '#c6c6c6' : '#161616', fontSize: '0.8rem' }}
          >← Prev</button>
          <span style={{ fontSize: '0.8rem', color: '#525252' }}>Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            style={{ padding: '0.4rem 0.75rem', border: '1px solid #e0e0e0', borderRadius: 4, background: '#fff', cursor: page >= totalPages ? 'not-allowed' : 'pointer', color: page >= totalPages ? '#c6c6c6' : '#161616', fontSize: '0.8rem' }}
          >Next →</button>
        </div>
      )}

      <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#6f6f6f' }}>
        Showing {journeys.length} of {total} journeys with gaps · Auto-refreshes every 60s
      </p>

      {/* ── Reset Confirm Modal ── */}
      {resetOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 6, padding: '2rem', maxWidth: 480, width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.2rem', fontWeight: 600, color: '#da1e28' }}>⚠ Reset Pipeline Data</h2>
            <p style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '1rem', lineHeight: 1.5 }}>
              This will <strong>truncate</strong> the <code>predicted_gaps</code> and <code>journey_stations</code> tables.
              All gap predictions and journey station records will be permanently deleted.
              New data will start flowing in immediately from the Confluent pipeline.
            </p>
            <p style={{ fontSize: '0.875rem', color: '#da1e28', fontWeight: 600, marginBottom: '1.5rem' }}>
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                disabled={resetting}
                onClick={() => setResetOpen(false)}
                style={{ padding: '0.6rem 1.25rem', border: '1px solid #e0e0e0', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}
              >Cancel</button>
              <button
                disabled={resetting}
                onClick={handleReset}
                style={{ padding: '0.6rem 1.25rem', border: 'none', borderRadius: 4, background: '#da1e28', color: '#fff', cursor: resetting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', opacity: resetting ? 0.6 : 1 }}
              >{resetting ? 'Resetting…' : 'Yes, Reset All Data'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
