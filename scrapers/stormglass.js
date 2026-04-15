'use strict';

const axios = require('axios');

const STORMGLASS_BASE = 'https://api.stormglass.io/v2/weather/point';
const STORMGLASS_SOURCES = ['noaa', 'sg', 'icon', 'meto', 'dwd', 'fcoo', 'fmi', 'yr', 'smhi'];

/**
 * Fetch marine forecast from Stormglass API (aggregates NOAA, ECMWF, Metoffice, etc).
 * Returns hourly wave height, period, direction + wind for next 10 days.
 */
async function getMarineForecast(lat, lon, apiKey) {
  if (!apiKey) {
    return [];
  }

  const params = new URLSearchParams({
    lat:    lat,
    lng:    lon,
    params: [
      'waveHeight',
      'wavePeriod',
      'waveDirection',
      'swellHeight',
      'swellPeriod',
      'swellDirection',
      'windSpeed',
      'windGust',
      'windDirection'
    ].join(',')
  });

  try {
    const res = await axios.get(`${STORMGLASS_BASE}?${params}`, {
      headers: {
        'Authorization': apiKey,
        'User-Agent': 'JLWouldGo/1.0'
      },
      timeout: 12000
    });

    const data = res.data;
    if (!data.hours || data.hours.length === 0) {
      return [];
    }

    // Convert Stormglass hourly data to our standard format
    return data.hours.map(hour => {
      const ts = Math.floor(new Date(hour.time).getTime() / 1000);

      const waveHeight = pickSourceValue(hour.waveHeight);
      const wavePeriod = pickSourceValue(hour.wavePeriod);
      const waveDirection = pickSourceValue(hour.waveDirection);
      const swellHeight = pickSourceValue(hour.swellHeight);
      const swellPeriod = pickSourceValue(hour.swellPeriod);
      const swellDirection = pickSourceValue(hour.swellDirection);
      const windSpeed = pickSourceValue(hour.windSpeed);
      const windGust = pickSourceValue(hour.windGust);
      const windDirection = pickSourceValue(hour.windDirection);

      return {
        timestamp:         ts,
        waveHeightFt:      waveHeight !== null ? round1(waveHeight * 3.28084) : null,
        wavePeriod:        round1(wavePeriod),
        waveDirection:     waveDirection,
        swellHeightFt:     swellHeight !== null ? round1(swellHeight * 3.28084) : null,
        swellPeriod:       round1(swellPeriod),
        swellDirection:    swellDirection,
        windSpeedKts:      windSpeed !== null ? round1(windSpeed * 1.94384) : null,
        windDirectionDeg:  windDirection,
        windGustKts:       windGust !== null ? round1(windGust * 1.94384) : null,
        source:            'stormglass'
      };
    });
  } catch (err) {
    const status = err.response?.status || 'unknown';
    const detail = err.response?.data?.errors?.[0]?.message || err.response?.data?.message || err.message;
    console.error(`[STORMGLASS] ${status} — ${detail} (lat=${lat}, lon=${lon})`);
    return [];
  }
}

function round1(v) {
  return v !== null && v !== undefined ? Math.round(v * 10) / 10 : null;
}

function pickSourceValue(metric) {
  if (!metric || typeof metric !== 'object') {
    return null;
  }

  for (const source of STORMGLASS_SOURCES) {
    if (typeof metric[source] === 'number' && !Number.isNaN(metric[source])) {
      return metric[source];
    }
  }

  return null;
}

module.exports = { getMarineForecast };
