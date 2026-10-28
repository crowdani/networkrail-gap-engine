'use client';

import { useEffect, useState, useRef } from 'react';
import {
  DataTable,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Tag,
  Button,
  Loading,
  Tile,
  Grid,
  Column,
  Modal,
} from '@carbon/react';
import { Renew, TrainSpeed, WarningAlt, CheckmarkFilled } from '@carbon/icons-react';
import Header from '@/components/Header';

interface TrainPosition {
  train_id: string;
  stanox: string;
  location_name: string;
  actual_timestamp: string;
  event_type: string;
  platform?: string;
  route?: string;
  toc?: string;
  train_service_code?: string;
  latitude?: number;
  longitude?: number;
  seconds_ago: number;
}

interface Gap {
  id: number;
  train_id: string;
  train_uid: string;
  headcode: string;
  origin_name: string;
  destination_name: string;
  expected_stanox: string;
  expected_location: string;
  previous_location: string;
  next_location: string;
  expected_time: string;
  detection_time: string;
  severity: string;
  confidence: number;
  gap_duration_minutes?: number;
  distance_km?: number;
  toc?: string;
  seconds_ago: number;
}

interface Statistics {
  trains_last_hour: number;
  active_trains: number;
  gaps_24h: number;
  gaps_1h: number;
  critical_gaps_24h: number;
  high_gaps_24h: number;
}

interface TrainJourney {
  train_id: string;
  positions: Array<{
    stanox: string;
    location_name: string;
    actual_timestamp: string;
    event_type: string;
    platform?: string;
    latitude?: number;
    longitude?: number;
    planned_timestamp?: string;
    delay_minutes?: number;
  }>;
  gaps: Array<{
    expected_stanox: string;
    expected_location: string;
    expected_time: string;
    severity: string;
    confidence: number;
  }>;
}

