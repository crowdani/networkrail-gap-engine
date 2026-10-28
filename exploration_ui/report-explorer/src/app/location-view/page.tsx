'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, Close, CheckmarkFilled, WarningFilled, Launch, Checkmark, Warning, Reset, Information } from '@carbon/icons-react';
import { KENT_STANOX_CODES } from '@/lib/kent-locations';
import PageRefreshCountdown from '@/components/PageRefreshCountdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocationGapData {
  location_stanox: string;
  location_name: string;
  total_gaps: number;
  total_trains: number;
  gap_percentage: number;
  most_recent_gap: string | null;
  severity_breakdown: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
}

interface ApiResponse {
  locations: LocationGapData[];
  summary: {
    total_gaps: number;
    locations_affected: number;
  };
}

interface Gap {
  id: string;
  train_id: string;
  train_uid: string;
  schedule_start_date: string | null;
  severity: string;
  station_name: string;
  crs: string;
  stanox: string;
  tiploc: string | null;
  scheduled_time: string | null;
  actual_time: string | null;
  predicted_arrival: string | null;
  predicted_departure: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_confidence: number | null;
  prediction_method: string | null;
  approval_status: string;
  total_scheduled_stops: number | null;
  missed_stops_count: number | null;
}

// Full stop shape returned by /api/predicted-gaps/journey/[trainId]
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

