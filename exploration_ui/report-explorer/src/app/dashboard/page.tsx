'use client';

import { useRouter } from 'next/navigation';
import { Train, DataView, Location, CheckmarkOutline } from '@carbon/icons-react';
import { useEffect, useState } from 'react';

interface DashboardStats {
  totalGaps: number;
  totalJourneys: number;
  locationsAffected: number;
  predictedGaps: number;
  pendingApprovals: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalGaps: 0,
    totalJourneys: 0,
    locationsAffected: 0,
    predictedGaps: 0,
    pendingApprovals: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/dashboard/stats');
        if (res.ok) {
          const data = await res.json();
          setStats({
            totalGaps:         data.totalGaps || 0,
            totalJourneys:     data.totalJourneys || 0,
            locationsAffected: data.locationsAffected || 0,
            predictedGaps:     data.predictedGaps || 0,
            pendingApprovals:  data.pendingApprovals || 0,
          });
        }
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const cards = [
    {
      title: 'Train View',
      description: 'View all trains with gaps in the selected time period',
      icon: Train,
      href: '/train-view',
      stats: { label: 'Journeys Analyzed', value: loading ? '...' : stats.totalJourneys.toLocaleString() },
    },
    {
      title: 'Gap View',
      description: 'View and manage individual gap events',
      icon: DataView,
      href: '/gap-view',
      stats: { label: 'Total Gaps', value: loading ? '...' : stats.totalGaps.toLocaleString() },
    },
    {
      title: 'Location View',
      description: 'View locations with the most gap occurrences',
      icon: Location,
      href: '/location-view',
      stats: { label: 'Locations', value: loading ? '...' : stats.locationsAffected.toLocaleString() },
    },
    {
      title: 'Gap Approvals',
      description: 'Review and approve predicted infill times from the Confluent pipeline',
      icon: CheckmarkOutline,
      href: '/approvals',
      stats: { label: 'Pending Approvals', value: loading ? '...' : stats.pendingApprovals.toLocaleString() },
    },
  ];

  return (
    <div style={{ padding: '2rem', background: '#f4f4f4', minHeight: '100vh' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: '400', color: '#161616', margin: 0, marginBottom: '0.5rem' }}>
          Network Rail Gap Detection
        </h1>
        <p style={{ fontSize: '1rem', color: '#525252', margin: 0 }}>
          Monitor and analyze train reporting gaps across the network
        </p>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        {[
          { label: 'Total Gaps',           value: loading ? '...' : stats.totalGaps.toLocaleString() },
          { label: 'Journeys Analyzed',    value: loading ? '...' : stats.totalJourneys.toLocaleString() },
          { label: 'Predicted Gaps',       value: loading ? '...' : stats.predictedGaps.toLocaleString(), accent: true },
          { label: 'Pending Approvals',    value: loading ? '...' : stats.pendingApprovals.toLocaleString(), warn: stats.pendingApprovals > 0 },
        ].map(stat => (
          <div
            key={stat.label}
            style={{
              background: '#ffffff',
              padding: '2rem',
              borderRadius: '4px',
              border: `1px solid ${stat.warn ? '#ffd6a0' : stat.accent ? '#d0e2ff' : '#e0e0e0'}`,
            }}
          >
            <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>{stat.label}</div>
            <div style={{
              fontSize: '3rem',
              fontWeight: '300',
              color: stat.warn ? '#8a3800' : stat.accent ? '#0043ce' : '#161616',
              marginBottom: '0.5rem',
            }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* View Cards */}
      <div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '400', color: '#161616', marginBottom: '1.5rem' }}>
          Quick Access
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.href}
                onClick={() => router.push(card.href)}
                style={{
                  background: '#ffffff',
                  padding: '2rem',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#0f62fe';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e0e0e0';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      background: '#e8f4ff',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={24} style={{ color: '#0f62fe' }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>
                      {card.stats.label}
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '600', color: '#161616' }}>
                      {card.stats.value}
                    </div>
                  </div>
                </div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#161616', margin: 0, marginBottom: '0.5rem' }}>
                  {card.title}
                </h3>
                <p style={{ fontSize: '0.875rem', color: '#525252', margin: 0, lineHeight: '1.5' }}>
                  {card.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* System Status */}
      <SystemStatusPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// System status panel — live data from /api/system-status
// ---------------------------------------------------------------------------

interface ServiceStatus {
  name: string;
  status: 'running' | 'degraded' | 'offline';
  statusText: string;
  type: string;
}

interface SystemStatusData {
  services: ServiceStatus[];
  database: {
    connected: boolean;
    responseTime?: number;
    predictedGaps?: string | number;
    recentPredictedGaps?: string | number;
    gaps?: string | number;
    recentGaps?: string | number;
    error?: string;
  };
  kafka: {
    connected: boolean;
    responseMs?: number;
    clusterId?: string;
    liveJourneyState?: { messageCount: number } | null;
    error?: string;
  };
}

function StatusDot({ status }: { status: 'running' | 'degraded' | 'offline' | undefined }) {
  const color = status === 'running' ? '#24a148' : status === 'degraded' ? '#f1c21b' : '#da1e28';
  return <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

function SystemStatusPanel() {
  const [data, setData] = useState<SystemStatusData | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetch('/api/system-status')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setFetching(false));
  }, []);

