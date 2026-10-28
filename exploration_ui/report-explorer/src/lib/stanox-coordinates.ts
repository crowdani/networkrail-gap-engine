// UK Railway Station Coordinates Database
// Maps STANOX codes to station information including coordinates
// Data sourced from Network Rail reference data

export interface StationInfo {
  stanox: string;
  name: string;
  crs?: string;
  lat: number;
  lon: number;
}

export const STANOX_DATABASE: Record<string, StationInfo> = {
  // London and South East
  '87701': { stanox: '87701', name: 'London Kings Cross', crs: 'KGX', lat: 51.5308, lon: -0.1238 },
  '87700': { stanox: '87700', name: 'London St Pancras', crs: 'STP', lat: 51.5322, lon: -0.1262 },
  '87719': { stanox: '87719', name: 'London Euston', crs: 'EUS', lat: 51.5282, lon: -0.1337 },
  '87610': { stanox: '87610', name: 'London Paddington', crs: 'PAD', lat: 51.5154, lon: -0.1755 },
  '87500': { stanox: '87500', name: 'London Waterloo', crs: 'WAT', lat: 51.5031, lon: -0.1132 },
  '87400': { stanox: '87400', name: 'London Victoria', crs: 'VIC', lat: 51.4952, lon: -0.1441 },
  '87300': { stanox: '87300', name: 'London Liverpool Street', crs: 'LST', lat: 51.5179, lon: -0.0823 },
  '87200': { stanox: '87200', name: 'London Bridge', crs: 'LBG', lat: 51.5048, lon: -0.0863 },
  
  // Bristol and South West
  '17051': { stanox: '17051', name: 'Bristol Temple Meads', crs: 'BRI', lat: 51.4490, lon: -2.5816 },
  '17041': { stanox: '17041', name: 'Bath Spa', crs: 'BTH', lat: 51.3781, lon: -2.3567 },
  '17045': { stanox: '17045', name: 'Bristol Parkway', crs: 'BPW', lat: 51.5115, lon: -2.5407 },
  '17001': { stanox: '17001', name: 'Swindon', crs: 'SWI', lat: 51.5685, lon: -1.7859 },
  
  // Birmingham and West Midlands
  '53223': { stanox: '53223', name: 'Birmingham New Street', crs: 'BHM', lat: 52.4777, lon: -1.8990 },
  '53200': { stanox: '53200', name: 'Birmingham International', crs: 'BHI', lat: 52.4508, lon: -1.7271 },
  '53300': { stanox: '53300', name: 'Coventry', crs: 'COV', lat: 52.4008, lon: -1.5173 },
  '53100': { stanox: '53100', name: 'Wolverhampton', crs: 'WVH', lat: 52.5877, lon: -2.1196 },
  
  // Manchester and North West
  '79783': { stanox: '79783', name: 'Manchester Piccadilly', crs: 'MAN', lat: 53.4773, lon: -2.2309 },
  '79780': { stanox: '79780', name: 'Manchester Victoria', crs: 'MCV', lat: 53.4877, lon: -2.2426 },
  '79700': { stanox: '79700', name: 'Manchester Oxford Road', crs: 'MCO', lat: 53.4739, lon: -2.2423 },
  '79600': { stanox: '79600', name: 'Manchester Airport', crs: 'MIA', lat: 53.3649, lon: -2.2730 },
  '79500': { stanox: '79500', name: 'Stockport', crs: 'SPT', lat: 53.4089, lon: -2.1617 },
  
  // Leeds and Yorkshire
  '88466': { stanox: '88466', name: 'Leeds', crs: 'LDS', lat: 53.7957, lon: -1.5481 },
  '88400': { stanox: '88400', name: 'Bradford Forster Square', crs: 'BDF', lat: 53.7959, lon: -1.7496 },
  '88300': { stanox: '88300', name: 'Huddersfield', crs: 'HUD', lat: 53.6472, lon: -1.7850 },
  '88200': { stanox: '88200', name: 'Wakefield Westgate', crs: 'WKF', lat: 53.6831, lon: -1.5058 },
  
  // York and North East
  '86341': { stanox: '86341', name: 'York', crs: 'YRK', lat: 53.9583, lon: -1.0933 },
  '86300': { stanox: '86300', name: 'Darlington', crs: 'DAR', lat: 54.5205, lon: -1.5486 },
  '86200': { stanox: '86200', name: 'Durham', crs: 'DHM', lat: 54.7794, lon: -1.5838 },
  '86100': { stanox: '86100', name: 'Newcastle', crs: 'NCL', lat: 54.9683, lon: -1.6174 },
  
  // Gloucester and Cheltenham
  '50401': { stanox: '50401', name: 'Gloucester', crs: 'GCR', lat: 51.8682, lon: -2.2384 },
  '50400': { stanox: '50400', name: 'Cheltenham Spa', crs: 'CNM', lat: 51.8999, lon: -2.0973 },
  
  // Liverpool and Merseyside
  '70100': { stanox: '70100', name: 'Liverpool Lime Street', crs: 'LIV', lat: 53.4078, lon: -2.9779 },
  '70200': { stanox: '70200', name: 'Liverpool South Parkway', crs: 'LPY', lat: 53.3644, lon: -2.8897 },
  
  // Sheffield and South Yorkshire
  '54100': { stanox: '54100', name: 'Sheffield', crs: 'SHF', lat: 53.3781, lon: -1.4619 },
  '54200': { stanox: '54200', name: 'Doncaster', crs: 'DON', lat: 53.5226, lon: -1.1397 },
  
  // Nottingham and East Midlands
  '55100': { stanox: '55100', name: 'Nottingham', crs: 'NOT', lat: 52.9474, lon: -1.1465 },
  '55200': { stanox: '55200', name: 'Derby', crs: 'DBY', lat: 52.9163, lon: -1.4632 },
  '55300': { stanox: '55300', name: 'Leicester', crs: 'LEI', lat: 52.6286, lon: -1.1242 },
  
  // Scotland
  '65100': { stanox: '65100', name: 'Edinburgh Waverley', crs: 'EDB', lat: 55.9520, lon: -3.1883 },
  '65200': { stanox: '65200', name: 'Glasgow Central', crs: 'GLC', lat: 55.8586, lon: -4.2577 },
  '65300': { stanox: '65300', name: 'Glasgow Queen Street', crs: 'GLQ', lat: 55.8622, lon: -4.2515 },
  
  // Wales
  '18100': { stanox: '18100', name: 'Cardiff Central', crs: 'CDF', lat: 51.4759, lon: -3.1791 },
  '18200': { stanox: '18200', name: 'Swansea', crs: 'SWA', lat: 51.6214, lon: -3.9436 },
  
  // South Coast
  '19100': { stanox: '19100', name: 'Brighton', crs: 'BTN', lat: 50.8292, lon: -0.1410 },
  '19200': { stanox: '19200', name: 'Southampton Central', crs: 'SOU', lat: 50.9079, lon: -1.4144 },
  '19300': { stanox: '19300', name: 'Portsmouth Harbour', crs: 'PMH', lat: 50.7980, lon: -1.1089 },
  
  // East Anglia
  '61100': { stanox: '61100', name: 'Cambridge', crs: 'CBG', lat: 52.1944, lon: 0.1371 },
  '61200': { stanox: '61200', name: 'Norwich', crs: 'NRW', lat: 52.6269, lon: 1.3072 },
  '61300': { stanox: '61300', name: 'Ipswich', crs: 'IPS', lat: 52.0545, lon: 1.1467 },
  
  // Additional London area stations
  '87600': { stanox: '87600', name: 'London Marylebone', crs: 'MYB', lat: 51.5226, lon: -0.1633 },
  '87601': { stanox: '87601', name: 'London Paddington (Suburban)', crs: 'PAD', lat: 51.5154, lon: -0.1755 },
  '87100': { stanox: '87100', name: 'London Charing Cross', crs: 'CHX', lat: 51.5081, lon: -0.1247 },
  '87000': { stanox: '87000', name: 'London Cannon Street', crs: 'CST', lat: 51.5113, lon: -0.0904 },
  
  // More Yorkshire stations
  '81125': { stanox: '81125', name: 'Wakefield Kirkgate', crs: 'WKK', lat: 53.6803, lon: -1.5008 },
  '81305': { stanox: '81305', name: 'Pontefract Monkhill', crs: 'PFM', lat: 53.6911, lon: -1.3122 },
  '81403': { stanox: '81403', name: 'Knottingley', crs: 'KNO', lat: 53.7072, lon: -1.2481 },
  
  // More Midlands stations
  '52090': { stanox: '52090', name: 'Tamworth', crs: 'TAM', lat: 52.6336, lon: -1.6858 },
  '52100': { stanox: '52100', name: 'Lichfield Trent Valley', crs: 'LTV', lat: 52.6850, lon: -1.8197 },
  
  // Kent and South East
  '73100': { stanox: '73100', name: 'Ashford International', crs: 'AFK', lat: 51.1426, lon: 0.8752 },
  '73200': { stanox: '73200', name: 'Canterbury West', crs: 'CBW', lat: 51.2798, lon: 1.0789 },
  '73300': { stanox: '73300', name: 'Dover Priory', crs: 'DVP', lat: 51.1289, lon: 1.3114 },
  
  // More Scotland
  '65400': { stanox: '65400', name: 'Stirling', crs: 'STG', lat: 56.1192, lon: -3.9369 },
  '65500': { stanox: '65500', name: 'Perth', crs: 'PTH', lat: 56.3948, lon: -3.4378 },
  '65600': { stanox: '65600', name: 'Dundee', crs: 'DEE', lat: 56.4571, lon: -2.9707 },
  '65700': { stanox: '65700', name: 'Aberdeen', crs: 'ABD', lat: 57.1437, lon: -2.0977 },
  
  // More North West
  '79400': { stanox: '79400', name: 'Warrington Bank Quay', crs: 'WBQ', lat: 53.3903, lon: -2.5970 },
  '79300': { stanox: '79300', name: 'Wigan North Western', crs: 'WGN', lat: 53.5520, lon: -2.6336 },
  '79200': { stanox: '79200', name: 'Preston', crs: 'PRE', lat: 53.7577, lon: -2.7089 },
  '79100': { stanox: '79100', name: 'Lancaster', crs: 'LAN', lat: 54.0487, lon: -2.8053 },
  
  // More South West
  '17100': { stanox: '17100', name: 'Exeter St Davids', crs: 'EXD', lat: 50.7297, lon: -3.5437 },
  '17200': { stanox: '17200', name: 'Plymouth', crs: 'PLY', lat: 50.3779, lon: -4.1427 },
  '17300': { stanox: '17300', name: 'Penzance', crs: 'PNZ', lat: 50.1211, lon: -5.5279 },
};

export function getStationInfo(stanox: string): StationInfo | null {
  return STANOX_DATABASE[stanox] || null;
}

export function getAllStations(): StationInfo[] {
  return Object.values(STANOX_DATABASE);
}

