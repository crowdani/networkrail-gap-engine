'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Journey {
  id: number;
  train_id: string;
  train_uid: string;
  status: string;
  activated_at: string;
  terminated_at: string;
  analyzed_at: string;
  scheduled_stops: number;
  actual_stops: number;
  total_movements: number;
  gaps_detected: number;
  operator_code: string;
  journey_duration_minutes: number;
}

export default function JourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ANALYZED');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setCurrentPage(1); // Reset to page 1 when filter changes
    fetchJourneys();
    const interval = setInterval(fetchJourneys, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [filter]);

  const fetchJourneys = async () => {
    try {
      const response = await fetch(`/api/journeys?status=${filter}&limit=500`);
      const data = await response.json();
      // Sort by analyzed_at DESC (latest first), fallback to terminated_at
      const sorted = (data.journeys || []).sort((a: Journey, b: Journey) => {
        const dateA = new Date(a.analyzed_at || a.terminated_at || 0).getTime();
        const dateB = new Date(b.analyzed_at || b.terminated_at || 0).getTime();
        return dateB - dateA; // Descending order (latest first)
      });
      setJourneys(sorted);
    } catch (error) {
      console.error('Error fetching journeys:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-blue-100 text-blue-800';
      case 'COMPLETED': return 'bg-green-100 text-green-800';
      case 'TIMEOUT': return 'bg-yellow-100 text-yellow-800';
      case 'ANALYZED': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading journeys...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Train Journeys</h1>
          <p className="text-gray-600">Post-journey gap detection system</p>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {['ANALYZED', 'COMPLETED', 'ACTIVE', 'TIMEOUT'].map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm
                  ${filter === status
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {status}
              </button>
            ))}
          </nav>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Total Journeys</div>
            <div className="text-2xl font-bold">{journeys.length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">With Gaps</div>
            <div className="text-2xl font-bold text-red-600">
              {journeys.filter(j => j.gaps_detected > 0).length}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Total Gaps</div>
            <div className="text-2xl font-bold text-orange-600">
              {journeys.reduce((sum, j) => sum + (j.gaps_detected || 0), 0)}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Avg Stops</div>
            <div className="text-2xl font-bold">
              {journeys.length > 0
                ? Math.round(journeys.reduce((sum, j) => sum + j.actual_stops, 0) / journeys.length)
                : 0
              }
            </div>
          </div>
        </div>

        {/* Journeys Table */}
        <div className="bg-white shadow-md rounded-lg overflow-hidden">
          {/* Pagination Controls - Top */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                Showing {Math.min((currentPage - 1) * pageSize + 1, journeys.length)} to {Math.min(currentPage * pageSize, journeys.length)} of {journeys.length} journeys
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="border border-gray-300 rounded-md px-3 py-1 text-sm"
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-sm text-gray-700">
                Page {currentPage} of {Math.ceil(journeys.length / pageSize)}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(Math.ceil(journeys.length / pageSize), currentPage + 1))}
                disabled={currentPage >= Math.ceil(journeys.length / pageSize)}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>

          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Train ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  UID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Stops
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Gaps
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Analyzed ↓
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {journeys.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((journey) => (
                <tr key={journey.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {journey.train_id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {journey.train_uid}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(journey.status)}`}>
                      {journey.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {journey.actual_stops} / {journey.scheduled_stops}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {journey.gaps_detected > 0 ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        {journey.gaps_detected} gaps
                      </span>
                    ) : (
                      <span className="text-sm text-green-600">✓ No gaps</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {journey.journey_duration_minutes ? `${Math.round(journey.journey_duration_minutes)} min` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDateTime(journey.analyzed_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Link
                      href={`/journeys/${journey.id}`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      View Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {journeys.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No {filter.toLowerCase()} journeys found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


