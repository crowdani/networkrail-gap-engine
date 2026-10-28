'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Gap {
  id: number;
  missed_station_stanox: string;
  missed_station_name: string;
  missed_station_crs: string | null;
  severity: string;
  predicted_arrival: string | null;
  predicted_departure: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_confidence: number | null;
  prediction_method: string | null;
}

interface JourneyWithGaps {
  journey_id: number;
  train_id: string;
  train_uid: string;
  operator_code: string;
  detected_at: string;
  analyzed_at: string;
  total_gaps: number;
  gap_severity: string;
  scheduled_route: string[];
  actual_route: string[];
  gaps: Gap[];
}

interface ApiResponse {
  journeys: JourneyWithGaps[];
  total: number;
  page: number;
  pageSize: number;
}

export default function GapsByJourneyPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('all');

  useEffect(() => {
    fetchData();
  }, [page, severityFilter, locationFilter]);

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

      if (locationFilter && locationFilter !== 'all') {
        params.append('location', locationFilter);
      }

      const response = await fetch(`/api/gaps-by-journey?${params}`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching gaps:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-300';
      case 'HIGH': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (!confidence) return 'bg-gray-100 text-gray-700';
    if (confidence >= 0.9) return 'bg-green-100 text-green-800';
    if (confidence >= 0.7) return 'bg-blue-100 text-blue-800';
    if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-700';
  };

  const getMethodBadge = (method: string | null) => {
    if (!method) return null;
    const badges: Record<string, { label: string; color: string }> = {
      'ON_TIME_INTERPOLATION': { label: 'On-Time', color: 'bg-green-100 text-green-800' },
      'LINEAR_INTERPOLATION': { label: 'Interpolated', color: 'bg-blue-100 text-blue-800' },
      'SINGLE_STATION_EXTRAPOLATION': { label: 'Extrapolated', color: 'bg-purple-100 text-purple-800' },
      'SCHEDULE_ONLY': { label: 'Schedule', color: 'bg-gray-100 text-gray-700' },
    };
    return badges[method] || { label: method, color: 'bg-gray-100 text-gray-700' };
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading gaps...</p>
          </div>
        </div>
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Gap Detection - Journey View</h1>
          <p className="text-gray-600 mt-2">
            Journeys with confirmed missed stops (post-journey analysis)
          </p>
        </div>

        {/* Stats */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Total Journeys with Gaps</div>
              <div className="text-2xl font-bold text-red-600">{data.total}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Total Gaps Detected</div>
              <div className="text-2xl font-bold text-orange-600">
                {data.journeys.reduce((sum, j) => sum + j.total_gaps, 0)}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Gaps with Predictions</div>
              <div className="text-2xl font-bold text-blue-600">
                {data.journeys.reduce((sum, j) =>
                  sum + j.gaps.filter(g => g.predicted_arrival || g.predicted_departure || g.predicted_time).length, 0
                )}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Showing</div>
              <div className="text-2xl font-bold text-purple-600">
                {data.journeys.length} journeys
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <div className="flex gap-6 items-center flex-wrap">
            <div className="flex gap-2 items-center">
              <label className="text-sm font-medium text-gray-700">Search Location:</label>
              <select
                value={locationFilter}
                onChange={(e) => {
                  setLocationFilter(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="kent">Kent</option>
              </select>
            </div>
            
            <div className="flex gap-2 items-center">
              <label className="text-sm font-medium text-gray-700">Filter by Severity:</label>
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
        </div>

        {/* Journeys List */}
        <div className="space-y-4">
          {data?.journeys.map((journey) => (
            <div key={journey.journey_id} className="bg-white rounded-lg shadow-md overflow-hidden">
              {/* Journey Header */}
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      Train {journey.train_id}
                      <span className="ml-2 text-sm font-normal text-gray-600">
                        (UID: {journey.train_uid})
                      </span>
                    </h3>
                    <div className="flex gap-4 mt-2 text-sm text-gray-600">
                      <span>Operator: {journey.operator_code || 'N/A'}</span>
                      <span>Analyzed: {formatDateTime(journey.analyzed_at)}</span>
                      <span>Route: {journey.scheduled_route.length} stops scheduled, {journey.actual_route.length} visited</span>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getSeverityColor(journey.gap_severity)}`}>
                      {journey.gap_severity}
                    </span>
                    <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold">
                      {journey.total_gaps} {journey.total_gaps === 1 ? 'Gap' : 'Gaps'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Gaps List */}
              <div className="px-6 py-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Missed Stops:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {journey.gaps.map((gap) => (
                    <div
                      key={gap.id}
                      className={`p-4 rounded-lg border-2 ${getSeverityColor(gap.severity)}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium">
                          {gap.missed_station_name}
                          {gap.missed_station_crs && (
                            <span className="ml-2 text-sm font-normal">({gap.missed_station_crs})</span>
                          )}
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getSeverityColor(gap.severity)}`}>
                          {gap.severity}
                        </span>
                      </div>
                      
                      <div className="text-xs text-gray-600 mb-2">
                        STANOX: {gap.missed_station_stanox}
                      </div>

                      {/* Infill Prediction */}
                      {(gap.predicted_arrival || gap.predicted_departure || gap.predicted_time) ? (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="text-xs font-semibold text-gray-700 mb-2">📊 Predicted Infill Time:</div>
                          
                          <div className="space-y-1.5">
                            {gap.predicted_arrival && (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-600">Arrival:</span>
                                <span className="text-sm font-mono font-semibold text-blue-700">
                                  {formatTime(gap.predicted_arrival)}
                                </span>
                              </div>
                            )}
                            {gap.predicted_departure && (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-600">Departure:</span>
                                <span className="text-sm font-mono font-semibold text-purple-700">
                                  {formatTime(gap.predicted_departure)}
                                </span>
                              </div>
                            )}
                            {!gap.predicted_arrival && !gap.predicted_departure && gap.predicted_time && (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-600">Time:</span>
                                <span className="text-sm font-mono font-semibold text-blue-700">
                                  {formatTime(gap.predicted_time)}
                                </span>
                              </div>
                            )}
                            
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">Delay:</span>
                              <span className={`text-sm font-semibold ${
                                gap.predicted_delay_minutes === 0
                                  ? 'text-green-700'
                                  : gap.predicted_delay_minutes && gap.predicted_delay_minutes > 0
                                  ? 'text-red-700'
                                  : 'text-blue-700'
                              }`}>
                                {gap.predicted_delay_minutes === 0
                                  ? 'On-time'
                                  : gap.predicted_delay_minutes && gap.predicted_delay_minutes > 0
                                  ? `+${gap.predicted_delay_minutes} min`
                                  : `${gap.predicted_delay_minutes} min`
                                }
                              </span>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">Confidence:</span>
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getConfidenceColor(gap.prediction_confidence)}`}>
                                {gap.prediction_confidence ? `${(gap.prediction_confidence * 100).toFixed(0)}%` : 'N/A'}
                              </span>
                            </div>
                            
                            {gap.prediction_method && (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-600">Method:</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getMethodBadge(gap.prediction_method)?.color}`}>
                                  {getMethodBadge(gap.prediction_method)?.label}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="text-xs text-gray-500 italic">
                            ⏳ No prediction available
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* View Details Button */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <Link
                  href={`/journeys/${journey.journey_id}`}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  View Complete Journey Details →
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="px-4 py-2 bg-white border border-gray-300 rounded-md">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}

        {/* Empty State */}
        {data && data.journeys.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-600 text-lg">No gaps detected yet</p>
            <p className="text-gray-500 text-sm mt-2">
              Journeys will appear here once the analyzer detects missed stops
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

