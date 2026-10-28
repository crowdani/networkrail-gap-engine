'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, TextInput, Select, SelectItem, Tag, InlineNotification } from '@carbon/react';
import { Renew, Close } from '@carbon/icons-react';

type RecentMiss = {
  train_id: string;
  train_uid: string;
  scheduled_time?: string;
  completion_time?: string | number;
};

type StationSummary = {
  station_name: string;
  tiploc: string;
  stanox: string;
  missed_count: number;
  scheduled_count: number;
  found_count: number;
  affected_trains_count: number;
  missed_rate_pct: number;
  recent_misses: RecentMiss[];
};

function fmtEpoch(v?: string | number | null): string {
  if (!v || v === '0' || v === 0) return '—';
  try { return new Date(Number(v)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  catch { return String(v); }
}

export default function StationGapsPage() {
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [scanned,  setScanned]  = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [limit,    setLimit]    = useState(200);
  const [selected, setSelected] = useState<StationSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ limit: String(limit) });
      if (search) p.set('search', search);
      const r = await fetch(`/api/station-gaps?${p}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setStations(d.stations ?? []);
      setScanned(d.total_journeys_scanned ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, limit]);

  useEffect(() => { load(); }, [load]);

  const totalMissed = stations.reduce((a, s) => a + s.missed_count, 0);
  const hotStations = stations.filter(s => s.missed_count > 0);

  return (
    <div>
      <div className="ngi-page-header">
        <h1>Station Hotspots</h1>
        <p>Missed stop frequency aggregated from <code>NR_JOURNEY_GAPS</code> · {scanned.toLocaleString()} journeys scanned</p>
      </div>

      {/* KPI row */}
      <div className="ngi-kpi-row">
        <div className="ngi-kpi-tile">
          <div className="label">Total missed reads</div>
          <div className="value" style={{ color: '#da1e28' }}>{totalMissed.toLocaleString()}</div>
        </div>
        <div className="ngi-kpi-tile">
          <div className="label">Stations with gaps</div>
          <div className="value" style={{ color: '#0f62fe' }}>{hotStations.length}</div>
        </div>
        <div className="ngi-kpi-tile">
          <div className="label">Journeys scanned</div>
          <div className="value">{scanned.toLocaleString()}</div>
        </div>
        <div className="ngi-kpi-tile">
          <div className="label">Top hotspot</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.25rem', color: 'var(--cds-text-primary)' }}>
            {stations[0]?.station_name ? `${stations[0].station_name}` : '—'}
          </div>
          <div className="sub">{stations[0] ? `${stations[0].missed_count} missed reads` : ''}</div>
        </div>
      </div>

      <div className="ngi-toolbar">
        <TextInput id="sg-search" labelText="Search station" placeholder="Station name, TIPLOC or STANOX…"
          value={search} onChange={e => setSearch(e.target.value)} size="sm" style={{ width: 240 }} />
        <Select id="sg-limit" labelText="Scan depth" value={String(limit)} onChange={e => setLimit(Number(e.target.value))} size="sm">
          {[100, 200, 300, 500].map(n => <SelectItem key={n} value={String(n)} text={`${n} journeys`} />)}
        </Select>
        <Button kind="primary" size="sm" renderIcon={Renew} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {error && <InlineNotification kind="error" title="Error" subtitle={error} style={{ marginBottom: '1rem' }} />}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ flex: 1, background: 'var(--cds-layer-01,#fff)', border: '1px solid var(--cds-border-subtle-01,#e0e0e0)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--cds-layer-02,#f4f4f4)', borderBottom: '1px solid var(--cds-border-subtle-01,#e0e0e0)' }}>
                {['Rank', 'Station', 'Codes', 'Missed', 'Scheduled', 'Miss Rate', 'Trains Affected'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--cds-text-secondary)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>Loading station metrics…</td></tr>}
              {!loading && stations.length === 0 && <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>No station gap records found.</td></tr>}
              {stations.map((s, i) => {
                const highMiss = s.missed_count >= 5 || s.missed_rate_pct >= 50;
                return (
                  <tr key={i} onClick={() => setSelected(s === selected ? null : s)}
                    style={{
                      borderBottom: '1px solid var(--cds-border-subtle-01,#e0e0e0)', cursor: 'pointer',
                      background: selected === s ? 'var(--cds-layer-selected-01,#e8f4ff)' : i % 2 === 0 ? 'var(--cds-layer-01,#fff)' : 'var(--cds-layer-02,#fafafa)',
                    }}>
                    <td style={{ padding: '0.45rem 0.75rem', color: 'var(--cds-text-placeholder)', fontWeight: 600, width: 40 }}>#{i + 1}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontWeight: 700 }}>{s.station_name || s.tiploc}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>{s.tiploc} · {s.stanox}</td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <Tag type={s.missed_count > 0 ? 'red' : 'gray'} size="sm">{s.missed_count}</Tag>
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', color: 'var(--cds-text-secondary)' }}>{s.scheduled_count}</td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <span className="ngi-bar-wrap">
                        <span className="ngi-bar-fill" style={{ width: `${s.missed_rate_pct}%`, background: highMiss ? '#da1e28' : '#f1c21b' }} />
                      </span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: highMiss ? '#da1e28' : 'var(--cds-text-primary)' }}>{s.missed_rate_pct}%</span>
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', fontWeight: 500 }}>{s.affected_trains_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="ngi-flyout" style={{ width: 440 }}>
            <div className="ngi-flyout-header">
              <div>
                <h2 style={{ fontFamily: 'inherit' }}>{selected.station_name || selected.tiploc}</h2>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: 'var(--cds-text-secondary)' }}>
                  TIPLOC: {selected.tiploc} · STANOX: {selected.stanox}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Close size={16} /></button>
            </div>

            <div className="ngi-flyout-section">
              <dl className="ngi-meta-grid">
                <dt>Missed reads</dt><dd style={{ color: '#da1e28', fontWeight: 700 }}>{selected.missed_count}</dd>
                <dt>Found / observed</dt><dd style={{ color: '#24a148', fontWeight: 600 }}>{selected.found_count}</dd>
                <dt>Total scheduled</dt><dd>{selected.scheduled_count}</dd>
                <dt>Miss rate</dt>
                <dd style={{ fontWeight: 700, color: selected.missed_rate_pct >= 50 ? '#da1e28' : 'var(--cds-text-primary)' }}>
                  {selected.missed_rate_pct}%
                </dd>
                <dt>Trains affected</dt><dd>{selected.affected_trains_count}</dd>
              </dl>
            </div>

            <div className="ngi-flyout-section">
              <div className="ngi-flyout-section-label">Recent missed journeys ({selected.recent_misses.length})</div>
              {selected.recent_misses.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--cds-layer-02,#f4f4f4)', borderBottom: '1px solid var(--cds-border-subtle-01,#e0e0e0)' }}>
                      <th style={{ padding: '4px 6px', textAlign: 'left' }}>Train ID</th>
                      <th style={{ padding: '4px 6px', textAlign: 'left' }}>UID</th>
                      <th style={{ padding: '4px 6px', textAlign: 'right' }}>Scheduled</th>
                      <th style={{ padding: '4px 6px', textAlign: 'right' }}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.recent_misses.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--cds-border-subtle-01,#e0e0e0)', background: '#fff1f1' }}>
                        <td style={{ padding: '4px 6px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>{m.train_id}</td>
                        <td style={{ padding: '4px 6px', fontFamily: "'IBM Plex Mono',monospace", color: 'var(--cds-text-secondary)' }}>{m.train_uid || '—'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: 'var(--cds-text-secondary)' }}>{m.scheduled_time || '—'}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: 'var(--cds-text-secondary)' }}>{fmtEpoch(m.completion_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: '0.75rem', background: 'var(--cds-layer-02,#f4f4f4)', color: 'var(--cds-text-placeholder)', fontSize: '0.75rem', textAlign: 'center' }}>
                  No recent misses recorded.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
