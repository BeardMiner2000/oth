'use strict';

const axios = require('axios');

const BASE = 'https://marine-api.open-meteo.com/v1/marine';

/**
 * Fetch marine forecast from Open-Meteo (free, no auth).
 * Returns hourly wave height, period, direction for next 7 days.
 */
async function getMarineForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude:  lat,
    longitude: lon,
    hourly: [
      'wave_height',
      'wave_period',
      'wave_direction',
      'wind_wave_height',
      'wind_wave_period',
      'swell_wave_height',
      'swell_wave_period',
      'swell_wave_direction'
    ].join(','),
    wind_speed_unit: 'kn',
    length_unit:     'imperial',
    timezone:        'America/Los_Angeles',
    forecast_days:   7
  });

  const url = `${BASE}?${params}`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'JLWouldGo/1.0' },
    timeout: 12000
  });

  const h = res.data.hourly;
  if (!h || !h.time) return [];

  return h.time.map((t, i) => ({
    timestamp:         Math.floor(new Date(t).getTime() / 1000),
    waveHeightFt:      h.wave_height       ? round1(h.wave_height[i])       : null,
    wavePeriod:        h.wave_period       ? round1(h.wave_period[i])       : null,
    waveDirection:     h.wave_direction    ? h.wave_direction[i]            : null,
    swellHeightFt:     h.swell_wave_height ? round1(h.swell_wave_height[i]) : null,
    swellPeriod:       h.swell_wave_period ? round1(h.swell_wave_period[i]) : null,
    swellDirection:    h.swell_wave_direction ? h.swell_wave_direction[i]   : null
  }));
}

function round1(v) {
  return v !== null && v !== undefined ? Math.round(v * 10) / 10 : null;
}

module.exports = { getMarineForecast };
