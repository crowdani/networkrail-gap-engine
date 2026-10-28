'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, TextInput, Select, SelectItem, Tag, InlineNotification, Toggle } from '@carbon/react';
import { Renew, Close, Time, CheckmarkFilled, WarningFilled } from '@carbon/icons-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PredictionMethod =
  | 'ON_TIME_INTERPOLATION'
  | 'LINEAR_INTERPOLATION'
  | 'SINGLE_STATION_EXTRAPOLATION'
  | 'SCHEDULE_ONLY'
  | 'INSUFFICIENT_DATA';

type Station = {
  station_index:          number;
  station_name?:          string;
  tiploc:                 string;
  stanox:                 string;
  visited:                boolean;
  scheduled_time?:        string | null;
  actual_time?:           string | null;
  // prediction (missed stops only)
  predicted_time?:        string | null;
  predicted_time_ms?:     number | null;
  predicted_delay_minutes?: number | null;
  prediction_method?:     PredictionMethod | null;
  prediction_confidence?: number | null;
  prediction_basis?:      Record<string, unknown> | null;
};

type PredictionSummary = {
  total_missed:    number;
  total_predicted: number;
  methods:         Record<string, number>;
};

type GapRecord = {
  train_id?:              string;
  train_uid?:             string;
  schedule_start_date?:   string;
  completion_time?:       string | number;
  total_scheduled_stops?: number;
  found_stops_count?:     number;
  missed_stops_count?:    number;
  severity?:              string;
  stations?:              Station[];
  prediction_summary?:    PredictionSummary;
  _offset?:               number;
  _ts?:                   number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METHOD_LABEL: Record<string, string> = {
  ON_TIME_INTERPOLATION:        'On-time',
  LINEAR_INTERPOLATION:         'Linear',
  SINGLE_STATION_EXTRAPOLATION: 'Extrapolated',
  SCHEDULE_ONLY:                'Schedule',
  INSUFFICIENT_DATA:            'No data',
};

const METHOD_TAG: Record<string, 'green' | 'teal' | 'blue' | 'gray' | 'warm-gray'> = {
  ON_TIME_INTERPOLATION:        'green',
  LINEAR_INTERPOLATION:         'teal',
  SINGLE_STATION_EXTRAPOLATION: 'blue',
  SCHEDULE_ONLY:                'gray',
  INSUFFICIENT_DATA:            'warm-gray',
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

function confidencePct(c?: number | null): string {
  if (c == null) return '—';
  return `${Math.round(c * 100)}%`;
}

function delayLabel(min?: number | null): string | null {
  if (min == null) return null;
  if (min === 0) return 'on time';
  return `${min > 0 ? '+' : ''}${min} min`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function fmtKpi(value: string | number): string {
  if (typeof value !== 'number') return String(value);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000)    return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function KpiTile({ label, value, sub, accent, onClick, active }: {
  label: string; value: string | number; sub?: string;
  accent?: string; onClick?: () => void; active?: boolean;
}) {
  const display = fmtKpi(value);
  const compact  = typeof value === 'number' && value >= 10_000;
  return (
    <div
      className="ngi-kpi-tile"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, outline: active ? '2px solid var(--cds-interactive)' : undefined }}
    >
      <div className="label">{label}</div>
      <div className={`value${compact ? ' compact' : ''}`} style={accent ? { color: accent } : undefined}>
        {display}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function recordKey(r: GapRecord): string {
  return `${r.train_id ?? ''}|${r._offset ?? ''}`;
}

export default function PredictedGapsPage() {
  const [records,     setRecords]     = useState<GapRecord[]>([]);
  const [total,       setTotal]       = useState(0);
  const [fetched,     setFetched]     = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [search,      setSearch]      = useState('');
  const [sev,         setSev]         = useState('');
  const [method,      setMethod]      = useState('');
  const [limit,       setLimit]       = useState(100);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (search) p.set('search', search);
      if (sev)    p.set('severity', sev);
      if (method) p.set('method', method);
      const r = await fetch(`/api/predicted-gaps?${p}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setRecords(d.gaps ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, sev, method, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // ----------- Aggregates ------------------------------------------------
  const sevCounts: Record<string, number> = {};
  const methodCounts: Record<string, number> = {};
  let totalMissed = 0;
  let totalPredicted = 0;

  for (const r of records) {
    const s = r.severity ?? 'NONE';
    sevCounts[s] = (sevCounts[s] ?? 0) + 1;
    totalMissed    += r.prediction_summary?.total_missed    ?? r.missed_stops_count ?? 0;
    totalPredicted += r.prediction_summary?.total_predicted ?? 0;
    for (const [m, c] of Object.entries(r.prediction_summary?.methods ?? {})) {
      methodCounts[m] = (methodCounts[m] ?? 0) + c;
    }
  }

  const selected = selectedKey ? (records.find(r => recordKey(r) === selectedKey) ?? null) : null;

  const coveragePct = totalMissed > 0
    ? Math.round((totalPredicted / totalMissed) * 100)
    : 0;

  // ----------- Render ----------------------------------------------------
  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">Predicted Gap Infill</h1>
          <p className="ngi-page-subtitle">
            <code>NR_JOURNEY_GAPS_PREDICTED</code> · {total.toLocaleString()} total · showing {fetched}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Toggle id="pg-auto" labelText="" labelA="Auto off" labelB="Auto on"
            toggled={autoRefresh} onToggle={setAutoRefresh} size="sm" />
          <Button kind="primary" size="sm" renderIcon={Renew} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* ── KPI row ────────────────────────────────────────────────── */}
      <div className="ngi-kpi-row">
        <KpiTile label="Journeys with gaps"  value={records.length}  sub="in current view" />
        <KpiTile label="Total missed stops"  value={totalMissed}     sub="across all journeys"
          accent="var(--cds-support-error, #da1e28)" />
        <KpiTile label="Stops predicted"     value={totalPredicted}  sub="infill coverage"
          accent="var(--cds-interactive, #0f62fe)" />
        <KpiTile label="Coverage"            value={`${coveragePct}%`}
          sub={`${totalPredicted} of ${totalMissed} missed`}
          accent={coveragePct >= 80 ? 'var(--cds-support-success, #24a148)' : 'var(--cds-support-warning-text, #8e5a00)'} />
        {(['HIGH','MEDIUM','LOW'] as const).map(s => (
          <KpiTile key={s} label={s} value={sevCounts[s] ?? 0} sub="journeys"
            onClick={() => setSev(sev === s ? '' : s)}
            active={sev === s}
            accent={s === 'HIGH' ? 'var(--cds-support-error, #da1e28)' : s === 'MEDIUM' ? 'var(--cds-support-warning-text, #8e5a00)' : 'var(--cds-support-success, #24a148)'} />
        ))}
      </div>

      {/* ── Method breakdown ───────────────────────────────────────── */}
      {Object.keys(methodCounts).length > 0 && (
        <section style={{ marginBottom: '1.25rem' }}>
          <h2 className="ngi-section-label">Prediction Methods Used</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {Object.entries(methodCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([m, c]) => (
                <Tag
                  key={m}
                  type={METHOD_TAG[m] ?? 'gray'}
                  size="md"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setMethod(method === m ? '' : m)}
                >
                  {METHOD_LABEL[m] ?? m}: {c}
                  {method === m && ' ✕'}
                </Tag>
              ))}
          </div>
        </section>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="ngi-toolbar">
        <TextInput id="pg-search" labelText="Search" placeholder="train ID, UID, station…"
          value={search} onChange={e => setSearch(e.target.value)} size="sm" style={{ width: 220 }} />
        <Select id="pg-sev" labelText="Severity" value={sev} onChange={e => setSev(e.target.value)} size="sm">
          <SelectItem value="" text="All Severities" />
          {['HIGH','MEDIUM','LOW','NONE'].map(s => <SelectItem key={s} value={s} text={s} />)}
        </Select>
        <Select id="pg-method" labelText="Prediction method" value={method} onChange={e => setMethod(e.target.value)} size="sm">
          <SelectItem value="" text="All Methods" />
          {Object.entries(METHOD_LABEL).map(([v, t]) => <SelectItem key={v} value={v} text={t} />)}
        </Select>
        <Select id="pg-limit" labelText="Fetch last" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} size="sm">
          {[50,100,200,500].map(n => <SelectItem key={n} value={String(n)} text={String(n)} />)}
        </Select>
      </div>

      {error && <InlineNotification kind="error" title="Error" subtitle={error} style={{ marginBottom: '1rem' }} lowContrast />}

      {/* ── Main split ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>

        {/* Table */}
        <div style={{ flex: 1, background: 'var(--cds-layer-01,#fff)', border: '1px solid var(--cds-border-subtle-01,#e0e0e0)', overflow: 'auto' }}>
          <table className="ngi-table">
            <thead>
              <tr>
                {['Train ID','UID','Date','Sched','Found','Missed','Predicted','Coverage','Severity'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>Loading…</td></tr>}
              {!loading && records.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>
                  No predicted gap records found.
                </td></tr>
              )}
              {records.map((r, i) => {
                const missed    = r.missed_stops_count ?? 0;
                const predicted = r.prediction_summary?.total_predicted ?? 0;
                const cov       = missed > 0 ? Math.round((predicted / missed) * 100) : 100;
                return (
                  <tr key={i}
                    className={`ngi-row-clickable${selectedKey === recordKey(r) ? ' ngi-row-selected' : ''}`}
                    onClick={() => { const k = recordKey(r); setSelectedKey(selectedKey === k ? null : k); }}
                  >
                    <td><code style={{ fontWeight: 600 }}>{r.train_id ?? '—'}</code></td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{r.train_uid ?? '—'}</td>
                    <td style={{ color: 'var(--cds-text-secondary)' }}>{r.schedule_start_date ?? '—'}</td>
                    <td className="mono">{r.total_scheduled_stops ?? '—'}</td>
                    <td className="mono" style={{ color: 'var(--cds-support-success,#24a148)', fontWeight: 600 }}>{r.found_stops_count ?? 0}</td>
                    <td className="mono" style={{ color: missed > 0 ? 'var(--cds-support-error,#da1e28)' : 'var(--cds-text-secondary)', fontWeight: missed > 0 ? 600 : 400 }}>{missed}</td>
                    <td className="mono" style={{ color: 'var(--cds-interactive,#0f62fe)', fontWeight: 600 }}>{predicted}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="ngi-bar-wrap">
                          <span className="ngi-bar-fill" style={{ width: `${cov}%`, background: cov === 100 ? 'var(--cds-support-success,#24a148)' : cov >= 50 ? 'var(--cds-interactive,#0f62fe)' : 'var(--cds-support-warning,#f1c21b)' }} />
                        </span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{cov}%</span>
                      </div>
                    </td>
                    <td><Tag type={sevTagType(r.severity ?? '')} size="sm">{r.severity ?? '—'}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Detail flyout ─────────────────────────────────────────── */}
        {selected && (
          <div className="ngi-flyout" style={{ width: 480 }}>
            <div className="ngi-flyout-header">
              <div>
                <h2>{selected.train_id}</h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>
                  UID: {selected.train_uid ?? '—'} · {selected.schedule_start_date ?? '—'}
                </div>
              </div>
              <button onClick={() => setSelectedKey(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cds-text-secondary)' }}>
                <Close size={16} />
              </button>
            </div>

            {/* Summary */}
            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Severity</dt>        <dd><Tag type={sevTagType(selected.severity ?? '')} size="sm">{selected.severity ?? '—'}</Tag></dd>
                <dt>Scheduled stops</dt> <dd className="mono">{selected.total_scheduled_stops ?? '—'}</dd>
                <dt>Found</dt>           <dd style={{ color: 'var(--cds-support-success,#24a148)', fontWeight: 600 }}>{selected.found_stops_count ?? 0}</dd>
                <dt>Missed</dt>          <dd style={{ color: 'var(--cds-support-error,#da1e28)', fontWeight: 600 }}>{selected.missed_stops_count ?? 0}</dd>
                <dt>Predicted</dt>       <dd style={{ color: 'var(--cds-interactive,#0f62fe)', fontWeight: 600 }}>{selected.prediction_summary?.total_predicted ?? 0}</dd>
                <dt>Completed at</dt>    <dd className="mono" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmtEpoch(selected.completion_time)}</dd>
              </dl>
            </div>

            {/* Method breakdown for this journey */}
            {selected.prediction_summary?.methods && Object.keys(selected.prediction_summary.methods).length > 0 && (
              <div className="ngi-flyout-section">
                <div className="ngi-flyout-section-label">Prediction methods</div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {Object.entries(selected.prediction_summary.methods).map(([m, c]) => (
                    <Tag key={m} type={METHOD_TAG[m] ?? 'gray'} size="sm">
                      {METHOD_LABEL[m] ?? m} × {c}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            {/* Stop-by-stop progression */}
            {selected.stations && selected.stations.length > 0 && (
              <div className="ngi-flyout-section">
                <div className="ngi-flyout-section-label">
                  Stop progression ({selected.stations.length} stops)
                </div>
                <table className="ngi-table" style={{ fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}>#</th>
                      <th>Station</th>
                      <th style={{ textAlign: 'center', width: 56 }}>Status</th>
                      <th style={{ textAlign: 'right' }}>Sched</th>
                      <th style={{ textAlign: 'right' }}>Actual / Predicted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.stations.map((s, i) => (
                      <tr key={i} style={{ background: !s.visited ? 'var(--cds-support-error-background,#fff1f1)' : undefined }}>
                        <td style={{ color: 'var(--cds-text-placeholder)', textAlign: 'right', paddingRight: 4 }}>
                          {s.station_index ?? i + 1}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                            {s.station_name || s.tiploc}
                          </div>
                          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: 'var(--cds-text-secondary)' }}>
                            {s.tiploc} · {s.stanox}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {s.visited
                            ? <CheckmarkFilled size={14} style={{ color: 'var(--cds-support-success,#24a148)' }} />
                            : <WarningFilled   size={14} style={{ color: 'var(--cds-support-error,#da1e28)' }} />
                          }
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--cds-text-secondary)' }}>
                          {s.scheduled_time || '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {s.visited ? (
                            <span className="mono">{s.actual_time || '—'}</span>
                          ) : s.predicted_time ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.3rem' }}>
                                <Time size={10} style={{ color: 'var(--cds-interactive,#0f62fe)', flexShrink: 0 }} />
                                <span className="mono" style={{ color: 'var(--cds-interactive,#0f62fe)', fontWeight: 600 }}>
                                  {s.predicted_time}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.63rem', color: 'var(--cds-text-secondary)', fontFamily: "'IBM Plex Mono',monospace", textAlign: 'right', marginTop: 1 }}>
                                <Tag type={METHOD_TAG[s.prediction_method ?? ''] ?? 'gray'} size="sm" style={{ fontSize: '0.6rem' }}>
                                  {METHOD_LABEL[s.prediction_method ?? ''] ?? s.prediction_method}
                                </Tag>
                                {delayLabel(s.predicted_delay_minutes) && (
                                  <span style={{ marginLeft: 3 }}>{delayLabel(s.predicted_delay_minutes)}</span>
                                )}
                                {s.prediction_confidence != null && (
                                  <span style={{ marginLeft: 4, color: 'var(--cds-text-placeholder)' }}>
                                    {confidencePct(s.prediction_confidence)}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--cds-text-placeholder)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Kafka offset</dt>
                <dd style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{selected._offset ?? '—'}</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
