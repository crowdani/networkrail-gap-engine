import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

interface CallingPoint {
  distance: string;
  location: string;
  locationCode: string;
  platform: string;
  gbttArr: string;
  gbttDep: string;
  wttArr: string;
  wttDep: string;
  realtimeArr: string;
  realtimeDep: string;
  delay: string;
  path: string;
  line: string;
  isPublic: boolean;
  isPass: boolean;
}

interface TrainService {
  uid: string;
  identity: string;
  headcode: string;
  operator: string;
  origin: string;
  destination: string;
  date: string;
  callingPoints: CallingPoint[];
  formation: string;
  facilities: string[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trainUid: string; date: string }> }
) {
  try {
    const { trainUid, date } = await params;
    
    // Fetch the HTML from Realtime Trains
    const url = `https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${date}/detailed`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch train data' },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract service title
    const serviceTitle = $('#servicetitle h3 .header').text().trim();
    const operator = $('.toc.h3 div').text().trim();

    // Extract UID and identity
    const uidText = $('.infopanel ul li').first().text();
    const uidMatch = uidText.match(/UID\s+(\w+),\s+identity\s+(\w+)/);
    const uid = uidMatch ? uidMatch[1] : trainUid;
    const identity = uidMatch ? uidMatch[2] : '';

    // Extract headcode
    const headcodeMatch = uidText.match(/headcode\s+(\w+)/);
    const headcode = headcodeMatch ? headcodeMatch[1] : '';

    // Extract formation
    const formation = $('.formation span').text().trim();

    // Extract facilities
    const facilities: string[] = [];
    $('.facilities span').each((_: number, el: any) => {
      const tooltip = $(el).attr('tooltip');
      if (tooltip) facilities.push(tooltip);
    });

    // Parse calling points - deduplicate by location code
    const callingPointsMap = new Map<string, CallingPoint>();
    $('.location').each((_: number, el: any) => {
      const $location = $(el);
      
      // Extract distance
      const miles = $location.find('.distance .miles').text().trim();
      const chains = $location.find('.distance .chains').text().trim();
      const distance = miles && chains ? `${miles}.${chains}` : '';

      // Extract location name and code
      const locationLink = $location.find('.location a.name');
      const location = locationLink.text().trim();
      const locationCode = location.match(/\[(\w+)\]/)?.[1] || '';
      const locationName = location.replace(/\s*\[.*?\]\s*/, '');

      // Extract platform
      const platform = $location.find('.platform').text().trim();

      // Extract GBTT times
      const gbttArr = $location.find('.gbtt .arr').text().trim();
      const gbttDep = $location.find('.gbtt .dep').text().trim();

      // Extract WTT times
      const wttArr = $location.find('.wtt .arr').text().trim();
      const wttDep = $location.find('.wtt .dep').text().trim();

      // Extract Realtime times
      const realtimeArr = $location.find('.realtime .arr').text().trim();
      const realtimeDep = $location.find('.realtime .dep').text().trim();

      // Extract delay
      const delay = $location.find('.delay').text().trim();

      // Extract route info
      const path = $location.find('.route .path').text().trim();
      const line = $location.find('.route .line').text().trim();

      // Determine if public stop or pass
      const isPublic = $location.hasClass('public');
      const isPass = $location.hasClass('pass');

      if (location && locationCode) {
        // Use location code + distance as unique key to handle circular routes
        const key = `${locationCode}-${distance}`;
        
        // If this location already exists, merge the data (prefer non-empty values)
        if (callingPointsMap.has(key)) {
          const existing = callingPointsMap.get(key)!;
          callingPointsMap.set(key, {
            distance: existing.distance || distance,
            location: existing.location || locationName,
            locationCode: existing.locationCode || locationCode,
            platform: existing.platform || platform,
            gbttArr: existing.gbttArr || gbttArr,
            gbttDep: existing.gbttDep || gbttDep,
            wttArr: existing.wttArr || wttArr,
            wttDep: existing.wttDep || wttDep,
            realtimeArr: existing.realtimeArr || realtimeArr,
            realtimeDep: existing.realtimeDep || realtimeDep,
            delay: existing.delay || delay,
            path: existing.path || path,
            line: existing.line || line,
            isPublic: existing.isPublic || isPublic,
            isPass: existing.isPass && isPass
          });
        } else {
          callingPointsMap.set(key, {
            distance,
            location: locationName,
            locationCode,
            platform,
            gbttArr,
            gbttDep,
            wttArr,
            wttDep,
            realtimeArr,
            realtimeDep,
            delay,
            path,
            line,
            isPublic,
            isPass
          });
        }
      }
    });

    // Convert map to array
    const callingPoints = Array.from(callingPointsMap.values());

    const trainService: TrainService = {
      uid,
      identity,
      headcode,
      operator,
      origin: serviceTitle.split(' to ')[0]?.replace(/^\d+\s+\d+\s+/, '') || '',
      destination: serviceTitle.split(' to ')[1] || '',
      date,
      callingPoints,
      formation,
      facilities
    };

    return NextResponse.json(trainService);
  } catch (error) {
    console.error('Error scraping Realtime Trains:', error);
    return NextResponse.json(
      { error: 'Failed to parse train data' },
      { status: 500 }
    );
  }
}
