'use client';

import { useEffect, useState } from 'react';
import { Button, Tag, InlineNotification } from '@carbon/react';
import { Renew } from '@carbon/icons-react';

interface Statement { name: string; phase: string; detail: string; }
interface TopicStat  { topic: string; beginning: number; end: number; count: number; }
interface Status     { statements: Statement[]; topics: TopicStat[]; ts: number; }

const PHASE_TYPE: Record<string, 'green' | 'purple' | 'red' | 'gray' | 'magenta'> = {
  RUNNING:     'green',
  PENDING:     'purple',
  FAILED:      'red',
  STOPPED:     'gray',
  UNREACHABLE: 'magenta',
};

function phaseTag(phase: string) {
  return (
    <Tag type={PHASE_TYPE[phase] ?? 'gray'} size="sm">
      {phase}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// SVG pipeline diagram
// ---------------------------------------------------------------------------

const C = {
  topic:     { fill: '#dbeafe', stroke: '#3b82f6', text: '#1d4ed8' },  // blue — Kafka topics
  stream:    { fill: '#dcfce7', stroke: '#22c55e', text: '#15803d' },  // green — ksqlDB streams
  table:     { fill: '#f3e8ff', stroke: '#a855f7', text: '#7e22ce' },  // purple — ksqlDB tables
  connector: { fill: '#fef9c3', stroke: '#eab308', text: '#713f12' },  // yellow — connectors
  processor: { fill: '#fee2e2', stroke: '#ef4444', text: '#991b1b' },  // red — Python processors
  db:        { fill: '#f1f5f9', stroke: '#94a3b8', text: '#334155' },  // gray — databases
  ui:        { fill: '#ecfdf5', stroke: '#10b981', text: '#065f46' },  // teal — this UI
};

function Box({ x, y, w, h, style, label, sublabel }: {
  x: number; y: number; w: number; h: number;
  style: { fill: string; stroke: string; text: string };
  label: string; sublabel?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={style.fill} stroke={style.stroke} strokeWidth={1.5} />
      <text x={x + w / 2} y={sublabel ? y + h / 2 - 5 : y + h / 2 + 4}
        textAnchor="middle" fill={style.text} fontSize={11} fontWeight={600} fontFamily="IBM Plex Mono, monospace">
        {label}
      </text>
      {sublabel && (
        <text x={x + w / 2} y={y + h / 2 + 10}
          textAnchor="middle" fill={style.text} fontSize={9} fontFamily="IBM Plex Sans, sans-serif" opacity={0.8}>
          {sublabel}
        </text>
      )}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label?: string }) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g>
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#6b7280" />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7280" strokeWidth={1.5} markerEnd="url(#arrowhead)" />
      {label && (
        <text x={midX + 4} y={midY - 4} fill="#6b7280" fontSize={8} fontFamily="IBM Plex Sans, sans-serif">
          {label}
        </text>
      )}
    </g>
  );
}

