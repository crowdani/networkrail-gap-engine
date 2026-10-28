'use client';

import { useEffect, useState } from 'react';
import { Button, InlineNotification, Tag } from '@carbon/react';
import { Renew } from '@carbon/icons-react';

interface Statement { name: string; phase: string; detail: string; }
interface TopicStat  { topic: string; beginning: number; end: number; count: number; }
interface Status     { statements: Statement[]; topics: TopicStat[]; ts: number; }

const PIPELINE_TOPICS = [
  'NR_TRAIN_MESSAGES', 'NR_TIPLOC_REFERENCE', 'NR_ACTIVE_SCHEDULE',
  'FLATTENED_RAIL_TEXT', 'SCHEDULE_TABLE', 'TRAIN_ACTIVATION_TABLE',
  'MOVEMENT_STREAM', 'LIVE_JOURNEY_STATE', 'COMPLETED_JOURNEYS',
  'NR_JOURNEY_GAPS', 'NR_JOURNEY_GAPS_PREDICTED',
];

function phaseTagType(phase: string): 'green' | 'purple' | 'red' | 'gray' {
  if (phase === 'RUNNING') return 'green';
  if (phase === 'PENDING') return 'purple';
  if (phase === 'FAILED')  return 'red';
  return 'gray';
}

function sevTagType(sev: string): 'red' | 'warm-gray' | 'green' | 'gray' {
  if (sev === 'HIGH')   return 'red';
  if (sev === 'MEDIUM') return 'warm-gray';
  if (sev === 'LOW')    return 'green';
  return 'gray';
}

