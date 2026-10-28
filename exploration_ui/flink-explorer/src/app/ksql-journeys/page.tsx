'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, TextInput, Select, SelectItem, InlineNotification } from '@carbon/react';
import { Renew, Close } from '@carbon/icons-react';

type Station = { STANOX: string; STATION_NAME?: string; ACTUAL_TIME: string; EVENT: string };

type Journey = {
  TRAIN_ID?: string;
  TRAIN_UID?: string;
  COMPLETION_TIME?: string;
  TERMINATION_STATION_NAME?: string;
  TERMINATION_STANOX?: string;
  STATIONS_VISITED?: Station[];
  SCHEDULED_TIPLOCS?: string;
  _offset?: number;
  _ts?: number;
};

function fmtEpoch(v?: string | number): string {
  if (!v || v === '0' || v === 0) return '—';
  try { return new Date(Number(v)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  catch { return String(v); }
}

export default function CompletedJourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [total,    setTotal]    = useState(0);
  const [fetched,  setFetched]  = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [limit,    setLimit]    = useState(100);
  const [selected, setSelected] = useState<Journey | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (search) p.set('search', search);
      const r = await fetch(`/api/ksql-journeys?${p}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setJourneys(d.journeys ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, limit]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* Header */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">Completed Journeys</h1>
          <p className="ngi-page-subtitle">
            <code>COMPLETED_JOURNEYS</code> · {total.toLocaleString()} messages · showing {fetched}
          </p>
        </div>
      </div>

      <div className="ngi-toolbar">
        <TextInput
          id="cj-search" labelText="Search train" placeholder="TRAIN_ID or TRAIN_UID…"
          value={search} onChange={e => setSearch(e.target.value)} size="sm" style={{ width: 220 }}
        />
        <Select id="cj-limit" labelText="Fetch last" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} size="sm">
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
                {['Train ID', 'UID', 'Completed At', 'Termination Station', 'Stops'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>Loading…</td></tr>}
              {!loading && journeys.length === 0 && <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>No records found</td></tr>}
              {journeys.map((j, i) => {
                const stops = j.STATIONS_VISITED ?? [];
                return (
                  <tr
                    key={i}
                    className={`ngi-row-clickable${selected === j ? ' ngi-row-selected' : ''}`}
                    onClick={() => setSelected(j === selected ? null : j)}
                  >
                    <td><code style={{ fontWeight: 600 }}>{j.TRAIN_ID ?? '—'}</code></td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{j.TRAIN_UID ?? '—'}</td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{fmtEpoch(j.COMPLETION_TIME)}</td>
                    <td>{j.TERMINATION_STATION_NAME ?? j.TERMINATION_STANOX ?? (stops[stops.length - 1]?.STATION_NAME ?? stops[stops.length - 1]?.STANOX ?? '—')}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{stops.length}</td>
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
                <h2>{selected.TRAIN_ID}</h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>
                  UID: {selected.TRAIN_UID ?? '—'} · Completed: {fmtEpoch(selected.COMPLETION_TIME)}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cds-text-secondary)' }}>
                <Close size={16} />
              </button>
            </div>

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Termination station</dt><dd>{selected.TERMINATION_STATION_NAME ?? selected.TERMINATION_STANOX ?? '—'}</dd>
                <dt>Completed at</dt>       <dd style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtEpoch(selected.COMPLETION_TIME)}</dd>
                <dt>Stops recorded</dt>     <dd style={{ fontWeight: 600 }}>{(selected.STATIONS_VISITED ?? []).length}</dd>
              </dl>
            </div>

            <div className="ngi-flyout-section">
              <div className="ngi-flyout-section-label">
                Stations visited ({(selected.STATIONS_VISITED ?? []).length})
              </div>
              {(selected.STATIONS_VISITED ?? []).map((s, i) => (
                <div key={i} className="ngi-stop-row">
                  <span className="ngi-stop-index">{i + 1}</span>
                  <span className="ngi-stop-name">{s.STATION_NAME ?? s.STANOX}</span>
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
