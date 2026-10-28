'use client';

import { useState, useEffect } from 'react';
import { use } from 'react';
import Link from 'next/link';

interface Station {
  stanox: string;
  name: string;
  crs: string | null;
  tiploc: string | null;
  visited: boolean;
}

interface Gap {
  id: number;
  missed_station_stanox: string;
  missed_station_name: string;
  missed_station_crs: string;
  previous_station_name: string;
  next_station_name: string;
  severity: string;
  detected_at: string;
}

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
  scheduled_stations: Station[];
}

export default function JourneyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJourneyDetails();
  }, [resolvedParams.id]);

  const fetchJourneyDetails = async () => {
    try {
      const response = await fetch(`/api/journey-gaps/${resolvedParams.id}`);
      const data = await response.json();
      setJourney(data.journey);
      setGaps(data.gaps || []);
    } catch (error) {
      console.error('Error fetching journey details:', error);
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

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading journey details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!journey) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <p className="text-gray-600">Journey not found</p>
            <Link href="/journeys" className="text-blue-600 hover:text-blue-800 mt-4 inline-block">
              ← Back to Journeys
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const gapStanoxSet = new Set(gaps.map(g => g.missed_station_stanox));

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link href="/journeys" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
            ← Back to Journeys
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Journey Details</h1>
          <p className="text-gray-600 mt-2">Train {journey.train_id} (UID: {journey.train_uid})</p>
        </div>

        {/* Journey Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Status</div>
            <div className="text-xl font-bold">{journey.status}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Stops Visited</div>
            <div className="text-xl font-bold">{journey.actual_stops} / {journey.scheduled_stops}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Gaps Detected</div>
            <div className={`text-xl font-bold ${journey.gaps_detected > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {journey.gaps_detected}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Operator</div>
            <div className="text-xl font-bold">{journey.operator_code || 'N/A'}</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-bold mb-4">Timeline</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Activated:</span>
              <span className="font-medium">{formatDateTime(journey.activated_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Terminated:</span>
              <span className="font-medium">{formatDateTime(journey.terminated_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Analyzed:</span>
              <span className="font-medium">{formatDateTime(journey.analyzed_at)}</span>
            </div>
          </div>
        </div>

        {/* Gaps Summary */}
        {gaps.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="text-xl font-bold mb-4 text-red-600">Detected Gaps ({gaps.length})</h2>
            <div className="space-y-3">
              {gaps.map((gap) => (
                <div key={gap.id} className={`p-4 rounded-lg border-2 ${getSeverityColor(gap.severity)}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-lg">
                        {gap.missed_station_name || gap.missed_station_stanox}
                        {gap.missed_station_crs && (
                          <span className="ml-2 text-sm font-normal">({gap.missed_station_crs})</span>
                        )}
                      </div>
                      <div className="text-sm mt-1">
                        Between: {gap.previous_station_name} → {gap.next_station_name}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        STANOX: {gap.missed_station_stanox}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getSeverityColor(gap.severity)}`}>
                      {gap.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Complete Route */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">Complete Route</h2>
          <div className="space-y-2">
            {journey.scheduled_stations.map((station, index) => {
              const isGap = gapStanoxSet.has(station.stanox);
              const isVisited = station.visited;
              
              return (
                <div
                  key={`${station.stanox}-${index}`}
                  className={`p-3 rounded-lg border-2 ${
                    isGap
                      ? 'bg-red-50 border-red-300'
                      : isVisited
                      ? 'bg-green-50 border-green-300'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isGap
                          ? 'bg-red-200 text-red-800'
                          : isVisited
                          ? 'bg-green-200 text-green-800'
                          : 'bg-gray-200 text-gray-600'
                      }`}>
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">
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
                    </div>
                    <div>
                      {isGap && (
                        <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                           GAP
                        </span>
                      )}
                      {!isGap && isVisited && (
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                          ✓ Visited
                        </span>
                      )}
                      {!isGap && !isVisited && (
                        <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                          Not visited
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


