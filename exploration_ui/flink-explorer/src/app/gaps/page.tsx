'use client';

import { useEffect, useState, useCallback } from 'react';

type Gap = Record<string, unknown>;

const SEV_COLORS: Record<string, string> = {
  HIGH: '#da1e28', MEDIUM: '#f1c21b', LOW: '#24a148',
};
const METHODS = ['ON_TIME_INTERPOLATION','LINEAR_INTERPOLATION','SINGLE_STATION_EXTRAPOLATION','SCHEDULE_ONLY'];

function Badge({ value, colorMap }: { value: string; colorMap: Record<string,string> }) {
  const bg = colorMap[value] ?? '#a8a8a8';
  return (
    <span style={{ background: bg, color: '#fff', padding: '1px 7px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 }}>
      {value}
    </span>
  );
}

export default function GapsPage() {
  const [gaps,    setGaps]    = useState<Gap[]>([]);
  const [total,   setTotal]   = useState(0);
  const [fetched, setFetched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [sev,     setSev]     = useState('');
  const [method,  setMethod]  = useState('');
  const [limit,   setLimit]   = useState(100);
  const [selected, setSelected] = useState<Gap | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (search) params.set('search', search);
      if (sev)    params.set('severity', sev);
      if (method) params.set('method', method);
      const r = await fetch(`/api/gaps?${params}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setGaps(d.gaps ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, sev, method, limit]);

  useEffect(() => { load(); }, [load]);

  const sevCounts = gaps.reduce((a: Record<string,number>, g) => {
    const s = String(g.severity ?? ''); a[s] = (a[s] ?? 0) + 1; return a;
  }, {});

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#161616', margin: 0 }}>Flink Gaps</h1>
        <p style={{ color: '#6f6f6f', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          From <code>flink-gaps</code> Kafka topic · {total.toLocaleString()} total messages · showing last {fetched}
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Search</label>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="train_id, train_uid, STANOX…"
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #c6c6c6', borderRadius: 2, fontSize: '0.875rem', width: 220 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Severity</label>
          <select value={sev} onChange={e => setSev(e.target.value)}
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #c6c6c6', borderRadius: 2, fontSize: '0.875rem' }}>
            <option value="">All</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Method</label>
          <select value={method} onChange={e => setMethod(e.target.value)}
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #c6c6c6', borderRadius: 2, fontSize: '0.875rem' }}>
            <option value="">All</option>
            {METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g,' ')}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Fetch last</label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #c6c6c6', borderRadius: 2, fontSize: '0.875rem' }}>
            {[50,100,200,500].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '0.45rem 1rem', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 2, fontSize: '0.875rem', cursor: 'pointer' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Summary badges */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {Object.entries(sevCounts).map(([s, c]) => (
          <span key={s} style={{ background: SEV_COLORS[s] ?? '#a8a8a8', color: '#fff', padding: '2px 10px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600 }}>
            {s}: {c}
          </span>
        ))}
        {gaps.length > 0 && <span style={{ color: '#6f6f6f', fontSize: '0.75rem', alignSelf: 'center' }}>{gaps.length} matching</span>}
      </div>

      {error && (
        <div style={{ background: '#fff1f1', border: '1px solid #da1e28', borderRadius: 2, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#da1e28', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Table + detail panel */}
      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ flex: 1, background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 2, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f4f4f4', borderBottom: '1px solid #e0e0e0' }}>
                {['Train ID','UID','Missed STANOX','Idx','Prev → Next','Severity','Method','Conf','Delay (min)'].map(h => (
                  <th key={h} style={{ padding: '0.55rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#525252', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: '#a8a8a8' }}>Loading…</td></tr>
              )}
              {!loading && gaps.length === 0 && (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: '#a8a8a8' }}>No records found</td></tr>
              )}
              {gaps.map((g, i) => (
                <tr key={i}
                  onClick={() => setSelected(g === selected ? null : g)}
                  style={{
                    borderBottom: '1px solid #f4f4f4', cursor: 'pointer',
                    background: selected === g ? '#e8f4ff' : i % 2 === 0 ? '#fff' : '#fafafa',
                  }}>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{String(g.train_id ?? '')}</td>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: '#6f6f6f', fontSize: '0.75rem' }}>{String(g.train_uid ?? '—')}</td>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{String(g.missed_station_stanox ?? '')}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: '#6f6f6f' }}>{String(g.missed_station_index ?? '')}</td>
                  <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.72rem', color: '#525252' }}>
                    {String(g.previous_station_stanox ?? '')} → {String(g.next_station_stanox ?? '')}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem' }}><Badge value={String(g.severity ?? '')} colorMap={SEV_COLORS} /></td>
                  <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.72rem', color: '#525252' }}>
                    {String(g.prediction_method ?? '').replace(/_/g,' ')}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', color: '#6f6f6f' }}>
                    {g.prediction_confidence != null ? `${(Number(g.prediction_confidence) * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', color: '#6f6f6f' }}>
                    {g.predicted_delay_minutes != null ? String(g.predicted_delay_minutes) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{
            width: 320, background: '#ffffff', border: '1px solid #e0e0e0',
            borderRadius: 2, padding: '1rem', fontSize: '0.8rem', flexShrink: 0,
            maxHeight: '80vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <strong style={{ fontSize: '0.875rem' }}>Gap Detail</strong>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6f6f6f', fontSize: '1rem' }}>✕</button>
            </div>
            <dl style={{ margin: 0 }}>
              {Object.entries(selected).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                <div key={k} style={{ marginBottom: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <dt style={{ color: '#6f6f6f', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.replace(/_/g,' ')}</dt>
                  <dd style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
