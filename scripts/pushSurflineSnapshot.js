'use strict';

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const surfline = require('../scrapers/surfline');

const siteUrl = (process.env.SURFLINE_SNAPSHOT_SITE_URL || '').replace(/\/$/, '');
const token = process.env.SURFLINE_SNAPSHOT_TOKEN || '';
const spotKey = process.env.SURFLINE_SNAPSHOT_SPOT || 'bolinas';
const RELAY_CACHE_PATH = process.env.SURFLINE_RELAY_CACHE_PATH || path.join(__dirname, '..', 'data', 'surfline-relay-cache.json');

function ensureRelayCacheDir() {
  fs.mkdirSync(path.dirname(RELAY_CACHE_PATH), { recursive: true });
}

function loadRelayCache() {
  try {
    ensureRelayCacheDir();
    if (!fs.existsSync(RELAY_CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(RELAY_CACHE_PATH, 'utf8'));
  } catch (err) {
    console.error('[SURFLINE RELAY] Failed to load local cache:', err.message);
    return {};
  }
}

function saveRelayCache(cache) {
  ensureRelayCacheDir();
  fs.writeFileSync(RELAY_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function fetchWithFallback(label, fetcher, fallbackEntry) {
  try {
    const data = await fetcher();
    return {
      data,
      fetchedAt: new Date().toISOString(),
      mode: 'fresh',
      error: null
    };
  } catch (err) {
    if (fallbackEntry && Array.isArray(fallbackEntry.data) && fallbackEntry.data.length > 0) {
      return {
        data: fallbackEntry.data,
        fetchedAt: fallbackEntry.fetchedAt || new Date().toISOString(),
        mode: 'cached',
        error: err.message
      };
    }
    throw new Error(`${label}: ${err.message}`);
  }
}

async function main() {
  if (!siteUrl) {
    throw new Error('SURFLINE_SNAPSHOT_SITE_URL is required');
  }
  if (!token) {
    throw new Error('SURFLINE_SNAPSHOT_TOKEN is required');
  }

  const spot = surfline.SPOTS[spotKey];
  if (!spot) {
    throw new Error(`Unknown spot: ${spotKey}`);
  }

  const relayCache = loadRelayCache();
  const spotCache = relayCache[spotKey] || {};

  const wave = await fetchWithFallback('wave', () => surfline.getWaveForecast(spot.id), spotCache.wave);
  const wind = await fetchWithFallback('wind', () => surfline.getWindForecast(spot.id), spotCache.wind);
  const tides = await fetchWithFallback('tides', () => surfline.getTideForecast(spot.id), spotCache.tides);
  const conditions = await fetchWithFallback('conditions', () => surfline.getConditions(spot.id), spotCache.conditions);

  relayCache[spotKey] = {
    wave,
    wind,
    tides,
    conditions
  };
  saveRelayCache(relayCache);

  const freshestFetchedAt = [wave, wind, tides, conditions]
    .map(entry => entry.fetchedAt)
    .sort()
    .reverse()[0];

  const payload = {
    wave: wave.data,
    wind: wind.data,
    tides: tides.data,
    conditions: conditions.data,
    fetchedAt: freshestFetchedAt || new Date().toISOString()
  };

  const res = await axios.post(
    `${siteUrl}/api/internal/surfline-snapshot/${spotKey}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  console.log(JSON.stringify({
    ok: true,
    siteUrl,
    spotKey,
    modes: {
      wave: wave.mode,
      wind: wind.mode,
      tides: tides.mode,
      conditions: conditions.mode
    },
    counts: {
      wave: wave.data.length,
      wind: wind.data.length,
      tides: tides.data.length,
      conditions: conditions.data.length
    },
    response: res.data
  }, null, 2));
}

main().catch(err => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
