'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, TextInput, Select, SelectItem, Tag, InlineNotification } from '@carbon/react';
import { Renew, Close } from '@carbon/icons-react';

type Station = {
  station_index: number;
  station_name?: string;
  tiploc: string;
  stanox: string;
  status: string;
  visited: boolean;
  scheduled_time?: string;
  actual_time?: string | null;
  event?: string | null;
  // Prediction fields (missed stops only)
  predicted_time?: string | null;
  predicted_time_ms?: number | null;
  predicted_delay_minutes?: number | null;
  prediction_method?: string | null;
  prediction_confidence?: number | null;
  prediction_basis?: Record<string, unknown> | null;
};

type JourneyGapRecord = {
  train_id?: string;
  train_uid?: string;
  schedule_start_date?: string;
  completion_time?: string | number;
  total_scheduled_stops?: number;
  found_stops_count?: number;
  missed_stops_count?: number;
  severity?: string;
  stations?: Station[];
  _offset?: number;
  _ts?: number;
};

function sevTagType(s: string): 'red' | 'warm-gray' | 'green' | 'gray' {
  if (s === 'HIGH')   return 'red';
  if (s === 'MEDIUM') return 'warm-gray';
  if (s === 'LOW')    return 'green';
  return 'gray';
}

function fmtEpoch(v?: string | number | null): string {
  if (!v || v === '0' || v === 0) return '—';
  try { return new Date(Number(v)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return String(v); }
}

export default function KsqlGapsPage() {
  const [records,  setRecords]  = useState<JourneyGapRecord[]>([]);
  const [total,    setTotal]    = useState(0);
  const [fetched,  setFetched]  = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [sev,      setSev]      = useState('');
  const [limit,    setLimit]    = useState(100);
  const [selected, setSelected] = useState<JourneyGapRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (search) p.set('search', search);
      if (sev)    p.set('severity', sev);
      const r = await fetch(`/api/ksql-gaps?${p}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setRecords(d.gaps ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, sev, limit]);

  useEffect(() => { load(); }, [load]);

  const sevCounts = records.reduce((a: Record<string, number>, g) => {
    const s = String(g.severity ?? ''); if (s) a[s] = (a[s] ?? 0) + 1; return a;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">Journey Gaps</h1>
          <p className="ngi-page-subtitle">
            <code>NR_JOURNEY_GAPS</code> · {total.toLocaleString()} total · showing {fetched}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="ngi-kpi-row">
        {['HIGH', 'MEDIUM', 'LOW', 'NONE'].map(s => (
          <div key={s} className="ngi-kpi-tile" style={{ cursor: 'pointer' }} onClick={() => setSev(sev === s ? '' : s)}>
            <div className="label">{s}</div>
            <div className="value" style={{
              color: s === 'HIGH'   ? 'var(--cds-support-error, #da1e28)'
                   : s === 'MEDIUM' ? 'var(--cds-support-warning-text, #8e5a00)'
                   : s === 'LOW'    ? 'var(--cds-support-success, #24a148)'
                   : 'var(--cds-text-secondary)',
            }}>
              {sevCounts[s] ?? 0}
            </div>
            {sev === s && <div className="sub" style={{ color: 'var(--cds-interactive)' }}>● filtered</div>}
          </div>
        ))}
      </div>

      <div className="ngi-toolbar">
        <TextInput
          id="gap-search" labelText="Search" placeholder="train_id, train_uid, station…"
          value={search} onChange={e => setSearch(e.target.value)} size="sm" style={{ width: 220 }}
        />
        <Select id="gap-sev" labelText="Severity" value={sev} onChange={e => setSev(e.target.value)} size="sm">
          <SelectItem value="" text="All Severities" />
          {['HIGH', 'MEDIUM', 'LOW', 'NONE'].map(s => <SelectItem key={s} value={s} text={s} />)}
        </Select>
        <Select id="gap-limit" labelText="Fetch last" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} size="sm">
          {[50, 100, 200, 500].map(n => <SelectItem key={n} value={String(n)} text={String(n)} />)}
        </Select>
        <Button kind="primary" size="sm" renderIcon={Renew} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {error && <InlineNotification kind="error" title="Error" subtitle={error} style={{ marginBottom: '1rem' }} lowContrast />}

      <div style={{ display: 'flex', gap: '1rem' }}>
        {/* Table */}
        <div style={{ flex: 1, background: 'var(--cds-layer-01, #fff)', border: '1px solid var(--cds-border-subtle-01, #e0e0e0)', overflow: 'auto' }}>
          <table className="ngi-table">
            <thead>
              <tr>
                {['Train ID', 'UID', 'Date', 'Scheduled', 'Found', 'Missed', 'Severity', 'Completed'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>Loading…</td></tr>}
              {!loading && records.length === 0 && <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>No gap records found.</td></tr>}
              {records.map((r, i) => {
                const totalStops  = r.total_scheduled_stops ?? (r.stations?.length ?? 0);
                const foundStops  = r.found_stops_count  ?? (r.stations?.filter(s => s.visited).length ?? 0);
                const missedStops = r.missed_stops_count ?? (r.stations?.filter(s => !s.visited).length ?? 0);
                const sevLabel    = r.severity ?? (missedStops >= 4 ? 'HIGH' : missedStops >= 2 ? 'MEDIUM' : missedStops > 0 ? 'LOW' : 'NONE');
                return (
                  <tr
                    key={i}
                    className={`ngi-row-clickable${selected === r ? ' ngi-row-selected' : ''}`}
                    onClick={() => setSelected(r === selected ? null : r)}
                  >
                    <td><code style={{ fontWeight: 600 }}>{String(r.train_id ?? '')}</code></td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{String(r.train_uid ?? '—')}</td>
                    <td style={{ color: 'var(--cds-text-secondary)' }}>{r.schedule_start_date || '—'}</td>
                    <td className="mono">{totalStops}</td>
                    <td className="mono" style={{ color: 'var(--cds-support-success, #24a148)', fontWeight: 600 }}>{foundStops}</td>
                    <td className="mono" style={{ color: missedStops > 0 ? 'var(--cds-support-error, #da1e28)' : 'var(--cds-text-secondary)', fontWeight: missedStops > 0 ? 600 : 400 }}>{missedStops}</td>
                    <td><Tag type={sevTagType(String(sevLabel))} size="sm">{sevLabel}</Tag></td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{fmtEpoch(r.completion_time || r._ts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Flyout */}
        {selected && (
          <div className="ngi-flyout">
            <div className="ngi-flyout-header">
              <div>
                <h2>{selected.train_id}</h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>UID: {selected.train_uid} · {selected.schedule_start_date ?? '—'}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cds-text-secondary)' }}>
                <Close size={16} />
              </button>
            </div>

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Schedule date</dt><dd>{selected.schedule_start_date || '—'}</dd>
                <dt>Completed at</dt> <dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtEpoch(selected.completion_time)}</dd>
                <dt>Found stops</dt>  <dd style={{ color: 'var(--cds-support-success, #24a148)', fontWeight: 600 }}>{selected.found_stops_count ?? 0}</dd>
                <dt>Missed stops</dt> <dd style={{ color: 'var(--cds-support-error, #da1e28)', fontWeight: 600 }}>{selected.missed_stops_count ?? 0}</dd>
                <dt>Severity</dt>     <dd><Tag type={sevTagType(selected.severity ?? '')} size="sm">{selected.severity ?? '—'}</Tag></dd>
              </dl>
            </div>

            {selected.stations && selected.stations.length > 0 && (
              <div className="ngi-flyout-section">
                <div className="ngi-flyout-section-label">
                  Stop progression ({selected.stations.length})
                </div>
                <table className="ngi-table" style={{ fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}>#</th>
                      <th>Station</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'right' }}>Sched</th>
                      <th style={{ textAlign: 'right' }}>Actual / Predicted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.stations.map((s, i) => {
                      const methodShort: Record<string, string> = {
                        ON_TIME_INTERPOLATION:        '≈sched',
                        LINEAR_INTERPOLATION:         '~linear',
                        SINGLE_STATION_EXTRAPOLATION: '~extrap',
                        SCHEDULE_ONLY:                'sched',
                        INSUFFICIENT_DATA:            '?',
                      };
                      return (
                        <tr key={i} style={{ background: !s.visited ? 'var(--cds-support-error-background, #fff1f1)' : undefined }}>
                          <td style={{ color: 'var(--cds-text-placeholder)', textAlign: 'right', paddingRight: 4 }}>
                            {s.station_index ?? i + 1}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{s.station_name || s.tiploc}</div>
                            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.68rem', color: 'var(--cds-text-secondary)' }}>
                              {s.tiploc} · {s.stanox}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <Tag type={s.visited ? 'green' : 'red'} size="sm">
                              {s.visited ? 'found' : 'missed'}
                            </Tag>
                          </td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--cds-text-secondary)' }}>
                            {s.scheduled_time || '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {s.visited ? (
                              <span className="mono">{s.actual_time || '—'}</span>
                            ) : s.predicted_time ? (
                              <span>
                                <span className="mono" style={{ color: 'var(--cds-interactive, #0f62fe)' }}>
                                  {s.predicted_time}
                                </span>
                                <br />
                                <span style={{
                                  fontSize: '0.65rem',
                                  color: 'var(--cds-text-secondary)',
                                  fontFamily: "'IBM Plex Mono', monospace",
                                }}>
                                  {methodShort[s.prediction_method ?? ''] ?? s.prediction_method}
                                  {s.predicted_delay_minutes != null && s.predicted_delay_minutes !== 0
                                    ? ` ${s.predicted_delay_minutes > 0 ? '+' : ''}${s.predicted_delay_minutes}m`
                                    : ''}
                                  {s.prediction_confidence != null
                                    ? ` ${Math.round(s.prediction_confidence * 100)}%`
                                    : ''}
                                </span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--cds-text-placeholder)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Kafka offset</dt><dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{selected._offset ?? '—'}</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