  const dbStatus   = data?.database.connected ? 'running' : data ? 'offline' : undefined;
  const kafkaStatus: 'running' | 'offline' | undefined = data?.kafka.connected ? 'running' : data ? 'offline' : undefined;

  return (
    <div style={{ marginTop: '3rem', background: '#ffffff', padding: '2rem', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#161616', marginBottom: '1.5rem' }}>
        System Status
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>

        {/* Database */}
        <div>
          <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>Database</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <StatusDot status={dbStatus} />
            <span style={{ fontSize: '0.875rem', color: '#161616', fontWeight: '600' }}>
              {fetching ? '…' : data?.database.connected ? 'Healthy' : 'Offline'}
            </span>
          </div>
          {data?.database.connected && data.database.responseTime != null && (
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>{data.database.responseTime}ms response</div>
          )}
          {data?.database.predictedGaps != null && (
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>
              {Number(data.database.predictedGaps).toLocaleString()} predicted gaps
            </div>
          )}
        </div>

        {/* Confluent / Kafka */}
        <div>
          <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>Confluent (Kafka)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <StatusDot status={kafkaStatus} />
            <span style={{ fontSize: '0.875rem', color: '#161616', fontWeight: '600' }}>
              {fetching ? '…' : data?.kafka.connected ? 'Connected' : 'Offline'}
            </span>
          </div>
          {data?.kafka.connected && data.kafka.responseMs != null && (
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>{data.kafka.responseMs}ms REST proxy</div>
          )}
          {data?.kafka.liveJourneyState?.messageCount != null && (
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>
              {data.kafka.liveJourneyState.messageCount.toLocaleString()} live journey messages
            </div>
          )}
        </div>

        {/* JDBC Sink (predicted_gaps) */}
        <div>
          <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>JDBC Sink</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <StatusDot status={dbStatus} />
            <span style={{ fontSize: '0.875rem', color: '#161616', fontWeight: '600' }}>
              {fetching ? '…' : data?.database.connected ? 'Syncing' : 'Offline'}
            </span>
          </div>
          {data?.database.recentPredictedGaps != null && (
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f' }}>
              {data.database.recentPredictedGaps} gaps in last 6h
            </div>
          )}
        </div>

        {/* Other services from Docker / host */}
        {data?.services.filter(s => s.type !== 'confluent').map(svc => (
          <div key={svc.name}>
            <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>{svc.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <StatusDot status={svc.status} />
              <span style={{ fontSize: '0.875rem', color: '#161616', fontWeight: '600' }}>
                {svc.status === 'running' ? 'Running' : svc.status === 'degraded' ? 'Degraded' : 'Offline'}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6f6f6f', marginTop: '0.2rem' }}>{svc.statusText}</div>
          </div>
        ))}

        {/* Fallback static entries when API not yet loaded */}
        {fetching && ['STOMP Client', 'Journey Builder', 'Journey Analyzer'].map(name => (
          <div key={name}>
            <div style={{ fontSize: '0.875rem', color: '#525252', marginBottom: '0.5rem' }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e0e0e0' }} />
              <span style={{ fontSize: '0.875rem', color: '#8d8d8d' }}>Checking…</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
