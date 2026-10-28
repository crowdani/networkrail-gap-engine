'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/Header';
import { GapDetectionResult } from '@/types/gap-detection';
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
  Link,
  Button,
} from '@carbon/react';

interface ApiResponse {
  results: GapDetectionResult[];
  total: number;
  page: number;
  pageSize: number;
}

const headers = [
  { key: 'train_id', header: 'Train ID' },
  { key: 'train_uid', header: 'Train UID' },
  { key: 'actual_ts', header: 'Actual Time' },
  { key: 'location', header: 'Location' },
  { key: 'position', header: 'Position' },
  { key: 'previous', header: 'Previous' },
  { key: 'expected', header: 'Expected' },
  { key: 'realtime_link', header: 'Realtime Trains' },
  { key: 'actions', header: 'Actions' },
];

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/gaps?page=${currentPage}&pageSize=${pageSize}`);
        if (!response.ok) {
          throw new Error('Failed to fetch data');
        }
        const jsonData: ApiResponse = await response.json();
        setData(jsonData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentPage, pageSize]);

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getRealtimeTrainsUrl = (trainUid: string, actualTs: Date | string) => {
    const date = new Date(actualTs);
    const dateStr = date.toISOString().split('T')[0]; // yyyy-mm-dd format
    return `https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${dateStr}/detailed`;
  };

  const formatStanoxTiploc = (stanox: string, tiploc: string | null) => {
    if (!stanox) return '-';
    return tiploc ? `${stanox}/${tiploc}` : stanox;
  };

  const rows = data?.results.map((result, index) => ({
    id: `${result.train_id}-${result.actual_ts}-${index}`,
    train_id: result.train_id,
    train_uid: result.train_uid,
    actual_ts: formatDate(result.actual_ts),
    location: formatStanoxTiploc(result.loc_stanox, result.loc_tiploc_code),
    position: `${result.position_in_schedule} / ${result.total_stops}`,
    previous: formatStanoxTiploc(result.prev_stanox, result.prev_tiploc_code),
    expected: formatStanoxTiploc(result.expected_prev_stanox, result.expected_tiploc_code),
    realtime_link: getRealtimeTrainsUrl(result.train_uid, result.actual_ts),
    actions: result.train_id, // Store train_id for the button
    _raw: result, // Store raw data for custom rendering
  })) || [];

  return (
    <>
      <AppHeader />
      <main style={{ marginTop: '48px', padding: '2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>Network Rail Gap Detection Results</h1>
        <p style={{ marginBottom: '2rem' }}>View and analyze missed train report events</p>

        {loading && (
          <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
            <Loading description="Loading data..." withOverlay={false} />
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

        {data && !loading && (
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
                  title="Gap Detection Results"
                  description={`Total results: ${data.total}`}
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
                        <TableRow {...getRowProps({ row })} key={row.id}>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.id}>
                              {cell.info.header === 'realtime_link' ? (
                                <Link
                                  href={cell.value as string}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  View on RT
                                </Link>
                              ) : cell.info.header === 'actions' ? (
                                <Button
                                  kind="primary"
                                  size="sm"
                                  onClick={() => router.push(`/trains/${cell.value}`)}
                                >
                                  View Details
                                </Button>
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
              pageSizes={[10, 25, 50, 100]}
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
    </>
  );
}

