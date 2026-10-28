'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/Header';
import TrainJourneyMap from '@/components/TrainJourneyMap';
import { TrainMovement, MovementsApiResponse } from '@/types/train-movements';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  Pagination,
  Loading,
  InlineNotification,
  Tag,
  TextInput,
  Button,
} from '@carbon/react';
import { Search, Renew } from '@carbon/icons-react';

const headers = [
  { key: 'train_id', header: 'Train ID' },
  { key: 'train_uid', header: 'Train UID' },
  { key: 'actual_ts', header: 'Scheduled Time' },
  { key: 'location', header: 'Location' },
  { key: 'event_type', header: 'Event Type' },
  { key: 'platform', header: 'Platform' },
  { key: 'variation', header: 'Variation' },
  { key: 'status', header: 'Status' },
];

export default function MovementsPage() {
  const router = useRouter();
  const [data, setData] = useState<MovementsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchTrainId, setSearchTrainId] = useState('');
  const [searchTrainUid, setSearchTrainUid] = useState('');
  const [searchStanox, setSearchStanox] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const handleTrainClick = (trainId: string) => {
    setSelectedTrainId(trainId);
    setMapOpen(true);
  };

  const handleCloseMap = () => {
    setMapOpen(false);
    setSelectedTrainId(null);
  };

  const fetchData = async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        pageSize: pageSize.toString(),
      });
      
      if (searchTrainId) params.append('trainId', searchTrainId);
      if (searchTrainUid) params.append('trainUid', searchTrainUid);
      if (searchStanox) params.append('stanox', searchStanox);
      
      const response = await fetch(`/api/movements?${params}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      const jsonData: MovementsApiResponse = await response.json();
      setData(jsonData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      if (!isBackgroundRefresh) {
        setLoading(false);
      }
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData(false);
  }, [currentPage, pageSize]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetchData(true); // Background refresh
    }, 10000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, currentPage, pageSize, searchTrainId, searchTrainUid, searchStanox]);

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    try {
      // Handle both ISO string and Date object
      const d = typeof date === 'string' ? new Date(date) : date;
      if (isNaN(d.getTime())) return '-';
      
      // Format: DD/MM/YYYY HH:MM:SS
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      
      return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    } catch {
      return '-';
    }
  };

  const formatLocation = (stanox: string, tiploc: string | null, locationName?: string | null, crs?: string | null) => {
    if (!stanox) return '-';
    if (locationName) {
      return crs ? `${locationName} (${crs})` : locationName;
    }
    return tiploc ? `${tiploc} (${stanox})` : stanox;
  };

  const getVariationTag = (variation: number | null, status: string | null) => {
    if (variation === null || variation === undefined) return null;
    
    if (variation === 0) {
      return <Tag type="green" size="sm">On Time</Tag>;
    } else if (variation > 0) {
      return <Tag type="red" size="sm">+{variation} min</Tag>;
    } else {
      return <Tag type="blue" size="sm">{variation} min</Tag>;
    }
  };

  const getStatusTag = (status: string | null) => {
    if (!status) return null;
    
    const statusMap: Record<string, 'green' | 'red' | 'blue' | 'gray'> = {
      'ON TIME': 'green',
      'EARLY': 'blue',
      'LATE': 'red',
      'OFF ROUTE': 'red',
    };
    
    return <Tag type={statusMap[status] || 'gray'} size="sm">{status}</Tag>;
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchData(false);
  };

  const handleReset = () => {
    setSearchTrainId('');
    setSearchTrainUid('');
    setSearchStanox('');
    setCurrentPage(1);
    fetchData(false);
  };

  const rows = data?.movements.map((movement, index) => ({
    id: `${movement.id}-${index}`,
    train_id: movement.train_id,
    train_uid: movement.train_uid,
    actual_ts: formatDate(movement.actual_ts),
    location: formatLocation(
      movement.loc_stanox,
      movement.tiploc_code,
      (movement as any).location_name,
      (movement as any).location_crs
    ),
    event_type: movement.event_type || '-',
    platform: movement.platform || '-',
    variation: movement.timetable_variation,
    status: movement.variation_status,
    _raw: movement,
  })) || [];

  return (
    <>
      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .refresh-indicator {
          animation: fadeIn 0.3s ease-out;
        }
        .cds--data-table tbody tr {
          transition: background-color 0.15s ease, transform 0.1s ease;
        }
        .cds--data-table tbody tr:hover {
          background-color: var(--cds-layer-hover-01) !important;
          transform: translateX(2px);
        }
        .cds--data-table tbody tr:active {
          transform: translateX(0px);
        }
      `}</style>
      <AppHeader />
      <main style={{ marginTop: '48px', padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ marginBottom: '0.5rem' }}>Train Movements</h1>
            <p style={{ marginBottom: '0.25rem' }}>Real-time train movement events from Network Rail</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--cds-text-secondary)' }}>
              <strong>Scheduled Time:</strong> The planned time for each event (arrival/departure/pass).
              Variation shows how early/late the train actually was.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Tag type={autoRefresh ? 'green' : 'gray'} size="md">
              {autoRefresh ? 'Auto-refresh: ON' : '⏸Auto-refresh: OFF'}
            </Tag>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? 'Pause' : 'Resume'}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Renew}
              onClick={() => fetchData(false)}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
            </Button>
          </div>
        </div>

        {/* Search Filters */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '1rem', 
          marginBottom: '2rem',
          padding: '1rem',
          backgroundColor: 'var(--cds-layer-01)',
          borderRadius: '4px'
        }}>
          <TextInput
            id="search-train-id"
            labelText="Train ID"
            placeholder="e.g., 123456789"
            value={searchTrainId}
            onChange={(e) => setSearchTrainId(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <TextInput
            id="search-train-uid"
            labelText="Train UID"
            placeholder="e.g., C12345"
            value={searchTrainUid}
            onChange={(e) => setSearchTrainUid(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <TextInput
            id="search-stanox"
            labelText="STANOX"
            placeholder="e.g., 87701"
            value={searchStanox}
            onChange={(e) => setSearchStanox(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <Button
              kind="primary"
              size="md"
              renderIcon={Search}
              onClick={handleSearch}
            >
              Search
            </Button>
            <Button
              kind="secondary"
              size="md"
              onClick={handleReset}
            >
              Reset
            </Button>
          </div>
        </div>

        {loading && !data && (
          <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
            <Loading description="Loading movements..." withOverlay={false} />
          </div>
        )}
        
        {isRefreshing && data && (
          <div className="refresh-indicator" style={{
            position: 'fixed',
            top: '60px',
            right: '20px',
            zIndex: 1000,
            backgroundColor: 'var(--cds-layer-01)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            border: '1px solid var(--cds-border-subtle-01)'
          }}>
            <div style={{
              width: '12px',
              height: '12px',
              border: '2px solid var(--cds-interactive-01)',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--cds-text-primary)' }}>Updating...</span>
          </div>
        )}
        
        {error && (
          <InlineNotification
            kind="error"
            title="Error"
            subtitle={error}
            style={{ marginBottom: '1rem' }}
          />
        )}

        {data && (
          <>
            <DataTable rows={rows} headers={headers}>
              {({
                rows,
                headers,
                getTableProps,
                getHeaderProps,
                getRowProps,
              }) => (
                <TableContainer
                  title="Recent Movements"
                  description={`Showing ${rows.length} of ${data.total} movements`}
                >
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
                        <TableRow
                          {...getRowProps({ row })}
                          key={row.id}
                          onClick={() => handleTrainClick(row.cells.find(c => c.info.header === 'train_id')?.value as string)}
                          style={{ cursor: 'pointer' }}
                        >
                          {row.cells.map((cell) => (
                            <TableCell key={cell.id}>
                              {cell.info.header === 'variation' ? (
                                getVariationTag(cell.value as number, (row.cells.find(c => c.info.header === 'status')?.value as string))
                              ) : cell.info.header === 'status' ? (
                                getStatusTag(cell.value as string)
                              ) : (
                                cell.value
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DataTable>

            <Pagination
              backwardText="Previous page"
              forwardText="Next page"
              itemsPerPageText="Items per page:"
              page={currentPage}
              pageSize={pageSize}
              pageSizes={[25, 50, 100, 200]}
              totalItems={data.total}
              onChange={({ page, pageSize: newPageSize }) => {
                if (newPageSize !== pageSize) {
                  setPageSize(newPageSize);
                  setCurrentPage(1);
                } else {
                  setCurrentPage(page);
                }
              }}
              style={{ marginTop: '1rem' }}
            />
          </>
        )}
      </main>
      
      {/* Train Journey Map Modal */}
      {selectedTrainId && (
        <TrainJourneyMap
          trainId={selectedTrainId}
          open={mapOpen}
          onClose={handleCloseMap}
        />
      )}
    </>
  );
}

