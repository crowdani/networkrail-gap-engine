'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { Close, Checkmark, Warning, Reset, Information, ChevronLeft } from '@carbon/icons-react';

// ---------------------------------------------------------------------------
// Types
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

interface JourneyData {
  train_id: string;
  train_uid: string | null;
  schedule_start_date: string | null;
  severity: string | null;
  total_scheduled_stops: number | null;
  found_stops_count: number | null;
  missed_stops_count: number | null;
  source: 'journey_stations' | 'predicted_gaps_merge' | null;
  stops: FullStop[];
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IBM_FONT = 'IBM Plex Sans, system-ui, -apple-system, sans-serif';

const EVENT_PILL_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  ARR:        { bg: '#e8daff', color: '#6929c4', border: '#a56eff' },
  DEP:        { bg: '#d0e2ff', color: '#0043ce', border: '#78a9ff' },
  PASS:       { bg: '#d9fbfb', color: '#005d5d', border: '#3ddbd9' },
  ORIGIN:     { bg: '#d9fbfb', color: '#005d5d', border: '#3ddbd9' },
  DEST:       { bg: '#ffd7d9', color: '#750e13', border: '#ff8389' },
  ORIGIN_DEP: { bg: '#d9fbfb', color: '#005d5d', border: '#3ddbd9' },
  DEST_ARR:   { bg: '#ffd7d9', color: '#750e13', border: '#ff8389' },
};

function resolveEventPills(stop: FullStop): string[] {
  const e = (stop.event ?? '').toUpperCase();
  const pills: string[] = [];
  if (e.includes('ORIGIN') || stop.station_index === 1)   pills.push('ORIGIN');
  if (e.includes('DEST')   || e.includes('DESTINATION'))  pills.push('DEST');
  if (e.includes('PASS'))                                  pills.push('PASS');
  if ((e.includes('ARR') && !e.includes('DEST')) || (stop.scheduled_arrival && !e.includes('ORIGIN'))) pills.push('ARR');
  if ((e.includes('DEP') && !e.includes('ORIGIN')) || (stop.scheduled_departure && !e.includes('DEST')))  pills.push('DEP');
  return [...new Set(pills)];
}

function StopEventPills({ stop }: { stop: FullStop }) {
  const pills = resolveEventPills(stop);
  if (pills.length === 0) return <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
      {pills.map(p => {
        const s = EVENT_PILL_STYLE[p] ?? { bg: '#e0e0e0', color: '#525252', border: '#c6c6c6' };
        return (
          <span key={p} style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.35rem', borderRadius: '4px', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
            {p}
          </span>
        );
      })}
    </div>
  );
}

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

function severityColor(s: string | null) {
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
    LINEAR_INTERPOLATION:         'Linear interpolation',
    SINGLE_STATION_EXTRAPOLATION: 'Single-station extrapolation',
    SCHEDULE_ONLY:                'Schedule only',
    ON_TIME_INTERPOLATION:        'On-time interpolation',
  };
  return map[m] ?? m.replace(/_/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// StatusPill
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const styles = {
    PENDING:  { bg: '#d0e2ff', color: '#0043ce' },
    APPROVED: { bg: '#a7f0ba', color: '#0e6027' },
    REJECTED: { bg: '#ffd7d9', color: '#750e13' },
  };
  const s = styles[status] ?? styles.PENDING;
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '12px' }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TimeRow
// ---------------------------------------------------------------------------

