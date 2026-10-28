'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatTime } from '@/lib/format-time';

interface DelayedTrain {
  train_id: string;
  train_uid: string;
  schedule_start_date: string;
  total_scheduled_stops: number;
  found_stops_count: number;
  missed_stops_count: number;
  severity: string;
  origin_station: string;
  origin_event: string | null;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  delay_minutes: number;
  crosses_midnight: boolean;
  predicted_reason?: string | null;
  received_at: string;
}

/** Badge shown when a time falls on the next calendar day after schedule_start_date. */
function NextDayBadge() {
  return (
    <span style={{
      display: 'inline-block',
      marginLeft: '0.2rem',
      padding: '0.05rem 0.28rem',
      fontSize: '0.6rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      background: '#ede9fe',
      color: '#6d28d9',
      border: '1px solid #c4b5fd',
      borderRadius: '3px',
      verticalAlign: 'middle',
      lineHeight: 1.4,
    }}>
      +1d
    </span>
  );
}

// Event pill styles — one pill per NR event type that occurred at the origin stop.
const EVENT_PILL: Record<string, { bg: string; color: string; border: string }> = {
  ACTIVATED:    { bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe' },
  ARR:          { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  DEP:          { bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
  TERMINATED:   { bg: '#fff1f1', color: '#991b1b', border: '#fca5a5' },
  CANCELLATION: { bg: '#ffd7d9', color: '#991b1b', border: '#f87171' },
};

function EventPills({ t }: { t: DelayedTrain }) {
  const pills: string[] = [];
  const ev = (t.origin_event ?? '').toUpperCase();

  if (ev.includes('ACTIVATED'))               pills.push('ACTIVATED');

  if (t.actual_arrival)                       pills.push('ARR');
  else if (ev.includes('ARR'))                pills.push('ARR');

  if (t.actual_departure)                     pills.push('DEP');
  else if (ev.includes('DEP') || ev.includes('DEPARTURE')) pills.push('DEP');

  if (ev.includes('TERMINAT'))               pills.push('TERMINATED');
  if (ev.includes('CANCEL'))                 pills.push('CANCELLATION');

  // Fallback: if nothing resolved and we know it ran, show ACTIVATED
  if (pills.length === 0)                    pills.push('ACTIVATED');

  return (
    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
      {pills.map(p => {
        const s = EVENT_PILL[p] ?? { bg: '#e5e7eb', color: '#374151', border: '#d1d5db' };
        return (
          <span key={p} style={{
            display: 'inline-block',
            padding: '0.15rem 0.45rem',
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

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  HIGH:   { bg: '#fee2e2', text: '#991b1b' },
  MEDIUM: { bg: '#fef3c7', text: '#92400e' },
  LOW:    { bg: '#dcfce7', text: '#166534' },
  NONE:   { bg: '#f3f4f6', text: '#374151' },
};

const DELAY_STYLES = (mins: number) => {
  if (mins >= 30) return { bg: '#fee2e2', text: '#991b1b', label: 'Severely late' };
  if (mins >= 10) return { bg: '#fef3c7', text: '#92400e', label: 'Late' };
  return              { bg: '#dcfce7', text: '#166534', label: 'Slightly late' };
};

export default function DelayedTrainsPage() {
  const [trains, setTrains]       = useState<DelayedTrain[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [minDelay, setMinDelay]   = useState(5);
  const [hours, setHours]         = useState(4);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchDelayed = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/delayed-trains?min_delay=${minDelay}&hours=${hours}&limit=300`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTrains(data.trains || []);
      setLastRefresh(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [minDelay, hours]);

  useEffect(() => {
    setLoading(true);
    fetchDelayed();
    const id = setInterval(fetchDelayed, 30_000);
    return () => clearInterval(id);
  }, [fetchDelayed]);

  const stats = {
    total:        trains.length,
    severe:       trains.filter(t => t.delay_minutes >= 30).length,
    moderate:     trains.filter(t => t.delay_minutes >= 10 && t.delay_minutes < 30).length,
    avgDelay:     trains.length
      ? Math.round(trains.reduce((s, t) => s + t.delay_minutes, 0) / trains.length)
      : 0,
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Delayed Trains
          </h1>
          <p style={{ color: '#6b7280', marginTop: '0.25rem', fontSize: '0.875rem' }}>
            Completed journeys where the first recorded stop was later than scheduled.
            {lastRefresh && (
              <span style={{ marginLeft: '0.75rem', color: '#9ca3af' }}>
                Updated {lastRefresh.toLocaleTimeString('en-GB')}
              </span>
            )}
          </p>
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex', gap: '1rem', alignItems: 'center',
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
          padding: '0.75rem 1rem', marginBottom: '1.25rem', flexWrap: 'wrap',
        }}>
          <label style={{ fontSize: '0.875rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Min delay
            <select
              value={minDelay}
              onChange={e => setMinDelay(Number(e.target.value))}
              style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
            >
              {[1, 5, 10, 15, 30].map(v => (
                <option key={v} value={v}>{v} min</option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: '0.875rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Look-back
            <select
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
              style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
            >
              {[1, 2, 4, 8, 12, 24].map(v => (
                <option key={v} value={v}>{v}h</option>
              ))}
            </select>
          </label>

          <button
            onClick={() => { setLoading(true); fetchDelayed(); }}
            style={{
              marginLeft: 'auto', padding: '0.375rem 0.875rem',
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
            }}
          >
            Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {[
            { label: 'Delayed trains',      value: stats.total,    color: '#1d4ed8' },
            { label: 'Severe (≥30 min)',     value: stats.severe,   color: '#dc2626' },
            { label: 'Moderate (10–29 min)', value: stats.moderate, color: '#d97706' },
            { label: 'Avg delay (min)',       value: stats.avgDelay, color: '#374151' },
          ].map(card => (
            <div key={card.label} style={{
              background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: '8px', padding: '1rem',
            }}>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>{card.label}</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
              <div style={{
                width: '2.5rem', height: '2.5rem', borderRadius: '50%',
                border: '3px solid #e5e7eb', borderTopColor: '#2563eb',
                animation: 'spin 0.8s linear infinite', margin: '0 auto 0.75rem',
              }} />
              Loading…
            </div>
          ) : error ? (
            <div style={{ padding: '2rem', color: '#dc2626', textAlign: 'center' }}>{error}</div>
          ) : trains.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>
              No delayed trains found for the selected filters.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Train ID', 'UID', 'Date', 'Origin station', 'Events', 'Sched Arr', 'Act Arr (delay basis)', 'Act Dep', 'Delay', 'Predicted reason for delay', 'Severity', 'Stops', ''].map(h => (
                    <th key={h} style={{
                      padding: '0.75rem 1rem', textAlign: 'left',
                      fontSize: '0.7rem', fontWeight: 600,
                      color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trains.map((t, i) => {
                   const delay  = DELAY_STYLES(t.delay_minutes);
                   const sev    = SEVERITY_STYLES[t.severity] ?? SEVERITY_STYLES.NONE;

                   return (
                     <tr
                       key={`${t.train_id}-${t.schedule_start_date}`}
                       style={{
                         borderBottom: i < trains.length - 1 ? '1px solid #f3f4f6' : 'none',
                         background: i % 2 === 0 ? '#fff' : '#fafafa',
                       }}
                     >
                       <td style={{ padding: '0.625rem 1rem', fontWeight: 600, fontFamily: 'monospace' }}>
                          <Link
                            href={`/trains/${encodeURIComponent(t.train_id)}${t.schedule_start_date ? `?scheduleStartDate=${encodeURIComponent(t.schedule_start_date)}` : ''}`}
                            style={{ color: '#111827', textDecoration: 'none' }}
                          >
                            {t.train_id}
                          </Link>
                        </td>
                       <td style={{ padding: '0.625rem 1rem', color: '#374151', fontFamily: 'monospace' }}>
                         {t.train_uid || '—'}
                       </td>
                       <td style={{ padding: '0.625rem 1rem', color: '#6b7280' }}>
                         {t.schedule_start_date || '—'}
                       </td>
                       <td style={{ padding: '0.625rem 1rem', color: '#374151', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                         {t.origin_station || '—'}
                       </td>
                       {/* Event pills — ACTIVATED always, plus ARR / DEP if those events occurred */}
                       <td style={{ padding: '0.5rem 1rem' }}>
                         <EventPills t={t} />
                       </td>
                       {/* Scheduled Arrival — the reference time for delay */}
                       <td style={{ padding: '0.625rem 1rem', color: '#374151', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                         {t.scheduled_arrival ? formatTime(t.scheduled_arrival) ?? t.scheduled_arrival : <span style={{ color: '#9ca3af' }}>—</span>}
                       </td>
                       {/* Actual Arrival — delay basis; +1d badge when it crossed midnight */}
                       <td style={{ padding: '0.625rem 1rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                         {t.actual_arrival
                           ? <span style={{ color: '#16a34a', fontWeight: 700 }}>
                               {formatTime(t.actual_arrival) ?? t.actual_arrival}
                               {t.crosses_midnight && <NextDayBadge />}
                             </span>
                           : <span style={{ color: '#9ca3af' }}>—</span>}
                       </td>
                       {/* Actual Departure — informational only */}
                       <td style={{ padding: '0.625rem 1rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                         {t.actual_departure
                           ? <span style={{ color: '#2563eb' }}>
                               {formatTime(t.actual_departure) ?? t.actual_departure}
                               {t.crosses_midnight && <NextDayBadge />}
                             </span>
                           : <span style={{ color: '#9ca3af' }}>—</span>}
                       </td>
                       {/* Delay */}
                       <td style={{ padding: '0.625rem 1rem' }}>
                         <span style={{
                           display: 'inline-block', padding: '0.2rem 0.6rem',
                           borderRadius: '9999px', fontWeight: 700,
                           fontSize: '0.8rem',
                           background: delay.bg, color: delay.text,
                         }}>
                           +{t.delay_minutes} min
                           {t.crosses_midnight && <NextDayBadge />}
                         </span>
                       </td>
                      <td style={{ padding: '0.625rem 1rem', fontSize: '0.8rem', color: '#4b5563', width: '140px', maxWidth: '140px' }}>
                        {t.predicted_reason ? (
                          <span style={{ display: 'block', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>
                            {t.predicted_reason}
                          </span>
                        ) : (
                          <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '0.625rem 1rem' }}>
                        <span style={{
                          display: 'inline-block', padding: '0.15rem 0.5rem',
                          borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                          background: sev.bg, color: sev.text,
                        }}>
                          {t.severity}
                        </span>
                      </td>
                      <td style={{ padding: '0.625rem 1rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {t.found_stops_count}/{t.total_scheduled_stops}
                      </td>
                      <td style={{ padding: '0.625rem 1rem', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <Link
                            href={`/trains/${encodeURIComponent(t.train_id)}${t.schedule_start_date ? `?scheduleStartDate=${encodeURIComponent(t.schedule_start_date)}` : ''}`}
                            style={{
                              display: 'inline-block', padding: '0.25rem 0.65rem',
                              border: '1px solid #d1d5db', borderRadius: '5px',
                              color: '#374151', background: '#fff',
                              textDecoration: 'none', fontSize: '0.78rem', fontWeight: 500,
                            }}
                          >
                            Detail
                          </Link>
                          <Link
                            href={`/journey/${encodeURIComponent(t.train_id)}${t.schedule_start_date ? `?scheduleStartDate=${encodeURIComponent(t.schedule_start_date)}` : ''}`}
                            style={{
                              display: 'inline-block', padding: '0.25rem 0.65rem',
                              border: '1px solid #2563eb', borderRadius: '5px',
                              color: '#2563eb', background: '#fff',
                              textDecoration: 'none', fontSize: '0.78rem', fontWeight: 500,
                            }}
                          >
                            Journey
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {trains.length > 0 && (
          <p style={{ textAlign: 'right', fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            {trains.length} train{trains.length !== 1 ? 's' : ''} · refreshes every 30 s
          </p>
        )}
      </div>

      {/* keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
