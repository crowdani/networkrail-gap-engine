'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Button, TextInput, Select, SelectItem, Tag, InlineNotification, Toggle,
} from '@carbon/react';
import {
  Renew, Close, CheckmarkFilled, WarningFilled, Launch,
  ArrowUp, ArrowDown,
} from '@carbon/icons-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Station = {
  station_index:           number;
  station_name?:           string;
  tiploc:                  string;
  stanox:                  string;
  visited:                 boolean;
  scheduled_time?:         string | null;
  actual_time?:            string | null;
  delay_minutes?:          number | null;
  predicted_time?:         string | null;
  predicted_delay_minutes?: number | null;
  prediction_method?:      string | null;
  prediction_confidence?:  number | null;
};

type JourneyDelay = {
  is_delayed:         boolean;
  max_delay_minutes:  number | null;
  avg_delay_minutes:  number | null;
  delayed_stops:      number;
};

type DelayAnalysis = {
  cause:           string;
  category:        string;
  confidence:      number;
  detail:          string;
  approval_status: string;
  model_id:        string;
  generated_at:    string;
} | null;

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
  journey_delay?:         JourneyDelay;
  delay_analysis?:        DelayAnalysis;
  prediction_summary?:    { total_missed: number; total_predicted: number; methods: Record<string, number> };
  _offset?:               number;
  _ts?:                   number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, 'red' | 'purple' | 'teal' | 'cyan' | 'magenta' | 'gray'> = {
  INFRASTRUCTURE:  'red',
  ROLLING_STOCK:   'purple',
  OPERATIONAL:     'teal',
  TIMETABLING:     'cyan',
  EXTERNAL:        'magenta',
  UNKNOWN:         'gray',
};

const SEV_TAG: Record<string, 'red' | 'warm-gray' | 'green' | 'gray'> = {
  HIGH: 'red', MEDIUM: 'warm-gray', LOW: 'green', NONE: 'gray',
};

function fmtEpoch(v?: string | number | null): string {
  if (!v || v === '0' || v === 0) return '—';
  try { return new Date(Number(v)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return String(v); }
}

function delayLabel(min?: number | null): string {
  if (min == null) return '—';
  if (min === 0)   return 'on time';
  return `${min > 0 ? '+' : ''}${min} min`;
}

/**
 * Build a Realtime Trains URL for a given UID and date.
 * Falls back gracefully if the date is missing or unparseable.
 */
function getRealtimeTrainsUrl(trainUid: string | undefined, dateStr: string | undefined): string | null {
  if (!trainUid) return null;
  // Prefer schedule_start_date (already YYYY-MM-DD), otherwise try completion_time epoch
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return `https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${dateStr}/detailed`;
  }
  return null;
}

