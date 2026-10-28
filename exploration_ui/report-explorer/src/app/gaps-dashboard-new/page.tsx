'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PageRefreshCountdown from '@/components/PageRefreshCountdown';

interface Gap {
  id: number;
  missed_station_stanox: string;
  missed_station_name: string;
  missed_station_crs: string | null;
  severity: string;
}

interface Station {
  stanox: string;
  name: string;
  crs: string | null;
  tiploc: string | null;
  visited: boolean;
  scheduled_time?: string;
  actual_time?: string;
}

interface JourneyWithGaps {
  journey_id: number;
  train_id: string;
  train_uid: string;
  operator_code: string;
  detected_at: string;
  analyzed_at: string;
  activated_at: string;
  terminated_at: string;
  total_gaps: number;
  gap_severity: string;
  scheduled_route: string[];
  actual_route: string[];
  gaps: Gap[];
  scheduled_stations?: Station[];
}

interface ApiResponse {
  journeys: JourneyWithGaps[];
  total: number;
  page: number;
  pageSize: number;
}

export default function GapsDashboardNew() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<JourneyWithGaps | null>(null);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, [page, severityFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '20',
      });
      
      if (severityFilter) {
        params.append('severity', severityFilter);
      }

      const response = await fetch(`/api/gaps-by-journey?${params}`);
      const result = await response.json();
      
      // Fetch station details for each journey
      const journeysWithStations = await Promise.all(
        result.journeys.map(async (journey: JourneyWithGaps) => {
          const detailResponse = await fetch(`/api/journey-gaps/${journey.journey_id}`);
          const detailData = await detailResponse.json();
          return {
            ...journey,
            scheduled_stations: detailData.journey.scheduled_stations
          };
        })
      );
      
      setData({ ...result, journeys: journeysWithStations });
    } catch (error) {
      console.error('Error fetching gaps:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (journeyId: number, journey: JourneyWithGaps) => {
    if (expandedRow === journeyId) {
      setExpandedRow(null);
    } else {
      setExpandedRow(journeyId);
      setSelectedJourney(journey);
    }
  };

  const getRouteDescription = (journey: JourneyWithGaps) => {
    if (!journey.scheduled_stations || journey.scheduled_stations.length === 0) {
      return 'Unknown route';
    }
    const first = journey.scheduled_stations[0];
    const last = journey.scheduled_stations[journey.scheduled_stations.length - 1];
    return `${first.name} → ${last.name}`;
  };

  const getGapLocation = (journey: JourneyWithGaps) => {
    if (journey.gaps.length === 0) return '-';
    return journey.gaps.map(g => g.missed_station_name).join(', ');
  };

  const formatTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getSeverityBadge = (severity: string) => {
    const colors = {
      'CRITICAL': 'bg-red-500 text-white',
      'HIGH': 'bg-orange-500 text-white',
      'MEDIUM': 'bg-yellow-500 text-white',
      'LOW': 'bg-blue-500 text-white'
    };
    return colors[severity as keyof typeof colors] || 'bg-gray-500 text-white';
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading gap detection data...</p>
        </div>
      </div>
    );
  }

  const totalGaps = data?.journeys.reduce((sum, j) => sum + j.total_gaps, 0) || 0;
  const openGaps = data?.journeys.filter(j => j.gap_severity === 'HIGH' || j.gap_severity === 'CRITICAL').length || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Main Content */}
        <div className={`flex-1 transition-all duration-300 ${selectedJourney ? 'mr-96' : ''}`}>
          <div className="p-8">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center">
                <h1 className="text-3xl font-bold text-gray-900">Gap Detection Dashboard</h1>
                <PageRefreshCountdown
                  refreshInterval={60000}
                  onRefresh={fetchData}
                  isPaused={false}
                />
              </div>
              <p className="text-gray-600 mt-2">View and manage missed train report events</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600 mb-2">Total Gaps</div>
                <div className="text-4xl font-bold text-gray-900">{totalGaps}</div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600 mb-2">Infill Accuracy</div>
                <div className="text-4xl font-bold text-gray-900">
                  {data ? ((data.journeys.length - openGaps) / data.journeys.length * 100).toFixed(1) : 0}%
                </div>
                <div className="text-xs text-green-600 mt-1">↑ 0.4% vs last week</div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm text-gray-600 mb-2">Open Gaps</div>
                <div className="text-4xl font-bold text-gray-900">{openGaps}</div>
                <div className="text-xs text-orange-600 mt-1">Require action</div>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-lg shadow mb-6">
              <div className="flex gap-4 items-center">
                <div className="flex gap-2">
                  <input
                    type="date"
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Start date"
                  />
                  <input
                    type="date"
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="End date"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Search location..."
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Search train ID..."
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-12 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input type="checkbox" className="rounded" />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Train ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Train UID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Route Summary
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Gap Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Schedule Position
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data?.journeys.map((journey) => (
                    <>
                      {/* Main Row */}
                      <tr
                        key={journey.journey_id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggleRow(journey.journey_id, journey)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <input
                            type="checkbox"
                            className="rounded"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`/journeys/${journey.journey_id}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {journey.train_id}
                          </Link>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {journey.train_uid}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {getRouteDescription(journey)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="text-blue-600 font-medium">
                            {getGapLocation(journey)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {journey.actual_route.length} / {journey.scheduled_route.length}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getSeverityBadge(journey.gap_severity)}`}>
                            {journey.gap_severity}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded Row */}
                      {expandedRow === journey.journey_id && journey.scheduled_stations && (
                        <tr>
                          <td colSpan={7} className="px-6 py-4 bg-gray-50">
                            <div className="space-y-2">
                              <h4 className="font-semibold text-gray-900 mb-3">Complete Journey Route:</h4>
                              {journey.scheduled_stations.map((station, index) => {
                                const isGap = journey.gaps.some(g => g.missed_station_stanox === station.stanox);
                                const isVisited = station.visited;
                                
                                return (
                                  <div
                                    key={`${station.stanox}-${index}`}
                                    className={`flex items-center justify-between p-3 rounded-lg border-l-4 ${
                                      isGap
                                        ? 'bg-red-50 border-red-500'
                                        : isVisited
                                        ? 'bg-green-50 border-green-500'
                                        : 'bg-gray-50 border-gray-300'
                                    }`}
                                  >
                                    <div className="flex items-center gap-4 flex-1">
                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                        isGap
                                          ? 'bg-red-200 text-red-800'
                                          : isVisited
                                          ? 'bg-green-200 text-green-800'
                                          : 'bg-gray-200 text-gray-600'
                                      }`}>
                                        {index + 1}
                                      </div>
                                      <div className="flex-1">
                                        <div className="font-medium text-gray-900">
                                          {station.name}
                                          {station.crs && (
                                            <span className="ml-2 text-sm text-gray-600">({station.crs})</span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          STANOX: {station.stanox}
                                          {station.tiploc && ` • TIPLOC: ${station.tiploc}`}
                                        </div>
                                      </div>
                                      <div className="text-sm">
                                        {station.scheduled_time && (
                                          <div className="text-gray-600">
                                            Scheduled: {station.scheduled_time}
                                          </div>
                                        )}
                                        {station.actual_time && (
                                          <div className="text-gray-900">
                                            Actual: {station.actual_time}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="ml-4">
                                      {isGap ? (
                                        <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold">
                                          No report
                                        </span>
                                      ) : isVisited ? (
                                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                                          ✓ Reported
                                        </span>
                                      ) : (
                                        <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-semibold">
                                          Not visited
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Empty State */}
            {data && data.journeys.length === 0 && (
              <div className="bg-white rounded-lg shadow p-12 text-center mt-6">
                <p className="text-gray-600 text-lg">No gaps detected</p>
                <p className="text-gray-500 text-sm mt-2">
                  Journeys will appear here once the analyzer detects missed stops
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - Journey Context */}
        {selectedJourney && (
          <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xl font-bold text-gray-900">Journey Context</h2>
                <button
                  onClick={() => {
                    setSelectedJourney(null);
                    setExpandedRow(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              {/* Last Recorded */}
              <div className="mb-6">
                <div className="text-sm font-semibold text-gray-700 mb-1">Last Recorded</div>
                <div className="text-lg font-mono">
                  {formatTime(selectedJourney.terminated_at)} / {formatTime(selectedJourney.analyzed_at)}
                </div>
              </div>

              {/* Gap Scheduled Time */}
              <div className="mb-6">
                <div className="text-sm font-semibold text-gray-700 mb-1">Gap Scheduled Time</div>
                <div className="text-lg font-mono">
                  {formatTime(selectedJourney.activated_at)}
                </div>
              </div>

              {/* Train Journey Timeline */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Train Journey</h3>
                <div className="space-y-4">
                  {selectedJourney.scheduled_stations?.map((station, index) => {
                    const isGap = selectedJourney.gaps.some(g => g.missed_station_stanox === station.stanox);
                    const isVisited = station.visited;
                    
                    return (
                      <div key={`sidebar-${station.stanox}-${index}`} className="flex items-start gap-3">
                        <div className="relative">
                          <div className={`w-3 h-3 rounded-full ${
                            isGap ? 'bg-red-500' : isVisited ? 'bg-blue-500' : 'bg-gray-300'
                          }`} />
                          {index < (selectedJourney.scheduled_stations?.length || 0) - 1 && (
                            <div className="absolute left-1/2 top-3 w-0.5 h-8 bg-gray-300 -translate-x-1/2" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{station.name}</div>
                          {station.scheduled_time && (
                            <div className="text-sm text-gray-600">
                              Scheduled: {station.scheduled_time}
                            </div>
                          )}
                          {station.actual_time && (
                            <div className="text-sm text-gray-900">
                              Actual: {station.actual_time}
                            </div>
                          )}
                          {isGap && (
                            <div className="text-sm text-red-600 font-semibold mt-1">
                              No report
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Journey Details */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Journey Details</h3>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-gray-600">Train ID</dt>
                    <dd className="text-sm font-medium text-gray-900">{selectedJourney.train_id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-600">Train UID</dt>
                    <dd className="text-sm font-medium text-gray-900">{selectedJourney.train_uid}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-600">Operator</dt>
                    <dd className="text-sm font-medium text-gray-900">{selectedJourney.operator_code || 'N/A'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-600">Total Gaps</dt>
                    <dd className="text-sm font-medium text-red-600">{selectedJourney.total_gaps}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-600">Severity</dt>
                    <dd>
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getSeverityBadge(selectedJourney.gap_severity)}`}>
                        {selectedJourney.gap_severity}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* View Full Journey Button */}
              <div className="mt-6">
                <Link
                  href={`/journeys/${selectedJourney.journey_id}`}
                  className="block w-full px-4 py-2 bg-blue-600 text-white text-center rounded-md hover:bg-blue-700 transition-colors"
                >
                  View Full Journey Details
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

