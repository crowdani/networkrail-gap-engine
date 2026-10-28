'use client';

import { useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/Header';
import {
  Tile,
  Loading,
  InlineNotification,
  Tag,
  ProgressBar,
  Button,
  Modal,
} from '@carbon/react';
import {
  WarningAlt,
  ErrorFilled,
  Renew,
  CheckmarkFilled,
  Download,
  Activity,
} from '@carbon/icons-react';
import { useRefresh } from '@/contexts/RefreshContext';


// ── Live Stream ───────────────────────────────────────────────────────────────

interface LiveStreamEvent {
  TRAIN_ID:             string;
  TRAIN_UID:            string | null;
  TRAIN_SERVICE_CODE:   string | null;
  CURRENT_STANOX:       string | null;
  CURRENT_STATION_NAME: string | null;
  LAST_UPDATED:         string | null;
  STATUS:               string | null;
  ORIGIN_TIPLOC:        string | null;
  ORIGIN_TIME:          string | null;
  DEST_TIPLOC:          string | null;
  DEST_TIME:            string | null;
  VISITED_COUNT:        number;
  OPERATOR:             string | null;
  _ts:                  number;
}

function fmtEpochMs(epochMs: number): string {
  if (!epochMs || epochMs <= 0) return '—';
  return new Date(epochMs).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function relativeTs(epochMs: number): string {
  if (!epochMs || epochMs <= 0) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 5_000)     return 'just now';
  if (diff < 60_000)    return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function LiveProcessingStream() {
  const [events,      setEvents]      = useState<LiveStreamEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [newCount,    setNewCount]    = useState<number>(0);
  const [lastPoll,    setLastPoll]    = useState<number>(0);
  const prevTopTsRef  = useRef<number>(-1);
  const isMountedRef  = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const poll = async () => {
      if (!isMountedRef.current) return;
      try {
        const res = await fetch('/api/live-stream', { cache: 'no-store' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
        }
        const data: LiveStreamEvent[] = await res.json();
        if (!isMountedRef.current) return;

        const topTs = data[0]?._ts ?? -1;
        const added = topTs > prevTopTsRef.current && prevTopTsRef.current > 0
          ? data.filter(e => e._ts > prevTopTsRef.current).length
          : 0;
        prevTopTsRef.current = topTs;
        setNewCount(added);
        setEvents(data);
        setLastPoll(Date.now());
        setStreamError(null);
      } catch (err) {
        if (isMountedRef.current) setStreamError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  const activeCount     = events.filter(e => e.STATUS === 'ACTIVE').length;
  const terminatedCount = events.filter(e => e.STATUS === 'TERMINATED').length;

  return (
    <Tile style={{ marginBottom: '2rem', padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: '0.875rem 1.5rem',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={16} style={{ color: '#0f62fe' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            Live Journey Stream
          </h2>
          <span style={{ fontSize: '0.7rem', color: '#525252', marginLeft: '0.25rem' }}>
            ksqlDB · LIVE_JOURNEY_STATE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {streamError ? (
            <Tag type="red" size="sm">STREAM ERROR</Tag>
          ) : (
            <>
              {/* Summary badges */}
              {events.length > 0 && (
                <>
                  <span style={{ fontSize: '0.72rem', color: '#42be65', fontWeight: 600 }}>
                    {activeCount} active
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#8d8d8d' }}>
                    {terminatedCount} terminated
                  </span>
                </>
              )}
              {newCount > 0 && (
                <span style={{ fontSize: '0.72rem', color: '#78a9ff', fontWeight: 600 }}>
                  +{newCount} updated
                </span>
              )}
              {/* Live pulse */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                fontSize: '0.75rem', color: '#24a148', fontWeight: 500,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#24a148',
                  display: 'inline-block', animation: 'pulse-dot 1.4s ease-in-out infinite',
                }} />
                LIVE
              </span>
              {lastPoll > 0 && (
                <span style={{ fontSize: '0.68rem', color: '#8d8d8d' }}>
                  polled {relativeTs(lastPoll)}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '68px 70px 80px 1fr 1fr 52px 70px',
        padding: '0.3rem 1.25rem',
        background: '#1c1c1c',
        borderBottom: '1px solid #3d3d3d',
        fontFamily: 'monospace',
        fontSize: '0.62rem',
        color: '#6f6f6f',
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        gap: '0.5rem',
      }}>
        <span>Updated</span>
        <span>UID</span>
        <span>Operator</span>
        <span>Origin → Destination</span>
        <span>Current Station</span>
        <span style={{ textAlign: 'right' }}>Visited</span>
        <span style={{ textAlign: 'right' }}>Status</span>
      </div>

      {/* Feed */}
      <div style={{
        height: 340,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '0.73rem',
        background: '#161616',
        color: '#f4f4f4',
      }}>
        {events.length === 0 && !streamError ? (
          <div style={{ padding: '1.25rem 1.5rem', color: '#8d8d8d' }}>
            Connecting to ksqlDB…
          </div>
        ) : streamError !== null ? (
          <div style={{ padding: '1rem 1.5rem', color: '#da1e28', wordBreak: 'break-all' }}>
            ⚠ {streamError}
          </div>
        ) : (
          events.map((ev, i) => {
            const status      = ev.STATUS?.toUpperCase() ?? 'UNKNOWN';
            const isActive    = status === 'ACTIVE';
            const isTerm      = status === 'TERMINATED';
            const statusColor = isActive ? '#42be65' : isTerm ? '#8d8d8d' : '#78a9ff';
            const rowBg       = isActive && i === 0 ? '#0d2b0d'
                              : isActive ? 'transparent'
                              : 'transparent';
            const tsMs        = ev._ts;

            // Origin → Destination display
            const origin = ev.ORIGIN_TIPLOC
              ? `${ev.ORIGIN_TIPLOC}${ev.ORIGIN_TIME ? ` ${ev.ORIGIN_TIME}` : ''}`
              : '—';
            const dest = ev.DEST_TIPLOC
              ? `${ev.DEST_TIPLOC}${ev.DEST_TIME ? ` ${ev.DEST_TIME}` : ''}`
              : '—';
            const route = `${origin} → ${dest}`;

            const currentStation = ev.CURRENT_STATION_NAME
              ? ev.CURRENT_STATION_NAME
              : ev.CURRENT_STANOX ? `STANOX ${ev.CURRENT_STANOX}` : '—';

            return (
              <div
                key={ev.TRAIN_ID}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '68px 70px 80px 1fr 1fr 52px 70px',
                  alignItems: 'center',
                  padding: '0.32rem 1.25rem',
                  borderBottom: '1px solid #2d2d2d',
                  background: rowBg,
                  gap: '0.5rem',
                  opacity: isTerm ? 0.55 : 1,
                }}
              >
                {/* Updated time */}
                <span style={{ color: tsMs > 0 ? '#a8c7fa' : '#8d8d8d', whiteSpace: 'nowrap', fontSize: '0.68rem' }}>
                  {tsMs > 0 ? fmtEpochMs(tsMs) : '—'}
                </span>

                {/* Train UID */}
                <span style={{ color: '#78a9ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.TRAIN_UID?.trim() || ev.TRAIN_ID.slice(0, 7)}
                </span>

                {/* Operator */}
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: ev.OPERATOR ? '#f1c21b' : '#6f6f6f',
                  fontSize: '0.68rem',
                }}>
                  {ev.OPERATOR ?? '—'}
                </span>

                {/* Origin → Destination */}
                <span style={{ color: '#c6c6c6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.68rem' }}>
                  {route}
                </span>

                {/* Current station */}
                <span style={{
                  color: isActive ? '#f4f4f4' : '#8d8d8d',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {currentStation}
                </span>

                {/* Visited count */}
                <span style={{
                  color: ev.VISITED_COUNT > 0 ? '#42be65' : '#6f6f6f',
                  fontWeight: 600, fontSize: '0.68rem',
                  textAlign: 'right' as const,
                }}>
                  {ev.VISITED_COUNT > 0 ? ev.VISITED_COUNT : '—'}
                </span>

                {/* Status */}
                <span style={{
                  color: statusColor, fontSize: '0.62rem', fontWeight: 700,
                  letterSpacing: '0.3px', textAlign: 'right' as const, whiteSpace: 'nowrap',
                }}>
                  {status}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '0.45rem 1.5rem',
        borderTop: '1px solid #e0e0e0',
        fontSize: '0.68rem',
        color: '#8d8d8d',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>ksqlDB pull query · LIVE_JOURNEY_STATE table · newest 50 by last update</span>
        <span>{events.length} journeys</span>
      </div>
    </Tile>
  );
}

// ── Page interfaces ────────────────────────────────────────────────────────────


interface Service {
  name: string;
  container: string;
  status: 'running' | 'degraded' | 'stopped';
  statusText: string;
  type: string;
}

interface SystemStatus {
  timestamp: string;
  services: Service[];
  database: {
    connected: boolean;
    responseTime?: number;
    movements?: number;
    gaps?: number;
    locations?: number;
    recentMovements?: number;
    recentGaps?: number;
    error?: string;
  };
}

export default function SystemStatusPage() {
  const { startRefresh, completeRefresh } = useRefresh();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshOutput, setRefreshOutput] = useState<string>('');

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/system-status', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) throw new Error('Failed to fetch status');
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshSchedules = async () => {
    setRefreshing(true);
    startRefresh();
    setRefreshOutput('Starting schedule refresh...\n');
    
    try {
      const response = await fetch('/api/refresh-schedules', {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (data.success) {
        const infoMsg = data.message || 'Schedule refresh completed successfully!';
        const note = data.info?.note ? `\n${data.info.note}` : '';
        const countMsg = data.currentSchedules?.count !== undefined
          ? `\nSchedules in DB: ${data.currentSchedules.count} (${data.currentSchedules.dataAge || 'unknown age'})`
          : '';
        setRefreshOutput(prev => prev + `\n✅ ${infoMsg}${note}${countMsg}\n\n` + (data.output || ''));
        completeRefresh();
      } else {
        setRefreshOutput(prev => prev + '\n❌ Schedule refresh failed:\n' + data.error + '\n\n' + (data.output || ''));
        completeRefresh();
      }
    } catch (err) {
      setRefreshOutput(prev => prev + '\n❌ Error: ' + (err instanceof Error ? err.message : 'Unknown error'));
      completeRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <CheckmarkFilled size={20} style={{ color: '#24a148' }} />;
      case 'degraded':
        return <WarningAlt size={20} style={{ color: '#f1c21b' }} />;
      case 'stopped':
        return <ErrorFilled size={20} style={{ color: '#da1e28' }} />;
      default:
        return null;
    }
  };

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'running':
        return <Tag type="green" size="sm">ONLINE</Tag>;
      case 'degraded':
        return <Tag type="warm-gray" size="sm">DEGRADED</Tag>;
      case 'stopped':
        return <Tag type="red" size="sm">OFFLINE</Tag>;
      default:
        return <Tag type="gray" size="sm">UNKNOWN</Tag>;
    }
  };

  if (loading) {
    return (
      <>
        <AppHeader />
        <main style={{ marginTop: '48px', padding: '2rem' }}>
          <Loading description="Loading system status..." withOverlay={false} />
        </main>
      </>
    );
  }

  const allServicesRunning = status?.services.every(s => s.status === 'running') && status?.database.connected;

  return (
    <>
      <style jsx global>{`
        .status-container {
          max-width: 1584px;
          margin: 0 auto;
        }
        
        .status-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #e0e0e0;
        }
        
        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
          margin-bottom: 2rem;
        }
        
        .service-list {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        
        .service-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem;
          border-bottom: 1px solid #e0e0e0;
          transition: background-color 0.15s ease;
        }
        
        .service-item:hover {
          background-color: #f4f4f4;
        }
        
        .service-item:last-child {
          border-bottom: none;
        }
        
        .service-info {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex: 1;
        }
        
        .service-name {
          font-weight: 600;
          font-size: 0.875rem;
          color: #161616;
        }
        
        .service-type {
          font-size: 0.75rem;
          color: #525252;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .service-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .metric-card {
          padding: 1.5rem;
          background: #ffffff;
        }
        
        .metric-label {
          font-size: 0.75rem;
          color: #525252;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 0.5rem;
        }
        
        .metric-value {
          font-size: 2rem;
          font-weight: 600;
          color: #161616;
          margin-bottom: 0.5rem;
        }
        
        .metric-subtitle {
          font-size: 0.875rem;
          color: #525252;
        }
        
        .health-banner {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          border-radius: 0;
          font-weight: 600;
          font-size: 0.875rem;
          margin-bottom: 2rem;
        }
        
        .health-banner.healthy {
          background: #defbe6;
          color: #0e6027;
          border-left: 4px solid #24a148;
        }
        
        .health-banner.issues {
          background: #fff1f1;
          color: #750e13;
          border-left: 4px solid #da1e28;
        }
        
        .controls {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
      
      <AppHeader />
      <main style={{ marginTop: '48px', padding: '2rem' }}>
        <div className="status-container">
          <div className="status-header">
            <div>
              <h1 style={{ marginBottom: '0.5rem', fontSize: '2rem', fontWeight: 400 }}>System Status</h1>
              <p style={{ color: '#525252', fontSize: '0.875rem' }}>
                Real-time monitoring of infrastructure components
              </p>
            </div>
            <div className="controls">
              <Tag type={autoRefresh ? 'green' : 'gray'} size="md">
                {autoRefresh ? 'Auto-refresh' : 'Paused'}
              </Tag>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                {autoRefresh ? 'Pause' : 'Resume'}
              </Button>
              <Button
                kind="primary"
                size="sm"
                renderIcon={Renew}
                onClick={fetchStatus}
              >
                Refresh
              </Button>
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Download}
                onClick={() => setRefreshModalOpen(true)}
              >
                Update Schedules
              </Button>
            </div>
          </div>

          {error && (
            <InlineNotification
              kind="error"
              title="Connection Error"
              subtitle={error}
              style={{ marginBottom: '2rem' }}
              lowContrast
            />
          )}

          <LiveProcessingStream />

          <div className={`health-banner ${allServicesRunning ? 'healthy' : 'issues'}`}>
            {allServicesRunning ? (
              <>
                <CheckmarkFilled size={20} />
                <span>All systems operational</span>
              </>
            ) : (
              <>
                <WarningAlt size={20} />
                <span>System degradation detected</span>
              </>
            )}
          </div>

          {/* Services */}
          <Tile style={{ marginBottom: '2rem', padding: 0 }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e0e0e0' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                Infrastructure Services
              </h2>
            </div>
            <div className="service-list">
              {status?.services.map((service, index) => (
                <div key={index} className="service-item">
                  <div className="service-info">
                    <div>
                      <div className="service-name">{service.name}</div>
                      <div className="service-type">{service.type}</div>
                    </div>
                  </div>
                  <div className="service-status">
                    {getStatusIcon(service.status)}
                    {getStatusTag(service.status)}
                  </div>
                </div>
              ))}
            </div>
          </Tile>

          {/* Database Metrics */}
          {status?.database.connected ? (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Database Metrics</h2>
              </div>
              <div className="status-grid">
                <Tile className="metric-card">
                  <div className="metric-label">Total Movements</div>
                  <div className="metric-value">{status.database.movements?.toLocaleString() || '0'}</div>
                  <div className="metric-subtitle">Historical records</div>
                </Tile>
                
                <Tile className="metric-card">
                  <div className="metric-label">Recent Activity</div>
                  <div className="metric-value">{status.database.recentMovements?.toLocaleString() || '0'}</div>
                  <div className="metric-subtitle">Last 5 minutes</div>
                </Tile>
                
                <Tile className="metric-card">
                  <div className="metric-label">Gaps Detected</div>
                  <div className="metric-value">{status.database.gaps?.toLocaleString() || '0'}</div>
                  <div className="metric-subtitle">Total identified</div>
                </Tile>
                
                <Tile className="metric-card">
                  <div className="metric-label">Recent Gaps</div>
                  <div className="metric-value">{status.database.recentGaps?.toLocaleString() || '0'}</div>
                  <div className="metric-subtitle">Last hour</div>
                </Tile>
                
                <Tile className="metric-card">
                  <div className="metric-label">Reference Data</div>
                  <div className="metric-value">{status.database.locations?.toLocaleString() || '0'}</div>
                  <div className="metric-subtitle">CORPUS locations</div>
                </Tile>
                
                <Tile className="metric-card">
                  <div className="metric-label">Response Time</div>
                  <div className="metric-value">{status.database.responseTime || '0'}ms</div>
                  <div className="metric-subtitle">Database latency</div>
                </Tile>
              </div>
              
              {status.database.recentMovements !== undefined && status.database.recentMovements > 0 && (
                <Tile style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Data Ingestion</span>
                    <Tag type="green" size="sm">ACTIVE</Tag>
                  </div>
                  <ProgressBar
                    label="Processing train movements"
                    value={100}
                    status="active"
                    hideLabel
                  />
                </Tile>
              )}
            </>
          ) : (
            <Tile>
              <InlineNotification
                kind="error"
                title="Database Unavailable"
                subtitle={status?.database.error || 'Unable to establish database connection'}
                lowContrast
              />
            </Tile>
          )}

          <div style={{ 
            marginTop: '2rem', 
            paddingTop: '1rem', 
            borderTop: '1px solid #e0e0e0',
            fontSize: '0.75rem', 
            color: '#8d8d8d',
            textAlign: 'center'
          }}>
            Last updated: {status?.timestamp ? new Date(status.timestamp).toLocaleString('en-GB', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }) : '-'}
          </div>
        </div>
      </main>

      <Modal
        open={refreshModalOpen}
        onRequestClose={() => !refreshing && setRefreshModalOpen(false)}
        modalHeading="Update Train Schedules"
        primaryButtonText={refreshing ? "Refreshing..." : "Start Refresh"}
        secondaryButtonText="Close"
        onRequestSubmit={handleRefreshSchedules}
        primaryButtonDisabled={refreshing}
        preventCloseOnClickOutside={refreshing}
        size="lg"
      >
        <p style={{ marginBottom: '1rem' }}>
          This will download the latest train schedule data from Network Rail and update the database.
          The process may take several minutes.
        </p>
        
        {refreshOutput && (
          <div style={{
            background: '#f4f4f4',
            padding: '1rem',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            maxHeight: '400px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {refreshOutput}
          </div>
        )}
        
        {refreshing && (
          <Loading description="Downloading and processing schedules..." withOverlay={false} small />
        )}
      </Modal>
    </>
  );
}