// Prediction shape used for the detail modal
interface ModalPrediction {
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

interface LocationDetail {
  location_stanox: string;
  location_name: string;
  total: number;
  gaps: Gap[];
}

// Journey modal state
interface JourneyModalData {
  trainId: string;
  trainUid: string | null;
  scheduleStartDate: string | null;
  severity: string | null;
  totalScheduledStops: number | null;
  stops: FullStop[] | null;       // null = loading
  source: string | null;
  error: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IBM_FONT = 'IBM Plex Sans, system-ui, -apple-system, sans-serif';

const EVENT_PILL_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  ACTIVATED:    { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe' },
  ARR:          { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  DEP:          { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
  TERMINATED:   { bg: '#fff1f1', color: '#750e13', border: '#ffb3b8' },
  CANCELLATION: { bg: '#ffd7d9', color: '#750e13', border: '#ff8389' },
};

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

function severityColor(s: string | null) {
  switch ((s ?? '').toUpperCase()) {
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

function resolveEventPills(
  event: string | null,
  actualArrival: string | null,
  actualDeparture: string | null,
): string[] {
  const pills: string[] = [];
  const ev = (event ?? '').toUpperCase();
  if (ev.includes('ACTIVATED'))                             pills.push('ACTIVATED');
  if (actualArrival)                                        pills.push('ARR');
  else if (ev.includes('ARR'))                              pills.push('ARR');
  if (actualDeparture)                                      pills.push('DEP');
  else if (ev.includes('DEP') || ev.includes('DEPARTURE')) pills.push('DEP');
  if (ev.includes('TERMINAT'))                              pills.push('TERMINATED');
  if (ev.includes('CANCEL'))                                pills.push('CANCELLATION');
  return pills;
}

function formatRelativeTime(timestamp?: string | null) {
  if (!timestamp) return null;
  const diffMs   = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components (mirrors approvals page)
// ---------------------------------------------------------------------------

function StopEventPills({ stop }: { stop: FullStop }) {
  const pills = resolveEventPills(stop.event, stop.actual_arrival, stop.actual_departure);
  if (pills.length === 0) return <span style={{ fontSize: '0.7rem', color: '#c6c6c6' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
      {pills.map(p => {
        const s = EVENT_PILL_STYLE[p] ?? { bg: '#e0e0e0', color: '#525252', border: '#c6c6c6' };
        return (
          <span key={p} style={{ display: 'inline-block', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em', background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
            {p}
          </span>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const styles: Record<string, React.CSSProperties> = {
    PENDING:  { background: '#d0e2ff', color: '#0043ce' },
    APPROVED: { background: '#a7f0ba', color: '#0e6027' },
    REJECTED: { background: '#ffd7d9', color: '#750e13' },
  };
  return (
    <span style={{ ...(styles[status] ?? styles.PENDING), display: 'inline-block', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '12px', fontFamily: IBM_FONT }}>
      {status}
    </span>
  );
}

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

function PredictionDetailModal({
  prediction,
  onClose,
  onApprove,
  onAmend,
  onReject,
  onReset,
}: {
  prediction: ModalPrediction | null;
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
  const stationDisplay = (p.station_name?.trim() || null) ?? (p.crs ?? p.tiploc ?? p.stanox ?? '—');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.5)', zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#ffffff', width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', background: '#f4f4f4' }}>
          <div>
            <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#161616' }}>
              Stop {p.station_index} · {stationDisplay}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#525252', marginTop: '0.2rem' }}>
              STANOX {p.stanox ?? '—'} · TIPLOC {p.tiploc ?? '—'}{p.crs ? ` · CRS ${p.crs}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center', color: '#525252' }}>
            <Close size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem' }}>
            <StatusPill status={p.approval_status} />
            {p.approval_status === 'REJECTED' && p.rejection_reason && (
              <span style={{ fontSize: '0.8rem', color: '#750e13' }}>{p.rejection_reason}</span>
            )}
          </div>

          {/* Time comparison */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#525252', textTransform: 'uppercase', letterSpacing: '0.32px', marginBottom: '0.5rem' }}>Time Comparison</div>
            <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.5rem 1rem' }}>
              {(p.scheduled_arrival || p.scheduled_departure) ? (
                <>
                  <TimeRow label="Sched Arrival"    value={p.scheduled_arrival}   color="#161616" />
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

          {/* Delay + confidence */}
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

          {/* Prediction basis */}
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

        {/* Footer */}
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
// Journey modal — full-screen overlay with complete stop timeline
// ---------------------------------------------------------------------------

function JourneyModal({
  data,
  onClose,
  onApprove,
  onApproveAll,
  onAmend,
  onReject,
  onReset,
}: {
  data: JourneyModalData;
  onClose: () => void;
  onApprove: (id: number) => void;
  onApproveAll: (stops: FullStop[]) => void;
  onAmend: (id: number, current: string | null) => void;
  onReject: (id: number, reason?: string) => void;
  onReset: (id: number) => void;
}) {
  const [modalPred, setModalPred] = useState<ModalPrediction | null>(null);
  const [amendModal, setAmendModal] = useState<{ id: number; current: string | null } | null>(null);
  const [amendTime, setAmendTime] = useState('');
  const [rejectModal, setRejectModal] = useState<{ id: number } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const flash = (type: 'success' | 'error', msg: string) => {
    if (type === 'success') { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); }
    else                    { setErrorMsg(msg);   setTimeout(() => setErrorMsg(null),   5000); }
  };

  const stops = data.stops ?? [];
  const missedCount  = stops.filter(s => s.status === 'MISSED').length;
  const visitedCount = stops.filter(s => s.status === 'VISITED').length;
  const pendingCount = stops.filter(s => s.status === 'MISSED' && (s.approval_status ?? 'PENDING') === 'PENDING').length;
  const sev = severityColor(data.severity);
  const isFullTimeline = data.source === 'journey_stations';

  function stopToModalPrediction(s: FullStop): ModalPrediction {
    return {
      id:                    s.id ? Number(s.id) : 0,
      train_id:              data.trainId,
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
      approval_status:       (s.approval_status ?? 'PENDING') as ModalPrediction['approval_status'],
      approved_time:         s.approved_time,
      approved_by:           null,
      approved_at:           null,
      rejection_reason:      null,
      received_at:           '',
    };
  }

  return (
    <>
      {/* Full-screen backdrop */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.65)', zIndex: 11000, display: 'flex', flexDirection: 'column', fontFamily: IBM_FONT }} onClick={onClose}>
        {/* Modal panel */}
        <div
          style={{ position: 'absolute', inset: '2rem', background: '#f4f4f4', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', overflowY: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Header */}
          <div style={{ padding: '1.25rem 1.5rem', background: '#ffffff', borderBottom: '1px solid #e0e0e0', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0f62fe' }}>{data.trainId}</span>
                  {data.severity && (
                    <span style={{ background: sev.bg, color: sev.text, padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: '12px' }}>
                      {data.severity}
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span style={{ background: '#d0e2ff', color: '#0043ce', padding: '0.125rem 0.5rem', fontSize: '0.75rem', borderRadius: '12px' }}>
                      {pendingCount} pending
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#525252', marginTop: '0.3rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {data.trainUid && <span>UID: {data.trainUid}</span>}
                  {data.scheduleStartDate && <span>· {data.scheduleStartDate}</span>}
                  {data.trainUid && data.scheduleStartDate && /^\d{4}-\d{2}-\d{2}$/.test(data.scheduleStartDate) && (
                    <a
                      href={`https://www.realtimetrains.co.uk/service/gb-nr:${data.trainUid.trim()}/${data.scheduleStartDate}/detailed`}
                      target="_blank" rel="noreferrer"
                      style={{ color: '#0f62fe', fontSize: '0.75rem', textDecoration: 'none' }}
                    >
                      Realtime Trains ↗
                    </a>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {pendingCount > 0 && data.stops && (
                  <button
                    onClick={() => onApproveAll(data.stops!)}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#0f62fe', background: 'transparent', border: '1px solid #0f62fe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                  >
                    <Checkmark size={14} /> Approve all
                  </button>
                )}
                <button onClick={onClose}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.375rem', display: 'flex', alignItems: 'center', color: '#525252' }}>
                  <Close size={20} />
                </button>
              </div>
            </div>

            {/* Flash messages */}
            {successMsg && (
              <div style={{ background: '#24a148', color: '#fff', padding: '0.625rem 1rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <Checkmark size={16} /> {successMsg}
              </div>
            )}
            {errorMsg && (
              <div style={{ background: '#da1e28', color: '#fff', padding: '0.625rem 1rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <Warning size={16} /> {errorMsg}
              </div>
            )}
          </div>

          {/* ── Content */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            {data.error && (
              <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.875rem', color: '#750e13' }}>
                Failed to load journey stop data.
              </div>
            )}
            {!data.error && data.stops === null && (
              <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.875rem', color: '#525252' }}>
                Loading stop timeline…
              </div>
            )}
            {!data.error && data.stops !== null && stops.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.875rem', color: '#525252' }}>
                No stop data found for this journey.
              </div>
            )}
            {!data.error && data.stops !== null && stops.length > 0 && (
              <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', margin: '1.5rem', minWidth: '1100px' }}>
                {/* Journey context bar */}
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', padding: '0.625rem 1.5rem', background: '#f4f4f4', borderBottom: '1px solid #e0e0e0', fontSize: '0.75rem', color: '#525252', flexWrap: 'wrap' }}>
                  <span><strong style={{ color: '#161616' }}>{data.totalScheduledStops ?? stops.length}</strong> scheduled stops</span>
                  <span style={{ color: '#0e6027' }}><strong>{visitedCount}</strong> visited (captured)</span>
                  <span style={{ color: '#750e13' }}><strong>{missedCount}</strong> missed (need infill)</span>
                  {!isFullTimeline && (
                    <span style={{ background: '#fff8f0', color: '#8a3800', padding: '0.125rem 0.5rem', border: '1px solid #ff832b', borderRadius: '12px' }}>
                      ⚠ Partial — showing missed stops only.
                    </span>
                  )}
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: IBM_FONT }}>
                  <thead>
                    <tr style={{ background: '#e8e8e8' }}>
                      {['#', 'Station', 'Events', 'Status', 'Sched Arr', 'Sched Dep', 'Act Arr', 'Act Dep', 'Predicted', 'Delay', 'Method', 'Conf.', 'Approval', 'Actions'].map(h => (
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
                      const approvalStatus = (s.approval_status ?? 'PENDING') as ModalPrediction['approval_status'];
                      const isPending = isMissed && approvalStatus === 'PENDING';
                      const asPred = stopToModalPrediction(s);

                      return (
                        <tr
                          key={`${s.station_index}-${s.status}`}
                          style={{ borderBottom: '1px solid #e0e0e0', background: rowBg, cursor: isMissed ? 'pointer' : 'default' }}
                          onMouseEnter={e => { e.currentTarget.style.background = isMissed ? '#ffd7d944' : '#f4f4f4'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                        >
                          {/* Index */}
                          <td style={{ padding: '0.625rem 0.875rem', fontSize: '0.75rem', color: '#8d8d8d' }}
                              onClick={() => isMissed && setModalPred(asPred)}>{s.station_index}</td>

                          {/* Station */}
                          <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => isMissed && setModalPred(asPred)}>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#161616', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              {isVisited
                                ? <CheckmarkFilled size={13} style={{ color: '#0e6027', flexShrink: 0 }} />
                                : <WarningFilled   size={13} style={{ color: '#da1e28', flexShrink: 0 }} />
                              }
                              {s.station_name || s.stanox || '—'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#8d8d8d', paddingLeft: '1.1rem' }}>
                              {[s.crs, s.stanox].filter(Boolean).join(' · ')}
                            </div>
                          </td>

                          {/* Events */}
                          <td style={{ padding: '0.625rem 0.875rem' }} onClick={() => isMissed && setModalPred(asPred)}>
                            <StopEventPills stop={s} />
                          </td>

                          {/* Status */}
                          <td style={{ padding: '0.625rem 0.875rem' }}>
                            <span style={{
                              background: isVisited ? '#a7f0ba' : isMissed ? '#ffd7d9' : '#e0e0e0',
                              color:      isVisited ? '#0e6027' : isMissed ? '#750e13' : '#525252',
                              padding: '0.125rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '12px',
                            }}>
                              {s.status}
                            </span>
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

                          {/* Predicted */}
                          <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'IBM Plex Mono, monospace' }}
                              onClick={() => isMissed && setModalPred(asPred)}>
                            {isMissed ? (
                              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: s.predicted_time ? '#0f62fe' : '#8d8d8d' }}>
                                {approvalStatus === 'APPROVED' && s.approved_time
                                  ? <>{s.approved_time} <span style={{ fontSize: '0.7rem', color: '#0e6027', fontWeight: 400, fontFamily: IBM_FONT }}>(amended)</span></>
                                  : (s.predicted_time ?? '—')}
                              </span>
                            ) : <span style={{ fontSize: '0.75rem', color: '#c6c6c6' }}>n/a</span>}
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

                          {/* Approval status */}
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
                                  <button onClick={() => { onApprove(Number(s.id)); flash('success', '✓ Approved'); }}
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
                                  <button onClick={() => { onReset(Number(s.id)); flash('success', 'Reset to pending'); }}
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
        </div>
      </div>

      {/* Stop detail modal */}
      {modalPred && (
        <PredictionDetailModal
          prediction={modalPred}
          onClose={() => setModalPred(null)}
          onApprove={id => { onApprove(id); setModalPred(null); flash('success', '✓ Approved'); }}
          onAmend={(id, cur) => { setAmendModal({ id, current: cur }); setAmendTime(cur ?? ''); setModalPred(null); }}
          onReject={id => { setRejectModal({ id }); setRejectReason(''); setModalPred(null); }}
          onReset={id => { onReset(id); flash('success', 'Reset to pending'); }}
        />
      )}

      {/* Amend modal */}
      {amendModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.5)', zIndex: 20001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setAmendModal(null)}>
          <div style={{ background: '#fff', width: '100%', maxWidth: '480px', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.25rem 1.5rem', background: '#f4f4f4', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#161616' }}>Amend predicted time</div>
              <button onClick={() => setAmendModal(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#525252' }}><Close size={20} /></button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#161616', marginBottom: '0.5rem' }}>
                Corrected time (HH:MM)
              </label>
              <input
                type="text"
                value={amendTime}
                onChange={e => setAmendTime(e.target.value)}
                placeholder="e.g. 14:32"
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', fontFamily: 'IBM Plex Mono, monospace', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ padding: '1rem 1.5rem', background: '#f4f4f4', borderTop: '1px solid #e0e0e0', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setAmendModal(null)}
                style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  onAmend(amendModal.id, amendTime.trim() || null);
                  setAmendModal(null);
                  flash('success', '✓ Prediction amended');
                }}
                style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: '#0f62fe', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <Checkmark size={14} /> Confirm amend
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,22,22,0.5)', zIndex: 20001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setRejectModal(null)}>
          <div style={{ background: '#fff', width: '100%', maxWidth: '480px', fontFamily: IBM_FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.25rem 1.5rem', background: '#f4f4f4', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#161616' }}>Reject prediction</div>
              <button onClick={() => setRejectModal(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#525252' }}><Close size={20} /></button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#161616', marginBottom: '0.5rem' }}>
                Reason (optional)
              </label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="e.g. Time looks incorrect"
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', fontFamily: IBM_FONT, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ padding: '1rem 1.5rem', background: '#f4f4f4', borderTop: '1px solid #e0e0e0', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setRejectModal(null)}
                style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#161616', background: '#fff', border: '1px solid #8d8d8d', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  onReject(rejectModal.id, rejectReason.trim() || undefined);
                  setRejectModal(null);
                  flash('success', '✓ Prediction rejected');
                }}
                style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', fontFamily: IBM_FONT, color: '#fff', background: '#da1e28', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <Close size={14} /> Confirm reject
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function LocationView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLocation, setSearchLocation] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minGapsFilter, setMinGapsFilter] = useState('0');
  const [sortBy, setSortBy] = useState('total_gaps');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedLocation, setSelectedLocation] = useState<LocationGapData | null>(null);
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showArchived, setShowArchived] = useState(false);

  // Journey modal state
  const [journeyModal, setJourneyModal] = useState<JourneyModalData | null>(null);

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, minGapsFilter, sortBy, sortOrder, showArchived]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (minGapsFilter !== '0') params.append('minGaps', minGapsFilter);
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);

      const response = await fetch(`/api/locations?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch location data');
      const jsonData: ApiResponse = await response.json();
      setData(jsonData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const openDrawer = async (location: LocationGapData) => {
    setSelectedLocation(location);
    setDrawerOpen(true);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(location.location_stanox)}?pageSize=100`);
      if (!res.ok) throw new Error('Failed to fetch location details');
      const d = await res.json();
      setLocationDetail({
        location_stanox: location.location_stanox,
        location_name:   location.location_name,
        total:           d.total ?? 0,
        gaps:            d.gaps ?? [],
      });
    } catch (err) {
      console.error('Error fetching location details:', err);
      setLocationDetail({
        location_stanox: location.location_stanox,
        location_name:   location.location_name,
        total:           0,
        gaps:            [],
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      setSelectedLocation(null);
      setLocationDetail(null);
    }, 240);
  };

  // Open the journey modal — fetches full stop timeline via predicted-gaps journey endpoint
  const openJourneyModal = useCallback((gap: Gap) => {
    setJourneyModal({
      trainId:             gap.train_id,
      trainUid:            gap.train_uid ?? null,
      scheduleStartDate:   gap.schedule_start_date ?? null,
      severity:            gap.severity ?? null,
      totalScheduledStops: gap.total_scheduled_stops ?? null,
      stops:               null,
      source:              null,
      error:               false,
    });

    const params = new URLSearchParams();
    if (gap.schedule_start_date) params.set('scheduleStartDate', gap.schedule_start_date);
    fetch(`/api/predicted-gaps/journey/${encodeURIComponent(gap.train_id)}?${params}`)
      .then(r => r.json())
      .then((d: { stops?: FullStop[]; source?: string }) => {
        setJourneyModal(prev => prev ? {
          ...prev,
          stops:  d.stops ?? [],
          source: d.source ?? null,
        } : prev);
      })
      .catch(() => {
        setJourneyModal(prev => prev ? { ...prev, error: true } : prev);
      });
  }, []);

  // API actions — operate on the predicted-gaps endpoint and reload modal stops
  const reloadJourneyStops = useCallback((trainId: string, scheduleStartDate: string | null) => {
    const params = new URLSearchParams();
    if (scheduleStartDate) params.set('scheduleStartDate', scheduleStartDate);
    fetch(`/api/predicted-gaps/journey/${encodeURIComponent(trainId)}?${params}`)
      .then(r => r.json())
      .then((d: { stops?: FullStop[]; source?: string }) => {
        setJourneyModal(prev => prev ? { ...prev, stops: d.stops ?? [], source: d.source ?? null } : prev);
      })
      .catch(() => {});
  }, []);

  const approveStop = useCallback(async (id: number) => {
    await fetch(`/api/predicted-gaps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });
    if (journeyModal) reloadJourneyStops(journeyModal.trainId, journeyModal.scheduleStartDate);
  }, [journeyModal, reloadJourneyStops]);

  const approveAllStops = useCallback(async (stops: FullStop[]) => {
    const pendingIds = stops
      .filter(s => s.status === 'MISSED' && (s.approval_status ?? 'PENDING') === 'PENDING' && s.id)
      .map(s => s.id!);
    await Promise.all(pendingIds.map(id => fetch(`/api/predicted-gaps/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })));
    if (journeyModal) reloadJourneyStops(journeyModal.trainId, journeyModal.scheduleStartDate);
  }, [journeyModal, reloadJourneyStops]);

  const amendStop = useCallback(async (id: number, approvedTime: string | null) => {
    await fetch(`/api/predicted-gaps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', approved_time: approvedTime ?? undefined }),
    });
    if (journeyModal) reloadJourneyStops(journeyModal.trainId, journeyModal.scheduleStartDate);
  }, [journeyModal, reloadJourneyStops]);

  const rejectStop = useCallback(async (id: number, reason?: string) => {
    await fetch(`/api/predicted-gaps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
    });
    if (journeyModal) reloadJourneyStops(journeyModal.trainId, journeyModal.scheduleStartDate);
  }, [journeyModal, reloadJourneyStops]);

  const resetStop = useCallback(async (id: number) => {
    await fetch(`/api/predicted-gaps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    });
    if (journeyModal) reloadJourneyStops(journeyModal.trainId, journeyModal.scheduleStartDate);
  }, [journeyModal, reloadJourneyStops]);

  // Filter / paginate
  const filteredLocations = data?.locations.filter(location => {
    const matchesSearch = searchTerm === '' ||
      location.location_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      location.location_stanox.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLocation = searchLocation === 'all' ||
      (searchLocation === 'kent' && KENT_STANOX_CODES.includes(location.location_stanox));
    return matchesSearch && matchesLocation;
  }) || [];

  const filteredSummary = {
    total_gaps: filteredLocations.reduce((sum, loc) => sum + loc.total_gaps, 0),
    locations_affected: filteredLocations.length
  };

  const totalPages = Math.ceil(filteredLocations.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedLocations = filteredLocations.slice(startIndex, startIndex + pageSize);

  if (loading && !data) {
    return (
      <div style={{ padding: '2rem', background: '#ffffff', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <div style={{ fontSize: '1rem', color: '#525252' }}>Loading location data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', background: '#ffffff', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <div style={{ fontSize: '1rem', color: '#da1e28', marginBottom: '1rem' }}>Error: {error}</div>
          <button onClick={fetchData} style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', background: '#0f62fe', color: '#ffffff', border: 'none', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', background: '#ffffff', minHeight: '100vh', fontFamily: IBM_FONT }}>
      {/* Page Header */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: '400', color: '#161616', margin: 0, marginBottom: '0.5rem' }}>
            Location View
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#525252', margin: 0 }}>
            All locations with gaps in the selected time period
          </p>
        </div>
        <PageRefreshCountdown refreshInterval={60000} onRefresh={fetchData} />
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: '#f4f4f4', padding: '1.5rem', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem', fontWeight: '400' }}>Total Gaps</div>
          <div style={{ fontSize: '2.5rem', fontWeight: '300', color: '#161616' }}>{filteredSummary.total_gaps.toLocaleString()}</div>
        </div>
        <div style={{ background: '#f4f4f4', padding: '1.5rem', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem', fontWeight: '400' }}>Locations Affected</div>
          <div style={{ fontSize: '2.5rem', fontWeight: '300', color: '#161616' }}>{filteredSummary.locations_affected.toLocaleString()}</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ background: '#f4f4f4', padding: '1.5rem', border: '1px solid #e0e0e0', marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>Search location</label>
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search location..."
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>Filter by region</label>
            <select value={searchLocation} onChange={e => setSearchLocation(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }}>
              <option value="all">All Locations</option>
              <option value="kent">Kent Only</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>Minimum gaps</label>
            <select value={minGapsFilter} onChange={e => setMinGapsFilter(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }}>
              <option value="0">All</option>
              <option value="1">1+</option>
              <option value="5">5+</option>
              <option value="10">10+</option>
              <option value="20">20+</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>Sort by</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }}>
              <option value="total_gaps">Total Gaps</option>
              <option value="recent">Most Recent</option>
              <option value="gap_percentage">Gap Percentage</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem' }}>Gap Status</label>
            <select value={showArchived ? 'archived' : 'active'} onChange={e => setShowArchived(e.target.value === 'archived')}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #8d8d8d', fontSize: '0.875rem', background: '#ffffff', fontFamily: IBM_FONT }}>
              <option value="active">Active Gaps</option>
              <option value="archived">Archived Gaps</option>
            </select>
          </div>
        </div>
      </div>

      {/* Locations Table */}
      {paginatedLocations.length === 0 ? (
        <div style={{ background: '#ffffff', padding: '3rem', textAlign: 'center', border: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: '0.875rem', color: '#525252' }}>No locations found matching your filters</div>
        </div>
      ) : (
        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0' }}>
          {/* Table Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr', padding: '1rem', background: '#e0e0e0', borderBottom: '1px solid #c6c6c6', fontWeight: '600', fontSize: '0.875rem', color: '#161616' }}>
            <div>Location</div>
            <div style={{ textAlign: 'center' }}>Total Trains</div>
            <div style={{ textAlign: 'center' }}>Gap Count</div>
            <div style={{ textAlign: 'center' }}>Recent Gap</div>
            <div style={{ textAlign: 'center' }}>Gap Percentage</div>
          </div>

          {paginatedLocations.map((location) => (
            <div
              key={location.location_stanox}
              onClick={() => openDrawer(location)}
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr', padding: '1rem', borderBottom: '1px solid #e0e0e0', cursor: 'pointer', position: 'relative' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#e5e5e5'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}
            >
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#161616', marginBottom: '0.25rem' }}>{location.location_name}</div>
                <div style={{ fontSize: '0.75rem', color: '#525252' }}>{location.location_stanox}</div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.875rem', color: '#161616', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {location.total_trains.toLocaleString()}
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.875rem', fontWeight: '600', color: '#161616', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {location.total_gaps.toLocaleString()}
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#525252', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {formatRelativeTime(location.most_recent_gap) || 'N/A'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '2.5rem' }}>
                <span style={{ fontSize: '0.875rem', color: '#161616', minWidth: '40px' }}>{Math.round(location.gap_percentage)}%</span>
                <div style={{ flex: 1, position: 'relative', height: '8px', background: '#e0e0e0', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${Math.min(location.gap_percentage, 100)}%`,
                    background: location.gap_percentage >= 40 ? '#da1e28' : location.gap_percentage >= 20 ? '#ff832b' : location.gap_percentage >= 10 ? '#0f62fe' : '#24a148',
                  }} />
                </div>
              </div>
              <div style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)' }}>
                <ChevronRight size={16} style={{ color: '#161616' }} />
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e0e0e0' }}>
            <div style={{ fontSize: '0.875rem', color: '#525252' }}>
              Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filteredLocations.length)} of {filteredLocations.length}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                style={{ padding: '0.6875rem 1rem', fontSize: '0.875rem', color: currentPage === 1 ? '#c6c6c6' : '#161616', background: '#ffffff', border: 'none', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}>
                Previous
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = i + 1;
                if (totalPages > 5) {
                  if (currentPage > 3 && currentPage < totalPages - 2) pageNum = currentPage - 2 + i;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                }
                return (
                  <button key={pageNum} onClick={() => setCurrentPage(pageNum)}
                    style={{ padding: '0.6875rem 1rem', fontSize: '0.875rem', color: '#161616', background: currentPage === pageNum ? '#e0e0e0' : '#ffffff', border: 'none', cursor: 'pointer', minWidth: '2.5rem' }}>
                    {pageNum}
                  </button>
                );
              })}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                style={{ padding: '0.6875rem 1rem', fontSize: '0.875rem', color: currentPage === totalPages ? '#c6c6c6' : '#161616', background: '#ffffff', border: 'none', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1 }}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Location Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: drawerOpen ? 0 : '-600px', width: '600px', height: '100vh',
        background: '#ffffff', boxShadow: drawerOpen ? '-2px 0 6px rgba(0,0,0,0.3)' : 'none',
        transition: 'right 0.24s cubic-bezier(0.2,0,0.38,0.9)', zIndex: 10000, overflow: 'auto', fontFamily: IBM_FONT,
      }}>
        {selectedLocation && (
          <div style={{ padding: '2rem' }}>
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid #e0e0e0', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.75rem', fontWeight: '400', color: '#161616', margin: 0 }}>Location Details</h2>
              <button onClick={closeDrawer} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem', display: 'flex', alignItems: 'center' }}>
                <Close size={20} style={{ color: '#161616' }} />
              </button>
            </div>

            {loadingDetail ? (
              <div style={{ textAlign: 'center', padding: '2rem', fontSize: '0.875rem', color: '#525252' }}>
                Loading location details...
              </div>
            ) : locationDetail ? (
              <>
                {/* Location Info */}
                <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f4f4f4', border: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Location Name</div>
                  <div style={{ fontSize: '1rem', fontWeight: '600', color: '#161616', marginBottom: '1rem' }}>{locationDetail.location_name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>STANOX</div>
                  <div style={{ fontSize: '1rem', color: '#161616', marginBottom: '1rem' }}>{locationDetail.location_stanox}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e0e0e0' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Total Gaps</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '300', color: '#161616' }}>{selectedLocation.total_gaps}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Total Trains</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '300', color: '#161616' }}>{selectedLocation.total_trains}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Gap %</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '300', color: '#161616' }}>{selectedLocation.gap_percentage.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>

                {/* Gap list */}
                <div style={{ marginBottom: '2rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#161616', marginBottom: '1rem' }}>
                    Predicted Gaps ({locationDetail.total > locationDetail.gaps.length
                      ? `${locationDetail.gaps.length} of ${locationDetail.total}`
                      : locationDetail.gaps.length})
                  </h3>
                  {locationDetail.gaps.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', background: '#f4f4f4', border: '1px solid #e0e0e0', fontSize: '0.875rem', color: '#525252' }}>
                      No predicted gaps found for this location
                    </div>
                  ) : (
                    locationDetail.gaps.map((gap, index) => {
                      const sevColor = gap.severity === 'HIGH'   ? { bg: '#fff1f1', border: '#da1e28', badge: '#da1e28' }
                                     : gap.severity === 'MEDIUM' ? { bg: '#fff8e1', border: '#f1c21b', badge: '#8a3800' }
                                     :                             { bg: '#f4f4f4', border: '#e0e0e0', badge: '#525252' };
                      const confPct = gap.prediction_confidence !== null ? Math.round(gap.prediction_confidence * 100) : null;
                      const approvalStyle: Record<string, React.CSSProperties> = {
                        PENDING:  { background: '#d0e2ff', color: '#0043ce' },
                        APPROVED: { background: '#a7f0ba', color: '#0e6027' },
                        REJECTED: { background: '#ffd7d9', color: '#750e13' },
                      };
                      return (
                        <div key={`${gap.id}-${index}`} style={{ padding: '1rem', background: sevColor.bg, border: `1px solid ${sevColor.border}`, marginBottom: '0.75rem', borderRadius: '2px' }}>
                          {/* Header row */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                            <div>
                              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#0f62fe', marginRight: '0.5rem' }}>{gap.train_id}</span>
                              <span style={{ fontSize: '0.75rem', color: '#525252' }}>UID: {gap.train_uid}</span>
                              {gap.schedule_start_date && (
                                <span style={{ fontSize: '0.75rem', color: '#8d8d8d', marginLeft: '0.5rem' }}>· {gap.schedule_start_date}</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              <span style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '10px', background: sevColor.badge, color: '#fff' }}>
                                {gap.severity}
                              </span>
                              <span style={{ ...(approvalStyle[gap.approval_status] ?? approvalStyle.PENDING), padding: '0.15rem 0.45rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '10px' }}>
                                {gap.approval_status}
                              </span>
                            </div>
                          </div>

                          {/* Times grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                            <div>
                              <div style={{ color: '#525252', marginBottom: '0.1rem' }}>Scheduled</div>
                              <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#161616' }}>{gap.scheduled_time ?? '—'}</div>
                            </div>
                            <div>
                              <div style={{ color: '#525252', marginBottom: '0.1rem' }}>Actual</div>
                              <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: gap.actual_time ? '#0e6027' : '#c6c6c6' }}>
                                {gap.actual_time ?? 'not captured'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: '#525252', marginBottom: '0.1rem' }}>Pred Arr</div>
                              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: gap.predicted_arrival ? '#0f62fe' : '#c6c6c6' }}>
                                {gap.predicted_arrival ?? '—'}
                              </div>
                            </div>
                            <div>
                              <div style={{ color: '#525252', marginBottom: '0.1rem' }}>Pred Dep</div>
                              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: gap.predicted_departure ? '#7c3aed' : '#c6c6c6' }}>
                                {gap.predicted_departure ?? '—'}
                              </div>
                            </div>
                          </div>

                          {/* Footer row */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#6f6f6f', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '0.4rem' }}>
                            <span>
                              {gap.missed_stops_count != null && gap.total_scheduled_stops != null
                                ? `${gap.missed_stops_count} missed / ${gap.total_scheduled_stops} scheduled`
                                : ''}
                            </span>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                              {confPct !== null && (
                                <span style={{ color: confPct >= 80 ? '#0e6027' : confPct >= 60 ? '#8a3800' : '#750e13' }}>
                                  {confPct}% confidence
                                </span>
                              )}
                              {gap.prediction_method && (
                                <span style={{ fontStyle: 'italic' }}>{gap.prediction_method.replace(/_/g, ' ').toLowerCase()}</span>
                              )}
                              <a
                                href={`/trains/${encodeURIComponent(gap.train_id)}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.6rem', fontSize: '0.7rem', color: '#0f62fe', textDecoration: 'none' }}
                              >
                                <Launch size={12} /> Open page
                              </a>
                              <a
                                href={`/journey/${encodeURIComponent(gap.train_id)}${gap.schedule_start_date ? `?scheduleStartDate=${encodeURIComponent(gap.schedule_start_date)}` : ''}`}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.6rem', fontSize: '0.7rem', fontWeight: 600, background: '#0f62fe', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '2px', fontFamily: IBM_FONT, textDecoration: 'none' }}
                              >
                                View journey
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Journey full-screen modal */}
      {journeyModal && (
        <JourneyModal
          data={journeyModal}
          onClose={() => setJourneyModal(null)}
          onApprove={approveStop}
          onApproveAll={approveAllStops}
          onAmend={amendStop}
          onReject={rejectStop}
          onReset={resetStop}
        />
      )}
    </div>
  );
}