export default function LiveTrackingPage() {
  const [trains, setTrains] = useState<TrainPosition[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedTrain, setSelectedTrain] = useState<string | null>(null);
  const [trainJourney, setTrainJourney] = useState<TrainJourney | null>(null);
  const [showJourneyModal, setShowJourneyModal] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket server
    const connectWebSocket = () => {
      const ws = new WebSocket('ws://localhost:8765');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'initial_data':
              setTrains(message.data.trains || []);
              setGaps(message.data.gaps || []);
              setStatistics(message.data.statistics || null);
              break;
            
            case 'positions_update':
              setTrains(message.data || []);
              break;
            
            case 'gaps_update':
              setGaps(message.data || []);
              break;
            
            case 'statistics_update':
              setStatistics(message.data || null);
              break;
            
            case 'train_journey':
              setTrainJourney(message.data);
              setShowJourneyModal(true);
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnected(false);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        // Reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
      };
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const viewTrainJourney = (trainId: string) => {
    setSelectedTrain(trainId);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe_train',
        train_id: trainId
      }));
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-GB');
  };

  const formatSecondsAgo = (seconds: number) => {
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'red';
      case 'HIGH': return 'magenta';
      case 'MEDIUM': return 'purple';
      case 'LOW': return 'blue';
      default: return 'gray';
    }
  };

  const getEventTypeColor = (eventType: string) => {
    switch (eventType) {
      case 'ARRIVAL': return 'green';
      case 'DEPARTURE': return 'blue';
      case 'PASS': return 'cyan';
      default: return 'gray';
    }
  };

  const trainHeaders = [
    { key: 'train_id', header: 'Train ID' },
    { key: 'location_name', header: 'Location' },
    { key: 'event_type', header: 'Event' },
    { key: 'platform', header: 'Platform' },
    { key: 'toc', header: 'TOC' },
    { key: 'last_seen', header: 'Last Seen' },
    { key: 'actions', header: 'Actions' },
  ];

  const gapHeaders = [
    { key: 'train_id', header: 'Train ID' },
    { key: 'headcode', header: 'Headcode' },
    { key: 'expected_location', header: 'Missed Station' },
    { key: 'route', header: 'Route' },
    { key: 'severity', header: 'Severity' },
    { key: 'detected', header: 'Detected' },
  ];

  const trainRows = trains.map((train) => ({
    id: train.train_id,
    train_id: train.train_id.substring(0, 10) + '...',
    location_name: train.location_name || 'Unknown',
    event_type: (
      <Tag type={getEventTypeColor(train.event_type) as any}>
        {train.event_type}
      </Tag>
    ),
    platform: train.platform || '-',
    toc: train.toc || '-',
    last_seen: formatSecondsAgo(train.seconds_ago),
    actions: (
      <Button
        size="sm"
        kind="ghost"
        onClick={() => viewTrainJourney(train.train_id)}
      >
        View Journey
      </Button>
    ),
  }));

  const gapRows = gaps.map((gap) => ({
    id: gap.id.toString(),
    train_id: gap.train_id.substring(0, 10) + '...',
    headcode: gap.headcode || '-',
    expected_location: gap.expected_location,
    route: `${gap.previous_location} → ${gap.next_location}`,
    severity: (
      <Tag type={getSeverityColor(gap.severity) as any}>
        {gap.severity}
      </Tag>
    ),
    detected: formatSecondsAgo(gap.seconds_ago),
  }));

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f4f4' }}>
      <Header />
      
      <div style={{ padding: '2rem' }}>
        {/* Connection Status */}
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {connected ? (
            <>
              <CheckmarkFilled size={20} style={{ color: '#24a148' }} />
              <span style={{ color: '#24a148', fontWeight: 600 }}>Connected to Live Feed</span>
            </>
          ) : (
            <>
              <Loading small withOverlay={false} />
              <span style={{ color: '#da1e28' }}>Connecting to Live Feed...</span>
            </>
          )}
        </div>

        {/* Statistics Dashboard */}
        {statistics && (
          <Grid style={{ marginBottom: '2rem' }}>
            <Column lg={4} md={4} sm={4}>
              <Tile style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f62fe' }}>
                  {statistics.active_trains}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#525252', marginTop: '0.5rem' }}>
                  Active Trains
                </div>
              </Tile>
            </Column>
            <Column lg={4} md={4} sm={4}>
              <Tile style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#24a148' }}>
                  {statistics.trains_last_hour}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#525252', marginTop: '0.5rem' }}>
                  Movements (1h)
                </div>
              </Tile>
            </Column>
            <Column lg={4} md={4} sm={4}>
              <Tile style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#da1e28' }}>
                  {statistics.gaps_1h}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#525252', marginTop: '0.5rem' }}>
                  Gaps Detected (1h)
                </div>
              </Tile>
            </Column>
          </Grid>
        )}

        {/* Active Trains Table */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
            <TrainSpeed size={24} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Active Trains
          </h2>
          <DataTable rows={trainRows} headers={trainHeaders}>
            {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })} key={header.key}>
                          {header.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </div>

        {/* Recent Gaps Table */}
        <div>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
            <WarningAlt size={24} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Recent Gaps (24h)
          </h2>
          <DataTable rows={gapRows} headers={gapHeaders}>
            {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })} key={header.key}>
                          {header.header}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </div>

        {/* Train Journey Modal */}
        <Modal
          open={showJourneyModal}
          onRequestClose={() => setShowJourneyModal(false)}
          modalHeading={`Train Journey: ${selectedTrain?.substring(0, 15)}...`}
          primaryButtonText="Close"
          onRequestSubmit={() => setShowJourneyModal(false)}
          size="lg"
        >
          {trainJourney && (
            <div>
              <h4 style={{ marginBottom: '1rem' }}>Journey Timeline</h4>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {trainJourney.positions.map((pos, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '1rem',
                      borderLeft: '3px solid #0f62fe',
                      marginLeft: '1rem',
                      marginBottom: '0.5rem',
                      backgroundColor: '#f4f4f4',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{pos.location_name}</div>
                    <div style={{ fontSize: '0.875rem', color: '#525252' }}>
                      {pos.event_type} at {formatTimestamp(pos.actual_timestamp)}
                      {pos.platform && ` - Platform ${pos.platform}`}
                      {pos.delay_minutes && pos.delay_minutes > 0 && (
                        <Tag type="red" size="sm" style={{ marginLeft: '0.5rem' }}>
                          +{pos.delay_minutes}m
                        </Tag>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              {trainJourney.gaps.length > 0 && (
                <>
                  <h4 style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>Detected Gaps</h4>
                  {trainJourney.gaps.map((gap, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '1rem',
                        backgroundColor: '#fff1f1',
                        border: '1px solid #da1e28',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#da1e28' }}>
                        Missed: {gap.expected_location}
                      </div>
                      <div style={{ fontSize: '0.875rem' }}>
                        Expected at {formatTimestamp(gap.expected_time)}
                        <Tag type={getSeverityColor(gap.severity) as any} size="sm" style={{ marginLeft: '0.5rem' }}>
                          {gap.severity}
                        </Tag>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}

