'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Close, Checkmark } from '@carbon/icons-react';
import { KENT_STANOX_CODES } from '@/lib/kent-locations';

interface Journey {
  train_id: string;
  train_uid: string;
  schedule_start_date: string | null;
  severity: string;
  total_scheduled_stops: number;
  found_stops_count: number;
  missed_stops_count: number;
  prediction_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  received_at: string | null;
}

interface ApiResponse {
  journeys: Journey[];
  total: number;
}

interface Stop {
  id: string | null;
  station_index: number;
  station_name: string;
  crs: string;
  tiploc: string | null;
  stanox: string;
  status: 'VISITED' | 'MISSED' | 'UNKNOWN';
  scheduled_time: string | null;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
  actual_time: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  predicted_arrival: string | null;
  predicted_departure: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_confidence: number | null;
  prediction_method: string | null;
  approval_status: string | null;
  approved_time: string | null;
}

interface JourneyDetail {
  train_id: string;
  train_uid: string;
  schedule_start_date: string | null;
  severity: string;
  total_scheduled_stops: number | null;
  found_stops_count: number | null;
  missed_stops_count: number | null;
  stops: Stop[];
}

export default function TrainView() {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLocation, setSearchLocation] = useState('all');
  const [timeRangeFilter, setTimeRangeFilter] = useState('All');
  const [minGapsFilter, setMinGapsFilter] = useState('0');
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [journeyDetail, setJourneyDetail] = useState<JourneyDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Inline approval state for the drawer
  const [approvalOverrides, setApprovalOverrides] = useState<Record<string, string>>({});
  const [actioning, setActioning] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [externalVerificationEnabled, setExternalVerificationEnabled] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Source journeys from predicted_gaps (all statuses)
        const response = await fetch('/api/predicted-gaps?status=all&pageSize=500');
        if (!response.ok) throw new Error('Failed to fetch journeys');
        const jsonData = await response.json();
        setData({ journeys: jsonData.journeys ?? [], total: jsonData.total ?? 0 });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const formatRelativeTime = (timestamp?: string | null) => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;

    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

    return date.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleRowClick = async (journey: Journey) => {
    setSelectedJourney(journey);
    setDrawerOpen(true);
    setLoadingDetail(true);
    setApprovalOverrides({});
    setActionMsg(null);
    try {
      const params = new URLSearchParams();
      if (journey.schedule_start_date) params.set('scheduleStartDate', journey.schedule_start_date);
      const response = await fetch(`/api/predicted-gaps/journey/${encodeURIComponent(journey.train_id)}?${params}`);
      if (!response.ok) throw new Error('Failed to fetch journey details');
      const data = await response.json();
      setJourneyDetail(data);
    } catch (err) {
      console.error('Failed to fetch journey details:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      setSelectedJourney(null);
      setJourneyDetail(null);
      setApprovalOverrides({});
      setActionMsg(null);
    }, 300);
  };

  const doApprove = useCallback(async (stopId: string) => {
    setActioning(stopId);
    try {
      const res = await fetch(`/api/predicted-gaps/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setApprovalOverrides(prev => ({ ...prev, [stopId]: 'APPROVED' }));
      setActionMsg({ type: 'ok', text: '✓ Approved' });
    } catch (e) {
      setActionMsg({ type: 'err', text: String(e) });
    } finally {
      setActioning(null);
    }
  }, []);

  const doReject = useCallback(async (stopId: string) => {
    setActioning(stopId);
    try {
      const res = await fetch(`/api/predicted-gaps/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setApprovalOverrides(prev => ({ ...prev, [stopId]: 'REJECTED' }));
      setActionMsg({ type: 'ok', text: '✕ Rejected' });
    } catch (e) {
      setActionMsg({ type: 'err', text: String(e) });
    } finally {
      setActioning(null);
    }
  }, []);

  const getPercentageWithGaps = (journey: Journey) => {
    if (!journey.total_scheduled_stops) return 0;
    return Math.round((journey.missed_stops_count / journey.total_scheduled_stops) * 100);
  };

  const getProgressBarColor = (percentage: number) => {
    if (percentage >= 40) return '#da1e28';
    if (percentage >= 20) return '#ff832b';
    if (percentage >= 10) return '#0f62fe';
    return '#24a148';
  };

  const filteredJourneys = data?.journeys.filter(journey => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        journey.train_id.toLowerCase().includes(search) ||
        journey.train_uid.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }

    // Time range filter on received_at
    if (timeRangeFilter !== 'All') {
      const activatedAt = new Date(journey.received_at ?? '');
      const now = new Date();
      const hoursDiff = (now.getTime() - activatedAt.getTime()) / (1000 * 60 * 60);
      
      switch (timeRangeFilter) {
        case '1h':
          if (hoursDiff > 1) return false;
          break;
        case '6h':
          if (hoursDiff > 6) return false;
          break;
        case '24h':
          if (hoursDiff > 24) return false;
          break;
        case '7d':
          if (hoursDiff > 24 * 7) return false;
          break;
        case '30d':
          if (hoursDiff > 24 * 30) return false;
          break;
      }
    }

    // Minimum gaps filter
    const minGaps = parseInt(minGapsFilter);
    if ((journey.missed_stops_count ?? 0) < minGaps) return false;

    return true;
  }) || [];

  const totalGaps = filteredJourneys.reduce((sum, j) => sum + Number(j.missed_stops_count ?? 0), 0);

  // Pagination
  const totalPages = Math.ceil(filteredJourneys.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedJourneys = filteredJourneys.slice(startIndex, endIndex);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  return (
    <div style={{ padding: '2rem', background: '#ffffff', minHeight: '100vh' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '400', color: '#161616', margin: 0, marginBottom: '0.5rem' }}>
          Train View
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#525252', margin: 0 }}>
          All trains with gaps in the selected time period
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Missed Stops',   value: loading ? '...' : totalGaps.toLocaleString() },
          { label: 'Journeys',       value: loading ? '...' : filteredJourneys.length.toLocaleString() },
          { label: 'Pending Approval', value: loading ? '...' : filteredJourneys.reduce((s, j) => s + Number(j.pending_count ?? 0), 0).toLocaleString(), accent: '#0043ce' },
        ].map(c => (
          <div key={c.label} style={{ background: '#f4f4f4', padding: '1.5rem', border: '1px solid #e0e0e0' }}>
            <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>{c.label}</div>
            <div style={{ fontSize: '2.5rem', fontWeight: '300', color: c.accent ?? '#161616', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: '#f4f4f4', padding: '1.5rem', border: '1px solid #e0e0e0', marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '400', color: '#525252', marginBottom: '0.5rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
              Search train ID or UID
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search train ID..."
              style={{
                width: '100%',
                padding: '0.6875rem 1rem',
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                background: '#ffffff',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                outline: 'none'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '400', color: '#525252', marginBottom: '0.5rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
              Search location
            </label>
            <select
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6875rem 1rem',
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                background: '#ffffff',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all">All</option>
              <option value="kent">Kent</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '400', color: '#525252', marginBottom: '0.5rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
              Time Range
            </label>
            <select
              value={timeRangeFilter}
              onChange={(e) => setTimeRangeFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6875rem 1rem',
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                background: '#ffffff',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="All">All Time</option>
              <option value="1h">Last Hour</option>
              <option value="6h">Last 6 Hours</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '400', color: '#525252', marginBottom: '0.5rem', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
              Minimum Gaps
            </label>
            <select
              value={minGapsFilter}
              onChange={(e) => setMinGapsFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6875rem 1rem',
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                background: '#ffffff',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="0">All (0+)</option>
              <option value="1">1+ gaps</option>
              <option value="2">2+ gaps</option>
              <option value="3">3+ gaps</option>
              <option value="5">5+ gaps</option>
              <option value="10">10+ gaps</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{ background: '#ffffff', padding: '3rem', borderRadius: '0', border: '1px solid #e0e0e0', textAlign: 'center' }}>
          <div style={{ fontSize: '0.875rem', color: '#525252' }}>Loading trains...</div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div style={{ background: '#fff1f1', padding: '1rem', borderRadius: '0', border: '1px solid #da1e28', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.875rem', color: '#750e13' }}>Error: {error}</div>
        </div>
      )}

      {/* Table */}
      {!loading && !error && data && (
        <div style={{ background: '#ffffff', borderRadius: '0', border: '1px solid #e0e0e0', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
            <thead>
              <tr style={{ background: '#e0e0e0', borderBottom: '1px solid #c6c6c6' }}>
                {['Train ID', 'UID', 'Date', 'Severity', 'Scheduled', 'Missed', '% Missed', 'Approvals', ''].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '600', color: '#161616' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedJourneys.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '2rem', textAlign: 'center', fontSize: '0.875rem', color: '#525252' }}>
                    No journeys found
                  </td>
                </tr>
              ) : (
                paginatedJourneys.map((journey) => {
                  const percentage = getPercentageWithGaps(journey);
                  const sevStyle = journey.severity === 'HIGH' ? '#da1e28' : journey.severity === 'MEDIUM' ? '#f1c21b' : '#24a148';
                  return (
                    <tr
                      key={`${journey.train_id}-${journey.schedule_start_date}`}
                      style={{
                        borderBottom: '1px solid #e0e0e0',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f4f4f4';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#ffffff';
                      }}
                      onClick={() => handleRowClick(journey)}
                    >
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#0f62fe', fontWeight: '600' }}>{journey.train_id}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#525252' }}>{journey.train_uid}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#6f6f6f' }}>{journey.schedule_start_date ?? '—'}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '10px', background: sevStyle, color: '#fff' }}>
                          {journey.severity ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', textAlign: 'center', color: '#161616' }}>{journey.total_scheduled_stops ?? '—'}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', textAlign: 'center', fontWeight: 600, color: journey.missed_stops_count ? '#da1e28' : '#161616' }}>{journey.missed_stops_count ?? 0}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#161616', minWidth: '32px' }}>{percentage}%</span>
                          <div style={{ flex: 1, height: '6px', background: '#e0e0e0', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${percentage}%`, background: getProgressBarColor(percentage), transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {journey.pending_count > 0 && (
                          <span style={{ background: '#d0e2ff', color: '#0043ce', padding: '0.15rem 0.45rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '10px' }}>
                            {journey.pending_count} pending
                          </span>
                        )}
                        {journey.pending_count === 0 && journey.approved_count > 0 && (
                          <span style={{ background: '#a7f0ba', color: '#0e6027', padding: '0.15rem 0.45rem', fontSize: '0.7rem', fontWeight: 600, borderRadius: '10px' }}>
                            {journey.approved_count} approved
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <ChevronRight size={20} style={{ color: '#525252' }} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && filteredJourneys.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 2rem',
          background: '#ffffff',
          borderTop: '1px solid #e0e0e0',
          fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.875rem', lineHeight: 1.29, color: '#525252', fontWeight: '400' }}>
              Items per page:
            </span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              style={{
                padding: '0.6875rem 2.5rem 0.6875rem 1rem',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                background: '#f4f4f4',
                cursor: 'pointer',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                outline: 'none',
                appearance: 'none',
                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 16 16\'%3E%3Cpath fill=\'%23161616\' d=\'M8 11L3 6l.7-.7L8 9.6l4.3-4.3.7.7z\'/%3E%3C/svg%3E")',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.5rem center'
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span style={{ fontSize: '0.875rem', lineHeight: 1.29, color: '#525252', fontWeight: '400' }}>
              {startIndex + 1}–{Math.min(endIndex, filteredJourneys.length)} of {filteredJourneys.length} journeys
            </span>
          </div>
          
          <div style={{ display: 'flex', gap: '0.0625rem' }}>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              style={{
                padding: '0.6875rem 1rem',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                fontWeight: '400',
                color: currentPage === 1 ? '#c6c6c6' : '#161616',
                background: '#ffffff',
                border: 'none',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                transition: 'background 0.11s cubic-bezier(0.2, 0, 0.38, 0.9)',
                opacity: currentPage === 1 ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (currentPage !== 1) {
                  e.currentTarget.style.background = '#e5e5e5';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPage !== 1) {
                  e.currentTarget.style.background = '#ffffff';
                }
              }}
            >
              Previous
            </button>
            
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              
              const isActive = currentPage === pageNum;
              
              return (
                <button
                  key={pageNum}
                  onClick={() => handlePageChange(pageNum)}
                  style={{
                    padding: '0.6875rem 1rem',
                    fontSize: '0.875rem',
                    lineHeight: 1.29,
                    fontWeight: '400',
                    color: isActive ? '#ffffff' : '#161616',
                    background: isActive ? '#0f62fe' : '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                    transition: 'background 0.11s cubic-bezier(0.2, 0, 0.38, 0.9)',
                    minWidth: '2.5rem'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#e5e5e5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#ffffff';
                    }
                  }}
                >
                  {pageNum}
                </button>
              );
            })}
            
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              style={{
                padding: '0.6875rem 1rem',
                fontSize: '0.875rem',
                lineHeight: 1.29,
                fontWeight: '400',
                color: currentPage === totalPages ? '#c6c6c6' : '#161616',
                background: '#ffffff',
                border: 'none',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif',
                transition: 'background 0.11s cubic-bezier(0.2, 0, 0.38, 0.9)',
                opacity: currentPage === totalPages ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (currentPage !== totalPages) {
                  e.currentTarget.style.background = '#e5e5e5';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPage !== totalPages) {
                  e.currentTarget.style.background = '#ffffff';
                }
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Drawer — full journey stop timeline */}
      <div style={{ position: 'fixed', top: 0, right: drawerOpen ? 0 : '-660px', width: '660px', height: '100vh', background: '#ffffff', boxShadow: drawerOpen ? '-2px 0 8px rgba(0,0,0,0.2)' : 'none', transition: 'right 0.24s cubic-bezier(0.2,0,0.38,0.9)', zIndex: 10000, overflow: 'auto', fontFamily: 'IBM Plex Sans, system-ui, -apple-system, sans-serif' }}>
        {selectedJourney && (
          <div style={{ padding: '1.5rem 2rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid #e0e0e0', paddingBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#161616', margin: 0 }}>{selectedJourney.train_id}</h2>
                <div style={{ fontSize: '0.75rem', color: '#525252', marginTop: '0.2rem' }}>
                  UID: {selectedJourney.train_uid}{selectedJourney.schedule_start_date ? ` · ${selectedJourney.schedule_start_date}` : ''}
                  {selectedJourney.severity && <span style={{ marginLeft: '0.5rem', padding: '0.1rem 0.4rem', fontSize: '0.7rem', fontWeight: 600, background: selectedJourney.severity === 'HIGH' ? '#da1e28' : '#f1c21b', color: '#fff', borderRadius: '10px' }}>{selectedJourney.severity}</span>}
                </div>
              </div>
              <button onClick={closeDrawer} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.25rem' }}>
                <Close size={20} style={{ color: '#161616' }} />
              </button>
            </div>

            {loadingDetail ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#525252', fontSize: '0.875rem' }}>Loading journey stops…</div>
            ) : journeyDetail ? (
              <>
                {/* Summary strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {[
                    { label: 'Scheduled stops', value: journeyDetail.total_scheduled_stops ?? '—' },
                    { label: 'Found stops',      value: journeyDetail.found_stops_count    ?? '—', color: '#0e6027' },
                    { label: 'Missed stops',     value: journeyDetail.missed_stops_count   ?? '—', color: '#da1e28' },
                  ].map(s => (
                    <div key={s.label} style={{ background: '#f4f4f4', border: '1px solid #e0e0e0', padding: '0.75rem 1rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: '#525252', marginBottom: '0.2rem' }}>{s.label}</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 300, color: (s as {label:string;value:string|number;color?:string}).color ?? '#161616' }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Full stop timeline */}
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#161616', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.32px' }}>
                  All Stops ({journeyDetail.stops.length})
                </h3>
                <div style={{ position: 'relative', paddingLeft: '1.75rem' }}>
                  {/* Vertical rail */}
                  <div style={{ position: 'absolute', left: '0.5rem', top: '0.75rem', bottom: '0.75rem', width: '2px', background: '#e0e0e0' }} />

                  {/* Action flash message */}
                  {actionMsg && (
                    <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.875rem', fontSize: '0.8rem', background: actionMsg.type === 'ok' ? '#defbe6' : '#fff1f1', color: actionMsg.type === 'ok' ? '#0e6027' : '#da1e28', border: `1px solid ${actionMsg.type === 'ok' ? '#a7f0ba' : '#ffb3b8'}` }}>
                      {actionMsg.text}
                    </div>
                  )}

                  {journeyDetail.stops.map((stop, idx) => {
                   const isMissed  = stop.status === 'MISSED';
                   const isVisited = stop.status === 'VISITED';
                   const dotColor  = isMissed ? '#da1e28' : isVisited ? '#24a148' : '#e0e0e0';
                   const confPct   = stop.prediction_confidence !== null ? Math.round((stop.prediction_confidence as number) * 100) : null;
                   const approvalCol: Record<string, string> = { PENDING: '#0043ce', APPROVED: '#0e6027', REJECTED: '#750e13' };
                   const approvalBg: Record<string, string>  = { PENDING: '#d0e2ff', APPROVED: '#a7f0ba', REJECTED: '#ffd7d9' };
                   const effectiveStatus = stop.id ? (approvalOverrides[stop.id] ?? stop.approval_status ?? 'PENDING') : (stop.approval_status ?? 'PENDING');
                   const isPending = isMissed && effectiveStatus === 'PENDING';
                   const isActioning = stop.id !== null && actioning === stop.id;

                   return (
                     <div
                       key={`${stop.stanox}-${idx}`}
                       style={{ position: 'relative', marginBottom: '0', paddingBottom: '0' }}
                     >
                       {/* Track dot */}
                       <div style={{ position: 'absolute', left: '-1.25rem', top: '0.6rem', width: '10px', height: '10px', borderRadius: '50%', background: dotColor, border: '2px solid #fff', boxShadow: `0 0 0 1px ${dotColor}` }} />

                       {/* Stop card */}
                       <div style={{ marginBottom: '0.5rem', padding: '0.625rem 0.875rem', background: isMissed ? '#fff8f8' : '#f4f4f4', border: `1px solid ${isMissed ? '#ffb3b8' : '#e0e0e0'}`, borderRadius: '2px' }}>
                         {/* Station name row */}
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                           <div>
                             <span style={{ fontSize: '0.875rem', fontWeight: 600, color: isMissed ? '#da1e28' : '#161616' }}>
                               {stop.station_name}
                             </span>
                             {stop.crs && <span style={{ fontSize: '0.7rem', color: '#8d8d8d', marginLeft: '0.35rem' }}>{stop.crs}</span>}
                             {stop.stanox && <span style={{ fontSize: '0.65rem', color: '#a8a8a8', marginLeft: '0.35rem' }}>{stop.stanox}</span>}
                           </div>
                           <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexShrink: 0 }}>
                             <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.35rem', borderRadius: '8px', background: isMissed ? '#ffb3b8' : '#a7f0ba', color: isMissed ? '#750e13' : '#0e6027' }}>
                               {isMissed ? 'MISSED' : 'VISITED'}
                             </span>
                             {isMissed && (
                               <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.35rem', borderRadius: '8px', background: approvalBg[effectiveStatus] ?? '#e0e0e0', color: approvalCol[effectiveStatus] ?? '#525252' }}>
                                 {effectiveStatus}
                               </span>
                             )}
                           </div>
                         </div>

                         {/* Times grid — 2 rows: scheduled + actual, ARR/DEP columns */}
                         <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '0.2rem 0.5rem', marginTop: '0.35rem', fontSize: '0.72rem', alignItems: 'center' }}>
                           {/* Header */}
                           <div />
                           <div style={{ color: '#8d8d8d', fontWeight: 600 }}>ARR</div>
                           <div style={{ color: '#8d8d8d', fontWeight: 600 }}>DEP</div>
                           {/* Scheduled row */}
                           <div style={{ color: '#8d8d8d' }}>Sched</div>
                           <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#525252' }}>
                             {stop.scheduled_arrival ?? stop.scheduled_time ?? '—'}
                           </div>
                           <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#8d8d8d' }}>
                             {stop.scheduled_departure ?? '—'}
                           </div>
                           {/* Actual row — visited stops */}
                           {isVisited && <>
                             <div style={{ color: '#8d8d8d' }}>Actual</div>
                             <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: stop.actual_arrival ? '#0e6027' : '#c6c6c6', fontWeight: stop.actual_arrival ? 600 : 400 }}>
                               {stop.actual_arrival ?? '—'}
                             </div>
                             <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: stop.actual_departure ? '#0e6027' : '#c6c6c6', fontWeight: stop.actual_departure ? 600 : 400 }}>
                               {stop.actual_departure ?? '—'}
                             </div>
                           </>}
                           {/* Predicted row — missed stops */}
                           {isMissed && <>
                             <div style={{ color: '#8d8d8d' }}>Pred Arr</div>
                             <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: stop.predicted_arrival ? '#0f62fe' : '#c6c6c6', fontWeight: 600 }}>
                               {effectiveStatus === 'APPROVED' && stop.approved_time
                                 ? <>{stop.approved_time} <span style={{ fontSize: '0.6rem', color: '#0e6027', fontWeight: 400 }}>✓</span></>
                                 : (stop.predicted_arrival ?? '—')}
                             </div>
                             <div style={{ fontFamily: 'IBM Plex Mono, monospace', color: stop.predicted_departure ? '#7c3aed' : '#c6c6c6', fontWeight: 600 }}>
                               {stop.predicted_departure ?? '—'}
                             </div>
                           </>}
                         </div>

                         {/* Prediction meta row */}
                         {isMissed && (stop.prediction_method || confPct !== null || stop.predicted_delay_minutes !== null) && (
                           <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.3rem', fontSize: '0.68rem', color: '#6f6f6f', flexWrap: 'wrap' }}>
                             {stop.prediction_method && <span style={{ fontStyle: 'italic' }}>{stop.prediction_method.replace(/_/g, ' ').toLowerCase()}</span>}
                             {confPct !== null && <span style={{ color: confPct >= 80 ? '#0e6027' : confPct >= 60 ? '#8a3800' : '#750e13' }}>{confPct}% confidence</span>}
                             {stop.predicted_delay_minutes !== null && (
                               <span style={{ color: stop.predicted_delay_minutes > 0 ? '#da1e28' : '#0e6027' }}>
                                 {stop.predicted_delay_minutes > 0 ? `+${stop.predicted_delay_minutes}` : stop.predicted_delay_minutes}m delay
                               </span>
                             )}
                           </div>
                         )}

                         {/* Inline approve / reject for missed stops */}
                         {isMissed && stop.id && (
                           <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.45rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                             {isActioning
                               ? <span style={{ fontSize: '0.7rem', color: '#8d8d8d' }}>Saving…</span>
                               : isPending ? (<>
                                   <button onClick={() => doApprove(stop.id!)}
                                     style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', fontWeight: 600, background: '#defbe6', color: '#0e6027', border: '1px solid #a7f0ba', cursor: 'pointer', borderRadius: '2px' }}>
                                     ✓ Approve
                                   </button>
                                   <button onClick={() => doReject(stop.id!)}
                                     style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', fontWeight: 600, background: '#fff1f1', color: '#da1e28', border: '1px solid #ffb3b8', cursor: 'pointer', borderRadius: '2px' }}>
                                     ✕ Reject
                                   </button>
                                 </>)
                               : <span style={{ fontSize: '0.7rem', color: effectiveStatus === 'APPROVED' ? '#0e6027' : '#da1e28', fontWeight: 600 }}>
                                   {effectiveStatus === 'APPROVED' ? '✓ Approved' : '✕ Rejected'}
                                 </span>
                             }
                           </div>
                         )}
                       </div>
                     </div>
                   );
                 })}
               </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Overlay */}
      {drawerOpen && (
        <div
          onClick={closeDrawer}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(22, 22, 22, 0.5)',
            zIndex: 9999,
            transition: 'opacity 0.24s cubic-bezier(0.2, 0, 0.38, 0.9)',
          }}
        />
      )}
    </div>
  );
}


