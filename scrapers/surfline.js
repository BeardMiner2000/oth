'use strict';

const axios = require('axios');

const SPOTS = {
  bolinas:      { id: '5842041f4e65fad6a77089c2', name: 'Bolinas',       region: 'Marin',          lat: 37.9051, lon: -122.6815 },
  stinson:      { id: '5842041f4e65fad6a77089c1', name: 'Stinson Beach', region: 'Marin',          lat: 37.8978, lon: -122.6415 },
  oceanBeachSF: { id: '638e32a4f052ba4ed06d0e3e', name: 'Ocean Beach SF',region: 'San Francisco',  lat: 37.7594, lon: -122.5107 },
  lindaMar:     { id: '5842041f4e65fad6a7708976', name: 'Linda Mar',     region: 'Pacifica',       lat: 37.5856, lon: -122.4995 },
  mavericks:    { id: '5842041f4e65fad6a7708801', name: "Maverick's",    region: 'Half Moon Bay',  lat: 37.4917, lon: -122.5042 },
  dillonBeach:  { id: '584204204e65fad6a770938c', name: 'Dillon Beach',  region: 'Marin',          lat: 38.2394, lon: -122.9618 },
  salmonCreek:  { id: '5842041f4e65fad6a77089c8', name: 'Salmon Creek',  region: 'Sonoma',         lat: 38.3394, lon: -123.0582 }
};

const BASE = 'https://services.surfline.com/kbyg/spots/forecasts';

const HEADER_PROFILES = [
  {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.surfline.com',
    'Referer': 'https://www.surfline.com/',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Sec-CH-UA': '"Chromium";v="135", "Google Chrome";v="135", "Not.A/Brand";v="8"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"macOS"'
  },
  {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.surfline.com/',
    'Accept': 'application/json'
  }
];

async function safeFetch(url) {
  let lastErr = null;

  for (const headers of HEADER_PROFILES) {
    try {
      const res = await axios.get(url, {
        headers,
        timeout: 15000
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : 'no-response';
      const msg = err.response ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
      console.error(`[Surfline] HTTP ${status} for ${url} — ${msg}`);
    }
  }

  const status = lastErr && lastErr.response ? lastErr.response.status : 'no-response';
  throw new Error(`Surfline HTTP ${status}: ${lastErr ? lastErr.message : 'Unknown error'}`);
}

/**
 * Surfline now separates surf heights, swell partitions and energy.
 * Join by timestamp, retaining the wave shape consumed by stored snapshots.
 */
async function getWaveForecast(spotId) {
  const query = `spotId=${encodeURIComponent(spotId)}&days=7&intervalHours=3&cacheEnabled=true`;
  const [surfResult, swellResult, energyResult] = await Promise.allSettled([
    safeFetch(`${BASE}/surf?${query}&units%5BwaveHeight%5D=FT`),
    safeFetch(`${BASE}/swells?${query}&units%5BswellHeight%5D=FT`),
    safeFetch(`${BASE}/energy?${query}`)
  ]);
  if (surfResult.status === 'rejected') throw surfResult.reason;
  const intervals = (surfResult.value.data?.surf || []).filter(entry =>
    Number.isFinite(entry.timestamp) && Number.isFinite(entry.surf?.min) && Number.isFinite(entry.surf?.max)
  );
  if (!intervals.some(entry => entry.timestamp >= Date.now() / 1000)) {
    throw new Error('Surfline returned no current surf forecast');
  }

  // Missing supplemental feeds must not discard a valid surf-height forecast.
  const swellRows = swellResult.status === 'fulfilled' ? swellResult.value.data?.swells || [] : [];
  const energyRows = energyResult.status === 'fulfilled' ? energyResult.value.data?.energy || [] : [];
  const swellByTs = new Map(swellRows.map(entry => [entry.timestamp, entry]));
  const energyByTs = new Map(energyRows.map(entry => [entry.timestamp, entry]));
  return intervals.map(entry => {
    const swell = swellByTs.get(entry.timestamp);
    const energy = energyByTs.get(entry.timestamp);
    return {
      timestamp: entry.timestamp,
      surf: {
        min: entry.surf.min,
        max: entry.surf.max,
        humanRelation: entry.surf.humanRelation || '',
        rawMin: entry.surf.raw?.min ?? entry.surf.min,
        rawMax: entry.surf.raw?.max ?? entry.surf.max
      },
      power: swell?.power ?? null,
      swells: (swell?.swells || []).map(s => ({
        height: s.height ?? null,
        period: s.period ?? null,
        direction: s.direction ?? null,
        directionMin: s.directionMin ?? null,
        optimalScore: s.optimalScore ?? 0
      })),
      energy: energy ? {
        nearshoreKj: Number.isFinite(energy.nearshore) ? energy.nearshore : null,
        offshoreKj: Number.isFinite(energy.offshore) ? energy.offshore : null
      } : null
    };
  });
}

/**
 * Returns wind forecast.
 * Shape: [ { timestamp, speed, direction, directionType, gust, optimalScore } ]
 */
async function getWindForecast(spotId) {
  const url = `${BASE}/wind?spotId=${spotId}&days=7&intervalHours=3`;
  const raw = await safeFetch(url);
  const intervals = (raw.data && raw.data.wind) ? raw.data.wind : [];
  return intervals.map(entry => ({
    timestamp:     entry.timestamp,
    speed:         entry.speed         || 0,
    direction:     entry.direction     || 0,
    directionType: entry.directionType || '',
    gust:          entry.gust          || 0,
    optimalScore:  entry.optimalScore  || 0
  }));
}

/**
 * Returns tide forecast.
 * Shape: [ { timestamp, height, type } ]
 */
async function getTideForecast(spotId) {
  const url = `${BASE}/tides?spotId=${spotId}&days=7`;
  const raw = await safeFetch(url);
  const intervals = (raw.data && raw.data.tides) ? raw.data.tides : [];
  return intervals.map(entry => ({
    timestamp: entry.timestamp,
    height:    entry.height || 0,
    type:      entry.type   || ''   // 'HIGH' | 'LOW' | 'NORMAL'
  }));
}

/**
 * Returns conditions (overall rating) forecast.
 * Shape: [ { timestamp, am: { rating, humanRelation }, pm: { rating, humanRelation } } ]
 */
async function getConditions(spotId) {
  const url = `${BASE}/conditions?spotId=${spotId}&days=7`;
  const raw = await safeFetch(url);
  const intervals = (raw.data && raw.data.conditions) ? raw.data.conditions : [];
  return intervals.map(entry => ({
    timestamp: entry.timestamp,
    am: {
      rating:        (entry.am && entry.am.rating)        ? entry.am.rating        : 0,
      humanRelation: (entry.am && entry.am.humanRelation) ? entry.am.humanRelation : ''
    },
    pm: {
      rating:        (entry.pm && entry.pm.rating)        ? entry.pm.rating        : 0,
      humanRelation: (entry.pm && entry.pm.humanRelation) ? entry.pm.humanRelation : ''
    }
  }));
}

module.exports = {
  SPOTS,
  getWaveForecast,
  getWindForecast,
  getTideForecast,
  getConditions
};
