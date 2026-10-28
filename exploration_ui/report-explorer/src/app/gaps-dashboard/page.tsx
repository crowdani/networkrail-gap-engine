'use client';

import { useEffect, useState, useRef } from 'react';
import AppHeader from '@/components/Header';
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
  Button,
  Select,
  SelectItem,
  Modal,
  Search,
  TextInput,
  Tooltip,
  Checkbox,
} from '@carbon/react';
import { Location, Train, WarningAlt, Filter, Launch, Close } from '@carbon/icons-react';
import dynamic from 'next/dynamic';
import RealtimeTrainsTable from '@/components/RealtimeTrainsTable';
import 'leaflet/dist/leaflet.css';

// Dynamically import map components
const MapContainer = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import('react-leaflet').then((mod) => mod.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import('react-leaflet').then((mod) => mod.Popup),
  { ssr: false }
);
const Polyline = dynamic(
  () => import('react-leaflet').then((mod) => mod.Polyline),
  { ssr: false }
);
const Circle = dynamic(
  () => import('react-leaflet').then((mod) => mod.Circle),
  { ssr: false }
);

interface Gap {
  id: number;
  train_id: string;
  train_uid: string;
  journey_id: number | null;
  detected_at: string;
  missed_station_stanox: string;
  missed_station_tiploc: string | null;
  missed_station_name: string | null;
  previous_station_stanox: string;
  previous_station_tiploc: string | null;
  previous_station_name: string | null;
  previous_station_crs: string | null;
  next_station_stanox: string;
  next_station_tiploc: string | null;
  next_station_name: string | null;
  next_station_crs: string | null;
  severity: string;
  confidence_score: number;
  gap_type: string;
  scheduled_route: string[];
  actual_route: string[];
  timing_data: any;
  operator_code: string | null;
  service_code: string | null;
}

interface ApiResponse {
  gaps: Gap[];
  total: number;
  page: number;
  pageSize: number;
}

const headers = [
  { key: 'detected_at', header: 'Detected' },
  { key: 'train_id', header: 'Train ID' },
  { key: 'train_uid', header: 'Train UID' },
  { key: 'gap_count', header: 'Gaps' },
  { key: 'actual_time', header: 'Scheduled Time' },
  { key: 'missed_station', header: 'Missed Stations' },
  { key: 'route', header: 'Route' },
  { key: 'actions', header: 'Actions' },
  { key: 'explore', header: 'Explore' },
];

