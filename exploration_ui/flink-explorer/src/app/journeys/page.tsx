'use client';

import { useEffect, useState, useCallback, type JSX } from 'react';

type Journey = Record<string, unknown>;
type StopTiming = { actual_ts: number; scheduled_ts: number; delay_min: number };

function StopTimingTable({ raw, fmtTs }: { raw: unknown; fmtTs: (v: unknown) => string }): JSX.Element | null {
  if (!raw) return null;
  let timing: Record<string, StopTiming> = {};
  try { timing = typeof raw === 'string' ? JSON.parse(raw) : raw as typeof timing; } catch { return null; }
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#6f6f6f', fontWeight: 600, marginBottom: '0.35rem', textTransform: 'uppercase' }}>Stop Timing</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
        <thead><tr style={{ background: '#f4f4f4' }}>
          <th style={{ padding: '3px 5px', textAlign: 'left' }}>STANOX</th>
          <th style={{ padding: '3px 5px', textAlign: 'right' }}>Actual</th>
          <th style={{ padding: '3px 5px', textAlign: 'right' }}>Delay</th>
        </tr></thead>
        <tbody>
          {Object.entries(timing).map(([stanox, t]) => (
            <tr key={stanox} style={{ borderBottom: '1px solid #f4f4f4' }}>
              <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{stanox}</td>
              <td style={{ padding: '3px 5px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtTs(t.actual_ts)}</td>
              <td style={{ padding: '3px 5px', textAlign: 'right', color: t.delay_min > 5 ? '#da1e28' : '#24a148' }}>
                {t.delay_min >= 0 ? `+${t.delay_min}` : t.delay_min}m
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function JourneysPage() {
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
      const params = new URLSearchParams({ limit: String(limit) });
      if (search) params.set('search', search);
      const r = await fetch(`/api/journeys?${params}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setJourneys(d.journeys ?? []);
      setTotal(d.total ?? 0);
      setFetched(d.fetched ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, limit]);

  useEffect(() => { load(); }, [load]);

  function fmtTs(ms: unknown) {
    if (!ms) return '—';
    try { return new Date(Number(ms)).toLocaleTimeString(); } catch { return String(ms); }
  }

  function parseRoute(val: unknown): string[] {
    if (!val) return [];
    try { return typeof val === 'string' ? JSON.parse(val) : (Array.isArray(val) ? val : []); }
    catch { return []; }
  }

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#161616', margin: 0 }}>Journeys</h1>
        <p style={{ color: '#6f6f6f', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          From <code>flink-journeys</code> Kafka topic · {total.toLocaleString()} total · showing last {fetched}
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Search</label>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="train_id or train_uid…"
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #c6c6c6', borderRadius: 2, fontSize: '0.875rem', width: 220 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Fetch last</label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #c6c6c6', borderRadius: 2, fontSize: '0.875rem' }}>
            {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '0.45rem 1rem', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 2, fontSize: '0.875rem', cursor: 'pointer' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fff1f1', border: '1px solid #da1e28', borderRadius: 2, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#da1e28', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <div style={{ flex: 1, background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: 2, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f4f4f4', borderBottom: '1px solid #e0e0e0' }}>
                {['Train ID','UID','Operator','Schedule Date','Stops','First Mvmt','Last Mvmt','Cancelled'].map(h => (
                  <th key={h} style={{ padding: '0.55rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#525252', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#a8a8a8' }}>Loading…</td></tr>}
              {!loading && journeys.length === 0 && <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#a8a8a8' }}>No records found</td></tr>}
              {journeys.map((j, i) => {
                const route = parseRoute(j.actual_route);
                return (
                  <tr key={i}
                    onClick={() => setSelected(j === selected ? null : j)}
                    style={{
                      borderBottom: '1px solid #f4f4f4', cursor: 'pointer',
                      background: selected === j ? '#e8f4ff' : i % 2 === 0 ? '#fff' : '#fafafa',
                    }}>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{String(j.train_id ?? '')}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', color: '#6f6f6f', fontSize: '0.75rem' }}>{String(j.train_uid ?? '—')}</td>
                    <td style={{ padding: '0.45rem 0.75rem', color: '#525252' }}>{String(j.operator_code ?? '—')}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#6f6f6f' }}>{String(j.schedule_start_date ?? '—')}</td>
                    <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right' }}>{route.length}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: '#6f6f6f' }}>{fmtTs(j.first_movement_at)}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: '#6f6f6f' }}>{fmtTs(j.last_movement_at)}</td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      {j.is_cancelled
                        ? <span style={{ color: '#da1e28', fontWeight: 600, fontSize: '0.72rem' }}>YES</span>
                        : <span style={{ color: '#a8a8a8', fontSize: '0.72rem' }}>No</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{
            width: 340, background: '#ffffff', border: '1px solid #e0e0e0',
            borderRadius: 2, padding: '1rem', fontSize: '0.8rem', flexShrink: 0,
            maxHeight: '80vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <strong style={{ fontSize: '0.875rem' }}>Journey Detail</strong>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6f6f6f', fontSize: '1rem' }}>✕</button>
            </div>

            {/* Actual route */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#6f6f6f', fontWeight: 600, marginBottom: '0.35rem', textTransform: 'uppercase' }}>Actual Route ({parseRoute(selected.actual_route).length} stops)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {parseRoute(selected.actual_route).map((s, i) => (
                  <span key={i} style={{ background: '#e8f4ff', color: '#0043ce', padding: '1px 6px', borderRadius: 2, fontFamily: 'monospace', fontSize: '0.7rem' }}>{s}</span>
                ))}
              </div>
            </div>

            {/* Stop timing */}
            <StopTimingTable raw={selected.stop_timing_map} fmtTs={fmtTs} />

            {/* Raw fields */}
            <dl style={{ margin: 0 }}>
              {['train_id','train_uid','operator_code','schedule_start_date','total_movements','is_cancelled'].map(k => (
                <div key={k} style={{ marginBottom: '0.4rem', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <dt style={{ color: '#6f6f6f', fontSize: '0.72rem', textTransform: 'uppercase' }}>{k.replace(/_/g,' ')}</dt>
                  <dd style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.75rem' }}>{String(selected[k] ?? '—')}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
