'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Close, Checkmark, Warning, Reset, Information } from '@carbon/icons-react';
import PageRefreshCountdown from '@/components/PageRefreshCountdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Prediction {
  id: number;
  train_id: string;
  station_index: number;
  station_name: string | null;
  crs: string | null;
  tiploc: string | null;
  stanox: string | null;
  scheduled_time: string | null;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
  actual_time: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  predicted_arrival: string | null;
  predicted_departure: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_confidence: number | null;
  prediction_method: string | null;
  prediction_basis: Record<string, unknown> | null;
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approved_time: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  received_at: string;
}

interface Journey {
  train_id: string;
  train_uid: string;
  schedule_start_date: string | null;
  severity: string;
  total_scheduled_stops: number | null;
  found_stops_count: number | null;
  missed_stops_count: number | null;
  received_at: string;
  prediction_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  predictions: Prediction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceLabel(c: number | null): 'High' | 'Medium' | 'Low' {
  if (c === null) return 'Low';
  if (c >= 0.8) return 'High';
  if (c >= 0.6) return 'Medium';
  return 'Low';
}

function confidenceColor(c: number | null) {
  const label = confidenceLabel(c);
  if (label === 'High')   return { bg: '#a7f0ba', text: '#0e6027' };
  if (label === 'Medium') return { bg: '#ffd6a0', text: '#8a3800' };
  return { bg: '#ffd7d9', text: '#750e13' };
}

function severityColor(s: string) {
  switch (s?.toUpperCase()) {
    case 'HIGH':   return { bg: '#ffd7d9', text: '#750e13' };
    case 'MEDIUM': return { bg: '#ffd6a0', text: '#8a3800' };
    case 'LOW':    return { bg: '#d0e2ff', text: '#0043ce' };
    default:       return { bg: '#e0e0e0', text: '#161616' };
  }
}

function methodLabel(m: string | null) {
  if (!m) return null;
  const map: Record<string, string> = {
    LINEAR_INTERPOLATION:           'Linear interpolation',
    SINGLE_STATION_EXTRAPOLATION:   'Single-station extrapolation',
    SCHEDULE_ONLY:                  'Schedule only',
    ON_TIME_INTERPOLATION:          'On-time interpolation',
  };
  return map[m] ?? m.replace(/_/g, ' ').toLowerCase();
}

function formatRelative(ts: string | null) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (diff < 1)    return 'just now';
  if (diff < 60)   return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stationLabel(p: Prediction) {
  const name = p.station_name?.trim() || null;
  const crs  = p.crs?.trim() || null;
  return name ? (crs ? `${name} (${crs})` : name) : (p.tiploc ?? p.stanox ?? '—');
}

const IBM_FONT = 'IBM Plex Sans, system-ui, -apple-system, sans-serif';

// ---------------------------------------------------------------------------
// Event pills — mirrors Delayed Trains page
// ---------------------------------------------------------------------------
const EVENT_PILL_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  ACTIVATED:    { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe' },
  ARR:          { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  DEP:          { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
  TERMINATED:   { bg: '#fff1f1', color: '#750e13', border: '#ffb3b8' },
  CANCELLATION: { bg: '#ffd7d9', color: '#750e13', border: '#ff8389' },
};

/** Derive the ordered list of event pill labels for a stop row. */
function resolveEventPills(
  event: string | null,
  actualArrival: string | null,
  actualDeparture: string | null,
): string[] {
  const pills: string[] = [];
  const ev = (event ?? '').toUpperCase();

  // ACTIVATED — shown when the train activation event was recorded here
  if (ev.includes('ACTIVATED')) pills.push('ACTIVATED');

  // ARR / DEP — derive from actual times (most reliable) or event string
  if (actualArrival)                            pills.push('ARR');
  else if (ev.includes('ARR'))                  pills.push('ARR');

  if (actualDeparture)                          pills.push('DEP');
  else if (ev.includes('DEP') || ev.includes('DEPARTURE')) pills.push('DEP');

  // TERMINATED / CANCELLATION — only come from the event string
  if (ev.includes('TERMINAT'))                  pills.push('TERMINATED');
  if (ev.includes('CANCEL'))                    pills.push('CANCELLATION');

  return pills;
}

function StopEventPills({ stop }: { stop: FullStop }) {
  const pills = resolveEventPills(stop.event, stop.actual_arrival, stop.actual_departure);
  if (pills.length === 0) return <span style={{ fontSize: '0.7rem', color: '#c6c6c6' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
      {pills.map(p => {
        const s = EVENT_PILL_STYLE[p] ?? { bg: '#e0e0e0', color: '#525252', border: '#c6c6c6' };
        return (
          <span key={p} style={{
            display: 'inline-block',
            padding: '0.15rem 0.4rem',
            borderRadius: '4px',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            background: s.bg,
            color: s.color,
            border: `1px solid ${s.border}`,
          }}>
            {p}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------
function StatusPill({ status }: { status: Prediction['approval_status'] }) {
  const styles: Record<Prediction['approval_status'], React.CSSProperties> = {
    PENDING:  { background: '#d0e2ff', color: '#0043ce' },
    APPROVED: { background: '#a7f0ba', color: '#0e6027' },
    REJECTED: { background: '#ffd7d9', color: '#750e13' },
  };
  return (
    <span style={{ ...styles[status], display: 'inline-block', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '12px', fontFamily: IBM_FONT }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Time row used inside the detail modal
// ---------------------------------------------------------------------------
function TimeRow({ label, value, color, note }: { label: string; value: string | null; color?: string; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', padding: '0.625rem 0', borderBottom: '1px solid #e8e8e8' }}>
      <span style={{ minWidth: '140px', fontSize: '0.8rem', color: '#525252', fontFamily: IBM_FONT }}>{label}</span>
      <span style={{ fontSize: '1rem', fontWeight: 600, color: color ?? '#161616', fontFamily: 'IBM Plex Mono, monospace' }}>
        {value ?? <span style={{ color: '#8d8d8d', fontStyle: 'italic', fontWeight: 400, fontFamily: IBM_FONT }}>not recorded</span>}
      </span>
      {note && <span style={{ fontSize: '0.75rem', color: '#6f6f6f', fontFamily: IBM_FONT }}>— {note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prediction detail modal (Carbon-style)
// ---------------------------------------------------------------------------
function PredictionModal({
  prediction,
  onClose,
  onApprove,
  onAmend,
  onReject,
  onReset,
}: {
  prediction: Prediction | null;
  onClose: () => void;
  onApprove: (id: number) => void;
  onAmend: (id: number, current: string | null) => void;
  onReject: (id: number) => void;
  onReset: (id: number) => void;
}) {
  if (!prediction) return null;

  const p = prediction;
  const conf = confidenceColor(p.prediction_confidence);
  const isPending = p.approval_status === 'PENDING';
  const basis = p.prediction_basis;

  // Determine the final approved / display time
  const finalTime = p.approval_status === 'APPROVED' && p.approved_time
    ? p.approved_time
    : p.predicted_time;

  // Delay colour
  const delayColor = p.predicted_delay_minutes !== null && p.predicted_delay_minutes > 0
    ? '#da1e28'
    : p.predicted_delay_minutes !== null && p.predicted_delay_minutes < 0
      ? '#0e6027'
      : '#525252';

  return (
    /* Overlay */
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onClose}
    >
      {/* Modal container */}
      <div
        style={{ background: '#ffffff', width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Modal header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', background: '#f4f4f4' }}>
          <div>
            <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#161616' }}>
              Stop {p.station_index} · {stationLabel(p)}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#525252', marginTop: '0.2rem' }}>
              STANOX {p.stanox ?? '—'} · TIPLOC {p.tiploc ?? '—'}{p.crs ? ` · CRS ${p.crs}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center', color: '#525252' }}
            aria-label="Close"
          >
            <Close size={20} />
          </button>
        </div>

        {/* ── Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>

          {/* Status row */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem' }}>
            <StatusPill status={p.approval_status} />
            {p.approval_status === 'REJECTED' && p.rejection_reason && (
              <span style={{ fontSize: '0.8rem', color: '#750e13' }}>{p.rejection_reason}</span>
            )}
            {p.approval_status === 'APPROVED' && p.approved_by && (
              <span style={{ fontSize: '0.8rem', color: '#0e6027' }}>by {p.approved_by}</span>
            )}
          </div>

          {/* ── Times section */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>
              Time Comparison
            </div>
            <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.5rem 1rem' }}>
              {/* Scheduled — show arrival/departure separately when available */}
              {(p.scheduled_arrival || p.scheduled_departure) ? (
                <>
                  <TimeRow label="Sched Arrival"   value={p.scheduled_arrival}   color="#161616" />
                  <TimeRow label="Sched Departure"  value={p.scheduled_departure} color="#161616" />
                </>
              ) : (
                <TimeRow label="Scheduled" value={p.scheduled_time} color="#161616" />
              )}
              {/* Actual — show arrival/departure separately when available */}
              {(p.actual_arrival || p.actual_departure) ? (
                <>
                  <TimeRow
                    label="Act Arrival"
                    value={p.actual_arrival}
                    color={p.actual_arrival ? '#0e6027' : undefined}
                    note={p.actual_arrival ? 'recorded ARR' : undefined}
                  />
                  <TimeRow
                    label="Act Departure"
                    value={p.actual_departure}
                    color={p.actual_departure ? '#0e6027' : undefined}
                    note={p.actual_departure ? 'recorded DEP' : undefined}
                  />
                </>
              ) : (
                <TimeRow
                  label="Actual (captured)"
                  value={p.actual_time}
                  color={p.actual_time ? '#0e6027' : undefined}
                  note={p.actual_time ? 'recorded movement' : undefined}
                />
              )}
              {(p.predicted_arrival || p.predicted_departure) ? (
                <>
                  <TimeRow label="Pred Arrival"   value={p.predicted_arrival}   color="#0f62fe" note={p.predicted_arrival   ? methodLabel(p.prediction_method) ?? undefined : undefined} />
                  <TimeRow label="Pred Departure" value={p.predicted_departure} color="#7c3aed" note={p.predicted_departure ? methodLabel(p.prediction_method) ?? undefined : undefined} />
                </>
              ) : (
                <TimeRow label="Predicted (infill)" value={p.predicted_time} color="#0f62fe" note={methodLabel(p.prediction_method) ?? undefined} />
              )}
              {p.approval_status === 'APPROVED' && p.approved_time && p.approved_time !== p.predicted_time && (
                <TimeRow label="Approved (amended)" value={p.approved_time} color="#0e6027" note="operator override" />
              )}
              {p.approval_status === 'APPROVED' && (
                <TimeRow label="Final time" value={finalTime} color="#0e6027" />
              )}
            </div>
          </div>

          {/* ── Delay + confidence */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.875rem 1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Predicted delay</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, color: delayColor, fontFamily: 'IBM Plex Mono, monospace' }}>
                {p.predicted_delay_minutes !== null
                  ? `${p.predicted_delay_minutes > 0 ? '+' : ''}${p.predicted_delay_minutes}m`
                  : '—'}
              </div>
            </div>
            <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.875rem 1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Confidence</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 600, color: conf.text, fontFamily: 'IBM Plex Mono, monospace' }}>
                  {p.prediction_confidence !== null ? `${Math.round(p.prediction_confidence * 100)}%` : '—'}
                </span>
                <span style={{ background: conf.bg, color: conf.text, padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '12px' }}>
                  {confidenceLabel(p.prediction_confidence)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Prediction basis */}
          {basis && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>
                Prediction Basis
              </div>
              <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.875rem 1rem', fontSize: '0.8rem', color: '#161616' }}>
                {typeof basis.reasoning === 'string' && basis.reasoning && (
                  <div style={{ marginBottom: '0.5rem' }}>{basis.reasoning}</div>
                )}
                {!!(basis.before || basis.after) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
                    {typeof basis.before === 'object' && basis.before !== null && (() => {
                      const b = basis.before as Record<string, unknown>;
                      return (
                        <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '0.5rem 0.75rem' }}>
                          <div style={{ fontSize: '0.7rem', color: '#525252', marginBottom: '0.2rem' }}>Before station</div>
                          <div style={{ fontWeight: 600 }}>{String(b.station ?? '—')}</div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#0f62fe' }}>{String(b.actual ?? '—')}</div>
                          <div style={{ color: '#525252', fontSize: '0.75rem' }}>delay: {String(b.delay_min ?? '—')}m</div>
                        </div>
                      );
                    })()}
                    {typeof basis.after === 'object' && basis.after !== null && (() => {
                      const a = basis.after as Record<string, unknown>;
                      return (
                        <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '0.5rem 0.75rem' }}>
                          <div style={{ fontSize: '0.7rem', color: '#525252', marginBottom: '0.2rem' }}>After station</div>
                          <div style={{ fontWeight: 600 }}>{String(a.station ?? '—')}</div>
                          <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#0f62fe' }}>{String(a.actual ?? '—')}</div>
                          <div style={{ color: '#525252', fontSize: '0.75rem' }}>delay: {String(a.delay_min ?? '—')}m</div>
                        </div>
                      );
                    })()}
                    {basis.reference != null && (
                      <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '0.5rem 0.75rem' }}>
                        <div style={{ fontSize: '0.7rem', color: '#525252', marginBottom: '0.2rem' }}>Reference station</div>
                        <div style={{ fontWeight: 600 }}>{String(basis.reference)}</div>
                        {basis.ref_actual != null && <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#0f62fe' }}>{String(basis.ref_actual)}</div>}
                        {basis.ref_delay_min != null && <div style={{ color: '#525252', fontSize: '0.75rem' }}>delay: {String(basis.ref_delay_min)}m</div>}
                      </div>
                    )}
                  </div>
                )}
                {basis.weight != null && (
                  <div style={{ marginTop: '0.5rem', color: '#525252', fontSize: '0.75rem' }}>Interpolation weight: {String(basis.weight)}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Modal footer / actions */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e0e0e0', background: '#f4f4f4', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {!isPending && (
            <button
              onClick={() => { onReset(p.id); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Reset size={14} /> Reset to pending
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}
          >
            Close
          </button>
          {isPending && (<>
            <button
              onClick={() => { onReject(p.id); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#da1e28', background: '#fff', border: '1px solid #da1e28', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Close size={14} /> Reject
            </button>
            <button
              onClick={() => { onAmend(p.id, p.predicted_time); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}
            >
              Amend time
            </button>
            <button
              onClick={() => { onApprove(p.id); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: '#0f62fe', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Checkmark size={14} /> Accept
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface FullStop {
  id: string | null;
  station_index: number;
  station_name: string;
  crs: string;
  stanox: string;
  status: 'VISITED' | 'MISSED' | 'UNKNOWN';
  scheduled_time: string | null;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
  actual_time: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  event: string | null;
  predicted_arrival: string | null;
  predicted_departure: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_confidence: number | null;
  prediction_method: string | null;
  prediction_basis: Record<string, unknown> | null;
  approval_status: string | null;
  approved_time: string | null;
}

interface JourneyStops {
  stops: FullStop[];
  source: 'journey_stations' | 'predicted_gaps_merge' | null;
}

export default function ApprovalsPage() {
  const [journeys,       setJourneys]       = useState<Journey[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [statusFilter,   setStatusFilter]   = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'all'>('PENDING');
  const [page,           setPage]           = useState(1);
  const [total,          setTotal]          = useState(0);
  const [pageSize]                          = useState(20);
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set());
  const [journeyStops,   setJourneyStops]   = useState<Map<string, JourneyStops>>(new Map());

  // Modal
  const [modalPred,      setModalPred]      = useState<Prediction | null>(null);

  // Amend modal
  const [amendModal,     setAmendModal]     = useState<{ id: number; current: string | null } | null>(null);
  const [amendTime,      setAmendTime]      = useState('');

  // Reject modal
  const [rejectModal,    setRejectModal]    = useState<{ id: number } | null>(null);
  const [rejectReason,   setRejectReason]   = useState('');

  const [successMsg,     setSuccessMsg]     = useState<string | null>(null);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });

  const fetchJourneys = useCallback(async () => {
    try {
      const res = await fetch(`/api/predicted-gaps?status=${statusFilter}&page=${page}&pageSize=${pageSize}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setJourneys(data.journeys ?? []);
      setTotal(data.total ?? 0);

      const [pRes, aRes, rRes] = await Promise.all([
        fetch('/api/predicted-gaps?status=PENDING&pageSize=1'),
        fetch('/api/predicted-gaps?status=APPROVED&pageSize=1'),
        fetch('/api/predicted-gaps?status=REJECTED&pageSize=1'),
      ]);
      const [pd, ad, rd] = await Promise.all([pRes.json(), aRes.json(), rRes.json()]);
      setStats({ total: (pd.total ?? 0) + (ad.total ?? 0) + (rd.total ?? 0), pending: pd.total ?? 0, approved: ad.total ?? 0, rejected: rd.total ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, pageSize]);

  useEffect(() => { setLoading(true); fetchJourneys(); }, [fetchJourneys]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const approve = async (id: number, approvedTime?: string) => {
    try {
      const res = await fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', approved_time: approvedTime ?? undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      flash('success', '✓ Prediction approved');
      await fetchJourneys();
    } catch (err) {
      flash('error', 'Failed to approve: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const reject = async (id: number, reason: string) => {
    try {
      const res = await fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      flash('success', '✓ Prediction rejected');
      await fetchJourneys();
    } catch (err) {
      flash('error', 'Failed to reject: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const approveAll = async (journey: Journey) => {
    const key = `${journey.train_id}|${journey.schedule_start_date ?? ''}`;
    // Use journeyStops MISSED rows if available (they have the composite id), otherwise fall back to journey.predictions
    const js = journeyStops.get(key);
    const pendingIds: string[] = js
      ? js.stops.filter(s => s.status === 'MISSED' && s.approval_status === 'PENDING' && s.id).map(s => s.id!)
      : journey.predictions.filter(p => p.approval_status === 'PENDING').map(p => String(p.id));
    try {
      await Promise.all(pendingIds.map(id => fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })));
      flash('success', `✓ ${pendingIds.length} prediction(s) approved`);
      await fetchJourneys();
    } catch { flash('error', 'Bulk approve failed'); }
  };

  const resetPrediction = async (id: number) => {
    await fetch(`/api/predicted-gaps/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) });
    flash('success', 'Reset to pending');
    fetchJourneys();
  };

  const flash = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); }
    else                    { setErrorMsg(msg);   setTimeout(() => setErrorMsg(null),   5000); }
  };

  const toggleExpand = (journey: Journey) => {
    const key = `${journey.train_id}|${journey.schedule_start_date ?? ''}`;
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(key)) {
        n.delete(key);
      } else {
        n.add(key);
        // Fetch full journey stop timeline if not already loaded
        if (!journeyStops.has(key)) {
          const params = new URLSearchParams();
          if (journey.schedule_start_date) params.set('scheduleStartDate', journey.schedule_start_date);
          fetch(`/api/predicted-gaps/journey/${encodeURIComponent(journey.train_id)}?${params}`)
            .then(r => r.json())
            .then((data: { stops?: FullStop[]; source?: string }) => {
              setJourneyStops(prev2 => new Map(prev2).set(key, {
                stops: data.stops ?? [],
                source: (data.source as JourneyStops['source']) ?? null,
              }));
            })
            .catch(() => {});
        }
      }
      return n;
    });
  };

  const totalPages = Math.ceil(total / pageSize);
  const anyModalOpen = !!modalPred || !!amendModal || !!rejectModal;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={{ background: '#f4f4f4', minHeight: 'calc(100vh - 60px)', fontFamily: IBM_FONT }}>

      {/* ── Page header */}
      <div style={{ padding: '2rem', background: '#ffffff', marginBottom: '1px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h1 style={{ fontSize: '2.625rem', fontWeight: 300, lineHeight: 1.2, color: '#161616', margin: 0, fontFamily: IBM_FONT }}>
            Gap Approvals
          </h1>
          <PageRefreshCountdown refreshInterval={30000} onRefresh={fetchJourneys} isPaused={anyModalOpen} />
        </div>
        <p style={{ fontSize: '0.875rem', color: '#525252', margin: '0 0 1.5rem', fontFamily: IBM_FONT }}>
          Review and approve predicted infill times sinked from <code>NR_JOURNEY_GAPS_PREDICTED</code>
        </p>

        {/* Flash messages */}
        {successMsg && (
          <div style={{ background: '#24a148', color: '#fff', padding: '0.875rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Checkmark size={16} /> {successMsg}
          </div>
        )}
        {errorMsg && (
          <div style={{ background: '#da1e28', color: '#fff', padding: '0.875rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Warning size={16} /> {errorMsg}
          </div>
        )}

        {/* Stats bar — shows filtered counts when hide-JN is active */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Total Journeys', value: stats.total,    color: '#161616' },
            { label: 'Pending',        value: stats.pending,  color: '#0043ce' },
            { label: 'Approved',       value: stats.approved, color: '#0e6027' },
            { label: 'Rejected',       value: stats.rejected, color: '#750e13' },
          ].map(s => (
            <div key={s.label} style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '1.25rem 1.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>{s.label}</div>
              <div style={{ fontSize: '2rem', fontWeight: 300, color: s.color }}>{loading ? '—' : s.value.toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* Status filter tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e0e0e0' }}>
          {(['PENDING', 'APPROVED', 'REJECTED', 'all'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '0.75rem 1.25rem', fontSize: '0.875rem', fontFamily: IBM_FONT, fontWeight: statusFilter === s ? 600 : 400, color: statusFilter === s ? '#0f62fe' : '#525252', background: 'transparent', border: 'none', borderBottom: statusFilter === s ? '2px solid #0f62fe' : '2px solid transparent', cursor: 'pointer' }}>
              {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div style={{ padding: '3rem', textAlign: 'center', background: '#fff', margin: '0 2rem', fontSize: '0.875rem', color: '#525252' }}>
          Loading predictions…
        </div>
      )}
      {error && (
        <div style={{ margin: '1rem 2rem', padding: '1rem', background: '#fff1f1', border: '1px solid #da1e28', fontSize: '0.875rem', color: '#750e13' }}>{error}</div>
      )}

      {/* ── Journey list */}
      {!loading && !error && (
        <div style={{ margin: '0 2rem 2rem', background: '#ffffff', border: '1px solid #e0e0e0' }}>
          {journeys.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', fontSize: '0.875rem', color: '#525252' }}>
              No {statusFilter === 'all' ? '' : statusFilter.toLowerCase() + ' '}predictions found.
            </div>
          ) : journeys.map(journey => {
            const journeyKey = `${journey.train_id}|${journey.schedule_start_date ?? ''}`;
            const isExpanded = expanded.has(journeyKey);
            const hasPending = journey.pending_count > 0;
            const sev = severityColor(journey.severity);
            const js = journeyStops.get(journeyKey);
            const stops = js?.stops;
            const stopsSource = js?.source ?? null;

            return (
              <div key={journeyKey} style={{ borderBottom: '1px solid #e0e0e0' }}>
                {/* Journey header */}
                <div
                  style={{ padding: '1rem 1.5rem', display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', cursor: 'pointer', background: isExpanded ? '#f4f4f4' : '#ffffff', transition: 'background 0.1s' }}
                  onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#f4f4f4'; }}
                  onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = '#ffffff'; }}
                  onClick={() => toggleExpand(journey)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f62fe' }}>{journey.train_id}</div>
                      <div style={{ fontSize: '0.75rem', color: '#525252', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>UID: {journey.train_uid}{journey.schedule_start_date ? ` · ${journey.schedule_start_date}` : ''}</span>
                        {journey.train_uid && journey.schedule_start_date && /^\d{4}-\d{2}-\d{2}$/.test(journey.schedule_start_date) && (
                          <a
                            href={`https://www.realtimetrains.co.uk/service/gb-nr:${journey.train_uid.trim()}/${journey.schedule_start_date}/detailed`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ color: '#0f62fe', fontSize: '0.72rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', whiteSpace: 'nowrap' }}
                          >
                            Realtime Trains ↗
                          </a>
                        )}
                      </div>
                    </div>
                    <span style={{ background: sev.bg, color: sev.text, padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '12px' }}>{journey.severity ?? '—'}</span>
                    <span style={{ fontSize: '0.75rem', color: '#525252' }}>{journey.missed_stops_count ?? '?'} missed / {journey.total_scheduled_stops ?? '?'} scheduled</span>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {journey.pending_count  > 0 && <span style={{ background: '#d0e2ff', color: '#0043ce', padding: '0.125rem 0.5rem', fontSize: '0.75rem', borderRadius: '12px' }}>{journey.pending_count} pending</span>}
                      {journey.approved_count > 0 && <span style={{ background: '#a7f0ba', color: '#0e6027', padding: '0.125rem 0.5rem', fontSize: '0.75rem', borderRadius: '12px' }}>{journey.approved_count} approved</span>}
                      {journey.rejected_count > 0 && <span style={{ background: '#ffd7d9', color: '#750e13', padding: '0.125rem 0.5rem', fontSize: '0.75rem', borderRadius: '12px' }}>{journey.rejected_count} rejected</span>}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>{formatRelative(journey.received_at)}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }} onClick={e => e.stopPropagation()}>
                    {hasPending && (
                      <button onClick={() => approveAll(journey)} style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', fontFamily: IBM_FONT, color: '#0f62fe', background: 'transparent', border: '1px solid #0f62fe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <Checkmark size={14} /> Approve all
                      </button>
                    )}
                    <span style={{ fontSize: '1rem', color: '#525252', userSelect: 'none', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }} onClick={() => toggleExpand(journey)}>▼</span>
                  </div>
                </div>

                {/* Expanded stop timeline — shows ALL stops (VISITED green + MISSED red) */}
                {isExpanded && (
                  <div style={{ background: '#ffffff', borderTop: '1px solid #e0e0e0', overflowX: 'auto' }}>
                    {!js && (
                      <div style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', color: '#8d8d8d' }}>Loading stop timeline…</div>
                    )}
                    {js && stops!.length === 0 && (
                      <div style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', color: '#8d8d8d' }}>No stop data found for this journey.</div>
                    )}
                    {js && stops!.length > 0 && (() => {
                      const missedCount  = stops!.filter(s => s.status === 'MISSED').length;
                      const visitedCount = stops!.filter(s => s.status === 'VISITED').length;
                      const totalSched   = journey.total_scheduled_stops ?? null;
                      const isFullTimeline = stopsSource === 'journey_stations';
                      return (
                        <>
                          {/* Journey context bar */}
                          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', padding: '0.625rem 1.5rem', background: '#f4f4f4', borderBottom: '1px solid #e0e0e0', fontSize: '0.75rem', color: '#525252', flexWrap: 'wrap' }}>
                            <span><strong style={{ color: '#161616' }}>{totalSched ?? stops!.length}</strong> scheduled stops</span>
                            <span style={{ color: '#0e6027' }}><strong>{visitedCount}</strong> visited (captured)</span>
                            <span style={{ color: '#750e13' }}><strong>{missedCount}</strong> missed (need infill)</span>
                            {!isFullTimeline && (
                              <span style={{ background: '#fff8f0', color: '#8a3800', padding: '0.125rem 0.5rem', border: '1px solid #ff832b', borderRadius: '12px' }}>
                                ⚠ Partial — showing missed stops only. Deploy connector 07-connector-journey-stations-sink.json for full timeline.
                              </span>
                            )}
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px', fontFamily: IBM_FONT }}>
                            <thead>
                              <tr style={{ background: '#e8e8e8' }}>
                                {['#', 'Station', 'Events', 'Status', 'Sched Arr', 'Sched Dep', 'Act Arr', 'Act Dep', 'Pred Arr', 'Pred Dep', 'Delay', 'Method', 'Conf.', 'Approval', 'Actions'].map(h => (
                                  <th key={h} style={{ padding: '0.625rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#161616', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                          {stops!.map((s, i) => {
                            const isMissed = s.status === 'MISSED';
                            const conf = confidenceColor(s.prediction_confidence);

                            // ── Per-event gap logic ────────────────────────────
                            // Derive stop role from which scheduled times are set.
                            // ORIGIN:      has departure but no arrival
                            // DESTINATION: has arrival but no departure
                            // INTERMEDIATE / timing point: both (or neither — fall back gracefully)
                            const isOrigin      = !s.scheduled_arrival && !!s.scheduled_departure;
                            const isDestination = !!s.scheduled_arrival && !s.scheduled_departure;

                            // Whether each event is expected at this stop
                            const arrivalExpected   = !isOrigin;      // all stops except ORIGIN need an arrival
                            const departureExpected = !isDestination;  // all stops except DESTINATION need a departure

                            // Whether each actual is missing
                            const arrMissing = arrivalExpected   && !s.actual_arrival;
                            const depMissing = departureExpected && !s.actual_departure;

                            // Show prediction cells whenever the corresponding actual is absent
                            const showPredArr = arrMissing && !!s.predicted_arrival;
                            const showPredDep = depMissing && !!s.predicted_departure;

                            // Row has at least one gap event needing a prediction
                            const hasAnyGap = arrMissing || depMissing;

                            const rowBg = isMissed
                              ? (i % 2 === 0 ? '#fff8f8' : '#fff1f1')
                              : hasAnyGap
                                ? (i % 2 === 0 ? '#fffbf0' : '#fff8e6')   // amber tint for partial gaps
                                : (i % 2 === 0 ? '#fff' : '#fafafa');
                            const approvalStatus = (s.approval_status ?? 'PENDING') as Prediction['approval_status'];
                            // isPending covers fully-missed stops and visited stops with partial gaps
                            const isPending = (isMissed || hasAnyGap) && approvalStatus === 'PENDING';

                            // Map FullStop back to Prediction shape for the modal (best-effort)
                            const asPred: Prediction = {
                              id: s.id ? Number(s.id) : 0,
                              train_id: journey.train_id,
                              station_index: s.station_index,
                              station_name: s.station_name,
                              crs: s.crs,
                              tiploc: null,
                              stanox: s.stanox,
                              scheduled_time: s.scheduled_time,
                              scheduled_arrival: s.scheduled_arrival ?? null,
                              scheduled_departure: s.scheduled_departure ?? null,
                              actual_time: s.actual_time,
                              actual_arrival: s.actual_arrival ?? null,
                              actual_departure: s.actual_departure ?? null,
                              predicted_arrival: s.predicted_arrival ?? null,
                              predicted_departure: s.predicted_departure ?? null,
                              predicted_time: s.predicted_time,
                              predicted_delay_minutes: s.predicted_delay_minutes,
                              prediction_confidence: s.prediction_confidence,
                              prediction_method: s.prediction_method,
                              prediction_basis: s.prediction_basis ?? null,
                              approval_status: approvalStatus,
                              approved_time: s.approved_time,
                              approved_by: null,
                              approved_at: null,
                              rejection_reason: null,
                              received_at: journey.received_at,
                            };

                            return (
                              <tr
                                key={`${s.station_index}-${s.status}`}
                                style={{ borderBottom: '1px solid #e0e0e0', background: rowBg, cursor: (isMissed || hasAnyGap) ? 'pointer' : 'default' }}
                                onMouseEnter={e => { e.currentTarget.style.background = isMissed ? '#ffd7d944' : hasAnyGap ? '#fff3cd44' : '#f4f4f4'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                              >
                                {/* Index */}
                                <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem', color: '#8d8d8d' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>{s.station_index}</td>

                                {/* Station */}
                                <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#161616' }}>
                                    {s.station_name || s.stanox || '—'}
                                  </div>
                                  <div style={{ fontSize: '0.7rem', color: '#8d8d8d' }}>
                                    {[s.crs, s.stanox].filter(Boolean).join(' · ')}
                                  </div>
                                </td>

                                {/* Events column */}
                                <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  <StopEventPills stop={s} />
                                </td>

                                {/* Stop status badge & Event indicator */}
                                <td style={{ padding: '0.625rem 0.875rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{
                                      background: s.status === 'VISITED' ? '#a7f0ba' : isMissed ? '#ffd7d9' : '#e0e0e0',
                                      color:      s.status === 'VISITED' ? '#0e6027' : isMissed ? '#750e13' : '#525252',
                                      padding: '0.125rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '12px',
                                    }}>
                                      {s.status}
                                    </span>
                                    {s.event && (
                                      <span style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 600,
                                        padding: '0.1rem 0.35rem',
                                        borderRadius: '4px',
                                        background: s.event.includes('DEP') ? '#d0e2ff' : s.event.includes('ARR') ? '#e8daff' : '#f4f4f4',
                                        color: s.event.includes('DEP') ? '#0043ce' : s.event.includes('ARR') ? '#6929c4' : '#525252',
                                      }}>
                                        {s.event.includes('DEP') ? 'DEP' : s.event.includes('ARR') ? 'ARR' : s.event}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Sched Arr */}
                                <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: '#525252', fontFamily: 'IBM Plex Mono, monospace' }}
                                    onClick={() => isMissed && setModalPred(asPred)}>
                                  {s.scheduled_arrival
                                    // Only fall back to scheduled_time when there is no separate
                                    // departure time either — i.e. the stop is a pure timing point
                                    // with a single time field.  For ORIGIN stops scheduled_arrival
                                    // is null but scheduled_departure is set, so we show '—'.
                                    ?? (s.scheduled_departure == null ? s.scheduled_time : null)
                                    ?? '—'}
                                </td>

                                {/* Sched Dep */}
                                <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: '#8d8d8d', fontFamily: 'IBM Plex Mono, monospace' }}
                                    onClick={() => isMissed && setModalPred(asPred)}>
                                  {s.scheduled_departure ?? '—'}
                                </td>

                                {/* Act Arr */}
                                <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {!arrivalExpected
                                    // ORIGIN — no arrival expected
                                    ? <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>
                                    : s.actual_arrival
                                      ? <span style={{ fontSize: '0.875rem', color: '#0e6027', fontWeight: 600 }}>{s.actual_arrival}</span>
                                      : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>not captured</span>}
                                </td>

                                {/* Act Dep */}
                                <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {!departureExpected
                                    // DESTINATION — no departure expected
                                    ? <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>
                                    : s.actual_departure
                                      ? <span style={{ fontSize: '0.875rem', color: '#0e6027', fontWeight: 600 }}>{s.actual_departure}</span>
                                      : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>not captured</span>}
                                </td>

                                {/* Pred Arr — show whenever arrival is expected but not captured */}
                                <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {showPredArr ? (
                                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f62fe' }}>
                                      {approvalStatus === 'APPROVED' && s.approved_time ? s.approved_time : s.predicted_arrival}
                                    </span>
                                  ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                                </td>

                                {/* Pred Dep — show whenever departure is expected but not captured */}
                                <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {showPredDep ? (
                                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#7c3aed' }}>
                                      {s.predicted_departure}
                                    </span>
                                  ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                                </td>

                                {/* Delay */}
                                <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.875rem', fontFamily: 'IBM Plex Mono, monospace',
                                             color: s.predicted_delay_minutes != null && s.predicted_delay_minutes > 0 ? '#da1e28'
                                                  : s.predicted_delay_minutes != null && s.predicted_delay_minutes < 0 ? '#0e6027' : '#525252' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {(isMissed || hasAnyGap) && s.predicted_delay_minutes != null ? `${s.predicted_delay_minutes > 0 ? '+' : ''}${s.predicted_delay_minutes}m` : '—'}
                                </td>

                                {/* Method */}
                                <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.7rem', color: '#6f6f6f', fontStyle: 'italic', maxWidth: '120px' }}
                                    onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {(isMissed || hasAnyGap) ? (methodLabel(s.prediction_method) ?? '—') : '—'}
                                </td>

                                {/* Confidence */}
                                <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {(isMissed || hasAnyGap) && s.prediction_confidence != null ? (
                                    <span style={{ background: conf.bg, color: conf.text, padding: '0.125rem 0.4rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '12px' }}>
                                      {Math.round(s.prediction_confidence * 100)}%
                                    </span>
                                  ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                                </td>

                                {/* Approval status */}
                                <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => (isMissed || hasAnyGap) && setModalPred(asPred)}>
                                  {(isMissed || hasAnyGap)
                                    ? <StatusPill status={approvalStatus} />
                                    : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                                </td>

                                {/* Actions */}
                                <td style={{ padding: '0.625rem 0.875rem' }} onClick={e => e.stopPropagation()}>
                                  {(isMissed || hasAnyGap) && s.id ? (
                                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                      <button title="View detail" onClick={() => setModalPred(asPred)}
                                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: IBM_FONT, color: '#525252', background: 'transparent', border: '1px solid #c6c6c6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                        <Information size={12} /> Detail
                                      </button>
                                      {isPending && (<>
                                        <button onClick={() => approve(Number(s.id))}
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: IBM_FONT, color: '#fff', background: '#0f62fe', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                          <Checkmark size={12} /> Accept
                                        </button>
                                        <button onClick={() => { setAmendModal({ id: Number(s.id), current: s.predicted_time }); setAmendTime(s.predicted_time ?? ''); }}
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: IBM_FONT, color: '#525252', background: 'transparent', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
                                          Amend
                                        </button>
                                        <button onClick={() => { setRejectModal({ id: Number(s.id) }); setRejectReason(''); }}
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: IBM_FONT, color: '#da1e28', background: 'transparent', border: '1px solid #da1e28', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                          <Close size={12} /> Reject
                                        </button>
                                      </>)}
                                      {!isPending && (
                                        <button onClick={() => resetPrediction(Number(s.id))}
                                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: IBM_FONT, color: '#525252', background: 'transparent', border: '1px solid #8d8d8d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                          <Reset size={12} /> Reset
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                            </tbody>
                          </table>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination */}
      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', background: '#f4f4f4', borderTop: '1px solid #e0e0e0' }}>
          <span style={{ fontSize: '0.875rem', color: '#525252' }}>Page {page} of {totalPages} · {total.toLocaleString()} journeys</span>
          <div style={{ display: 'flex', gap: '0.0625rem' }}>
            {[{ label: 'Previous', disabled: page === 1, action: () => setPage(p => p - 1) }, { label: 'Next', disabled: page === totalPages, action: () => setPage(p => p + 1) }].map(btn => (
              <button key={btn.label} onClick={btn.action} disabled={btn.disabled} style={{ padding: '0.6875rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: btn.disabled ? '#c6c6c6' : '#161616', background: '#ffffff', border: 'none', cursor: btn.disabled ? 'not-allowed' : 'pointer', opacity: btn.disabled ? 0.5 : 1 }}>
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Prediction detail modal */}
      {modalPred && (
        <PredictionModal
          prediction={modalPred}
          onClose={() => setModalPred(null)}
          onApprove={(id) => { approve(id); setModalPred(null); }}
          onAmend={(id, current) => { setAmendModal({ id, current }); setAmendTime(current ?? ''); }}
          onReject={(id) => { setRejectModal({ id }); setRejectReason(''); }}
          onReset={(id) => resetPrediction(id)}
        />
      )}

      {/* ── Amend modal */}
      {amendModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', padding: '2rem', width: '480px', maxWidth: '90%', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 400, color: '#161616', margin: '0 0 1.5rem' }}>Amend Predicted Time</h2>
            <div style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#525252' }}>
              Current prediction: <strong style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{amendModal.current ?? '—'}</strong>
            </div>
            <label style={{ display: 'block', fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>
              Enter corrected time (HH:MM or HH:MM:SS)
            </label>
            <input
              type="text"
              value={amendTime}
              onChange={e => setAmendTime(e.target.value)}
              placeholder="e.g. 14:32"
              style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem', fontFamily: 'IBM Plex Mono, monospace', border: '1px solid #8d8d8d', marginBottom: '1.5rem', boxSizing: 'border-box' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setAmendModal(null); setAmendTime(''); }} style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>Cancel</button>
              <button
                disabled={!amendTime.trim()}
                onClick={async () => { await approve(amendModal.id, amendTime.trim()); setAmendModal(null); setAmendTime(''); }}
                style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: amendTime.trim() ? '#0f62fe' : '#c6c6c6', border: 'none', cursor: amendTime.trim() ? 'pointer' : 'not-allowed' }}
              >
                Approve with this time
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', padding: '2rem', width: '480px', maxWidth: '90%', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 400, color: '#161616', margin: '0 0 1.5rem' }}>Reject Prediction</h2>
            <label style={{ display: 'block', fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>Reason (optional)</label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Train did not pass through this station"
              style={{ width: '100%', padding: '0.75rem', fontSize: '0.875rem', border: '1px solid #8d8d8d', fontFamily: IBM_FONT, minHeight: '80px', resize: 'vertical', marginBottom: '1.5rem', boxSizing: 'border-box' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }} style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => { await reject(rejectModal.id, rejectReason); setRejectModal(null); setRejectReason(''); }} style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: '#da1e28', border: 'none', cursor: 'pointer' }}>
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