function confidencePct(c?: number | null): string {
  if (c == null) return '';
  return `${Math.round(c * 100)}%`;
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

function DelayBadge({ jd }: { jd?: JourneyDelay | null }) {
  if (!jd) return <span style={{ color: 'var(--cds-text-placeholder)' }}>—</span>;
  if (!jd.is_delayed) {
    return <span style={{ color: 'var(--cds-support-success,#24a148)', fontWeight: 600, fontSize: '0.75rem' }}>On time</span>;
  }
  return (
    <span style={{ color: 'var(--cds-support-error,#da1e28)', fontWeight: 600, fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 2 }}>
      <ArrowUp size={12} />
      {jd.max_delay_minutes != null ? `+${jd.max_delay_minutes} min` : 'Delayed'}
    </span>
  );
}

function LlmAnalysisPanel({ da }: { da?: DelayAnalysis }) {
  if (!da) {
    return (
      <div style={{ padding: '0.75rem', background: 'var(--cds-layer-02,#f4f4f4)', borderRadius: 4, color: 'var(--cds-text-placeholder)', fontSize: '0.8rem' }}>
        No AI analysis (journey ran on time with no gaps)
      </div>
    );
  }
  if (da.cause === 'ANALYSIS_UNAVAILABLE') {
    return (
      <div style={{ padding: '0.75rem', background: 'var(--cds-layer-02,#f4f4f4)', borderRadius: 4, color: 'var(--cds-support-warning-text,#8e5a00)', fontSize: '0.8rem' }}>
        Analysis unavailable: {da.detail}
      </div>
    );
  }

  const approvalColor =
    da.approval_status === 'APPROVED'  ? 'var(--cds-support-success,#24a148)' :
    da.approval_status === 'REJECTED'  ? 'var(--cds-support-error,#da1e28)'   :
    'var(--cds-support-warning-text,#8e5a00)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {/* Category + confidence + approval */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Tag type={CATEGORY_COLORS[da.category] ?? 'gray'} size="sm">{da.category}</Tag>
        {confidencePct(da.confidence) && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cds-text-secondary)', fontFamily: "'IBM Plex Mono',monospace" }}>
            {confidencePct(da.confidence)} confidence
          </span>
        )}
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: approvalColor, marginLeft: 'auto' }}>
          {da.approval_status}
        </span>
      </div>

      {/* Cause */}
      <p style={{ margin: 0, fontWeight: 600, fontSize: '0.825rem', color: 'var(--cds-text-primary,#161616)', lineHeight: 1.4 }}>
        {da.cause}
      </p>

      {/* Detail */}
      <p style={{ margin: 0, fontSize: '0.775rem', color: 'var(--cds-text-secondary)', lineHeight: 1.5 }}>
        {da.detail}
      </p>

      {/* Footer */}
      <div style={{ fontSize: '0.65rem', color: 'var(--cds-text-placeholder)', fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>
        {da.model_id} · {da.generated_at ? new Date(da.generated_at).toLocaleString('en-GB') : ''}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// Stable key for a record — used to preserve selection across re-renders
function recordKey(r: GapRecord): string {
  return `${r.train_id ?? ''}|${r._offset ?? ''}`;
}

export default function AnalysedGapsPage() {
  const [records,     setRecords]     = useState<GapRecord[]>([]);
  const [total,       setTotal]       = useState(0);
  const [fetched,     setFetched]     = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [search,      setSearch]      = useState('');
  const [sev,         setSev]         = useState('');
  const [delayed,     setDelayed]     = useState('');
  const [category,    setCategory]    = useState('');
  const [limit,       setLimit]       = useState(100);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (search)   p.set('search',   search);
      if (sev)      p.set('severity', sev);
      if (delayed)  p.set('delayed',  delayed);
      if (category) p.set('category', category);
      const r = await fetch(`/api/analysed-gaps?${p}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setRecords(d.gaps ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, sev, delayed, category, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Derive selected record from stable key — survives re-renders
  const selected = selectedKey ? (records.find(r => recordKey(r) === selectedKey) ?? null) : null;

  // Aggregates
  const totalJourneys  = records.length;
  const delayedCount   = records.filter(r => r.journey_delay?.is_delayed).length;
  const withGapsCount  = records.filter(r => (r.missed_stops_count ?? 0) > 0).length;
  const analysedCount  = records.filter(r => r.delay_analysis && r.delay_analysis.cause !== 'ANALYSIS_UNAVAILABLE').length;
  const catCounts: Record<string, number> = {};
  for (const r of records) {
    const cat = r.delay_analysis?.category ?? null;
    if (cat) catCounts[cat] = (catCounts[cat] ?? 0) + 1;
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">AI Delay Analysis</h1>
          <p className="ngi-page-subtitle">
            <code>NR_JOURNEY_GAPS_ANALYSED</code> · {total.toLocaleString()} total · showing {fetched}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Toggle id="ag-auto" labelText="" labelA="Auto off" labelB="Auto on"
            toggled={autoRefresh} onToggle={setAutoRefresh} size="sm" />
          <Button kind="primary" size="sm" renderIcon={Renew} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* ── KPI row ────────────────────────────────────────────────── */}
      <div className="ngi-kpi-row">
        <KpiTile label="Total journeys"   value={totalJourneys}  sub="in current view" />
        <KpiTile label="Delayed"          value={delayedCount}   sub="is_delayed = true"
          accent="var(--cds-support-error,#da1e28)" />
        <KpiTile label="With gaps"        value={withGapsCount}  sub="missed stops > 0"
          accent="var(--cds-support-warning-text,#8e5a00)" />
        <KpiTile label="AI analysed"      value={analysedCount}  sub="LLM completed"
          accent="var(--cds-interactive,#0f62fe)" />
        {(['HIGH','MEDIUM','LOW'] as const).map(s => (
          <KpiTile key={s} label={`Sev: ${s}`} value={records.filter(r => r.severity === s).length}
            onClick={() => setSev(sev === s ? '' : s)} active={sev === s}
            accent={s === 'HIGH' ? 'var(--cds-support-error,#da1e28)' : s === 'MEDIUM' ? 'var(--cds-support-warning-text,#8e5a00)' : 'var(--cds-support-success,#24a148)'} />
        ))}
      </div>

      {/* ── Category breakdown ─────────────────────────────────────── */}
      {Object.keys(catCounts).length > 0 && (
        <section style={{ marginBottom: '1.25rem' }}>
          <h2 className="ngi-section-label">AI Categories</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, c]) => (
              <Tag key={cat} type={CATEGORY_COLORS[cat] ?? 'gray'} size="md"
                style={{ cursor: 'pointer' }}
                onClick={() => setCategory(category === cat ? '' : cat)}>
                {cat}: {c}{category === cat ? ' ✕' : ''}
              </Tag>
            ))}
          </div>
        </section>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="ngi-toolbar">
        <TextInput id="ag-search" labelText="Search" placeholder="train ID, UID, station…"
          value={search} onChange={e => setSearch(e.target.value)} size="sm" style={{ width: 220 }} />
        <Select id="ag-sev" labelText="Severity" value={sev} onChange={e => setSev(e.target.value)} size="sm">
          <SelectItem value="" text="All Severities" />
          {['HIGH','MEDIUM','LOW','NONE'].map(s => <SelectItem key={s} value={s} text={s} />)}
        </Select>
        <Select id="ag-delayed" labelText="Delay status" value={delayed} onChange={e => setDelayed(e.target.value)} size="sm">
          <SelectItem value=""      text="All" />
          <SelectItem value="true"  text="Delayed only" />
          <SelectItem value="false" text="On time only" />
        </Select>
        <Select id="ag-cat" labelText="AI category" value={category} onChange={e => setCategory(e.target.value)} size="sm">
          <SelectItem value="" text="All Categories" />
          {Object.keys(CATEGORY_COLORS).map(c => <SelectItem key={c} value={c} text={c} />)}
        </Select>
        <Select id="ag-limit" labelText="Fetch last" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} size="sm">
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
                {['Train ID','UID','Date','Severity','Delay','Missed','AI Category','Cause'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>Loading…</td></tr>}
              {!loading && records.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>
                  No analysed gap records found.
                </td></tr>
              )}
              {records.map((r, i) => {
                const da     = r.delay_analysis;
                const jd     = r.journey_delay;
                const rttUrl = getRealtimeTrainsUrl(r.train_uid, r.schedule_start_date);
                const key    = recordKey(r);
                const isSelected = selectedKey === key;
                return (
                  <tr key={i}
                    className={`ngi-row-clickable${isSelected ? ' ngi-row-selected' : ''}`}
                    onClick={() => setSelectedKey(isSelected ? null : key)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <code style={{ fontWeight: 600 }}>{r.train_id ?? '—'}</code>
                        {rttUrl && (
                          <a href={rttUrl} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            title="View on Realtime Trains"
                            style={{ color: 'var(--cds-link-01,#0f62fe)', display: 'flex', alignItems: 'center' }}>
                            <Launch size={12} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{r.train_uid ?? '—'}</td>
                    <td style={{ color: 'var(--cds-text-secondary)', whiteSpace: 'nowrap' }}>{r.schedule_start_date ?? '—'}</td>
                    <td><Tag type={SEV_TAG[r.severity ?? ''] ?? 'gray'} size="sm">{r.severity ?? '—'}</Tag></td>
                    <td><DelayBadge jd={jd} /></td>
                    <td className="mono" style={{ color: (r.missed_stops_count ?? 0) > 0 ? 'var(--cds-support-error,#da1e28)' : 'var(--cds-text-secondary)', fontWeight: (r.missed_stops_count ?? 0) > 0 ? 600 : 400 }}>
                      {r.missed_stops_count ?? 0}
                    </td>
                    <td>
                      {da && da.cause !== 'ANALYSIS_UNAVAILABLE'
                        ? <Tag type={CATEGORY_COLORS[da.category] ?? 'gray'} size="sm">{da.category}</Tag>
                        : <span style={{ color: 'var(--cds-text-placeholder)', fontSize: '0.75rem' }}>—</span>
                      }
                    </td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>
                      {da?.cause && da.cause !== 'ANALYSIS_UNAVAILABLE' ? da.cause : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Detail flyout ─────────────────────────────────────────── */}
        {selected && (
          <div className="ngi-flyout" style={{ width: 500 }}>
            <div className="ngi-flyout-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h2>{selected.train_id}</h2>
                  {(() => {
                    const url = getRealtimeTrainsUrl(selected.train_uid, selected.schedule_start_date);
                    return url ? (
                      <a href={url} target="_blank" rel="noreferrer"
                        title="View on Realtime Trains"
                        style={{ color: 'var(--cds-link-01,#0f62fe)', display: 'flex', alignItems: 'center' }}>
                        <Launch size={14} />
                      </a>
                    ) : null;
                  })()}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>
                  UID: {selected.train_uid ?? '—'} · {selected.schedule_start_date ?? '—'}
                </div>
              </div>
              <button onClick={() => setSelectedKey(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cds-text-secondary)' }}>
                <Close size={16} />
              </button>
            </div>

            {/* Journey summary */}
            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Severity</dt>        <dd><Tag type={SEV_TAG[selected.severity ?? ''] ?? 'gray'} size="sm">{selected.severity ?? '—'}</Tag></dd>
                <dt>Scheduled stops</dt> <dd className="mono">{selected.total_scheduled_stops ?? '—'}</dd>
                <dt>Found</dt>           <dd style={{ color: 'var(--cds-support-success,#24a148)', fontWeight: 600 }}>{selected.found_stops_count ?? 0}</dd>
                <dt>Missed</dt>          <dd style={{ color: 'var(--cds-support-error,#da1e28)', fontWeight: 600 }}>{selected.missed_stops_count ?? 0}</dd>
                <dt>Completed at</dt>    <dd className="mono">{fmtEpoch(selected.completion_time)}</dd>
              </dl>
            </div>

            {/* Delay summary */}
            {selected.journey_delay && (
              <div className="ngi-flyout-section">
                <div className="ngi-flyout-section-label">Journey Delay</div>
                <dl className="ngi-meta-grid">
                  <dt>Status</dt>
                  <dd><DelayBadge jd={selected.journey_delay} /></dd>
                  <dt>Max delay</dt>
                  <dd className="mono" style={{ color: selected.journey_delay.is_delayed ? 'var(--cds-support-error,#da1e28)' : 'var(--cds-support-success,#24a148)', fontWeight: 600 }}>
                    {selected.journey_delay.max_delay_minutes != null ? `${selected.journey_delay.max_delay_minutes > 0 ? '+' : ''}${selected.journey_delay.max_delay_minutes} min` : '—'}
                  </dd>
                  <dt>Avg delay</dt>
                  <dd className="mono">{selected.journey_delay.avg_delay_minutes != null ? `${selected.journey_delay.avg_delay_minutes > 0 ? '+' : ''}${selected.journey_delay.avg_delay_minutes} min` : '—'}</dd>
                  <dt>Late stops</dt>
                  <dd className="mono">{selected.journey_delay.delayed_stops}</dd>
                </dl>
              </div>
            )}

            {/* AI analysis */}
            <div className="ngi-flyout-section">
              <div className="ngi-flyout-section-label">AI Delay Analysis</div>
              <LlmAnalysisPanel da={selected.delay_analysis} />
            </div>

            {/* Stop-by-stop progression */}
            {selected.stations && selected.stations.length > 0 && (
              <div className="ngi-flyout-section">
                <div className="ngi-flyout-section-label">
                  Stop progression ({selected.stations.length} stops)
                </div>
                <table className="ngi-table" style={{ fontSize: '0.72rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}>#</th>
                      <th>Station</th>
                      <th style={{ textAlign: 'center', width: 40 }}>✓</th>
                      <th style={{ textAlign: 'right' }}>Sched</th>
                      <th style={{ textAlign: 'right' }}>Actual</th>
                      <th style={{ textAlign: 'right' }}>Delay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.stations.map((s, i) => {
                      const delay = s.visited ? s.delay_minutes : s.predicted_delay_minutes;
                      const isLate = delay != null && delay > 3;
                      const isEarly = delay != null && delay < -1;
                      return (
                        <tr key={i} style={{ background: !s.visited ? 'var(--cds-support-error-background,#fff1f1)' : undefined }}>
                          <td style={{ color: 'var(--cds-text-placeholder)', textAlign: 'right', paddingRight: 4 }}>
                            {s.station_index ?? i + 1}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
                              {s.station_name || s.tiploc}
                            </div>
                            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.62rem', color: 'var(--cds-text-secondary)' }}>
                              {s.stanox}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {s.visited
                              ? <CheckmarkFilled size={12} style={{ color: 'var(--cds-support-success,#24a148)' }} />
                              : <WarningFilled   size={12} style={{ color: 'var(--cds-support-error,#da1e28)' }} />
                            }
                          </td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--cds-text-secondary)' }}>
                            {s.scheduled_time || '—'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {s.visited
                              ? (s.actual_time || '—')
                              : s.predicted_time
                                ? <span style={{ color: 'var(--cds-interactive,#0f62fe)' }}>{s.predicted_time}</span>
                                : '—'
                            }
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {delay != null ? (
                              <span style={{
                                fontFamily: "'IBM Plex Mono',monospace",
                                fontWeight: 600,
                                color: isLate  ? 'var(--cds-support-error,#da1e28)'   :
                                       isEarly ? 'var(--cds-support-info,#0043ce)'    :
                                                 'var(--cds-support-success,#24a148)',
                                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2,
                              }}>
                                {isLate  && <ArrowUp   size={10} />}
                                {isEarly && <ArrowDown size={10} />}
                                {delayLabel(delay)}
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