export default function GapsDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [trainIdFilter, setTrainIdFilter] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [tempSelectedRoutes, setTempSelectedRoutes] = useState<string[]>([]);
  const [routeSearchTerm, setRouteSearchTerm] = useState('');
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationUrl, setValidationUrl] = useState('');
  const [validatingTrainUid, setValidatingTrainUid] = useState('');
  const [selectedGap, setSelectedGap] = useState<Gap | null>(null);
  const [showMapModal, setShowMapModal] = useState(false);
  const [stationCoords, setStationCoords] = useState<any>(null);
  const [journeyData, setJourneyData] = useState<any>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerJourneyData, setDrawerJourneyData] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [externalVerificationEnabled, setExternalVerificationEnabled] = useState(false);
  const [mapData, setMapData] = useState<{
    center: [number, number];
    previousStation?: [number, number];
    missedStation?: [number, number];
    nextStation?: [number, number];
    actualRoute?: [number, number][]; // Route taken (prev -> next)
    expectedRoute?: [number, number][]; // Expected route (prev -> missed -> next)
    routeLoading?: boolean;
    routeFallback?: boolean;
  } | null>(null);
  const hasLoadedOnce = useRef(false);
  const mapKey = useRef(0);

  // Fetch all available routes and feature flags on mount
  useEffect(() => {
    const fetchRoutes = async () => {
      try {
        const response = await fetch('/api/routes');
        if (response.ok) {
          const data = await response.json();
          setAvailableRoutes(data.routes || []);
        }
      } catch (err) {
        console.error('Failed to fetch routes:', err);
      } finally {
        setRoutesLoading(false);
      }
    };

    const fetchFeatureFlags = async () => {
      try {
        const response = await fetch('/api/feature-flags');
        const data = await response.json();
        if (data.success) {
          setExternalVerificationEnabled(data.flags.externalVerificationEnabled);
        }
      } catch (err) {
        console.error('Failed to fetch feature flags:', err);
      }
    };

    fetchRoutes();
    fetchFeatureFlags();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      // Only show loading spinner on very first load
      if (!hasLoadedOnce.current) {
        setLoading(true);
      }
      setError(null);
      try {
        let url = `/api/gaps-new?page=${currentPage}&pageSize=${pageSize}`;
        if (trainIdFilter) {
          url += `&trainId=${encodeURIComponent(trainIdFilter)}`;
        }
        if (locationFilter) {
          url += `&location=${encodeURIComponent(locationFilter)}`;
        }
        if (selectedRoutes.length > 0) {
          url += `&routes=${encodeURIComponent(selectedRoutes.join(','))}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch gaps');
        }
        const jsonData: ApiResponse = await response.json();
        setData(jsonData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        if (!hasLoadedOnce.current) {
          setLoading(false);
          hasLoadedOnce.current = true;
        }
      }
    };

    fetchData();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [currentPage, pageSize, trainIdFilter, locationFilter, selectedRoutes]);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatStation = (name: string | null, crs: string | null, stanox: string | null) => {
    if (name) {
      return crs ? `${name} (${crs})` : name;
    }
    return stanox || 'Unknown';
  };

  const formatRoute = (gap: Gap) => {
    const from = formatStation(gap.previous_station_name, gap.previous_station_crs, gap.previous_station_stanox);
    const to = formatStation(gap.next_station_name, gap.next_station_crs, gap.next_station_stanox);
    return `${from} → ${to}`;
  };

  const getMissedStationCount = (gap: Gap | undefined) => {
    if (!gap) return 0;
    // Calculate how many stations were missed based on scheduled vs actual route
    if (gap.scheduled_route && gap.actual_route) {
      const scheduledSet = new Set(gap.scheduled_route);
      const actualSet = new Set(gap.actual_route);
      const missed = gap.scheduled_route.filter(station => !actualSet.has(station));
      return missed.length;
    }
    // Fallback: if we have a missed station, count is at least 1
    return gap.missed_station_stanox ? 1 : 0;
  };

  const createStationIcon = (type: 'previous' | 'missed' | 'next') => {
    if (typeof window === 'undefined') return undefined;
    try {
      const L = require('leaflet');
      
      // IBM Carbon Design System colors
      const colors = {
        previous: { bg: '#24a148', border: '#198038', pulse: '#42be65', inner: '#0f62fe' },
        missed: { bg: '#da1e28', border: '#a2191f', pulse: '#fa4d56', inner: '#ffffff' },
        next: { bg: '#0f62fe', border: '#0043ce', pulse: '#4589ff', inner: '#ffffff' }
      };
      
      const color = colors[type];
      const size = type === 'missed' ? 36 : 28;
      const innerSize = type === 'missed' ? 16 : 12;
      
      return L.divIcon({
        className: 'custom-station-marker',
        html: `
          <div style="position: relative;">
            <div class="pulse-ring" style="
              position: absolute;
              width: ${size * 1.5}px;
              height: ${size * 1.5}px;
              border-radius: 50%;
              background: ${color.pulse};
              opacity: 0;
              animation: pulse 2s ease-out infinite;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
            "></div>
            <div style="
              position: relative;
              background: ${color.bg};
              width: ${size}px;
              height: ${size}px;
              border-radius: 50%;
              border: 3px solid ${color.border};
              box-shadow: 0 2px 8px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 1000;
            ">
              <div style="
                width: ${innerSize}px;
                height: ${innerSize}px;
                border-radius: 50%;
                background: ${color.inner};
                ${type === 'missed' ? 'border: 2px solid ' + color.bg + ';' : ''}
              "></div>
            </div>
          </div>
          <style>
            @keyframes pulse {
              0% {
                transform: translate(-50%, -50%) scale(0.5);
                opacity: 0.7;
              }
              100% {
                transform: translate(-50%, -50%) scale(2.5);
                opacity: 0;
              }
            }
          </style>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    } catch (error) {
      console.error('Error creating icon:', error);
      return undefined;
    }
  };

  const viewGapOnMap = async (gap: Gap) => {
    setSelectedGap(gap);
    setShowMapModal(true);
    setMapData(null); // Reset map data to show loading
    setJourneyData(null); // Reset journey data
    mapKey.current += 1; // Increment key to force new map instance
    
    // Fetch journey data in parallel with coordinates
    setJourneyLoading(true);
    const journeyPromise = fetch(`/api/train-journey/${gap.train_id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setJourneyData(data);
        setJourneyLoading(false);
      })
      .catch(err => {
        console.error('Error fetching journey data:', err);
        setJourneyLoading(false);
      });
    
    // Fetch coordinates for the stations
    try {
      const stanoxList = [gap.previous_station_stanox, gap.missed_station_stanox, gap.next_station_stanox].filter(Boolean).join(',');
      const namesList = [gap.previous_station_name, gap.missed_station_name, gap.next_station_name].filter(Boolean).join(',');
      
      console.log('Fetching coordinates for STANOXs:', stanoxList);
      console.log('Station names:', namesList);
      console.log('Gap details:', {
        previous: gap.previous_station_name,
        missed: gap.missed_station_name,
        next: gap.next_station_name
      });
      
      const response = await fetch(`/api/station-coords?stanox=${stanoxList}&names=${encodeURIComponent(namesList)}`);
      if (!response.ok) {
        console.error('Failed to fetch coordinates:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('Error response:', errorText);
        return;
      }
      
      const coords = await response.json();
      console.log('Received coordinates:', JSON.stringify(coords, null, 2));
      setStationCoords(coords);
      
      // Build map data
      const prevCoords = coords[gap.previous_station_stanox];
      const missedCoords = gap.missed_station_stanox ? coords[gap.missed_station_stanox] : null;
      const nextCoords = coords[gap.next_station_stanox];
      
      console.log('Previous station coords:', prevCoords, 'for STANOX:', gap.previous_station_stanox);
      console.log('Missed station coords:', missedCoords, 'for STANOX:', gap.missed_station_stanox);
      console.log('Next station coords:', nextCoords, 'for STANOX:', gap.next_station_stanox);
      
      if (prevCoords && nextCoords) {
        // Calculate center point - include missed station if available
        let centerLat, centerLon;
        if (missedCoords) {
          centerLat = (prevCoords.lat + missedCoords.lat + nextCoords.lat) / 3;
          centerLon = (prevCoords.lon + missedCoords.lon + nextCoords.lon) / 3;
        } else {
          centerLat = (prevCoords.lat + nextCoords.lat) / 2;
          centerLon = (prevCoords.lon + nextCoords.lon) / 2;
        }
        
        console.log('Setting initial map data with center:', [centerLat, centerLon]);
        console.log('Missed station coords:', missedCoords);
        
        // Set initial map data with loading state
        setMapData({
          center: [centerLat, centerLon],
          previousStation: [prevCoords.lat, prevCoords.lon],
          missedStation: missedCoords ? [missedCoords.lat, missedCoords.lon] : undefined,
          nextStation: [nextCoords.lat, nextCoords.lon],
          routeLoading: true,
        });
        
        // Fetch routes from GraphHopper
        try {
          // Route 1: Actual route taken (previous -> next, skipping missed)
          const actualRoutePoints = `${prevCoords.lat},${prevCoords.lon}|${nextCoords.lat},${nextCoords.lon}`;
          const actualRouteResponse = await fetch(`/api/railway-route?points=${actualRoutePoints}`);
          const actualRouteData = await actualRouteResponse.json();
          
          let expectedRouteData = null;
          
          // Route 2: Expected route (previous -> missed -> next)
          if (missedCoords) {
            const expectedRoutePoints = `${prevCoords.lat},${prevCoords.lon}|${missedCoords.lat},${missedCoords.lon}|${nextCoords.lat},${nextCoords.lon}`;
            const expectedRouteResponse = await fetch(`/api/railway-route?points=${expectedRoutePoints}`);
            expectedRouteData = await expectedRouteResponse.json();
          }
          
          console.log('Actual route:', actualRouteData.fallback ? 'fallback' : 'routed', actualRouteData.coordinates?.length, 'points');
          console.log('Expected route:', expectedRouteData?.fallback ? 'fallback' : 'routed', expectedRouteData?.coordinates?.length, 'points');
          
          // Update map data with routes
          setMapData({
            center: [centerLat, centerLon],
            previousStation: [prevCoords.lat, prevCoords.lon],
            missedStation: missedCoords ? [missedCoords.lat, missedCoords.lon] : undefined,
            nextStation: [nextCoords.lat, nextCoords.lon],
            actualRoute: actualRouteData.coordinates || [[prevCoords.lat, prevCoords.lon], [nextCoords.lat, nextCoords.lon]],
            expectedRoute: expectedRouteData?.coordinates || (missedCoords ? [
              [prevCoords.lat, prevCoords.lon],
              [missedCoords.lat, missedCoords.lon],
              [nextCoords.lat, nextCoords.lon]
            ] : undefined),
            routeLoading: false,
            routeFallback: actualRouteData.fallback || expectedRouteData?.fallback,
          });
        } catch (routeError) {
          console.error('Error fetching routes:', routeError);
          // Fallback to straight lines
          setMapData({
            center: [centerLat, centerLon],
            previousStation: [prevCoords.lat, prevCoords.lon],
            missedStation: missedCoords ? [missedCoords.lat, missedCoords.lon] : undefined,
            nextStation: [nextCoords.lat, nextCoords.lon],
            actualRoute: [[prevCoords.lat, prevCoords.lon], [nextCoords.lat, nextCoords.lon]],
            expectedRoute: missedCoords ? [
              [prevCoords.lat, prevCoords.lon],
              [missedCoords.lat, missedCoords.lon],
              [nextCoords.lat, nextCoords.lon]
            ] : undefined,
            routeLoading: false,
            routeFallback: true,
          });
        }
      } else {
        console.error('Missing coordinates for previous or next station');
        console.error('Available STANOXs in response:', Object.keys(coords));
        console.error('Looking for STANOXs:', {
          previous: gap.previous_station_stanox,
          next: gap.next_station_stanox
        });
        
        // Show error state in map modal
        setMapData({
          center: [52.5, -1.5],
          previousStation: undefined,
          missedStation: undefined,
          nextStation: undefined,
          routeLoading: false,
          routeFallback: true,
        });
      }
    } catch (error) {
      console.error('Error fetching station coordinates:', error);
      
      // Show error state
      setMapData({
        center: [52.5, -1.5],
        previousStation: undefined,
        missedStation: undefined,
        nextStation: undefined,
        routeLoading: false,
        routeFallback: true,
      });
    }
  };

  // Group gaps by journey_id (or train_id if no journey_id)
  const groupedGaps = data?.gaps.reduce((acc, gap) => {
    const key = gap.journey_id ? `journey-${gap.journey_id}` : `train-${gap.train_id}`;
    if (!acc[key]) {
      acc[key] = {
        journey_id: gap.journey_id,
        train_id: gap.train_id,
        train_uid: gap.train_uid,
        detected_at: gap.detected_at,
        gaps: [],
        route: gap.scheduled_route,
      };
    }
    acc[key].gaps.push(gap);
    return acc;
  }, {} as Record<string, { journey_id: number | null; train_id: string; train_uid: string; detected_at: string; gaps: Gap[]; route: string[] }>) || {};

  const rows = Object.values(groupedGaps).map((group, index) => {
    const firstGap = group.gaps[0];
    const missedStations = group.gaps.map(g => g.missed_station_name || formatStation(null, null, g.missed_station_stanox)).join(', ');
    
    return {
      id: `${group.journey_id || group.train_id}-${index}`,
      detected_at: formatDate(group.detected_at),
      train_id: group.train_id,
      train_uid: group.train_uid || 'N/A',
      gap_count: group.gaps.length,
      actual_time: firstGap.timing_data?.actual_timestamp
        ? (() => {
            const date = new Date(parseInt(firstGap.timing_data.actual_timestamp));
            return date.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
          })()
        : 'N/A',
      missed_station: missedStations,
      route: formatRoute(firstGap),
      actions: group.train_id,
      explore: JSON.stringify({
        train_uid: group.train_uid,
        detected_at: group.detected_at,
        journey_id: group.journey_id,
        gap_count: group.gaps.length
      }),
      _raw: firstGap,
      _gaps: group.gaps,
    };
  }) || [];

  return (
    <>
      <AppHeader />
      <main style={{ marginTop: '48px', padding: '2rem' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ marginBottom: '0.5rem' }}>Gap Detection Dashboard</h1>
          <p style={{ color: '#525252' }}>Real-time train gap detection with enhanced analytics</p>
        </div>

        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto' }}>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.75rem',
              fontWeight: 400,
              color: '#525252',
              letterSpacing: '0.32px'
            }}>
              Train ID
            </label>
            <Search
              id="train-id-search"
              labelText=""
              placeholder="e.g. 2A01, 1P23..."
              value={trainIdFilter}
              onChange={(e) => {
                setTrainIdFilter(e.target.value);
                setCurrentPage(1);
              }}
              onClear={() => {
                setTrainIdFilter('');
                setCurrentPage(1);
              }}
              style={{ width: '200px' }}
            />
          </div>
          
          <div style={{ flex: '0 0 auto' }}>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.75rem',
              fontWeight: 400,
              color: '#525252',
              letterSpacing: '0.32px'
            }}>
              Route Filter
            </label>
            <Button
              kind="tertiary"
              size="md"
              renderIcon={Filter}
              onClick={() => {
                setTempSelectedRoutes([...selectedRoutes]);
                setRouteSearchTerm('');
                setShowRouteModal(true);
              }}
              disabled={routesLoading}
              style={{
                background: '#ffffff',
                border: '1px solid #8d8d8d',
                minWidth: '180px',
                color: '#161616'
              }}
            >
              {selectedRoutes.length > 0
                ? `${selectedRoutes.length} Route${selectedRoutes.length !== 1 ? 's' : ''} Selected`
                : 'Select Routes'}
            </Button>
          </div>
          
          <div style={{ flex: '0 0 auto' }}>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.75rem',
              fontWeight: 400,
              color: '#525252',
              letterSpacing: '0.32px'
            }}>
              Missed Report
            </label>
            <Search
              id="location-search"
              labelText=""
              placeholder="e.g. SEAFORTH & LITHERLAND, London..."
              value={locationFilter}
              onChange={(e) => {
                setLocationFilter(e.target.value);
                setCurrentPage(1);
              }}
              onClear={() => {
                setLocationFilter('');
                setCurrentPage(1);
              }}
              style={{ width: '200px' }}
            />
          </div>
          
          <div style={{ marginLeft: 'auto', color: '#525252', fontSize: '0.875rem', alignSelf: 'center' }}>
            Auto-refreshing every 10s
          </div>
        </div>

        {loading && (
          <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
            <Loading description="Loading gaps..." withOverlay={false} />
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
            {data.total === 0 ? (
              <InlineNotification
                kind="info"
                title="No gaps detected"
                subtitle="No train gaps have been detected yet. The system is monitoring in real-time."
                style={{ marginBottom: '1rem' }}
              />
            ) : (
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
                      title="Detected Gaps"
                      description={`${data.total} total gaps detected`}
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
                              {row.cells.map((cell) => {
                                const gap = data.gaps.find(g => `${g.id}-${data.gaps.indexOf(g)}` === row.id);
                                const missedCount = getMissedStationCount(gap);
                                
                                return (
                                  <TableCell key={cell.id}>
                                    {cell.info.header === 'gap_count' ? (
                                      <Tag
                                        type={
                                          cell.value === 1
                                            ? 'warm-gray'
                                            : cell.value === 2
                                            ? 'magenta'
                                            : 'red'
                                        }
                                        size="md"
                                      >
                                        {cell.value} {cell.value === 1 ? 'gap' : 'gaps'}
                                      </Tag>
                                    ) : cell.info.header === 'route' ? (
                                      <Tooltip
                                        align="top"
                                        label={cell.value as string}
                                      >
                                        <span style={{
                                          display: 'inline-block',
                                          maxWidth: '250px',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                          cursor: 'help'
                                        }}>
                                          {cell.value}
                                        </span>
                                      </Tooltip>
                                    ) : cell.info.header === 'actions' ? (
                                      <Button
                                        kind="ghost"
                                        size="sm"
                                        renderIcon={Location}
                                        onClick={() => {
                                          const gap = data.gaps.find(g => g.train_id === cell.value);
                                          if (gap) {
                                            viewGapOnMap(gap);
                                          }
                                        }}
                                      >
                                        View on Map
                                      </Button>
                                    ) : cell.info.header === 'explore' ? (
                                      <Tooltip
                                        align="top"
                                        label="Explore further details about this gap"
                                      >
                                        <Button
                                          kind="ghost"
                                          size="sm"
                                          renderIcon={Launch}
                                          onClick={async () => {
                                            try {
                                              const cellData = JSON.parse(cell.value as string);
                                              const journeyId = cellData.journey_id;
                                              const trainUid = cellData.train_uid;
                                              const detectedAt = cellData.detected_at;
                                              
                                              if (journeyId) {
                                                // Open drawer and fetch journey data
                                                setDrawerOpen(true);
                                                setDrawerLoading(true);
                                                setDrawerJourneyData(null);
                                                
                                                try {
                                                  const response = await fetch(`/api/journey-gaps/${journeyId}`);
                                                  if (response.ok) {
                                                    const journeyData = await response.json();
                                                    setDrawerJourneyData(journeyData);
                                                  } else {
                                                    console.error('Failed to fetch journey data');
                                                  }
                                                } catch (error) {
                                                  console.error('Error fetching journey data:', error);
                                                } finally {
                                                  setDrawerLoading(false);
                                                }
                                              } else if (externalVerificationEnabled && trainUid && trainUid !== 'N/A') {
                                                // Fallback to old modal if no journey_id
                                                const date = new Date(detectedAt);
                                                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                                                const url = `https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${dateStr}/detailed`;
                                                
                                                const gapRow = data?.gaps.find((g: Gap) => g.train_uid === trainUid);
                                                setValidationUrl(url);
                                                setValidatingTrainUid(trainUid);
                                                setSelectedGap(gapRow || null);
                                                setShowValidationModal(true);
                                              }
                                            } catch (e) {
                                              console.error('Error parsing explore data:', e);
                                            }
                                          }}
                                        >
                                          Explore Further
                                        </Button>
                                      </Tooltip>
                                    ) : (
                                      cell.value
                                    )}
                                  </TableCell>
                                );
                              })}
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
          </>
        )}
      </main>

      {/* Map Modal */}
      {showMapModal && (
        <Modal
          open={true}
          onRequestClose={() => {
            setShowMapModal(false);
            setMapData(null);
            setSelectedGap(null);
          }}
          modalHeading="Gap Location"
          passiveModal
          size="lg"
          style={{ overflow: 'hidden' }}
        >
          {selectedGap && mapData ? (
            <div style={{ height: '700px', width: '100%', overflow: 'hidden', display: 'flex', gap: '1rem' }}>
              {/* Left side - Map and details */}
              <div style={{ flex: '1 1 60%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f4f4f4', borderRadius: '4px' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Gap Details</h4>
                <p style={{ margin: '0.25rem 0' }}>
                  <strong>Train:</strong> {selectedGap.train_id} ({selectedGap.train_uid})
                </p>
                <p style={{ margin: '0.25rem 0' }}>
                  <strong>Route:</strong> {formatStation(selectedGap.previous_station_name, selectedGap.previous_station_crs, selectedGap.previous_station_stanox)} → {selectedGap.missed_station_name || 'Unknown'} → {formatStation(selectedGap.next_station_name, selectedGap.next_station_crs, selectedGap.next_station_stanox)}
                </p>
                <p style={{ margin: '0.25rem 0' }}>
                  <strong>Stations on map:</strong> {mapData.previousStation ? '✓ Previous' : '✗ Previous'} | {mapData.missedStation ? '✓ Missed' : '✗ Missed'} | {mapData.nextStation ? '✓ Next' : '✗ Next'}
                </p>
                {(!mapData.previousStation || !mapData.nextStation) && (
                  <p style={{ margin: '0.5rem 0', padding: '0.5rem', background: '#fff1f1', borderLeft: '3px solid #da1e28', color: '#da1e28', fontSize: '0.875rem' }}>
                    <strong>Warning:</strong> Some station coordinates could not be found. The map may not display correctly.
                  </p>
                )}
              </div>
              
              <div style={{ height: '500px', width: '100%', position: 'relative', background: '#f4f4f4' }}>
                {(!mapData.previousStation || !mapData.nextStation) ? (
                  <div style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    padding: '2rem',
                    textAlign: 'center'
                  }}>
                    <h3 style={{ marginBottom: '0.5rem', color: '#161616' }}>Map Unavailable</h3>
                    <p style={{ color: '#525252', maxWidth: '400px' }}>
                      Station coordinates could not be found for this gap. This may be because the stations are not in our coordinate database or geocoding failed.
                    </p>
                    <p style={{ color: '#525252', fontSize: '0.875rem', marginTop: '1rem' }}>
                      Missing: {!mapData.previousStation && 'Previous Station'} {!mapData.previousStation && !mapData.nextStation && '& '} {!mapData.nextStation && 'Next Station'}
                    </p>
                  </div>
                ) : (
                <MapContainer
                  key={mapKey.current}
                  center={mapData.center}
                  zoom={11}
                  style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0 }}
                  scrollWheelZoom={true}
                  zoomControl={true}
                  dragging={true}
                  doubleClickZoom={true}
                >
                {/* Base Map Layer - Light Theme */}
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  opacity={1}
                />
                
                {/* Railway Infrastructure Layer */}
                <TileLayer
                  attribution='&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
                  url="https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
                  maxZoom={19}
                  opacity={0.8}
                />
                
                {/* Glow effect circles for stations - IBM colors */}
                {mapData.previousStation && (
                  <Circle
                    center={mapData.previousStation}
                    radius={300}
                    pathOptions={{
                      fillColor: '#24a148',
                      fillOpacity: 0.15,
                      color: '#42be65',
                      weight: 2,
                      opacity: 0.5
                    }}
                  />
                )}
                
                {mapData.missedStation && (
                  <Circle
                    center={mapData.missedStation}
                    radius={400}
                    pathOptions={{
                      fillColor: '#da1e28',
                      fillOpacity: 0.25,
                      color: '#fa4d56',
                      weight: 3,
                      opacity: 0.7
                    }}
                  />
                )}
                
                {mapData.nextStation && (
                  <Circle
                    center={mapData.nextStation}
                    radius={300}
                    pathOptions={{
                      fillColor: '#0f62fe',
                      fillOpacity: 0.15,
                      color: '#4589ff',
                      weight: 2,
                      opacity: 0.5
                    }}
                  />
                )}
                
                {/* Route Visualization - Real Railway Routes */}
                {!mapData.routeLoading && mapData.actualRoute && (
                  <>
                    {/* Actual route taken - IBM Green with real railway path */}
                    <Polyline
                      positions={mapData.actualRoute}
                      pathOptions={{
                        color: '#24a148',
                        weight: 5,
                        opacity: 0.85,
                        dashArray: '20, 15',
                        lineCap: 'round',
                        lineJoin: 'round'
                      }}
                    />
                    
                    {/* Shadow/glow effect for actual route */}
                    <Polyline
                      positions={mapData.actualRoute}
                      pathOptions={{
                        color: '#42be65',
                        weight: 10,
                        opacity: 0.25,
                        lineCap: 'round'
                      }}
                    />
                    
                    {/* Expected route through missed station - IBM Red with real railway path */}
                    {mapData.expectedRoute && (
                      <>
                        <Polyline
                          positions={mapData.expectedRoute}
                          pathOptions={{
                            color: '#da1e28',
                            weight: 6,
                            opacity: 0.9,
                            lineCap: 'round',
                            lineJoin: 'round'
                          }}
                        />
                        <Polyline
                          positions={mapData.expectedRoute}
                          pathOptions={{
                            color: '#fa4d56',
                            weight: 12,
                            opacity: 0.3,
                            lineCap: 'round'
                          }}
                        />
                      </>
                    )}
                  </>
                )}
                
                {/* Loading indicator for routes */}
                {mapData.routeLoading && mapData.previousStation && mapData.nextStation && (
                  <>
                    {/* Show simple lines while loading */}
                    <Polyline
                      positions={[mapData.previousStation, mapData.nextStation]}
                      pathOptions={{
                        color: '#8d8d8d',
                        weight: 3,
                        opacity: 0.5,
                        dashArray: '5, 10',
                        lineCap: 'round'
                      }}
                    />
                  </>
                )}
                
                {/* Station Markers - IBM styled */}
                {mapData.previousStation && (
                  <Marker position={mapData.previousStation} icon={createStationIcon('previous')}>
                    <Popup>
                      <div style={{ padding: '12px', minWidth: '220px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                        <h3 style={{ margin: '0 0 8px 0', color: '#24a148', fontSize: '14px', fontWeight: '600', letterSpacing: '0.16px' }}>
                          Previous Station
                        </h3>
                        <p style={{ margin: '4px 0', fontSize: '14px', fontWeight: '600', color: '#161616' }}>
                          {formatStation(selectedGap.previous_station_name, selectedGap.previous_station_crs, selectedGap.previous_station_stanox)}
                        </p>
                        <p style={{ margin: '4px 0', fontSize: '12px', color: '#525252', lineHeight: '1.4' }}>
                          Train passed through successfully
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                )}
                
                {mapData.missedStation && (
                  <Marker position={mapData.missedStation} icon={createStationIcon('missed')}>
                    <Popup>
                      <div style={{ padding: '12px', minWidth: '220px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                        <h3 style={{ margin: '0 0 8px 0', color: '#da1e28', fontSize: '14px', fontWeight: '600', letterSpacing: '0.16px' }}>
                          MISSED STATION
                        </h3>
                        <p style={{ margin: '4px 0', fontSize: '14px', fontWeight: '600', color: '#161616' }}>
                          {selectedGap.missed_station_name || 'Unknown'}
                        </p>
                        <p style={{ margin: '4px 0', fontSize: '12px', color: '#525252', lineHeight: '1.4' }}>
                          Train skipped this station
                        </p>
                        <div style={{ marginTop: '8px', padding: '8px', background: '#fff1f1', borderLeft: '3px solid #da1e28', borderRadius: '2px' }}>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}
                
                {mapData.nextStation && (
                  <Marker position={mapData.nextStation} icon={createStationIcon('next')}>
                    <Popup>
                      <div style={{ padding: '12px', minWidth: '220px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                        <h3 style={{ margin: '0 0 8px 0', color: '#0f62fe', fontSize: '14px', fontWeight: '600', letterSpacing: '0.16px' }}>
                          Next Station
                        </h3>
                        <p style={{ margin: '4px 0', fontSize: '14px', fontWeight: '600', color: '#161616' }}>
                          {formatStation(selectedGap.next_station_name, selectedGap.next_station_crs, selectedGap.next_station_stanox)}
                        </p>
                        <p style={{ margin: '4px 0', fontSize: '12px', color: '#525252', lineHeight: '1.4' }}>
                          Train arrived here after the gap
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
                )}
              </div>
              </div>
              
              {/* Right side - Journey Timeline */}
              <div style={{ flex: '1 1 40%', background: '#ffffff', borderRadius: '4px', padding: '1rem', overflowY: 'auto', maxHeight: '700px' }}>
                <h4 style={{ marginBottom: '1rem', color: '#161616', fontSize: '16px', fontWeight: '600' }}>
                  Train Journey Timeline
                </h4>
                {journeyLoading ? (
                  <div style={{ padding: '2rem', textAlign: 'center' }}>
                    <Loading description="Loading journey..." withOverlay={false} small />
                  </div>
                ) : journeyData && journeyData.stops ? (
                  <div style={{ position: 'relative' }}>
                    {/* Timeline line */}
                    <div style={{ position: 'absolute', left: '20px', top: '10px', bottom: '10px', width: '2px', background: '#e0e0e0' }}></div>
                    
                    {journeyData.stops.map((stop: any, index: number) => {
                      const isGapStation = stop.stanox === selectedGap.missed_station_stanox;
                      const isPrevious = stop.stanox === selectedGap.previous_station_stanox;
                      const isNext = stop.stanox === selectedGap.next_station_stanox;
                      
                      return (
                        <div key={index} style={{ position: 'relative', paddingLeft: '50px', marginBottom: '1.5rem' }}>
                          {/* Timeline dot */}
                          <div style={{
                            position: 'absolute',
                            left: '11px',
                            top: '5px',
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            background: isGapStation ? '#da1e28' : isPrevious ? '#24a148' : isNext ? '#0f62fe' : '#8d8d8d',
                            border: '3px solid white',
                            boxShadow: '0 0 0 2px ' + (isGapStation ? '#da1e28' : isPrevious ? '#24a148' : isNext ? '#0f62fe' : '#8d8d8d'),
                            zIndex: 1
                          }}></div>
                          
                          <div style={{
                            padding: '0.75rem',
                            background: isGapStation ? '#fff1f1' : '#f4f4f4',
                            borderRadius: '4px',
                            borderLeft: isGapStation ? '3px solid #da1e28' : isPrevious ? '3px solid #24a148' : isNext ? '3px solid #0f62fe' : 'none'
                          }}>
                            <div style={{ fontWeight: '600', color: '#161616', marginBottom: '0.25rem' }}>
                              {stop.location_name || stop.tiploc || stop.stanox}
                              {stop.crs && <span style={{ color: '#525252', fontWeight: 'normal', marginLeft: '0.5rem' }}>({stop.crs})</span>}
                            </div>
                            {stop.actual_timestamp && (
                              <div style={{ fontSize: '0.875rem', color: '#525252' }}>
                                {new Date(parseInt(stop.actual_timestamp)).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </div>
                            )}
                            {stop.event_type && (
                              <div style={{ fontSize: '0.75rem', color: '#8d8d8d', marginTop: '0.25rem' }}>
                                {stop.event_type}
                                {stop.platform && ` • Platform ${stop.platform}`}
                              </div>
                            )}
                            {isGapStation && (
                              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#da1e28', fontWeight: '600' }}>
                                MISSED STATION
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#525252' }}>
                    <p>No journey data available for this train.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <Loading description="Loading map..." withOverlay={false} />
            </div>
          )}
        </Modal>
      )}

      {/* Route Selection Modal */}
      {showRouteModal && (
        <Modal
          open={true}
          onRequestClose={() => setShowRouteModal(false)}
          modalHeading="Select Routes to Filter"
          primaryButtonText="Apply Filter"
          secondaryButtonText="Cancel"
          onRequestSubmit={() => {
            setSelectedRoutes(tempSelectedRoutes);
            setCurrentPage(1);
            setShowRouteModal(false);
          }}
          size="lg"
        >
          <div style={{ marginBottom: '1rem' }}>
            <Search
              id="route-search"
              labelText=""
              placeholder="Search routes..."
              value={routeSearchTerm}
              onChange={(e) => setRouteSearchTerm(e.target.value)}
              onClear={() => setRouteSearchTerm('')}
            />
          </div>
          
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '1rem',
            padding: '0.5rem',
            background: '#f4f4f4',
            borderRadius: '4px'
          }}>
            <span style={{ fontSize: '0.875rem', color: '#525252' }}>
              {tempSelectedRoutes.length} of {availableRoutes.length} routes selected
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => setTempSelectedRoutes([...availableRoutes])}
              >
                Select All
              </Button>
              <Button
                kind="ghost"
                size="sm"
                onClick={() => setTempSelectedRoutes([])}
              >
                Clear All
              </Button>
            </div>
          </div>

          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '1px solid #e0e0e0',
            borderRadius: '4px',
            padding: '0.5rem',
            background: '#ffffff'
          }}>
            {availableRoutes
              .filter(route =>
                routeSearchTerm === '' ||
                route.toLowerCase().includes(routeSearchTerm.toLowerCase())
              )
              .map((route) => (
                <div
                  key={route}
                  style={{
                    padding: '0.5rem',
                    borderBottom: '1px solid #e0e0e0',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f4f4f4'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                >
                  <Checkbox
                    id={`route-${route}`}
                    labelText={route}
                    checked={tempSelectedRoutes.includes(route)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setTempSelectedRoutes([...tempSelectedRoutes, route]);
                      } else {
                        setTempSelectedRoutes(tempSelectedRoutes.filter(r => r !== route));
                      }
                    }}
                  />
                </div>
              ))}
            
            {availableRoutes.filter(route =>
              routeSearchTerm === '' ||
              route.toLowerCase().includes(routeSearchTerm.toLowerCase())
            ).length === 0 && (
              <div style={{
                padding: '2rem',
                textAlign: 'center',
                color: '#525252'
              }}>
                No routes found matching "{routeSearchTerm}"
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Journey Route Drawer */}
      {drawerOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: '400px',
            height: '100vh',
            background: '#ffffff',
            boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.1)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Drawer Header */}
          <div
            style={{
              padding: '1rem',
              borderBottom: '1px solid #e0e0e0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f4f4f4',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#161616' }}>
              Train Journey
            </h3>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Close}
              iconDescription="Close"
              hasIconOnly
              onClick={() => {
                setDrawerOpen(false);
                setDrawerJourneyData(null);
              }}
            />
          </div>

          {/* Drawer Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', background: '#f4f4f4' }}>
            {drawerLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <Loading description="Loading..." withOverlay={false} small />
              </div>
            ) : drawerJourneyData ? (
              <div>
                {/* Journey Info Card */}
                <div style={{ marginBottom: '1rem', padding: '1rem', background: '#ffffff', borderRadius: '2px', border: '1px solid #e0e0e0' }}>
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Train ID</div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#161616', marginBottom: '0.75rem' }}>
                    {drawerJourneyData.journey.train_id}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Train UID</div>
                  <div style={{ fontSize: '0.875rem', color: '#161616', marginBottom: '0.75rem' }}>
                    {drawerJourneyData.journey.train_uid}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Status</div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <Tag type={
                      drawerJourneyData.journey.status === 'COMPLETED' ? 'green' :
                      drawerJourneyData.journey.status === 'ACTIVE' ? 'blue' : 'gray'
                    } size="sm">
                      {drawerJourneyData.journey.status === 'ANALYZED' ? 'ANALYSED' : drawerJourneyData.journey.status}
                    </Tag>
                  </div>
                  {drawerJourneyData.journey.scheduled_stops && (
                    <>
                      <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Stops</div>
                      <div style={{ fontSize: '0.875rem', color: '#161616', marginBottom: '0.75rem' }}>
                        {drawerJourneyData.journey.actual_stops || 0} / {drawerJourneyData.journey.scheduled_stops}
                      </div>
                    </>
                  )}
                  {drawerJourneyData.journey.activated_at && (
                    <>
                      {externalVerificationEnabled && (
                        <>
                          <div style={{ fontSize: '0.75rem', color: '#525252', marginBottom: '0.25rem' }}>Validation</div>
                          <Button
                            kind="tertiary"
                            size="sm"
                            renderIcon={Launch}
                            onClick={() => {
                              const date = new Date(drawerJourneyData.journey.activated_at);
                              const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                              const url = `https://www.realtimetrains.co.uk/service/gb-nr:${drawerJourneyData.journey.train_uid}/${dateStr}/detailed`;
                              window.open(url, '_blank');
                            }}
                            style={{ marginTop: '0.25rem' }}
                          >
                            Verify
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Gaps Summary */}
                {drawerJourneyData.gaps && drawerJourneyData.gaps.length > 0 && (
                  <div style={{ marginBottom: '1rem', padding: '1rem', background: '#ffffff', borderRadius: '2px', border: '1px solid #da1e28', borderLeft: '4px solid #da1e28' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#da1e28' }}>
                      {drawerJourneyData.gaps.length} Gap{drawerJourneyData.gaps.length > 1 ? 's' : ''} Detected
                    </div>
                    {drawerJourneyData.gaps.map((gap: any, idx: number) => (
                      <div key={`gap-${idx}`} style={{ fontSize: '0.75rem', color: '#525252', marginTop: '0.25rem' }}>
                        • {gap.missed_station_name || gap.missed_station_stanox}
                      </div>
                    ))}
                  </div>
                )}

                {/* Route Stations */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.75rem', color: '#161616', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Complete Route
                  </div>
                  <div style={{ position: 'relative', background: '#ffffff', padding: '1rem', borderRadius: '2px', border: '1px solid #e0e0e0' }}>
                    {/* Vertical line connecting stations */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '1.75rem',
                        top: '2rem',
                        bottom: '2rem',
                        width: '2px',
                        background: '#e0e0e0',
                      }}
                    />
                    
                    {drawerJourneyData.journey.scheduled_stations?.map((station: any, idx: number) => {
                      const isVisited = station.visited;
                      const isMissed = !isVisited;
                      
                      return (
                        <div
                          key={idx}
                          style={{
                            position: 'relative',
                            marginBottom: idx < drawerJourneyData.journey.scheduled_stations.length - 1 ? '1.5rem' : '0',
                            paddingLeft: '2.5rem',
                          }}
                        >
                          {/* Station marker */}
                          <div
                            style={{
                              position: 'absolute',
                              left: '0.5rem',
                              top: '0.25rem',
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              background: isVisited ? '#24a148' : '#da1e28',
                              border: '2px solid #ffffff',
                              boxShadow: '0 0 0 1px ' + (isVisited ? '#24a148' : '#da1e28'),
                              zIndex: 1,
                            }}
                          />
                          
                          {/* Station info */}
                          <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#161616' }}>
                              {station.name}
                              {station.crs && (
                                <span style={{ marginLeft: '0.5rem', color: '#525252', fontWeight: 400, fontSize: '0.75rem' }}>
                                  {station.crs}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#525252', marginTop: '0.125rem' }}>
                              STANOX: {station.stanox}
                            </div>
                            {isMissed && (
                              <Tag type="red" size="sm" style={{ marginTop: '0.5rem' }}>
                                No report
                              </Tag>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#525252', fontSize: '0.875rem' }}>
                No journey data available
              </div>
            )}
          </div>
        </div>
      )}

      {/* Validation/Exploration Modal */}
      {showValidationModal && (
        <Modal
          open={true}
          onRequestClose={() => {
            setShowValidationModal(false);
            setValidationUrl('');
            setValidatingTrainUid('');
          }}
          modalHeading={`Train ${validatingTrainUid} - Gap Details`}
          passiveModal
          size="lg"
        >
          <RealtimeTrainsTable
            trainUid={validatingTrainUid}
            date={new Date().toISOString().split('T')[0]}
            missedStationTiploc={selectedGap?.missed_station_tiploc || undefined}
            missedStationName={selectedGap?.missed_station_name || undefined}
          />
        </Modal>
      )}
    </>
  );
}

