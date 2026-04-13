'use strict';

const axios = require('axios');

const BUOYS = {
  sanFrancisco: { id: '46026', name: 'San Francisco Buoy', lat: 37.759, lon: -122.833 },
  bodegaBay:    { id: '46013', name: 'Bodega Bay Buoy',    lat: 38.242, lon: -123.301 },
  pointArena:   { id: '46214', name: 'Point Arena Buoy',   lat: 38.958, lon: -123.974 }
};

const NDBC_BASE = 'https://www.ndbc.noaa.gov/data/realtime2';

/**
 * Parse NDBC realtime2 text files.
 * The file format is:
 *   Line 1: column names   (#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE)
 *   Line 2: units          (#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft)
 *   Line 3+: data rows
 * Missing values are represented as MM or 99.0 or 999.0 etc.
 */
function parseNDBCText(text) {
  const lines = text.trim().split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 3) return null;

  // Parse header
  const headerLine = lines[0].replace(/^#/, '').trim();
  const unitsLine  = lines[1].replace(/^#/, '').trim();
  const headers    = headerLine.split(/\s+/);

  function idx(name) { return headers.indexOf(name); }

  const idxYY   = idx('YY');
  const idxMM   = idx('MM');
  const idxDD   = idx('DD');
  const idxHH   = idx('hh');
  const idxMIN  = idx('mm');
  const idxWDIR = idx('WDIR');
  const idxWSPD = idx('WSPD');
  const idxGST  = idx('GST');
  const idxWVHT = idx('WVHT');
  const idxDPD  = idx('DPD');
  const idxAPD  = idx('APD');
  const idxMWD  = idx('MWD');
  const idxPRES = idx('PRES');
  const idxATMP = idx('ATMP');
  const idxWTMP = idx('WTMP');

  // NDBC missing value sentinels vary by field:
  //   WDIR: 999   WSPD/GST: 99.0   WVHT/DPD/APD: 99.00   MWD: 999
  // Pass maxMissing=99.0 for wave/wind-speed fields, 999.0 for direction fields.
  function safeFloat(val, maxMissing = 999.0) {
    if (val === 'MM') return null;
    const f = parseFloat(val);
    if (isNaN(f))       return null;
    if (f >= maxMissing) return null;
    return f;
  }

  function parseDegToCompass(deg) {
    if (deg === null || deg === undefined) return 'N/A';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const ix = Math.round(deg / 22.5) % 16;
    return dirs[ix];
  }

  function celsiusToF(c) {
    if (c === null) return null;
    return Math.round(((c * 9 / 5) + 32) * 10) / 10;
  }

  function metersToFeet(m) {
    if (m === null) return null;
    return Math.round(m * 3.28084 * 10) / 10;
  }

  function mpsToKts(mps) {
    if (mps === null) return null;
    return Math.round(mps * 1.94384 * 10) / 10;
  }

  const readings = [];

  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length < 5) continue;

    // Build ISO timestamp (NDBC uses UTC)
    const year  = parts[idxYY]  ? (parseInt(parts[idxYY]) < 100 ? 2000 + parseInt(parts[idxYY]) : parseInt(parts[idxYY])) : null;
    const month = parts[idxMM]  ? parseInt(parts[idxMM])  : null;
    const day   = parts[idxDD]  ? parseInt(parts[idxDD])  : null;
    const hour  = parts[idxHH]  ? parseInt(parts[idxHH])  : null;
    const min   = parts[idxMIN] ? parseInt(parts[idxMIN]) : 0;

    let timestamp = null;
    if (year && month && day !== null && hour !== null) {
      timestamp = new Date(Date.UTC(year, month - 1, day, hour, min)).toISOString();
    }

    const wdirRaw  = idxWDIR >= 0 ? safeFloat(parts[idxWDIR], 999.0) : null; // 999 = missing
    const wspdRaw  = idxWSPD >= 0 ? safeFloat(parts[idxWSPD],  99.0) : null; // 99.0 = missing
    const gstRaw   = idxGST  >= 0 ? safeFloat(parts[idxGST],   99.0) : null;
    const wvhtRaw  = idxWVHT >= 0 ? safeFloat(parts[idxWVHT],  99.0) : null; // 99.00 = missing
    const dpdRaw   = idxDPD  >= 0 ? safeFloat(parts[idxDPD],   99.0) : null;
    const apdRaw   = idxAPD  >= 0 ? safeFloat(parts[idxAPD],   99.0) : null;
    const mwdRaw   = idxMWD  >= 0 ? safeFloat(parts[idxMWD],  999.0) : null;
    const wtmpRaw  = idxWTMP >= 0 ? safeFloat(parts[idxWTMP],  99.0) : null;
    const atmpRaw  = idxATMP >= 0 ? safeFloat(parts[idxATMP],  99.0) : null;
    const presRaw  = idxPRES >= 0 ? safeFloat(parts[idxPRES], 999.0) : null;

    readings.push({
      timestamp,
      waveHeightM:   wvhtRaw,
      waveHeightFt:  metersToFeet(wvhtRaw),
      dominantPeriod: dpdRaw,
      avgPeriod:      apdRaw,
      swellDirection: mwdRaw,
      swellDirectionCompass: parseDegToCompass(mwdRaw),
      windDirectionDeg:      wdirRaw,
      windDirection:         parseDegToCompass(wdirRaw),
      windSpeedMps:    wspdRaw,
      windSpeedKts:    mpsToKts(wspdRaw),
      windGustMps:     gstRaw,
      windGustKts:     mpsToKts(gstRaw),
      waterTempC:      wtmpRaw,
      waterTempF:      celsiusToF(wtmpRaw),
      airTempC:        atmpRaw,
      airTempF:        celsiusToF(atmpRaw),
      pressure:        presRaw
    });
  }

  return readings;
}

