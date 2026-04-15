'use strict';

const axios = require('axios');

const STORMGLASS_BASE = 'https://api.stormglass.io/v2/weather/point';

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

      // Stormglass returns data from multiple sources; average them
      const waveHeightFt = hour.waveHeight ? round1(hour.waveHeight.noaa * 3.28084) : null;
      const wavePeriod = hour.wavePeriod ? round1(hour.wavePeriod.noaa) : null;
      const swellHeightFt = hour.swellHeight ? round1(hour.swellHeight.noaa * 3.28084) : null;
      const swellPeriod = hour.swellPeriod ? round1(hour.swellPeriod.noaa) : null;
      const windSpeedKts = hour.windSpeed ? round1(hour.windSpeed.noaa * 1.94384) : null;  // m/s to knots
      const windGustKts = hour.windGust ? round1(hour.windGust.noaa * 1.94384) : null;

      return {
        timestamp:         ts,
        waveHeightFt:      waveHeightFt,
        wavePeriod:        wavePeriod,
        waveDirection:     hour.waveDirection ? hour.waveDirection.noaa : null,
        swellHeightFt:     swellHeightFt,
        swellPeriod:       swellPeriod,
        swellDirection:    hour.swellDirection ? hour.swellDirection.noaa : null,
        windSpeedKts:      windSpeedKts,
        windDirectionDeg:  hour.windDirection ? hour.windDirection.noaa : null,
        windGustKts:       windGustKts,
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

module.exports = { getMarineForecast };