function PipelineDiagram() {
  // Layout constants
  const BW = 190; const BH = 36; const COL1 = 10; const COL2 = 250; const COL3 = 490;
  // Row Y positions — main flow
  const rows = [20, 80, 140, 200, 260, 320, 380, 440, 500, 560, 620, 680];

  return (
    <svg viewBox="0 0 730 730" style={{ width: '100%', maxHeight: 750, display: 'block' }} aria-label="Pipeline architecture diagram">

      {/* ── COLUMN 1: Reference data (left) ─────────────────────────── */}
      <text x={COL1 + BW/2} y={14} textAnchor="middle" fill="#6b7280" fontSize={9} fontWeight={700} fontFamily="IBM Plex Sans,sans-serif" textTransform="uppercase" letterSpacing="0.08em">REFERENCE DATA</text>
      <Box x={COL1} y={rows[0]} w={BW} h={BH} style={C.db}        label="PostgreSQL" sublabel="tiploc_reference / active_schedule" />
      <Arrow x1={COL1+BW/2} y1={rows[0]+BH} x2={COL1+BW/2} y2={rows[1]} />
      <Box x={COL1} y={rows[1]} w={BW} h={BH} style={C.connector} label="JDBC connectors" sublabel="tiploc-reference + active-schedule" />
      <Arrow x1={COL1+BW/2} y1={rows[1]+BH} x2={COL1+BW/2} y2={rows[2]} />
      <Box x={COL1} y={rows[2]} w={BW} h={BH} style={C.topic}     label="NR_TIPLOC_REFERENCE" sublabel="Kafka topic (keyed by STANOX)" />
      <Arrow x1={COL1+BW/2} y1={rows[2]+BH} x2={COL1+BW/2} y2={rows[3]} />
      <Box x={COL1} y={rows[3]} w={BW} h={BH} style={C.table}     label="TIPLOC_REFERENCE_TABLE" sublabel="ksqlDB lookup table" />

      <Arrow x1={COL1+BW/2} y1={rows[3]+BH} x2={COL1+BW/2} y2={rows[4]} />
      <Box x={COL1} y={rows[4]} w={BW} h={BH} style={C.topic}     label="NR_ACTIVE_SCHEDULE" sublabel="Kafka topic (keyed by SERVICE_CODE)" />
      <Arrow x1={COL1+BW/2} y1={rows[4]+BH} x2={COL1+BW/2} y2={rows[5]} />
      <Box x={COL1} y={rows[5]} w={BW} h={BH} style={C.table}     label="SCHEDULE_TABLE" sublabel="ksqlDB lookup table" />

      <Arrow x1={COL1+BW/2} y1={rows[5]+BH} x2={COL1+BW/2} y2={rows[6]} />
      <Box x={COL1} y={rows[6]} w={BW} h={BH} style={C.table}     label="TRAIN_ACTIVATION_TABLE" sublabel="ksqlDB (type-0001 activations)" />

      {/* Cross arrows from reference col → main col */}
      {/* TIPLOC_REFERENCE_TABLE → MOVEMENT_STREAM */}
      <Arrow x1={COL1+BW} y1={rows[3]+BH/2} x2={COL2} y2={rows[4]+BH/2} label="LEFT JOIN" />
      {/* SCHEDULE_TABLE → LIVE_JOURNEY_STATE */}
      <Arrow x1={COL1+BW} y1={rows[5]+BH/2} x2={COL2} y2={rows[6]+BH/2} label="INNER JOIN" />
      {/* TRAIN_ACTIVATION_TABLE → LIVE_JOURNEY_STATE */}
      <Arrow x1={COL1+BW} y1={rows[6]+BH/2} x2={COL2} y2={rows[6]+BH/2} />

      {/* ── COLUMN 2: Main event stream (centre) ─────────────────────── */}
      <text x={COL2 + BW/2} y={14} textAnchor="middle" fill="#6b7280" fontSize={9} fontWeight={700} fontFamily="IBM Plex Sans,sans-serif">MAIN EVENT STREAM</text>
      <Box x={COL2} y={rows[0]} w={BW} h={BH} style={C.db}        label="Network Rail ActiveMQ" sublabel="TRAIN_MVT_ALL_TOC feed" />
      <Arrow x1={COL2+BW/2} y1={rows[0]+BH} x2={COL2+BW/2} y2={rows[1]} />
      <Box x={COL2} y={rows[1]} w={BW} h={BH} style={C.connector} label="activemq-source connector" sublabel="Kafka Connect → NR_TRAIN_MESSAGES" />
      <Arrow x1={COL2+BW/2} y1={rows[1]+BH} x2={COL2+BW/2} y2={rows[2]} />
      <Box x={COL2} y={rows[2]} w={BW} h={BH} style={C.topic}     label="NR_TRAIN_MESSAGES" sublabel="Raw JSON arrays (msg_type 0001/0003)" />
      <Arrow x1={COL2+BW/2} y1={rows[2]+BH} x2={COL2+BW/2} y2={rows[3]} />
      <Box x={COL2} y={rows[3]} w={BW} h={BH} style={C.stream}    label="FLATTENED_RAIL_TEXT" sublabel="ksqlDB: EXPLODE each message" />
      <Arrow x1={COL2+BW/2} y1={rows[3]+BH} x2={COL2+BW/2} y2={rows[4]} />
      <Box x={COL2} y={rows[4]} w={BW} h={BH} style={C.stream}    label="MOVEMENT_STREAM" sublabel="enriched with station names" />
      <Arrow x1={COL2+BW/2} y1={rows[4]+BH} x2={COL2+BW/2} y2={rows[5]} />
      <Box x={COL2} y={rows[5]} w={BW} h={BH} style={C.table}     label="TRAIN_ACTIVATION_TABLE" sublabel="type-0001 only → TRAIN_ID→UID map" />
      <Arrow x1={COL2+BW/2} y1={rows[5]+BH} x2={COL2+BW/2} y2={rows[6]} />
      <Box x={COL2} y={rows[6]} w={BW} h={BH} style={C.table}     label="LIVE_JOURNEY_STATE" sublabel="per-train aggregate (INNER+LEFT JOIN)" />
      <Arrow x1={COL2+BW/2} y1={rows[6]+BH} x2={COL2+BW/2} y2={rows[7]} />
      <Box x={COL2} y={rows[7]} w={BW} h={BH} style={C.stream}    label="LIVE_JOURNEY_CHANGES" sublabel="stream over LIVE_JOURNEY_STATE topic" />
      <Arrow x1={COL2+BW/2} y1={rows[7]+BH} x2={COL2+BW/2} y2={rows[8]} />
      <Box x={COL2} y={rows[8]} w={BW} h={BH} style={C.topic}     label="COMPLETED_JOURNEYS" sublabel="filtered: STATUS = TERMINATED" />
      <Arrow x1={COL2+BW/2} y1={rows[8]+BH} x2={COL2+BW/2} y2={rows[9]} />
      <Box x={COL2} y={rows[9]} w={BW} h={BH} style={C.processor} label="gap_detector.py" sublabel="compares visited vs. scheduled stops" />
      <Arrow x1={COL2+BW/2} y1={rows[9]+BH} x2={COL2+BW/2} y2={rows[10]} />
      <Box x={COL2} y={rows[10]} w={BW} h={BH} style={C.topic}    label="NR_JOURNEY_GAPS" sublabel="gap records with severity" />
      <Arrow x1={COL2+BW/2} y1={rows[10]+BH} x2={COL2+BW/2} y2={rows[11]} />
      <Box x={COL2} y={rows[11]} w={BW} h={BH} style={C.processor} label="infill_predictor.py" sublabel="interpolates missing passing times" />

      {/* ── COLUMN 3: Outputs (right) ────────────────────────────────── */}
      <text x={COL3 + BW/2} y={14} textAnchor="middle" fill="#6b7280" fontSize={9} fontWeight={700} fontFamily="IBM Plex Sans,sans-serif">OUTPUTS</text>
      {/* Arrow from infill_predictor → predicted gaps topic */}
      <Arrow x1={COL2+BW} y1={rows[11]+BH/2} x2={COL3} y2={rows[11]+BH/2} />
      <Box x={COL3} y={rows[11]} w={BW} h={BH} style={C.topic}    label="NR_JOURNEY_GAPS_PREDICTED" sublabel="with predicted times + confidence" />

      {/* Arrow from NR_JOURNEY_GAPS → this UI */}
      <Arrow x1={COL2+BW} y1={rows[10]+BH/2} x2={COL3} y2={rows[10]+BH/2} />
      <Box x={COL3} y={rows[10]} w={BW} h={BH} style={C.ui}       label="This UI" sublabel="Gap Explorer dashboard" />

      {/* delay_cause_analyser feeds from NR_JOURNEY_GAPS_PREDICTED */}
      <Arrow x1={COL3+BW/2} y1={rows[11]} x2={COL3+BW/2} y2={rows[9]+BH} />
      <Box x={COL3} y={rows[9]} w={BW} h={BH} style={C.processor} label="delay_cause_analyser.py" sublabel="AI delay categorisation (LLM)" />
      <Arrow x1={COL3+BW/2} y1={rows[9]} x2={COL3+BW/2} y2={rows[8]+BH} />
      <Box x={COL3} y={rows[8]} w={BW} h={BH} style={C.topic}     label="NR_JOURNEY_GAPS_ANALYSED" sublabel="LLM cause + category" />

      {/* Legend */}
      {([
        ['Kafka topic',        C.topic],
        ['ksqlDB stream',      C.stream],
        ['ksqlDB table',       C.table],
        ['Connector',          C.connector],
        ['Python processor',   C.processor],
        ['Database / feed',    C.db],
      ] as [string, typeof C.topic][]).map(([label, style], i) => (
        <g key={label} transform={`translate(${COL3 + 4 + (i % 2) * 97}, ${rows[0] + Math.floor(i/2) * 22})`}>
          <rect width={90} height={18} rx={3} fill={style.fill} stroke={style.stroke} strokeWidth={1} />
          <text x={45} y={12} textAnchor="middle" fill={style.text} fontSize={9} fontFamily="IBM Plex Sans,sans-serif">{label}</text>
        </g>
      ))}
    </svg>
  );
}