/**
 * Fetch and parse realtime buoy data for a given buoy ID.
 * Returns: { buoyId, name, latest: {...}, trend: [...last 24h readings], fetchedAt }
 */
async function getBuoyData(buoyId) {
  const url = `${NDBC_BASE}/${buoyId}.txt`;

  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (surf-forecast-app/1.0)' },
    timeout: 12000,
    responseType: 'text'
  });

  const readings = parseNDBCText(res.data);
  if (!readings || readings.length === 0) {
    throw new Error(`No readings parsed from buoy ${buoyId}`);
  }

  // Most recent is first in the file
  const latest = readings[0];

  // Trend = last 24 hours (up to 48 readings at 30-min intervals)
  const trend = readings.slice(0, 48);

  // Find buoy metadata
  const meta = Object.values(BUOYS).find(b => b.id === buoyId) || { id: buoyId, name: `Buoy ${buoyId}` };

  return {
    buoyId,
    name:      meta.name,
    lat:       meta.lat || null,
    lon:       meta.lon || null,
    latest,
    trend,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Fetch hourly tide height predictions from NOAA Tides & Currents.
 * Station 9414958 = Bolinas, CA (closest gauge to the surf spots).
 * Returns: [ { timestamp, height, type } ]
 */
async function getTidePredictions(stationId) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + 6);
  const fmt = d =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const url =
    'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter' +
    `?begin_date=${fmt(now)}&end_date=${fmt(end)}` +
    `&station=${stationId}&product=predictions&datum=MLLW` +
    `&time_zone=lst/ldt&interval=h&units=english&application=JLWouldGo&format=json`;

  const res = await axios.get(url, {
    headers: { 'User-Agent': 'JLWouldGo/1.0' },
    timeout: 10000
  });

  const predictions = (res.data && res.data.predictions) ? res.data.predictions : [];
  return predictions.map(p => ({
    timestamp: Math.floor(new Date(p.t).getTime() / 1000),
    height:    parseFloat(p.v),
    type:      'NORMAL'
  }));
}

module.exports = {
  BUOYS,
  getBuoyData,
  getTidePredictions
};
