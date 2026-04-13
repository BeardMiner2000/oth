'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const NodeCache = require('node-cache');

const surfline    = require('./scrapers/surfline');
const noaa        = require('./scrapers/noaa');
const surfForecast = require('./scrapers/surfForecast');
const openMeteo   = require('./scrapers/openMeteo');

// ─── Cache ────────────────────────────────────────────────────────────────────
const forecastCache = new NodeCache({ stdTTL: 30 * 60, checkperiod: 5 * 60 });
const buoyCache     = new NodeCache({ stdTTL: 15 * 60, checkperiod: 3 * 60 });

// ─── App ──────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Zip wave + wind arrays by timestamp proximity (both have 3-hour intervals).
 */
function mergeWaveWind(waves, winds) {
  return waves.map(w => {
    // Find closest wind entry
    const wind = winds.reduce((best, curr) => {
      return Math.abs(curr.timestamp - w.timestamp) < Math.abs(best.timestamp - w.timestamp)
        ? curr : best;
    }, winds[0] || {});
    return { ...w, wind: wind || null };
  });
}

/**
 * Find tide entry closest to a given timestamp.
 */
function closestTide(tides, timestamp) {
  if (!tides || tides.length === 0) return null;
  return tides.reduce((best, curr) => {
    return Math.abs(curr.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
      ? curr : best;
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/spots – return all known spots */
app.get('/api/spots', (req, res) => {
  const spots = Object.entries(surfline.SPOTS).map(([key, val]) => ({
    key,
    id:     val.id,
    name:   val.name,
    region: val.region
  }));
  res.json({ spots });
});

/** GET /api/forecast/:spotId – aggregate forecast for a spot key (e.g. "bolinas") */
app.get('/api/forecast/:spotId', async (req, res, next) => {
  const spotKey = req.params.spotId;
  const cacheKey = `forecast_${spotKey}`;

  const cached = forecastCache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  const spotMeta = surfline.SPOTS[spotKey];
  if (!spotMeta) {
    return res.status(404).json({ error: `Unknown spot: ${spotKey}` });
  }

  try {
    // Fetch Surfline + Open-Meteo + NOAA tides in parallel; tolerate partial failures
    const [waveResult, windResult, tideResult, condResult, meteoResult, noaaTideResult] = await Promise.allSettled([
      surfline.getWaveForecast(spotMeta.id),
      surfline.getWindForecast(spotMeta.id),
      surfline.getTideForecast(spotMeta.id),
      surfline.getConditions(spotMeta.id),
      openMeteo.getMarineForecast(spotMeta.lat, spotMeta.lon),
      noaa.getTidePredictions('9414958')   // Bolinas tide gauge — fallback when Surfline blocked
    ]);

    const waves      = waveResult.status  === 'fulfilled' ? waveResult.value      : [];
    const winds      = windResult.status  === 'fulfilled' ? windResult.value      : [];
    const sfTides    = tideResult.status  === 'fulfilled' ? tideResult.value      : [];
    const noaaTides  = noaaTideResult.status === 'fulfilled' ? noaaTideResult.value : [];
    const tides      = sfTides.length > 0 ? sfTides : noaaTides;   // prefer Surfline tides
    const conds      = condResult.status  === 'fulfilled' ? condResult.value      : [];
    const meteo      = meteoResult.status === 'fulfilled' ? meteoResult.value     : [];

    // Merge wave + wind by timestamp
    const merged = mergeWaveWind(waves, winds).map(entry => ({
      ...entry,
      tide: closestTide(tides, entry.timestamp)
    }));

    // Also try surf-forecast.com for supplemental data
    let sfData = { data: [], error: null };
    const sfSlug = surfForecast.SURF_FORECAST_SLUGS[spotKey];
    if (sfSlug) {
      try {
        sfData = await surfForecast.scrapeSpotForecast(sfSlug);
      } catch (e) {
        sfData = { data: [], error: e.message };
      }
    }

    const payload = {
      spot:           spotMeta,
      surfline:       merged,
      tides,
      conditions:     conds,
      openMeteo:      meteo,
      surfForecast:   sfData,
      fetchedAt:      new Date().toISOString(),
      cached:         false,
      errors: {
        wave:  waveResult.status  === 'rejected' ? waveResult.reason?.message  : null,
        wind:  windResult.status  === 'rejected' ? windResult.reason?.message  : null,
        tide:  tideResult.status  === 'rejected' ? tideResult.reason?.message  : null,
        cond:  condResult.status  === 'rejected' ? condResult.reason?.message  : null,
        meteo: meteoResult.status === 'rejected' ? meteoResult.reason?.message : null
      }
    };

    forecastCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

/** GET /api/buoy/:buoyId – real-time buoy data */
app.get('/api/buoy/:buoyId', async (req, res, next) => {
  const { buoyId } = req.params;
  const cacheKey = `buoy_${buoyId}`;

  const cached = buoyCache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const data = await noaa.getBuoyData(buoyId);
    buoyCache.set(cacheKey, data);
    res.json({ ...data, cached: false });
  } catch (err) {
    next(err);
  }
});

/** GET /api/buoys – return metadata for all tracked buoys */
app.get('/api/buoys', (req, res) => {
  res.json({ buoys: noaa.BUOYS });
});

/** Health check */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─── Error middleware ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error:   err.message || 'Internal server error',
    stack:   process.env.NODE_ENV !== 'production' ? err.stack : undefined
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`JL Would Go surf predictor running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