export default function PipelinePage() {
  const [status,      setStatus]      = useState<Status | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [lastRefresh, setLastRefresh] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/pipeline-status');
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setStatus(d);
      setLastRefresh(new Date(d.ts).toLocaleTimeString());
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtCount = (n: number) => n.toLocaleString();

  return (
    <div>
      {/* Header */}
      <div className="ngi-page-header">
        <div>
          <h1 className="ngi-page-title">Pipeline Status</h1>
          <p className="ngi-page-subtitle">
            ksqlDB queries &amp; Kafka topic health · refreshes every 20 s
            {lastRefresh && (
              <span style={{ marginLeft: '0.75rem', color: 'var(--cds-text-placeholder)' }}>
                Last: {lastRefresh}
              </span>
            )}
          </p>
        </div>
        <Button
          kind="primary"
          size="sm"
          renderIcon={Renew}
          onClick={load}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </Button>
      </div>

      {error && (
        <InlineNotification
          kind="error"
          title="Error loading pipeline status"
          subtitle={error}
          style={{ marginBottom: '1rem' }}
          lowContrast
        />
      )}

      {/* ksqlDB Queries */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="ngi-section-label">ksqlDB Queries</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(status?.statements ?? []).map(s => (
            <div key={s.name} className="ngi-card" style={{
              display: 'grid',
              gridTemplateColumns: '220px 110px 1fr',
              alignItems: 'center',
              gap: '0.75rem',
              borderLeft: `4px solid var(--cds-${PHASE_TYPE[s.phase] === 'green' ? 'support-success' : PHASE_TYPE[s.phase] === 'red' ? 'support-error' : PHASE_TYPE[s.phase] === 'purple' ? 'support-warning' : 'support-undefined'})`,
            }}>
              <code style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--cds-text-primary)' }}>
                {s.name}
              </code>
              <div>{phaseTag(s.phase)}</div>
              <div style={{ color: 'var(--cds-text-secondary)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.detail || '—'}
              </div>
            </div>
          ))}
          {!status && !loading && (
            <div style={{ color: 'var(--cds-text-placeholder)', fontSize: '0.875rem' }}>
              Waiting for data…
            </div>
          )}
        </div>
      </section>

      {/* Topic Stats */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 className="ngi-section-label">Kafka Topics</h2>
        <div className="ngi-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="ngi-table">
            <thead>
              <tr>
                {['Topic', 'Beginning Offset', 'End Offset', 'Message Count', 'Health'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !status && (
                <tr>
                  <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--cds-text-placeholder)' }}>
                    Loading…
                  </td>
                </tr>
              )}
              {(status?.topics ?? []).map(t => {
                const healthy = t.count > 0;
                return (
                  <tr key={t.topic}>
                    <td><code>{t.topic}</code></td>
                    <td style={{ color: 'var(--cds-text-secondary)' }}>{fmtCount(t.beginning)}</td>
                    <td style={{ color: 'var(--cds-text-secondary)' }}>{fmtCount(t.end)}</td>
                    <td style={{ fontWeight: 600 }}>{fmtCount(t.count)}</td>
                    <td>
                      <Tag type={healthy ? 'green' : 'gray'} size="sm">
                        {healthy ? 'Has data' : 'Empty'}
                      </Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Architecture diagram */}
      <section>
        <h2 className="ngi-section-label">Pipeline Architecture</h2>
        <div className="ngi-card" style={{ padding: '1.25rem', overflow: 'auto' }}>
          <PipelineDiagram />
        </div>
      </section>
    </div>
  );
}
