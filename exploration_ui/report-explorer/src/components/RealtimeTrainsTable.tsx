'use client';

import { useEffect, useState } from 'react';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  Loading,
  InlineNotification,
  Tag
} from '@carbon/react';

interface CallingPoint {
  distance: string;
  location: string;
  locationCode: string;
  platform: string;
  gbttArr: string;
  gbttDep: string;
  wttArr: string;
  wttDep: string;
  realtimeArr: string;
  realtimeDep: string;
  delay: string;
  path: string;
  line: string;
  isPublic: boolean;
  isPass: boolean;
}

interface TrainService {
  uid: string;
  identity: string;
  headcode: string;
  operator: string;
  origin: string;
  destination: string;
  date: string;
  callingPoints: CallingPoint[];
  formation: string;
  facilities: string[];
}

interface RealtimeTrainsTableProps {
  trainUid: string;
  date: string;
  missedStationTiploc?: string;
  missedStationName?: string;
  predictedReason?: string | null;
}

export default function RealtimeTrainsTable({ trainUid, date, missedStationTiploc, missedStationName, predictedReason }: RealtimeTrainsTableProps) {
  const [trainData, setTrainData] = useState<TrainService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrainData = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/realtime-trains/${trainUid}/${date}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch train data');
        }
        
        const data = await response.json();
        setTrainData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchTrainData();
  }, [trainUid, date]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Loading description="Loading train data..." withOverlay={false} />
      </div>
    );
  }

  if (error) {
    return (
      <InlineNotification
        kind="error"
        title="Error"
        subtitle={error}
        lowContrast
      />
    );
  }

  if (!trainData) {
    return (
      <InlineNotification
        kind="warning"
        title="No Data"
        subtitle="No train data available"
        lowContrast
      />
    );
  }

  const headers = [
    { key: 'distance', header: 'Mi.Ch' },
    { key: 'location', header: 'Location' },
    { key: 'locationCode', header: 'locationCode' }, // Hidden column for comparison
    { key: 'platform', header: 'Pl' },
    { key: 'gbttArr', header: 'GBTT Arr' },
    { key: 'gbttDep', header: 'GBTT Dep' },
    { key: 'wttArr', header: 'WTT Arr' },
    { key: 'wttDep', header: 'WTT Dep' },
    { key: 'realtimeArr', header: 'RT Arr' },
    { key: 'realtimeDep', header: 'RT Dep' },
    { key: 'delay', header: 'Delay' },
    { key: 'line', header: 'Line' }
  ];

  const rows = trainData.callingPoints.map((point, index) => {
    return {
      id: `${index}-${point.locationCode}-${point.distance}`,
      distance: point.distance,
      location: `${point.location} [${point.locationCode}]`,
      locationCode: point.locationCode,
      platform: point.platform,
      gbttArr: point.gbttArr,
      gbttDep: point.gbttDep,
      wttArr: point.wttArr,
      wttDep: point.wttDep,
      realtimeArr: point.realtimeArr,
      realtimeDep: point.realtimeDep,
      delay: point.delay,
      line: point.line,
      isPublic: point.isPublic,
      isPass: point.isPass
    };
  });

  return (
    <div style={{ padding: '1rem' }}>
      {/* Missed Station Alert */}
      {missedStationTiploc && missedStationName && (
        <InlineNotification
          kind="warning"
          title="Missed Report Detected"
          subtitle={`This train missed a report at ${missedStationName}. The missed station is highlighted in red below.`}
          lowContrast
          hideCloseButton
          style={{ marginBottom: '1rem', maxWidth: '100%' }}
        />
      )}

      {/* Service Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '0.5rem' }}>
          {trainData.identity} {trainData.origin} to {trainData.destination}
        </h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <Tag type="blue">UID: {trainData.uid}</Tag>
          <Tag type="green">Operator: {trainData.operator}</Tag>
          {trainData.formation && <Tag type="purple">{trainData.formation}</Tag>}
          {predictedReason && (
            <Tag type="red" title={predictedReason}>
              Predicted Delay Cause: {predictedReason}
            </Tag>
          )}
        </div>
        {trainData.facilities.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {trainData.facilities.map((facility, idx) => (
              <Tag key={idx} type="gray" size="sm">{facility}</Tag>
            ))}
          </div>
        )}
      </div>

      {/* Calling Points Table */}
      <DataTable rows={rows} headers={headers}>
        {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
          <TableContainer>
            <Table {...getTableProps()} size="sm">
              <TableHead>
                <TableRow>
                  {headers.map((header) => {
                    const { key, ...headerProps } = getHeaderProps({ header });
                    const isHidden = header.key === 'locationCode';
                    return (
                      <TableHeader
                        key={key}
                        {...headerProps}
                        style={isHidden ? { display: 'none' } : undefined}
                      >
                        {header.header}
                      </TableHeader>
                    );
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const { key, ...rowProps } = getRowProps({ row });
                  const locationCell = row.cells.find(c => c.info.header === 'location');
                  const locationCode = row.cells.find(c => c.info.header === 'locationCode')?.value as string;
                  const locationName = locationCell?.value as string;
                  const isPass = locationCell?.value.toString().includes('pass');
                  
                  // Check if this is the missed station using TIPLOC code match OR name match as fallback
                  const codeMatch = missedStationTiploc && locationCode === missedStationTiploc;
                  const nameMatch = missedStationName && locationName &&
                    locationName.toUpperCase().includes(missedStationName.toUpperCase());
                  const isMissedStation = codeMatch || nameMatch;
                  
                  // Debug logging
                  console.log('Row comparison:', {
                    locationCode,
                    locationName,
                    missedStationTiploc,
                    missedStationName,
                    codeMatch,
                    nameMatch,
                    isMissedStation
                  });
                  
                  return (
                    <TableRow
                      key={key}
                      {...rowProps}
                      style={{
                        backgroundColor: isMissedStation
                          ? '#fff1f1' // Light red background for missed station
                          : isPass
                          ? 'var(--cds-layer-01)'
                          : undefined,
                        borderLeft: isMissedStation ? '4px solid #da1e28' : undefined,
                        fontWeight: isMissedStation ? 600 : undefined
                      }}
                    >
                      {row.cells.map((cell) => {
                        const isHiddenColumn = cell.info.header === 'locationCode';
                        return (
                          <TableCell
                            key={cell.id}
                            style={isHiddenColumn ? { display: 'none' } : undefined}
                          >
                            {cell.info.header === 'location' && isMissedStation ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>{cell.value}</span>
                                <Tag type="red" size="sm">
                                  MISSED REPORT
                                </Tag>
                              </div>
                            ) : cell.info.header === 'delay' && cell.value && cell.value !== 'nil' ? (
                              <Tag type={cell.value.startsWith('+') ? 'red' : 'green'} size="sm">
                                {cell.value}
                              </Tag>
                            ) : (
                              cell.value
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>

      {/* External Link */}
      <div style={{ marginTop: '1rem', textAlign: 'right' }}>
        <a 
          href={`https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${date}/detailed`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--cds-link-primary)', textDecoration: 'none' }}
        >
          View more ↗
        </a>
      </div>
    </div>
  );
}

