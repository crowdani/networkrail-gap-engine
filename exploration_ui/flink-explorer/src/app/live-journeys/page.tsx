'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, TextInput, Select, SelectItem, Tag, InlineNotification, Toggle } from '@carbon/react';
import { Renew, Close } from '@carbon/icons-react';

type Station = {
  STANOX: string;
  STATION_NAME?: string;
  TIPLOC?: string;
  ACTUAL_TIME: string;
  EVENT: string;
};

type LiveJourney = {
  TRAIN_ID?: string;
  TRAIN_UID?: string;
  CURRENT_STANOX?: string;
  CURRENT_STATION_NAME?: string;
  LAST_UPDATED?: string;
  STATUS?: string;
  STATIONS_VISITED?: Station[];
  SCHEDULED_TIPLOCS?: string;
  _offset?: number;
  _ts?: number;
};

function statusTagType(s: string): 'blue' | 'green' | 'red' | 'gray' {
  if (s === 'TERMINATED') return 'blue';
  if (s === 'ACTIVE')     return 'green';
  if (s === 'CANCELLED')  return 'red';
  return 'gray';
}

function fmtEpoch(v?: string | number): string {
  if (!v || v === '0' || v === 0) return '—';
  try { return new Date(Number(v)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return String(v); }
}

export default function LiveJourneysPage() {
  const [journeys,    setJourneys]    = useState<LiveJourney[]>([]);
  const [total,       setTotal]       = useState(0);
  const [fetched,     setFetched]     = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [search,      setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limit,       setLimit]       = useState(100);
  const [selected,    setSelected]    = useState<LiveJourney | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (search)       p.set('search', search);
      if (statusFilter) p.set('status', statusFilter);
      const r = await fetch(`/api/live-journeys?${p}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setJourneys(d.journeys ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, statusFilter, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const statusCounts = journeys.reduce((a: Record<string, number>, j) => {
    const s = j.STATUS ?? 'UNKNOWN'; a[s] = (a[s] ?? 0) + 1; return a;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">Live Journeys</h1>
          <p className="ngi-page-subtitle">
            <code>LIVE_JOURNEY_STATE</code> · {total.toLocaleString()} messages · showing {fetched}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Toggle
            id="auto-refresh"
            labelText=""
            labelA="Auto off"
            labelB="Auto on"
            toggled={autoRefresh}
            onToggle={setAutoRefresh}
            size="sm"
          />
          <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Status summary chips */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {Object.entries(statusCounts).map(([s, c]) => (
          <Tag
            key={s}
            type={statusTagType(s)}
            size="md"
            style={{ cursor: 'pointer' }}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
          >
            {s}: {c}
          </Tag>
        ))}
      </div>

      {/* Toolbar */}
      <div className="ngi-toolbar">
        <TextInput
          id="lj-search"
          labelText="Search train"
          placeholder="TRAIN_ID, TRAIN_UID or STANOX…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          size="sm"
          style={{ width: 240 }}
        />
        <Select id="lj-status" labelText="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} size="sm">
          <SelectItem value="" text="All" />
          <SelectItem value="ACTIVE"     text="ACTIVE" />
          <SelectItem value="TERMINATED" text="TERMINATED" />
          <SelectItem value="CANCELLED"  text="CANCELLED" />
        </Select>
        <Select id="lj-limit" labelText="Fetch last" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} size="sm">
          {[50, 100, 200, 500].map(n => <SelectItem key={n} value={String(n)} text={String(n)} />)}
        </Select>
      </div>

      {error && <InlineNotification kind="error" title="Error" subtitle={error} style={{ marginBottom: '1rem' }} lowContrast />}

      <div style={{ display: 'flex', gap: '1rem' }}>
        {/* Table */}
        <div style={{ flex: 1, background: 'var(--cds-layer-01, #fff)', border: '1px solid var(--cds-border-subtle-01, #e0e0e0)', overflow: 'auto' }}>
          <table className="ngi-table">
            <thead>
              <tr>
                {['Train ID', 'UID', 'Status', 'Current Station', 'Stops', 'Last Updated'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>Loading…</td></tr>}
              {!loading && journeys.length === 0 && <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>No records found</td></tr>}
              {journeys.map((j, i) => (
                <tr
                  key={i}
                  className={`ngi-row-clickable${selected === j ? ' ngi-row-selected' : ''}`}
                  onClick={() => setSelected(j === selected ? null : j)}
                >
                  <td><code style={{ fontWeight: 600 }}>{j.TRAIN_ID ?? '—'}</code></td>
                  <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{j.TRAIN_UID ?? '—'}</td>
                  <td><Tag type={statusTagType(j.STATUS ?? '')} size="sm">{j.STATUS ?? '—'}</Tag></td>
                  <td>{j.CURRENT_STATION_NAME ?? j.CURRENT_STANOX ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{(j.STATIONS_VISITED ?? []).length}</td>
                  <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{fmtEpoch(j.LAST_UPDATED)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Flyout */}
        {selected && (
          <div className="ngi-flyout">
            <div className="ngi-flyout-header">
              <div>
                <h2>{selected.TRAIN_ID}</h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>UID: {selected.TRAIN_UID ?? '—'}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cds-text-secondary)' }}>
                <Close size={16} />
              </button>
            </div>

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Status</dt>         <dd><Tag type={statusTagType(selected.STATUS ?? '')} size="sm">{selected.STATUS ?? '—'}</Tag></dd>
                <dt>Current station</dt><dd>{selected.CURRENT_STATION_NAME ?? selected.CURRENT_STANOX ?? '—'}</dd>
                <dt>STANOX</dt>         <dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{selected.CURRENT_STANOX ?? '—'}</dd>
                <dt>Last updated</dt>   <dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtEpoch(selected.LAST_UPDATED)}</dd>
              </dl>
            </div>

            <div className="ngi-flyout-section">
              <div className="ngi-flyout-section-label">
                Stations visited ({(selected.STATIONS_VISITED ?? []).length})
              </div>
              {(selected.STATIONS_VISITED ?? []).map((s, i) => (
                <div key={i} className="ngi-stop-row">
                  <span className="ngi-stop-index">{i + 1}</span>
                  <span className="ngi-stop-name" style={{ color: s.STANOX === selected.CURRENT_STANOX ? 'var(--cds-link-primary, #0f62fe)' : undefined }}>
                    {s.STATION_NAME ?? s.STANOX}
                  </span>
                  <span className="ngi-stop-event">{s.EVENT}</span>
                  <span className="ngi-stop-time">{fmtEpoch(s.ACTUAL_TIME)}</span>
                </div>
              ))}
            </div>

            {selected.SCHEDULED_TIPLOCS && (
              <div className="ngi-flyout-section">
                <div className="ngi-flyout-section-label">Scheduled TIPLOCs</div>
                <div style={{ fontSize: '0.75rem', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--cds-text-secondary)', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {selected.SCHEDULED_TIPLOCS}
                </div>
              </div>
            )}

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Kafka offset</dt> <dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{selected._offset ?? '—'}</dd>
                <dt>Message time</dt> <dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtEpoch(selected._ts)}</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