function TimeRow({ label, value, color, note }: { label: string; value: string | null; color?: string; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.375rem 0', borderBottom: '1px solid #e0e0e0' }}>
      <span style={{ fontSize: '0.8rem', color: '#525252' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {note && <span style={{ fontSize: '0.7rem', color: '#8d8d8d', fontStyle: 'italic' }}>{note}</span>}
        <span style={{ fontSize: '0.875rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: value ? (color ?? '#161616') : '#c6c6c6' }}>
          {value ?? '—'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prediction detail modal (same as approvals page)
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
  const finalTime = p.approval_status === 'APPROVED' && p.approved_time ? p.approved_time : p.predicted_time;
  const delayColor = p.predicted_delay_minutes !== null && p.predicted_delay_minutes > 0 ? '#da1e28'
    : p.predicted_delay_minutes !== null && p.predicted_delay_minutes < 0 ? '#0e6027' : '#525252';

  const stationDisplay = p.station_name?.trim() || p.crs || p.tiploc || p.stanox || '—';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#ffffff', width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', background: '#f4f4f4' }}>
          <div>
            <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#161616' }}>Stop {p.station_index} · {stationDisplay}</div>
            <div style={{ fontSize: '0.8rem', color: '#525252', marginTop: '0.2rem' }}>STANOX {p.stanox ?? '—'} · TIPLOC {p.tiploc ?? '—'}{p.crs ? ` · CRS ${p.crs}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center', color: '#525252' }}><Close size={20} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem' }}>
            <StatusPill status={p.approval_status} />
            {p.approval_status === 'REJECTED' && p.rejection_reason && (
              <span style={{ fontSize: '0.8rem', color: '#750e13' }}>{p.rejection_reason}</span>
            )}
            {p.approval_status === 'APPROVED' && p.approved_by && (
              <span style={{ fontSize: '0.8rem', color: '#0e6027' }}>by {p.approved_by}</span>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>Time Comparison</div>
            <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.5rem 1rem' }}>
              {(p.scheduled_arrival || p.scheduled_departure) ? (
                <>
                  <TimeRow label="Sched Arrival"   value={p.scheduled_arrival}   color="#161616" />
                  <TimeRow label="Sched Departure"  value={p.scheduled_departure} color="#161616" />
                </>
              ) : (
                <TimeRow label="Scheduled" value={p.scheduled_time} color="#161616" />
              )}
              {(p.actual_arrival || p.actual_departure) ? (
                <>
                  <TimeRow label="Act Arrival"   value={p.actual_arrival}   color={p.actual_arrival   ? '#0e6027' : undefined} note={p.actual_arrival   ? 'recorded ARR' : undefined} />
                  <TimeRow label="Act Departure" value={p.actual_departure} color={p.actual_departure ? '#0e6027' : undefined} note={p.actual_departure ? 'recorded DEP' : undefined} />
                </>
              ) : (
                <TimeRow label="Actual (captured)" value={p.actual_time} color={p.actual_time ? '#0e6027' : undefined} note={p.actual_time ? 'recorded movement' : undefined} />
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.875rem 1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Predicted delay</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, color: delayColor, fontFamily: 'IBM Plex Mono, monospace' }}>
                {p.predicted_delay_minutes !== null ? `${p.predicted_delay_minutes > 0 ? '+' : ''}${p.predicted_delay_minutes}m` : '—'}
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

          {basis && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>Prediction Basis</div>
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
                  </div>
                )}
                {basis.weight != null && (
                  <div style={{ marginTop: '0.5rem', color: '#525252', fontSize: '0.75rem' }}>Interpolation weight: {String(basis.weight)}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e0e0e0', background: '#f4f4f4', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {!isPending && (
            <button onClick={() => { onReset(p.id); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Reset size={14} /> Reset to pending
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
            Close
          </button>
          {isPending && (<>
            <button onClick={() => { onReject(p.id); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#da1e28', background: '#fff', border: '1px solid #da1e28', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Close size={14} /> Reject
            </button>
            <button onClick={() => { onAmend(p.id, p.predicted_time); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
              Amend time
            </button>
            <button onClick={() => { onApprove(p.id); onClose(); }}
              style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: '#0f62fe', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Checkmark size={14} /> Accept
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function JourneyPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const trainId = decodeURIComponent(params.trainId as string);
  const scheduleStartDate = searchParams.get('scheduleStartDate');

  const [journey,    setJourney]    = useState<JourneyData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const [modalPred,  setModalPred]  = useState<Prediction | null>(null);
  const [amendModal, setAmendModal] = useState<{ id: number; current: string | null } | null>(null);
  const [amendTime,  setAmendTime]  = useState('');
  const [rejectModal, setRejectModal] = useState<{ id: number } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  const flash = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); }
    else                    { setErrorMsg(msg);   setTimeout(() => setErrorMsg(null),   5000); }
  };

  const fetchJourney = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams();
      if (scheduleStartDate) qp.set('scheduleStartDate', scheduleStartDate);
      const res = await fetch(`/api/predicted-gaps/journey/${encodeURIComponent(trainId)}?${qp}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setJourney(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journey');
    } finally {
      setLoading(false);
    }
  }, [trainId, scheduleStartDate]);

  useEffect(() => { fetchJourney(); }, [fetchJourney]);

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  const approve = async (id: number, approvedTime?: string) => {
    try {
      const res = await fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', approved_time: approvedTime ?? undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      flash('success', '✓ Prediction approved');
      await fetchJourney();
    } catch (err) {
      flash('error', 'Failed to approve: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  };

  const reject = async (id: number, reason?: string) => {
    try {
      const res = await fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      flash('success', '✓ Prediction rejected');
      await fetchJourney();
    } catch (err) {
      flash('error', 'Failed to reject: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  };

  const resetPrediction = async (id: number) => {
    try {
      await fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      flash('success', 'Reset to pending');
      await fetchJourney();
    } catch { flash('error', 'Reset failed'); }
  };

  const approveAll = async () => {
    if (!journey) return;
    const pendingIds = journey.stops
      .filter(s => s.status === 'MISSED' && (s.approval_status ?? 'PENDING') === 'PENDING' && s.id)
      .map(s => s.id!);
    try {
      await Promise.all(pendingIds.map(id => fetch(`/api/predicted-gaps/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })));
      flash('success', `✓ ${pendingIds.length} prediction(s) approved`);
      await fetchJourney();
    } catch { flash('error', 'Bulk approve failed'); }
  };

  // --------------------------------------------------------------------------
  // Computed
  // --------------------------------------------------------------------------

  const stops = journey?.stops ?? [];
  const missedCount   = stops.filter(s => s.status === 'MISSED').length;
  const visitedCount  = stops.filter(s => s.status === 'VISITED').length;
  const pendingCount  = stops.filter(s => s.status === 'MISSED' && (s.approval_status ?? 'PENDING') === 'PENDING').length;
  const approvedCount = stops.filter(s => s.status === 'MISSED' && s.approval_status === 'APPROVED').length;
  const rejectedCount = stops.filter(s => s.status === 'MISSED' && s.approval_status === 'REJECTED').length;
  const sev = severityColor(journey?.severity ?? null);
  const isFullTimeline = journey?.source === 'journey_stations';

  function stopToPrediction(s: FullStop): Prediction {
    return {
      id:                    s.id ? Number(s.id) : 0,
      train_id:              trainId,
      station_index:         s.station_index,
      station_name:          s.station_name,
      crs:                   s.crs,
      tiploc:                null,
      stanox:                s.stanox,
      scheduled_time:        s.scheduled_time,
      scheduled_arrival:     s.scheduled_arrival ?? null,
      scheduled_departure:   s.scheduled_departure ?? null,
      actual_time:           s.actual_time,
      actual_arrival:        s.actual_arrival ?? null,
      actual_departure:      s.actual_departure ?? null,
      predicted_arrival:     s.predicted_arrival ?? null,
      predicted_departure:   s.predicted_departure ?? null,
      predicted_time:        s.predicted_time,
      predicted_delay_minutes: s.predicted_delay_minutes,
      prediction_confidence: s.prediction_confidence,
      prediction_method:     s.prediction_method,
      prediction_basis:      s.prediction_basis ?? null,
      approval_status:       (s.approval_status ?? 'PENDING') as Prediction['approval_status'],
      approved_time:         s.approved_time,
      approved_by:           null,
      approved_at:           null,
      rejection_reason:      null,
      received_at:           '',
    };
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div style={{ background: '#f4f4f4', minHeight: 'calc(100vh - 60px)', fontFamily: IBM_FONT }}>

      {/* ── Page header (matches approvals page style) */}
      <div style={{ padding: '2rem', background: '#ffffff', marginBottom: '1px' }}>
        {/* Back link */}
        <button
          onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', background: 'transparent', border: 'none', cursor: 'pointer', color: '#525252', fontSize: '0.875rem', fontFamily: IBM_FONT, padding: 0, marginBottom: '1.25rem' }}
        >
          <ChevronLeft size={16} /> Back to locations
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
              <h1 style={{ fontSize: '2.625rem', fontWeight: 300, lineHeight: 1.2, color: '#161616', margin: 0, fontFamily: IBM_FONT }}>
                {trainId}
              </h1>
              {journey?.severity && (
                <span style={{ background: sev.bg, color: sev.text, padding: '0.2rem 0.625rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: '12px' }}>
                  {journey.severity}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#525252', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {journey?.train_uid && <span>UID: {journey.train_uid}</span>}
              {journey?.schedule_start_date && <span>· {journey.schedule_start_date}</span>}
              {journey?.train_uid && journey?.schedule_start_date && /^\d{4}-\d{2}-\d{2}$/.test(journey.schedule_start_date) && (
                <a
                  href={`https://www.realtimetrains.co.uk/service/gb-nr:${journey.train_uid.trim()}/${journey.schedule_start_date}/detailed`}
                  target="_blank" rel="noreferrer"
                  style={{ color: '#0f62fe', fontSize: '0.8rem', textDecoration: 'none' }}
                >
                  Realtime Trains ↗
                </a>
              )}
            </div>
          </div>
          {pendingCount > 0 && (
            <button
              onClick={approveAll}
              style={{ padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#0f62fe', background: 'transparent', border: '1px solid #0f62fe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Checkmark size={14} /> Approve all
            </button>
          )}
        </div>

        {/* Flash messages */}
        {successMsg && (
          <div style={{ background: '#24a148', color: '#fff', padding: '0.875rem 1rem', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Checkmark size={16} /> {successMsg}
          </div>
        )}
        {errorMsg && (
          <div style={{ background: '#da1e28', color: '#fff', padding: '0.875rem 1rem', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Warning size={16} /> {errorMsg}
          </div>
        )}

        {/* Stats cards */}
        {journey && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
            {[
              { label: 'Scheduled stops', value: journey.total_scheduled_stops ?? stops.length, color: '#161616' },
              { label: 'Visited',         value: visitedCount,  color: '#0e6027' },
              { label: 'Missed (gaps)',   value: missedCount,   color: '#750e13' },
              { label: 'Pending',         value: pendingCount,  color: '#0043ce' },
              { label: 'Approved',        value: approvedCount, color: '#0e6027' },
            ].map(stat => (
              <div key={stat.label} style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '1.25rem 1.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>{stat.label}</div>
                <div style={{ fontSize: '2rem', fontWeight: 300, color: stat.color }}>{stat.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Loading / error */}
      {loading && (
        <div style={{ padding: '3rem', textAlign: 'center', background: '#fff', margin: '0 2rem', fontSize: '0.875rem', color: '#525252' }}>
          Loading journey stop timeline…
        </div>
      )}
      {error && (
        <div style={{ margin: '1rem 2rem', padding: '1rem', background: '#fff1f1', border: '1px solid #da1e28', fontSize: '0.875rem', color: '#750e13' }}>
          {error}
        </div>
      )}

      {/* ── Stop table */}
      {!loading && !error && journey && (
        <div style={{ margin: '0 2rem 2rem', background: '#ffffff', border: '1px solid #e0e0e0' }}>
          {/* Journey context bar */}
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', padding: '0.625rem 1.5rem', background: '#f4f4f4', borderBottom: '1px solid #e0e0e0', fontSize: '0.75rem', color: '#525252', flexWrap: 'wrap' }}>
            <span><strong style={{ color: '#161616' }}>{journey.total_scheduled_stops ?? stops.length}</strong> scheduled stops</span>
            <span style={{ color: '#0e6027' }}><strong>{visitedCount}</strong> visited (captured)</span>
            <span style={{ color: '#750e13' }}><strong>{missedCount}</strong> missed (need infill)</span>
            {rejectedCount > 0 && (
              <span style={{ color: '#750e13' }}><strong>{rejectedCount}</strong> rejected</span>
            )}
            {!isFullTimeline && (
              <span style={{ background: '#fff8f0', color: '#8a3800', padding: '0.125rem 0.5rem', border: '1px solid #ff832b', borderRadius: '12px' }}>
                ⚠ Partial — showing missed stops only. Deploy connector 07-connector-journey-stations-sink.json for full timeline.
              </span>
            )}
          </div>

          {stops.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', fontSize: '0.875rem', color: '#525252' }}>No stop data found for this journey.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px', fontFamily: IBM_FONT }}>
                <thead>
                  <tr style={{ background: '#e8e8e8' }}>
                    {['#', 'Station', 'Events', 'Status', 'Sched Arr', 'Sched Dep', 'Act Arr', 'Act Dep', 'Pred Arr', 'Pred Dep', 'Delay', 'Method', 'Conf.', 'Approval', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '0.625rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#161616', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stops.map((s, i) => {
                    const isMissed  = s.status === 'MISSED';
                    const isVisited = s.status === 'VISITED';
                    const conf = confidenceColor(s.prediction_confidence);
                    const rowBg = isMissed ? (i % 2 === 0 ? '#fff8f8' : '#fff1f1') : (i % 2 === 0 ? '#fff' : '#fafafa');
                    const approvalStatus = (s.approval_status ?? 'PENDING') as Prediction['approval_status'];
                    const isPending = isMissed && approvalStatus === 'PENDING';
                    const asPred = stopToPrediction(s);

                    return (
                      <tr
                        key={`${s.station_index}-${s.status}`}
                        style={{ borderBottom: '1px solid #e0e0e0', background: rowBg, cursor: isMissed ? 'pointer' : 'default' }}
                        onMouseEnter={e => { e.currentTarget.style.background = isMissed ? '#ffd7d944' : '#f4f4f4'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                      >
                        {/* # */}
                        <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem', color: '#8d8d8d' }}
                            onClick={() => isMissed && setModalPred(asPred)}>{s.station_index}</td>

                        {/* Station */}
                        <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => isMissed && setModalPred(asPred)}>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#161616' }}>
                            {s.station_name || s.stanox || '—'}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#8d8d8d' }}>
                            {[s.crs, s.stanox].filter(Boolean).join(' · ')}
                          </div>
                        </td>

                        {/* Events */}
                        <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => isMissed && setModalPred(asPred)}>
                          <StopEventPills stop={s} />
                        </td>

                        {/* Status */}
                        <td style={{ padding: '0.625rem 0.875rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{
                              background: isVisited ? '#a7f0ba' : isMissed ? '#ffd7d9' : '#e0e0e0',
                              color:      isVisited ? '#0e6027' : isMissed ? '#750e13' : '#525252',
                              padding: '0.125rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '12px',
                            }}>
                              {s.status}
                            </span>
                            {s.event && (
                              <span style={{
                                fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.35rem', borderRadius: '4px',
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
                          {s.scheduled_arrival ?? s.scheduled_time ?? '—'}
                        </td>

                        {/* Sched Dep */}
                        <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: '#8d8d8d', fontFamily: 'IBM Plex Mono, monospace' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {s.scheduled_departure ?? '—'}
                        </td>

                        {/* Act Arr */}
                        <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {isVisited
                            ? (s.actual_arrival
                                ? <span style={{ fontSize: '0.875rem', color: '#0e6027', fontWeight: 600 }}>{s.actual_arrival}</span>
                                : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>)
                            : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>not captured</span>}
                        </td>

                        {/* Act Dep */}
                        <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {isVisited
                            ? (s.actual_departure
                                ? <span style={{ fontSize: '0.875rem', color: '#0e6027', fontWeight: 600 }}>{s.actual_departure}</span>
                                : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>)
                            : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                        </td>

                        {/* Pred Arr */}
                        <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {isMissed && s.predicted_arrival ? (
                            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f62fe' }}>
                              {approvalStatus === 'APPROVED' && s.approved_time ? s.approved_time : s.predicted_arrival}
                            </span>
                          ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                        </td>

                        {/* Pred Dep */}
                        <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {isMissed && s.predicted_departure ? (
                            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#7c3aed' }}>
                              {s.predicted_departure}
                            </span>
                          ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                        </td>

                        {/* Delay */}
                        <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.875rem', fontFamily: 'IBM Plex Mono, monospace',
                                     color: s.predicted_delay_minutes != null && s.predicted_delay_minutes > 0 ? '#da1e28'
                                          : s.predicted_delay_minutes != null && s.predicted_delay_minutes < 0 ? '#0e6027' : '#525252' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {s.predicted_delay_minutes != null ? `${s.predicted_delay_minutes > 0 ? '+' : ''}${s.predicted_delay_minutes}m` : '—'}
                        </td>

                        {/* Method */}
                        <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.7rem', color: '#6f6f6f', fontStyle: 'italic', maxWidth: '120px' }}
                            onClick={() => isMissed && setModalPred(asPred)}>
                          {isMissed ? (methodLabel(s.prediction_method) ?? '—') : '—'}
                        </td>

                        {/* Confidence */}
                        <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => isMissed && setModalPred(asPred)}>
                          {isMissed && s.prediction_confidence != null ? (
                            <span style={{ background: conf.bg, color: conf.text, padding: '0.125rem 0.4rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '12px' }}>
                              {Math.round(s.prediction_confidence * 100)}%
                            </span>
                          ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                        </td>

                        {/* Approval */}
                        <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => isMissed && setModalPred(asPred)}>
                          {isMissed
                            ? <StatusPill status={approvalStatus} />
                            : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>—</span>}
                        </td>

                        {/* Actions */}
                        <td style={{ padding: '0.625rem 0.875rem' }} onClick={e => e.stopPropagation()}>
                          {isMissed && s.id ? (
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
            </div>
          )}
        </div>
      )}

      {/* ── Prediction detail modal */}
      {modalPred && (
        <PredictionModal
          prediction={modalPred}
          onClose={() => setModalPred(null)}
          onApprove={id => { approve(id); setModalPred(null); }}
          onAmend={(id, current) => { setAmendModal({ id, current }); setAmendTime(current ?? ''); setModalPred(null); }}
          onReject={id => { setRejectModal({ id }); setRejectReason(''); setModalPred(null); }}
          onReset={id => { resetPrediction(id); setModalPred(null); }}
        />
      )}

      {/* ── Amend modal */}
      {amendModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAmendModal(null)}>
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
              <button onClick={() => { setAmendModal(null); setAmendTime(''); }}
                style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
                Cancel
              </button>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRejectModal(null)}>
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
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }}
                style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={async () => { await reject(rejectModal.id, rejectReason.trim() || undefined); setRejectModal(null); setRejectReason(''); }}
                style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: '#da1e28', border: 'none', cursor: 'pointer' }}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
