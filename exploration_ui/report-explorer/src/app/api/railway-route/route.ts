import { NextRequest, NextResponse } from 'next/server';

const GRAPHHOPPER_API_KEY = process.env.GRAPHHOPPER_API_KEY || '';
const GRAPHHOPPER_URL = process.env.GRAPHHOPPER_URL || 'https://graphhopper.com/api/1/route';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const points = searchParams.get('points'); // Format: "lat1,lon1|lat2,lon2|lat3,lon3"
    
    if (!points) {
      return NextResponse.json(
        { error: 'Points parameter is required' },
        { status: 400 }
      );
    }

    // Parse points
    const pointsArray = points.split('|').map(p => {
      const [lat, lon] = p.split(',').map(Number);
      return [lat, lon];
    });

    if (pointsArray.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 points are required' },
        { status: 400 }
      );
    }

    // If no GraphHopper API key is provided, use straight-line fallback
    if (!GRAPHHOPPER_API_KEY) {
      return NextResponse.json({
        fallback: true,
        coordinates: pointsArray.map(([lat, lon]) => [lon, lat]),
        message: 'GraphHopper API key not configured, using straight line fallback'
      });
    }

    // Build GraphHopper request
    const params = new URLSearchParams({
      key: GRAPHHOPPER_API_KEY,
      vehicle: 'car', // GraphHopper doesn't have a direct 'train' profile, but we can use car for general routing
      points_encoded: 'false',
      instructions: 'false',
      calc_points: 'true',
      details: 'road_class',
    });

    // Add all points
    pointsArray.forEach(([lat, lon]) => {
      params.append('point', `${lat},${lon}`);
    });

    const graphhopperUrl = `${GRAPHHOPPER_URL}?${params.toString()}`;
    
    console.log('Fetching route from GraphHopper:', graphhopperUrl);

    const response = await fetch(graphhopperUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GraphHopper API error:', response.status, errorText);
      
      // Fallback to straight lines if routing fails
      return NextResponse.json({
        fallback: true,
        coordinates: pointsArray.map(([lat, lon]) => [lon, lat]), // GeoJSON format [lon, lat]
        message: 'Using straight line fallback due to routing error'
      });
    }

    const data = await response.json();

    if (!data.paths || data.paths.length === 0) {
      console.error('No paths returned from GraphHopper');
      return NextResponse.json({
        fallback: true,
        coordinates: pointsArray.map(([lat, lon]) => [lon, lat]),
        message: 'No route found, using straight line'
      });
    }

    // Extract coordinates from the first path
    const path = data.paths[0];
    const coordinates = path.points.coordinates; // GeoJSON format [lon, lat]

    // Convert to Leaflet format [lat, lon]
    const leafletCoordinates = coordinates.map(([lon, lat]: [number, number]) => [lat, lon]);

    return NextResponse.json({
      fallback: false,
      coordinates: leafletCoordinates,
      distance: path.distance,
      time: path.time,
      message: 'Route successfully calculated'
    });

  } catch (error) {
    console.error('Error fetching railway route:', error);
    
    // Return fallback straight line
    const searchParams = request.nextUrl.searchParams;
    const points = searchParams.get('points');
    
    if (points) {
      const pointsArray = points.split('|').map(p => {
        const [lat, lon] = p.split(',').map(Number);
        return [lat, lon];
      });
      
      return NextResponse.json({
        fallback: true,
        coordinates: pointsArray,
        message: 'Error occurred, using straight line fallback'
      });
    }

    return NextResponse.json(
      { error: 'Failed to calculate route' },
      { status: 500 }
    );
  }
}

