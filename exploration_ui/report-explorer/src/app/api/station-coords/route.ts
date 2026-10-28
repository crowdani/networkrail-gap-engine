import { NextRequest, NextResponse } from 'next/server';
import { getStationInfo } from '@/lib/stanox-coordinates';
import pool from '@/lib/db';

// In-memory cache for geocoded coordinates (persists during server runtime)
const geocodeCache = new Map<string, { lat: number; lon: number }>();

async function geocodeStationName(stationName: string): Promise<{ lat: number; lon: number } | null> {
  // Check cache first
  if (geocodeCache.has(stationName)) {
    return geocodeCache.get(stationName)!;
  }

  try {
    // Use Nominatim OpenStreetMap API to geocode UK railway stations
    const query = encodeURIComponent(`${stationName} railway station UK`);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=gb`,
      {
        headers: {
          'User-Agent': 'NetworkRailGapDetection/1.0', // Required by Nominatim
        },
      }
    );

    if (!response.ok) {
      console.error(`Geocoding failed for ${stationName}:`, response.status);
      return null;
    }

    const data = await response.json();
    if (data && data.length > 0) {
      const coords = {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
      };
      
      // Cache the result
      geocodeCache.set(stationName, coords);
      console.log(`Geocoded ${stationName}:`, coords);
      
      return coords;
    }
  } catch (error) {
    console.error(`Error geocoding ${stationName}:`, error);
  }

  return null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const stanoxCodes = searchParams.get('stanox');
  const stationNames = searchParams.get('names'); // Optional: comma-separated station names

  if (!stanoxCodes) {
    return NextResponse.json(
      { error: 'Missing stanox parameter' },
      { status: 400 }
    );
  }

  const stanoxArray = stanoxCodes.split(',').filter(s => s && s.trim());
  const namesArray = stationNames ? stationNames.split(',').filter(s => s && s.trim()) : [];

  try {
    // Create a map of stanox to coordinates
    const coordsMap: Record<string, { lat: number; lon: number; name: string; crs: string | null }> = {};
    
    // First, try to get coordinates from the hardcoded database (fast, no API calls)
    const missingStanox: Array<{stanox: string, name?: string}> = [];
    stanoxArray.forEach((stanox, index) => {
      const stationInfo = getStationInfo(stanox.trim());
      if (stationInfo) {
        coordsMap[stanox.trim()] = {
          lat: stationInfo.lat,
          lon: stationInfo.lon,
          name: stationInfo.name,
          crs: stationInfo.crs || null,
        };
      } else {
        missingStanox.push({
          stanox: stanox.trim(),
          name: namesArray[index] || undefined
        });
      }
    });

    // For missing coordinates, try database first, then use provided names
    if (missingStanox.length > 0) {
      console.log('Missing STANOXs to geocode:', missingStanox);
      
      const stanoxList = missingStanox.map(s => s.stanox);
      const placeholders = stanoxList.map((_, i) => `$${i + 1}`).join(',');
      const query = `
        SELECT stanox, description, crs_code
        FROM tiploc
        WHERE stanox IN (${placeholders})
      `;
      
      const result = await pool.query(query, stanoxList);
      console.log(`Found ${result.rows.length} stations in database for geocoding`);
      
      // Create a map of found stations
      const foundStanox = new Set(result.rows.map(r => r.stanox));
      
      // Geocode stations found in database
      for (const row of result.rows) {
        console.log(`Processing station from DB: ${row.stanox} - ${row.description}`);
        
        if (row.description) {
          const coords = await geocodeStationName(row.description);
          
          if (coords) {
            console.log(`Geocoded ${row.description}:`, coords);
            coordsMap[row.stanox] = {
              lat: coords.lat,
              lon: coords.lon,
              name: row.description,
              crs: row.crs_code || null,
            };
          } else {
            console.warn(`Geocoding failed for ${row.description} (${row.stanox}), station will not be shown on map`);
            // Don't add to coordsMap if geocoding fails
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // For STANOXs not found in database, use provided names
      for (const missing of missingStanox) {
        if (!foundStanox.has(missing.stanox) && missing.name) {
          console.log(`Geocoding from provided name: ${missing.stanox} - ${missing.name}`);
          
          const coords = await geocodeStationName(missing.name);
          
          if (coords) {
            console.log(`Geocoded ${missing.name}:`, coords);
            coordsMap[missing.stanox] = {
              lat: coords.lat,
              lon: coords.lon,
              name: missing.name,
              crs: null,
            };
          } else {
            console.warn(`Geocoding failed for ${missing.name} (${missing.stanox}), skipping station`);
            // Don't add to coordsMap if geocoding fails
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log('Final coordsMap:', Object.keys(coordsMap));
    }

    return NextResponse.json(coordsMap);
  } catch (error) {
    console.error('Error fetching station coordinates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch station coordinates' },
      { status: 500 }
    );
  }
}

