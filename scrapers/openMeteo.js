'use strict';

const axios = require('axios');

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetch marine forecast from Open-Meteo (free, no auth).
 * Also fetches atmospheric wind from the weather API.
 * Returns hourly wave height, period, direction + wind for next 7 days.
 */
async function getMarineForecast(lat, lon) {
  const marineParams = new URLSearchParams({
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

  const windParams = new URLSearchParams({
    latitude:        lat,
    longitude:       lon,
    hourly:          'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kn',
    timezone:        'America/Los_Angeles',
    forecast_days:   7
  });

  const [marineResult, windResult] = await Promise.allSettled([
    axios.get(`${MARINE_BASE}?${marineParams}`, { headers: { 'User-Agent': 'JLWouldGo/1.0' }, timeout: 12000 }),
    axios.get(`${WEATHER_BASE}?${windParams}`,  { headers: { 'User-Agent': 'JLWouldGo/1.0' }, timeout: 12000 })
  ]);

  if (marineResult.status === 'rejected') return [];

  const h = marineResult.value.data.hourly;
  if (!h || !h.time) return [];

  // Build a timestamp→wind lookup from the weather API result
  const windByTs = {};
  if (windResult.status === 'fulfilled') {
    const wh = windResult.value.data.hourly;
    if (wh && wh.time) {
      wh.time.forEach((t, i) => {
        const ts = Math.floor(new Date(t).getTime() / 1000);
        windByTs[ts] = {
          windSpeedKts:    wh.wind_speed_10m   ? round1(wh.wind_speed_10m[i])   : null,
          windDirectionDeg: wh.wind_direction_10m ? wh.wind_direction_10m[i]    : null,
          windGustKts:     wh.wind_gusts_10m   ? round1(wh.wind_gusts_10m[i])   : null
        };
      });
    }
  }

  return h.time.map((t, i) => {
    const ts = Math.floor(new Date(t).getTime() / 1000);
    const wind = windByTs[ts] || {};
    return {
      timestamp:         ts,
      waveHeightFt:      h.wave_height       ? round1(h.wave_height[i])       : null,
      wavePeriod:        h.wave_period       ? round1(h.wave_period[i])       : null,
      waveDirection:     h.wave_direction    ? h.wave_direction[i]            : null,
      swellHeightFt:     h.swell_wave_height ? round1(h.swell_wave_height[i]) : null,
      swellPeriod:       h.swell_wave_period ? round1(h.swell_wave_period[i]) : null,   // use swell period, not wave period
      swellDirection:    h.swell_wave_direction ? h.swell_wave_direction[i]   : null,
      windSpeedKts:      wind.windSpeedKts    || null,
      windDirectionDeg:  wind.windDirectionDeg || null,
      windGustKts:       wind.windGustKts     || null
    };
  });
}

function round1(v) {
  return v !== null && v !== undefined ? Math.round(v * 10) / 10 : null;
}

module.exports = { getMarineForecast };
