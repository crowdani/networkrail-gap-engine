'use client';

import { useEffect, useState, useMemo } from 'react';
import { Modal, Loading, Tag, SkeletonText, Button, ButtonSet } from '@carbon/react';
import { TrainSpeed, Location, Time, PlayFilledAlt, PauseFilled, Reset, ChevronRight } from '@carbon/icons-react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

// Dynamically import map components to avoid SSR issues
const MapContainer = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer),
  { ssr: false }
);
const Polyline = dynamic(
  () => import('react-leaflet').then((mod) => mod.Polyline),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import('react-leaflet').then((mod) => mod.CircleMarker),
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

interface JourneyMovement {
  id: number;
  train_id: string;
  actual_ts: string;
  loc_stanox: string;
  tiploc_code: string | null;
  event_type: string;
  platform: string | null;
  variation_status: string | null;
  timetable_variation: number | null;
  location_info: {
    stanox: string;
    name: string;
    crs_code?: string;
    lat: number;
    lon: number;
  } | null;
}

interface JourneyData {
  trainId: string;
  movements: JourneyMovement[];
  totalStops: number;
}

interface TrainJourneyMapProps {
  trainId: string;
  open: boolean;
  onClose: () => void;
}

export default function TrainJourneyMap({ trainId, open, onClose }: TrainJourneyMapProps) {
  const [journeyData, setJourneyData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [trainIcon, setTrainIcon] = useState<any>(null);

  // Fetch journey data
  useEffect(() => {
    if (!open || !trainId) return;

    const fetchJourney = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/journey/${encodeURIComponent(trainId)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch journey data');
        }
        const data = await response.json();
        setJourneyData(data);
        setCurrentStopIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchJourney();
  }, [trainId, open]);

  // Initialize Leaflet icon on client side only
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initIcon = async () => {
      const L = (await import('leaflet')).default;
      
      const icon = L.divIcon({
        html: `<div style="
          background: #0f62fe;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        "></div>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      
      setTrainIcon(icon);
    };

    initIcon();
  }, []);

  // Animation effect
  useEffect(() => {
    if (!isPlaying || !journeyData) return;

    const mappedStops = journeyData.movements.filter(m => m.location_info);
    if (currentStopIndex >= mappedStops.length - 1) {
      setIsPlaying(false);
      return;
    }

    const interval = setInterval(() => {
      setCurrentStopIndex(prev => {
        const next = prev + 1;
        if (next >= mappedStops.length - 1) {
          setIsPlaying(false);
          return mappedStops.length - 1;
        }
        return next;
      });
    }, 2000 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, currentStopIndex, journeyData, playbackSpeed]);

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStopIndex(0);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  // Filter movements with location data
  const mappedMovements = useMemo(() => {
    return journeyData?.movements.filter(m => m.location_info) || [];
  }, [journeyData]);

  // Calculate route coordinates
  const routeCoordinates = useMemo(() => {
    return mappedMovements.map(m => [m.location_info!.lat, m.location_info!.lon] as [number, number]);
  }, [mappedMovements]);

  // Get current train position
  const currentPosition = useMemo(() => {
    if (mappedMovements.length === 0 || currentStopIndex >= mappedMovements.length) return null;
    const movement = mappedMovements[currentStopIndex];
    return movement.location_info ? [movement.location_info.lat, movement.location_info.lon] as [number, number] : null;
  }, [mappedMovements, currentStopIndex]);

  // Calculate completed and remaining routes
  const completedRoute = useMemo(() => {
    return routeCoordinates.slice(0, currentStopIndex + 1);
  }, [routeCoordinates, currentStopIndex]);

  const remainingRoute = useMemo(() => {
    return routeCoordinates.slice(currentStopIndex);
  }, [routeCoordinates, currentStopIndex]);

  // Calculate map center and bounds
  const mapCenter = useMemo(() => {
    if (routeCoordinates.length === 0) return [51.5074, -0.1278] as [number, number]; // London default
    const latSum = routeCoordinates.reduce((sum, coord) => sum + coord[0], 0);
    const lonSum = routeCoordinates.reduce((sum, coord) => sum + coord[1], 0);
    return [latSum / routeCoordinates.length, lonSum / routeCoordinates.length] as [number, number];
  }, [routeCoordinates]);

  // Count mapped vs unmapped stations
  const mappedStations = journeyData?.movements.filter(m => m.location_info).length || 0;
  const totalStations = journeyData?.totalStops || 0;
  const unmappedStations = totalStations - mappedStations;

  const progress = mappedMovements.length > 0 ? ((currentStopIndex + 1) / mappedMovements.length) * 100 : 0;

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrainSpeed size={24} />
          <span>Train Journey: {trainId}</span>
        </div>
      }
      size="lg"
      passiveModal
      style={{ 
        '--cds-modal-content-padding': '0',
      } as any}
    >
      <div style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Loading description="Loading journey data..." withOverlay={false} />
          </div>
        )}

        {error && (
          <div style={{ padding: '2rem', color: '#da1e28' }}>
            <p>Error: {error}</p>
          </div>
        )}

        {!loading && !error && journeyData && (
          <>
            {/* Controls Section */}
            <div style={{ 
              padding: '1rem', 
              borderBottom: '1px solid #e0e0e0',
              background: '#f4f4f4'
            }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                <ButtonSet>
                  <Button
                    kind="primary"
                    size="sm"
                    renderIcon={isPlaying ? PauseFilled : PlayFilledAlt}
                    onClick={handlePlayPause}
                    disabled={mappedMovements.length === 0}
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </Button>
                  <Button
                    kind="secondary"
                    size="sm"
                    renderIcon={Reset}
                    onClick={handleReset}
                    disabled={mappedMovements.length === 0}
                  >
                    Reset
                  </Button>
                </ButtonSet>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.875rem', color: '#525252' }}>Speed:</span>
                  {[1, 2, 4].map(speed => (
                    <Button
                      key={speed}
                      kind={playbackSpeed === speed ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => handleSpeedChange(speed)}
                    >
                      {speed}x
                    </Button>
                  ))}
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Tag type="blue">
                    Stop {currentStopIndex + 1} of {mappedMovements.length}
                  </Tag>
                  {unmappedStations > 0 && (
                    <Tag type="gray">
                      {unmappedStations} unmapped
                    </Tag>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div style={{ 
                width: '100%', 
                height: '4px', 
                background: '#e0e0e0', 
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                <div style={{ 
                  width: `${progress}%`, 
                  height: '100%', 
                  background: '#0f62fe',
                  transition: 'width 0.3s ease'
                }} />
              </div>

              {/* Current Stop Info */}
              {mappedMovements[currentStopIndex] && (
                <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <Location size={20} />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {mappedMovements[currentStopIndex].location_info?.name || 'Unknown Station'}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#525252' }}>
                      {mappedMovements[currentStopIndex].location_info?.crs_code && (
                        <span>{mappedMovements[currentStopIndex].location_info?.crs_code} • </span>
                      )}
                      <Time size={16} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                      {new Date(mappedMovements[currentStopIndex].actual_ts).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Map Section */}
            <div style={{ flex: 1, position: 'relative' }}>
              {routeCoordinates.length > 0 && (
                <MapContainer
                  center={mapCenter}
                  zoom={8}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  
                  {/* Railway overlay */}
                  <TileLayer
                    url="https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
                    attribution='<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'
                    maxZoom={19}
                    opacity={0.7}
                  />

                  {/* Completed route */}
                  {completedRoute.length > 1 && (
                    <Polyline
                      positions={completedRoute}
                      color="#0f62fe"
                      weight={4}
                      opacity={0.8}
                    />
                  )}

                  {/* Remaining route */}
                  {remainingRoute.length > 1 && (
                    <Polyline
                      positions={remainingRoute}
                      color="#8d8d8d"
                      weight={3}
                      opacity={0.5}
                      dashArray="10, 10"
                    />
                  )}

                  {/* Station markers */}
                  {mappedMovements.map((movement, index) => {
                    const isPassed = index <= currentStopIndex;
                    const isCurrent = index === currentStopIndex;
                    
                    return (
                      <CircleMarker
                        key={movement.id}
                        center={[movement.location_info!.lat, movement.location_info!.lon]}
                        radius={isCurrent ? 8 : 6}
                        fillColor={isCurrent ? '#0f62fe' : isPassed ? '#24a148' : '#da1e28'}
                        color="white"
                        weight={2}
                        opacity={1}
                        fillOpacity={0.9}
                      >
                        <Popup>
                          <div style={{ minWidth: '200px' }}>
                            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
                              {movement.location_info?.name}
                            </h4>
                            {movement.location_info?.crs_code && (
                              <p style={{ margin: '0.25rem 0', fontSize: '0.875rem' }}>
                                <strong>Code:</strong> {movement.location_info.crs_code}
                              </p>
                            )}
                            <p style={{ margin: '0.25rem 0', fontSize: '0.875rem' }}>
                              <strong>Time:</strong> {new Date(movement.actual_ts).toLocaleString()}
                            </p>
                            <p style={{ margin: '0.25rem 0', fontSize: '0.875rem' }}>
                              <strong>Event:</strong> {movement.event_type}
                            </p>
                            {movement.platform && (
                              <p style={{ margin: '0.25rem 0', fontSize: '0.875rem' }}>
                                <strong>Platform:</strong> {movement.platform}
                              </p>
                            )}
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}

                  {/* Current train position marker */}
                  {currentPosition && trainIcon && (
                    <Marker position={currentPosition} icon={trainIcon}>
                      <Popup>
                        <div>
                          <h4 style={{ margin: '0 0 0.5rem 0' }}>Current Position</h4>
                          <p style={{ margin: 0, fontSize: '0.875rem' }}>
                            {mappedMovements[currentStopIndex]?.location_info?.name}
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              )}

              {routeCoordinates.length === 0 && (
                <div style={{ 
                  height: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: '#525252'
                }}>
                  <p>No location data available for this journey</p>
                </div>
              )}
            </div>

            {/* Timeline Section */}
            <div style={{ 
              height: '200px', 
              overflowY: 'auto', 
              borderTop: '1px solid #e0e0e0',
              background: '#ffffff'
            }}>
              <div style={{ padding: '1rem' }}>
                <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#161616' }}>
                  Journey Timeline
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {mappedMovements.map((movement, index) => {
                    const isPassed = index <= currentStopIndex;
                    const isCurrent = index === currentStopIndex;
                    
                    return (
                      <div
                        key={movement.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          padding: '0.75rem',
                          background: isCurrent ? '#e5f6ff' : isPassed ? '#f4f4f4' : '#ffffff',
                          borderLeft: isCurrent ? '3px solid #0f62fe' : isPassed ? '3px solid #24a148' : '3px solid #e0e0e0',
                          borderRadius: '2px',
                          transition: 'all 0.3s ease'
                        }}
                      >
                        <div style={{ 
                          minWidth: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: isCurrent ? '#0f62fe' : isPassed ? '#24a148' : '#e0e0e0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '0.75rem',
                          fontWeight: 600
                        }}>
                          {index + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                            {movement.location_info?.name || 'Unknown Station'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#525252' }}>
                            {new Date(movement.actual_ts).toLocaleTimeString()} • {movement.event_type}
                          </div>
                        </div>
                        {isCurrent && (
                          <ChevronRight size={20} style={{ color: '#0f62fe' }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