function fmtKpi(value: string | number): string {
  if (typeof value !== 'number') return String(value);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000)    return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  const display = fmtKpi(value);
  const compact  = typeof value === 'number' && value >= 10_000;
  return (
    <div className="ngi-kpi-tile">
      <div className="label">{label}</div>
      <div className={`value${compact ? ' compact' : ''}`} style={accent ? { color: accent } : undefined}>
        {display}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [status,     setStatus]     = useState<Status | null>(null);
  const [recentGaps, setRecentGaps] = useState<Record<string, unknown>[]>([]);
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [st, gp] = await Promise.all([
        fetch('/api/pipeline-status').then(r => r.json()),
        fetch('/api/gaps?limit=20').then(r => r.json()),
      ]);
      if (!st.error) setStatus(st);
      setRecentGaps(gp.gaps ?? []);
      setError(st.error ?? '');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  const topicMap       = Object.fromEntries((status?.topics ?? []).map(t => [t.topic, t]));
  const totalMessages  = PIPELINE_TOPICS.reduce((s, t) => s + (topicMap[t]?.count ?? 0), 0);
  const runningQueries = (status?.statements ?? []).filter(s => s.phase === 'RUNNING').length;
  const sevCounts      = recentGaps.reduce((a: Record<string, number>, g: Record<string, unknown>) => {
    const s = String(g.severity ?? 'UNKNOWN'); a[s] = (a[s] ?? 0) + 1; return a;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">Dashboard</h1>
          <p className="ngi-page-subtitle">
            Network Gap Infill pipeline · auto-refreshes every 15 s
            {status && (
              <span style={{ marginLeft: '1rem', color: 'var(--cds-text-placeholder)' }}>
                Updated {new Date(status.ts).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <Button kind="ghost" size="sm" renderIcon={Renew} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <InlineNotification kind="error" title="Error" subtitle={error} style={{ marginBottom: '1rem' }} lowContrast />
      )}

      {/* KPI row */}
      <div className="ngi-kpi-row">
        <KpiTile label="Pipeline messages"  value={totalMessages}  sub="across all topics" />
        <KpiTile label="Running queries"    value={runningQueries} sub="ksqlDB CSAS / CTAS" accent="var(--cds-support-success, #24a148)" />
        <KpiTile label="Live journeys"      value={topicMap['LIVE_JOURNEY_STATE']?.count           ?? '—'} sub="LIVE_JOURNEY_STATE" />
        <KpiTile label="Completed journeys" value={topicMap['COMPLETED_JOURNEYS']?.count           ?? '—'} sub="COMPLETED_JOURNEYS" />
        <KpiTile label="Gap records"        value={topicMap['NR_JOURNEY_GAPS']?.count              ?? '—'} sub="NR_JOURNEY_GAPS" />
        <KpiTile label="Predicted infill"   value={topicMap['NR_JOURNEY_GAPS_PREDICTED']?.count    ?? '—'} sub="NR_JOURNEY_GAPS_PREDICTED" accent="var(--cds-interactive, #0f62fe)" />
      </div>

      {/* ksqlDB queries */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h2 className="ngi-section-label">ksqlDB Persistent Queries</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {(status?.statements ?? []).map(s => (
            <div key={s.name} className="ngi-card" style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.75rem 1rem',
              borderLeft: `3px solid ${s.phase === 'RUNNING' ? 'var(--cds-support-success, #24a148)' : s.phase === 'FAILED' ? 'var(--cds-support-error, #da1e28)' : 'var(--cds-support-warning, #f1c21b)'}`,
            }}>
              <code style={{ fontSize: '0.8rem', fontWeight: 600 }}>{s.name}</code>
              <Tag type={phaseTagType(s.phase)} size="sm">{s.phase}</Tag>
              <span style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.detail || '—'}
              </span>
            </div>
          ))}
          {!loading && !status?.statements?.length && (
            <div className="ngi-card" style={{ color: 'var(--cds-text-placeholder)', fontSize: '0.875rem' }}>
              No query data available
            </div>
          )}
        </div>
      </section>

      {/* Topic counts */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h2 className="ngi-section-label">Kafka Topic Message Counts</h2>
        <div style={{ background: 'var(--cds-layer-01, #fff)', border: '1px solid var(--cds-border-subtle-01, #e0e0e0)', overflow: 'hidden' }}>
          <table className="ngi-table">
            <thead>
              <tr>
                {['Topic', 'Messages', 'Beginning Offset', 'End Offset'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PIPELINE_TOPICS.map(topicName => {
                const t = topicMap[topicName];
                return (
                  <tr key={topicName}>
                    <td><code>{topicName}</code></td>
                    <td style={{ fontWeight: 600 }}>{t ? t.count.toLocaleString() : <span style={{ color: 'var(--cds-text-placeholder)' }}>—</span>}</td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{t ? t.beginning.toLocaleString() : '—'}</td>
                    <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{t ? t.end.toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent gaps */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 className="ngi-section-label" style={{ margin: 0 }}>Recent Gap Records (last 20)</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {Object.entries(sevCounts).map(([sev, count]) => (
              <Tag key={sev} type={sevTagType(sev)} size="sm">{sev}: {count}</Tag>
            ))}
          </div>
        </div>
        <div style={{ background: 'var(--cds-layer-01, #fff)', border: '1px solid var(--cds-border-subtle-01, #e0e0e0)', overflow: 'hidden' }}>
          <table className="ngi-table">
            <thead>
              <tr>
                {['Train ID', 'UID', 'Severity', 'Found', 'Missed', 'Schedule Date'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentGaps.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>
                    No gap records yet — pipeline is catching up
                  </td>
                </tr>
              )}
              {recentGaps.map((g, i) => (
                <tr key={i}>
                  <td><code style={{ fontWeight: 600 }}>{String(g.train_id ?? '')}</code></td>
                  <td className="mono" style={{ color: 'var(--cds-text-secondary)' }}>{String(g.train_uid ?? '—')}</td>
                  <td><Tag type={sevTagType(String(g.severity ?? ''))} size="sm">{String(g.severity ?? '—')}</Tag></td>
                  <td style={{ color: 'var(--cds-support-success, #24a148)', fontWeight: 600 }}>{String(g.found_stops_count ?? '—')}</td>
                  <td style={{ color: Number(g.missed_stops_count) > 0 ? 'var(--cds-support-error, #da1e28)' : 'var(--cds-text-secondary)', fontWeight: Number(g.missed_stops_count) > 0 ? 600 : 400 }}>
                    {String(g.missed_stops_count ?? '—')}
                  </td>
                  <td style={{ color: 'var(--cds-text-secondary)' }}>{String(g.schedule_start_date ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
