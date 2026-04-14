'use strict';

/* ═══════════════════════════════════════════════════════════════════════════════
   JL WOULD GO — Frontend Application
   ═══════════════════════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  currentSpot:  'bolinas',
  currentDay:   0,         // 0 = today, 1 = tomorrow, ...
  forecastData: null,
  buoyData:     null,
  loading:      false,
  lastUpdated:  null,
  spots:        {}
};

// ─── Spot Definitions (mirrors server) ───────────────────────────────────────
const SPOTS = {
  bolinas:      { id: '5842041f4e65fad6a77089c2', name: 'Bolinas',         region: 'Marin',         lat: 37.9051, lon: -122.6815 },
  stinson:      { id: '5842041f4e65fad6a77089c1', name: 'Stinson Beach',   region: 'Marin',         lat: 37.8978, lon: -122.6415 },
  oceanBeachSF: { id: '638e32a4f052ba4ed06d0e3e', name: 'Ocean Beach SF',  region: 'San Francisco', lat: 37.7594, lon: -122.5107 },
  lindaMar:     { id: '5842041f4e65fad6a7708976', name: 'Linda Mar',       region: 'Pacifica',      lat: 37.5856, lon: -122.4995 },
  mavericks:    { id: '5842041f4e65fad6a7708801', name: "Maverick's",      region: 'Half Moon Bay', lat: 37.4917, lon: -122.5042 },
  dillonBeach:  { id: '584204204e65fad6a770938c', name: 'Dillon Beach',    region: 'Marin',         lat: 38.2394, lon: -122.9618 },
  salmonCreek:  { id: '5842041f4e65fad6a77089c8', name: 'Salmon Creek',    region: 'Sonoma',        lat: 38.3394, lon: -123.0582 }
};

// ─── Wind direction helpers ───────────────────────────────────────────────────
const DIR_NAMES = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function degToCompass(deg) {
  if (deg === null || deg === undefined) return '---';
  if (typeof deg === 'string') return deg || '---'; // already a compass label
  if (isNaN(deg)) return '---';
  return DIR_NAMES[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  renderSpotSelector();
  renderDateNav();
  await loadForecast(state.currentSpot);
  startAutoRefresh();
  startSurferAnimation();
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────
function startAutoRefresh() {
  // Refresh every 30 minutes
  setInterval(() => {
    loadForecast(state.currentSpot);
  }, 30 * 60 * 1000);
}

// ─── API Calls ────────────────────────────────────────────────────────────────
async function loadForecast(spotId) {
  setLoading(true);
  try {
    const [forecast, ...buoys] = await Promise.all([
      fetch(`/api/forecast/${spotId}`).then(r => {
        if (!r.ok) throw new Error(`Forecast API returned ${r.status}`);
        return r.json();
      }),
      fetch(`/api/buoy/46026`).then(r => r.json()).catch(e => ({ error: e.message, latest: null })),
      fetch(`/api/buoy/46013`).then(r => r.json()).catch(e => ({ error: e.message, latest: null })),
      fetch(`/api/buoy/46214`).then(r => r.json()).catch(e => ({ error: e.message, latest: null }))
    ]);

    state.forecastData = forecast;
    state.buoyData     = buoys;
    state.lastUpdated  = new Date();

    // Log any server-side fetch errors for debugging
    if (forecast.errors) {
      const errs = Object.entries(forecast.errors).filter(([, v]) => v);
      if (errs.length) console.warn('[OTH] Server fetch errors:', Object.fromEntries(errs));
    }
    if (forecast.surfline && forecast.surfline.length === 0) {
      console.warn('[OTH] Surfline returned 0 intervals — error:', forecast.errors?.wave);
    }

    render();
  } catch (e) {
    renderError(e.message);
  } finally {
    setLoading(false);
  }
}

// Global function for the footer refresh link
window.refreshData = function() {
  loadForecast(state.currentSpot);
};

// ─── Render Orchestrator ──────────────────────────────────────────────────────
function render() {
  if (!state.forecastData) return;

  const spotName = SPOTS[state.currentSpot]
    ? SPOTS[state.currentSpot].name
    : state.currentSpot;

  // Update spot name in forecast header
  const nameEl = document.getElementById('forecast-spot-name');
  if (nameEl) nameEl.textContent = spotName.toUpperCase();

  // Normalize data sources once
  const surflineData       = state.forecastData.surfline || [];
  const surfForecastNorm   = normalizeSurfForecastForTable(state.forecastData.surfForecast || {});
  const stormglassNorm     = normalizeStormglassForTable(state.forecastData.stormglass || []);
  const openMeteoNorm      = normalizeOpenMeteoForTable(state.forecastData.openMeteo || []);

  const useSurfForecast    = surfForecastNorm.length > 0;
  const useStormglass      = stormglassNorm.length > 0;
  const useOpenMeteo       = openMeteoNorm.length > 0;

  // Table: Surf-Forecast.com (primary, 8/day) → Stormglass (backup, hourly) → Open-Meteo (fallback, hourly)
  let tableData, verdictSource;
  if (useSurfForecast) {
    tableData = surfForecastNorm;
    verdictSource = 'surf-forecast';
  } else if (useStormglass) {
    tableData = stormglassNorm;
    verdictSource = 'stormglass';
  } else {
    tableData = openMeteoNorm;
    verdictSource = useOpenMeteo ? 'open-meteo' : 'buoy';
  }

  // Verdict uses the selected day's slice
  const dayData       = getDaySlice(tableData, state.currentDay);
  const verdictInput  = buildVerdictInput(
    dayData,
    Array.isArray(state.buoyData) ? state.buoyData[0] : state.buoyData,
    verdictSource
  );
  const verdict = calculateVerdict(verdictInput);

  // Best time to surf today (only shown when viewing today)
  const todayIntervals = getDaySlice(tableData, 0);
  const bestTime = state.currentDay === 0
    ? findBestSurfTimeToday(todayIntervals, state.forecastData.tides)
    : null;

  renderVerdictPanel(verdict, bestTime);

  // Forecast table
  renderForecastTable(tableData, state.forecastData.tides, state.forecastData.conditions);

  // Buoy panel
  renderBuoyPanel(state.buoyData);

  // Update timestamp
  updateTimestamp();
  updateDayDisplay();
}

// ─── Stormglass → Surfline-shape normalizer (primary forecast source) ─────────
function normalizeStormglassForTable(intervals) {
  // Only show data from today onwards
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayMidnightTs = Math.floor(todayMidnight.getTime() / 1000);
  // Stormglass is hourly; sample every 3 hours
  return intervals
    .filter((e, i) => i % 3 === 0 && e.timestamp >= todayMidnightTs)
    .map(e => ({
      timestamp: e.timestamp,
      surf: {
        // Stormglass aggregates multiple meteorological sources (NOAA, ECMWF, etc).
        // Data is already fairly accurate for peak/average wave height at Bolinas.
        // Apply modest calibration: ~85-95% of reported Hs for local surf height.
        min: e.waveHeightFt ? Math.max(0.5, Math.round((e.waveHeightFt * 0.85) * 2) / 2) : 0,
        max: e.waveHeightFt ? Math.max(1.0, Math.round((e.waveHeightFt * 0.95) * 2) / 2) : 0
      },
      swells: e.waveHeightFt ? [{
        height:    e.waveHeightFt,
        // Stormglass wavePeriod (~10s) is better than Open-Meteo (~9s), closer to Surfline
        period:    e.wavePeriod || 0,
        direction: e.waveDirection || 0,
        optimalScore: 0
      }] : [],
      wind: e.windSpeedKts != null ? {
        speed:         e.windSpeedKts,
        direction:     e.windDirectionDeg || 0,
        directionType: '',
        gust:          e.windGustKts || 0
      } : null,
      tide: null
    }));
}

// ─── Open-Meteo → Surfline-shape normalizer (fallback for forecast table) ─────
function normalizeOpenMeteoForTable(intervals) {
  // Only show data from today onwards
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayMidnightTs = Math.floor(todayMidnight.getTime() / 1000);
  // Open-Meteo is hourly; sample every 3 hours
  return intervals
    .filter((e, i) => i % 3 === 0 && e.timestamp >= todayMidnightTs)
    .map(e => ({
      timestamp: e.timestamp,
      surf: {
        // Open-Meteo wave_height is significant wave height (open ocean).
        // Bolinas sees ~30-40% of Hs due to Point Reyes shadow + headland refraction.
        min: e.waveHeightFt ? Math.max(0.5, Math.round((e.waveHeightFt * 0.30) * 2) / 2) : 0,
        max: e.waveHeightFt ? Math.max(1.0, Math.round((e.waveHeightFt * 0.40) * 2) / 2) : 0
      },
      swells: e.swellHeightFt ? [{
        height:    e.swellHeightFt,
        // Use wave_period as better estimate than swell_wave_period for Bolinas
        // (Open-Meteo swell_wave_period is underestimated; wave_period ~9s is closer to actual)
        period:    e.wavePeriod || 0,
        direction: e.swellDirection || 0,
        optimalScore: 0
      }] : [],
      wind: e.windSpeedKts != null ? {
        speed:         e.windSpeedKts,
        direction:     e.windDirectionDeg || 0,
        directionType: '',
        gust:          e.windGustKts || 0
      } : null,
      tide: null
    }));
}

// ─── Surf-Forecast.com → Surfline-shape normalizer ────────────────────────────
function normalizeSurfForecastForTable(sfData) {
  if (!sfData || !sfData.data || sfData.error || sfData.data.length === 0) return [];
  // Only show data from today onwards (not yesterday evening)
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayMidnightTs = Math.floor(todayMidnight.getTime() / 1000);
  return sfData.data
    .filter(e => e.timestamp && e.timestamp >= todayMidnightTs)
    .map(e => ({
      timestamp: e.timestamp,
      surf: {
        // surf-forecast.com reports local surf height in metres — convert to ft range
        min: e.waveHeightFt ? Math.max(0.5, Math.round(e.waveHeightFt * 0.80 * 2) / 2) : 0,
        max: e.waveHeightFt ? Math.max(1.0, Math.round(e.waveHeightFt * 1.00 * 2) / 2) : 0
      },
      swells: e.period ? [{
        height:    e.waveHeightM || 0,
        period:    e.period,
        direction: e.waveDirection || 0,
        optimalScore: 0
      }] : [],
      wind: e.windSpeedKts ? {
        speed:         e.windSpeedKts,
        direction:     e.windDir || '---',   // compass string — degToCompass handles it
        directionType: e.windState || '',
        gust:          0
      } : null,
      tide: null
    }));
}

// ─── Data Helpers ─────────────────────────────────────────────────────────────

/**
 * Get all intervals for a given day offset (0 = today).
 */
function getDaySlice(intervals, dayOffset) {
  if (!intervals || intervals.length === 0) return [];

  const now    = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + dayOffset);

  const targetDay = target.toDateString();

  return intervals.filter(entry => {
    const d = new Date(entry.timestamp * 1000);
    return d.toDateString() === targetDay;
  });
}

/**
 * Pick best single representative interval from a day slice.
 * Prefer mid-morning (10am) or just pick first available.
 */
function getBestInterval(daySlice) {
  if (!daySlice || daySlice.length === 0) return null;

  // Prefer ~10am reading
  const morning = daySlice.find(e => {
    const h = new Date(e.timestamp * 1000).getHours();
    return h >= 9 && h <= 12;
  });
  return morning || daySlice[0];
}

/**
 * Build a simplified object for the verdict algorithm.
 * sourceHint: 'surfline' | 'open-meteo' | 'buoy'
 */
function buildVerdictInput(daySlice, buoyData, sourceHint = 'surfline') {
  const interval = getBestInterval(daySlice);
  if (!interval) {
    // Fall back to buoy data if no Surfline
    if (buoyData && buoyData.latest) {
      const b = buoyData.latest;
      // Buoy 46026 measures open-ocean significant wave height at the SF Bar.
      // Bolinas sees ~40% of that due to headland shadow + Point Reyes blocking.
      // Use dominantPeriod if available, fall back to avgPeriod.
      const rawFt  = b.waveHeightFt || 0;
      const surfFt = rawFt * 0.40;
      return {
        wave:   { min: Math.round(surfFt * 0.8 * 2) / 2,
                  max: Math.round(surfFt * 1.1 * 2) / 2,
                  period: b.dominantPeriod || b.avgPeriod || 0,
                  swellDir: b.swellDirectionCompass || '' },
        wind:   { speed: b.windSpeedKts || 0, direction: b.windDirection || '', gust: b.windGustKts || 0, type: '' },
        tide:   null,
        source: 'buoy'
      };
    }
    return null;
  }

  // Get dominant swell direction
  let swellDir = null;
  if (interval.swells && interval.swells.length > 0) {
    const dominant = interval.swells.reduce((a, b) => a.height >= b.height ? a : b);
    swellDir = degToCompass(dominant.direction);
  }

  const windDirName = interval.wind
    ? degToCompass(interval.wind.direction)
    : '---';

  const dominantSwell = (interval.swells || []).find(s => s.height > 0);
  return {
    wave: {
      min:    interval.surf ? interval.surf.min : 0,
      max:    interval.surf ? interval.surf.max : 0,
      period: dominantSwell ? dominantSwell.period : 0,
      swellDir
    },
    wind: {
      speed:     interval.wind ? interval.wind.speed         : 0,
      direction: windDirName,
      gust:      interval.wind ? interval.wind.gust          : 0,
      type:      interval.wind ? interval.wind.directionType : ''
    },
    tide:   interval.tide || null,
    source: sourceHint
  };
}

// ─── Verdict Algorithm ────────────────────────────────────────────────────────
//
// Tuned entirely for JL's style:
//   • Longboard / mellow vibe — slow, clean, glassy waves are the dream
//   • Sweet spot: 2-4ft, long period, glassy or light offshore
//   • 4-5ft starts feeling big; 5ft+ is genuinely scary → low score
//   • Flat/no waves → not a failure, just SWIM DAY (positive spin)
//   • Bolinas-specific tide: mid-to-low preferred for the Patch
//   • Channel: avoid strong incoming tide (fast low→high change)

function computeScore(data) {
  if (!data) return { score: 0, reasons: [], flat: false, scary: false };

  let score = 40; // start neutral
  const reasons = [];
  let flat  = false;
  let scary = false;

  // ── Wave height (the main dial) ──────────────────────────────────────────
  const waveMin = data.wave ? (data.wave.min || 0) : 0;
  const waveMax = data.wave ? (data.wave.max || 0) : 0;
  const waveMid = (waveMin + waveMax) / 2;
  const waveStr = waveMin === waveMax ? `${waveMin}FT` : `${waveMin}-${waveMax}FT`;

  if (waveMid < 0.5) {
    // Flat — totally different activity, not a failure
    flat = true;
    score = 20;
    reasons.push({ text: 'BASICALLY FLAT', cls: 'reason-swim' });
  } else if (waveMid < 1.5) {
    score += 0;
    reasons.push({ text: `${waveStr} SMALL`, cls: 'reason-neutral' });
  } else if (waveMid >= 1.5 && waveMid < 2.5) {
    score += 20;
    reasons.push({ text: `${waveStr} MELLOW ✓`, cls: 'reason-good' });
  } else if (waveMid >= 2.5 && waveMid <= 4.0) {
    // JL's ideal zone
    score += 35;
    reasons.push({ text: `${waveStr} PERFECT SIZE`, cls: 'reason-good' });
  } else if (waveMid > 4.0 && waveMid <= 5.0) {
    // Getting chunky — JL starts feeling it
    score -= 10;
    reasons.push({ text: `${waveStr} GETTING CHUNKY`, cls: 'reason-warn' });
  } else if (waveMid > 5.0 && waveMid <= 7.0) {
    // Scary territory
    scary = true;
    score -= 25;
    reasons.push({ text: `${waveStr} TOO MUCH POWER`, cls: 'reason-bad' });
  } else {
    // Way too big
    scary = true;
    score -= 40;
    reasons.push({ text: `${waveStr} TERRIFYING`, cls: 'reason-bad' });
  }

  if (flat) return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, flat, scary };

  // ── Glassiness / Wind (huge factor for JL — clean > size) ───────────────
  const windSpeed = data.wind ? (data.wind.speed || 0) : 0;
  const windDir   = data.wind ? (data.wind.direction || '') : '';
  const windType  = data.wind ? (data.wind.type || '') : '';

  const isOffshore = windType === 'Offshore' || ['N','NNE','NE','ENE'].includes(windDir);
  const isOnshore  = windType === 'Onshore'  || ['S','SSW','SW','W','WSW','NW','NNW'].includes(windDir);

  if (windSpeed < 3) {
    // Glassy — JL's dream
    score += 25;
    reasons.push({ text: 'GLASSY 🏄', cls: 'reason-good' });
  } else if (isOffshore && windSpeed < 8) {
    score += 20;
    reasons.push({ text: `${windDir} ${Math.round(windSpeed)}KT OFFSHORE`, cls: 'reason-good' });
  } else if (isOffshore && windSpeed < 15) {
    score += 10;
    reasons.push({ text: `${windDir} ${Math.round(windSpeed)}KT MOD OFFSHORE`, cls: 'reason-good' });
  } else if (!isOnshore && windSpeed < 8) {
    score += 8;
    reasons.push({ text: 'LIGHT WINDS', cls: 'reason-good' });
  } else if (isOnshore && windSpeed < 6) {
    score += 0;
    reasons.push({ text: 'LIGHT ONSHORE', cls: 'reason-neutral' });
  } else if (isOnshore && windSpeed < 12) {
    score -= 12;
    reasons.push({ text: `${windDir} ${Math.round(windSpeed)}KT ONSHORE`, cls: 'reason-bad' });
  } else if (isOnshore || windSpeed >= 12) {
    score -= 20;
    reasons.push({ text: `${Math.round(windSpeed)}KT BLOWN OUT`, cls: 'reason-bad' });
  }

  // ── Period (long period = slow, rolling waves = JL's ideal) ─────────────
  const period = data.wave ? (data.wave.period || 0) : 0;
  if (period >= 14) {
    score += 15;
    reasons.push({ text: `${period}S SLOW ROLLERS`, cls: 'reason-good' });
  } else if (period >= 11) {
    score += 8;
    reasons.push({ text: `${period}S GOOD PERIOD`, cls: 'reason-good' });
  } else if (period >= 8) {
    reasons.push({ text: `${period}S OK PERIOD`, cls: 'reason-neutral' });
  } else if (period > 0) {
    score -= 8;
    reasons.push({ text: `${period}S CHOPPY/FAST`, cls: 'reason-bad' });
  }

  // ── Swell direction (NW/WNW wraps into Bolinas beautifully) ─────────────
  const swellDir = data.wave ? (data.wave.swellDir || '') : '';
  if (['NW','WNW','W'].includes(swellDir)) {
    score += 8;
    reasons.push({ text: `${swellDir} SWELL ✓`, cls: 'reason-good' });
  } else if (['NNW','SW','WSW'].includes(swellDir)) {
    score += 3;
    reasons.push({ text: `${swellDir} SWELL OK`, cls: 'reason-neutral' });
  } else if (swellDir && ['S','SE','E','NE'].includes(swellDir)) {
    score -= 5;
    reasons.push({ text: `${swellDir} SWELL WEAK`, cls: 'reason-neutral' });
  }

  // ── Tide (mid-to-low = best for the Patch; strong incoming = messy Channel) ──
  const tideHeight = data.tide ? data.tide.height : null;
  const tideType   = data.tide ? (data.tide.type || '') : '';

  if (tideHeight !== null) {
    if (tideHeight >= 0 && tideHeight <= 2.5) {
      score += 10;
      reasons.push({ text: `${tideHeight.toFixed(1)}FT LOW-MID TIDE`, cls: 'reason-good' });
    } else if (tideHeight > 2.5 && tideHeight <= 4.0) {
      reasons.push({ text: `${tideHeight.toFixed(1)}FT MID TIDE`, cls: 'reason-neutral' });
    } else if (tideHeight > 4.0) {
      score -= 8;
      reasons.push({ text: `${tideHeight.toFixed(1)}FT HIGH TIDE`, cls: 'reason-bad' });
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, flat, scary };
}

function calculateVerdict(data) {
  const { score, reasons, flat, scary } = computeScore(data);

  let verdict, cls;

  // YES for everything except scary (too big/powerful)
  if (flat) {
    cls = 'swim';
  } else if (scary) {
    cls = score < 25 ? 'scary' : 'chunky';
  } else if (score >= 80) {
    cls = 'epic';
  } else if (score >= 62) {
    cls = 'good';
  } else if (score >= 44) {
    cls = 'marginal';
  } else {
    cls = 'chunky';
  }
  verdict = scary ? '[ NO ]' : '[ YES ]';

  // Parking lot indicator based on wave height
  const waveMid = data && data.wave ? ((data.wave.min || 0) + (data.wave.max || 0)) / 2 : 0;
  let parking;
  if (waveMid <= 2.0) {
    parking = { text: 'PARKING LOT: PRETTY EMPTY', cls: 'reason-good' };
  } else {
    parking = { text: 'PARKING LOT: FULL — WARNING: SHORTBOARDERS IN LOT', cls: 'reason-bad' };
  }

  return { verdict, score, cls, reasons, source: data ? data.source : null, parking };
}

// ─── Best time to surf today ─────────────────────────────────────────────────
/**
 * Score every future interval for today, return the best one.
 * Uses same computeScore() logic so it's consistent with the verdict.
 * Criteria: under 4ft, glassy/offshore wind, some push, lower tide.
 */
function findBestSurfTimeToday(todayIntervals, tides) {
  const nowTs = Math.floor(Date.now() / 1000);
  let best = null;
  let bestScore = -1;

  todayIntervals.forEach(entry => {
    if (entry.timestamp < nowTs) return; // skip past slots

    // Attach closest tide if not already present
    const tideEntry = entry.tide || (tides && tides.length
      ? tides.reduce((b, c) => Math.abs(c.timestamp - entry.timestamp) < Math.abs(b.timestamp - entry.timestamp) ? c : b)
      : null);

    const swellDir = entry.swells && entry.swells.length > 0
      ? degToCompass(entry.swells.reduce((a, b) => a.height >= b.height ? a : b).direction)
      : null;

    const dominantSwell = (entry.swells || []).find(s => s.height > 0);
    const verdictInput = {
      wave: {
        min:      entry.surf ? entry.surf.min : 0,
        max:      entry.surf ? entry.surf.max : 0,
        period:   dominantSwell ? dominantSwell.period : 0,
        swellDir: swellDir || ''
      },
      wind: {
        speed:     entry.wind ? entry.wind.speed         : 0,
        direction: entry.wind ? degToCompass(entry.wind.direction) : '---',
        gust:      entry.wind ? entry.wind.gust          : 0,
        type:      entry.wind ? entry.wind.directionType : ''
      },
      tide: tideEntry || null
    };

    const { score } = computeScore(verdictInput);
    if (score > bestScore) {
      bestScore = score;
      best = { entry, score, tideEntry, verdictInput };
    }
  });

  return best;
}

// ─── Render: Verdict Panel ────────────────────────────────────────────────────
function renderVerdictPanel(verdict, bestTime) {
  const box      = document.getElementById('verdict-box');
  const textEl   = document.getElementById('verdict-text');
  const labelEl  = document.getElementById('verdict-label');
  const stokeEl  = document.getElementById('stoke-bar');
  const reasonEl = document.getElementById('verdict-reasons');

  if (!box || !textEl) return;

  // Update class
  box.className = verdict.cls;

  textEl.textContent = verdict.verdict;

  // Label — condition descriptor + OTH verdict question
  const labels = {
    epic:     'OTH WOULD GO? // HUGE STOKE — SLOW CLEAN PERFECTION',
    good:     'OTH WOULD GO? // CONDITIONS FAVORABLE',
    marginal: 'OTH WOULD GO? // MARGINAL BUT WORTH IT',
    chunky:   'OTH WOULD GO? // GETTING CHUNKY — TIDE IT OUT',
    scary:    'OTH WOULD GO? // TOO MUCH POWER IN THE WATER',
    swim:     'OTH WOULD GO? // SWIM + EXERCISE DAY'
  };
  if (labelEl) labelEl.textContent = labels[verdict.cls] || 'OTH WOULD GO?';

  // Stoke meter
  if (stokeEl) {
    stokeEl.textContent = buildStokeMeter(verdict.score);
  }

  // Reasons + data source tag
  if (reasonEl) {
    const srcMap = { surfline: 'SURFLINE', stormglass: 'STORMGLASS', 'open-meteo': 'OPEN-METEO', 'surf-forecast': 'SURF-FORECAST.COM', buoy: 'NOAA BUOY (FALLBACK)' };
    const srcTag = verdict.source ? `<span class="reason-item reason-neutral">[ SRC: ${srcMap[verdict.source] || verdict.source} ]</span>` : '';
    reasonEl.innerHTML = (verdict.reasons
      ? verdict.reasons.map(r => `<span class="reason-item ${r.cls}">[ ${r.text} ]</span>`).join(' ')
      : '') + ' ' + srcTag;
  }

  // Parking indicator
  const parkEl = document.getElementById('parking-indicator');
  if (parkEl && verdict.parking) {
    parkEl.className = `reason-item ${verdict.parking.cls}`;
    parkEl.textContent = `[ ${verdict.parking.text} ]`;
  }

  // Best time to surf today
  const bestEl = document.getElementById('best-time-indicator');
  if (bestEl) {
    if (bestTime) {
      const dt = new Date(bestTime.entry.timestamp * 1000);
      const hr = dt.getHours();
      const timeLabel = `${hr % 12 || 12}${hr < 12 ? 'AM' : 'PM'}`;
      const waveMin = bestTime.entry.surf ? bestTime.entry.surf.min : 0;
      const waveMax = bestTime.entry.surf ? bestTime.entry.surf.max : 0;
      const waveStr = waveMin === waveMax ? `${waveMin}FT` : `${waveMin}-${waveMax}FT`;
      const windSpeed = bestTime.verdictInput.wind.speed;
      const windDir   = bestTime.verdictInput.wind.direction;
      const windType  = bestTime.verdictInput.wind.type;
      const isGlassy  = windSpeed < 3;
      const isOffshore = windType === 'Offshore' || ['N','NNE','NE','ENE'].includes(windDir);
      const windDesc  = isGlassy ? 'GLASSY' : isOffshore ? `${windDir} OFFSHORE` : `${windDir} ${Math.round(windSpeed)}KT`;
      const tideH     = bestTime.tideEntry ? `${bestTime.tideEntry.height.toFixed(1)}FT TIDE` : null;
      let desc = `${waveStr} // ${windDesc}`;
      if (tideH) desc += ` // ${tideH}`;
      bestEl.innerHTML = `<span class="reason-item reason-good">[ BEST TIME TODAY: ${timeLabel} — ${desc} ]</span>`;
    } else {
      bestEl.textContent = '';
    }
  }
}

/**
 * Build an ASCII stoke meter: [████████░░░░░░░░░░░░] 62%
 */
function buildStokeMeter(score) {
  const total  = 20;
  const filled = Math.round((score / 100) * total);
  const empty  = total - filled;
  const bar    = '█'.repeat(filled) + '░'.repeat(empty);
  return `[ ${bar} ] ${score}%`;
}


// ─── Render: Forecast Table ───────────────────────────────────────────────────
function renderForecastTable(intervals, tides, conditions) {
  const wrap = document.getElementById('forecast-table-wrap');
  if (!wrap) return;

  if (!intervals || intervals.length === 0) {
    wrap.innerHTML = buildErrorBox('NO FORECAST DATA AVAILABLE');
    return;
  }

  // Build one row per interval, grouped visually by day
  const rows = [];
  let lastDay = '';

  intervals.forEach(entry => {
    const dt       = new Date(entry.timestamp * 1000);
    const dayStr   = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }).toUpperCase();
    const hr = dt.getHours();
    const timeStr  = `${hr % 12 || 12}${hr < 12 ? 'AM' : 'PM'}`;
    const isToday  = dt.toDateString() === new Date().toDateString();
    const isNow    = Math.abs(dt - new Date()) < 3 * 60 * 60 * 1000; // within 3h

    const waveMin  = entry.surf ? entry.surf.min : 0;
    const waveMax  = entry.surf ? entry.surf.max : 0;
    const waveStr  = formatWaveHeight(waveMin, waveMax);

    // Dominant swell period
    let period = 0;
    let swellDir = '---';
    if (entry.swells && entry.swells.length > 0) {
      const dom = entry.swells.reduce((a, b) => a.height >= b.height ? a : b);
      period   = dom.period || 0;
      swellDir = degToCompass(dom.direction);
    }
    const periodStr = period > 0 ? `${period}s` : '---';

    // Wind
    const windSpeed = entry.wind ? entry.wind.speed         : null;
    const windDeg   = entry.wind ? entry.wind.direction     : null;
    const windDir   = degToCompass(windDeg);
    const windStr   = windSpeed !== null ? `${windDir} ${Math.round(windSpeed)}kt` : '---';

    // Tide (from entry or closest match in tides array)
    const tideEntry  = entry.tide || (tides && tides.length
      ? tides.reduce((best, curr) =>
          Math.abs(curr.timestamp - entry.timestamp) < Math.abs(best.timestamp - entry.timestamp)
            ? curr : best)
      : null);
    const tideHeight = tideEntry ? tideEntry.height : null;
    const tideStr    = tideHeight !== null ? `${tideHeight.toFixed(1)}ft` : '----';

    // Star rating: derive from wave + period for display
    const stars = computeStarRating(waveMin, waveMax, period, windSpeed,
      entry.wind ? entry.wind.directionType : '');

    // Colour coding tuned for JL: 2-4ft = sweet spot
    const waveMidRow = (waveMin + waveMax) / 2;
    let waveCls = 'tbl-data';
    if (waveMax < 0.5)                      waveCls = 'tbl-swim';   // flat = swim
    else if (waveMidRow >= 1.5 && waveMidRow <= 4.0) waveCls = 'tbl-good';   // ideal
    else if (waveMidRow > 4.0 && waveMidRow <= 5.5)  waveCls = 'tbl-amber';  // chunky
    else if (waveMidRow > 5.5)                        waveCls = 'tbl-poor';   // scary

    // Day separator
    if (dayStr !== lastDay) {
      lastDay = dayStr;
      rows.push({ type: 'separator', day: dayStr, isToday });
    }

    // Parking lot indicator from Surfline conditions
    const condEntry = conditions && conditions.find(c =>
      new Date(c.timestamp * 1000).toDateString() === dt.toDateString()
    );
    const condSlot  = condEntry ? (hr < 12 ? condEntry.am : condEntry.pm) : null;
    const condRel   = condSlot ? (condSlot.humanRelation || '').toUpperCase() : '';
    const condRating = condSlot ? (condSlot.rating || 0) : 0;
    let parkStr, parkCls;
    if (!condSlot) {
      // No Surfline conditions — fall back to wave height
      const waveMidRow = (waveMin + waveMax) / 2;
      if (waveMidRow <= 2.0) {
        parkStr = 'QUIET LOT'; parkCls = 'tbl-good';
      } else {
        parkStr = 'LOT FULL!'; parkCls = 'tbl-poor';
      }
    } else if (condRating >= 4 || /GOOD|EXCELLENT|EPIC|GREAT/.test(condRel)) {
      parkStr = 'PACKED'; parkCls = 'tbl-poor';    // red = bad news for parking
    } else if (/FAIR TO GOOD|FAIR/.test(condRel) || condRating >= 2.5) {
      parkStr = 'BUSY'; parkCls = 'tbl-amber';
    } else {
      parkStr = "FRANK'S?"; parkCls = 'tbl-good';  // green = parking available
    }

    rows.push({
      type: 'data',
      dayStr, timeStr, waveStr, periodStr, windStr, tideStr, stars, waveCls,
      parkStr, parkCls,
      isNow
    });
  });

  // Build ASCII table string
  const COL_DATE   = 11;
  const COL_TIME   = 6;
  const COL_WAVES  = 13;  // "10.5-13.5 FT" = 12 chars, needs ≥1 padding
  const COL_PERIOD = 8;
  const COL_WIND   = 12;
  const COL_TIDE   = 7;
  const COL_STARS  = 7;
  const COL_PARK   = 10;  // "FRANK'S?" = 8 chars

  function pad(s, len) {
    const str = String(s);
    return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
  }

  const totalW = COL_DATE + COL_TIME + COL_WAVES + COL_PERIOD + COL_WIND + COL_TIDE + COL_STARS + COL_PARK + 16;

  const TOP    = '╔' + '═'.repeat(totalW) + '╗';
  const HDR_SEP= '╠' + '═'.repeat(totalW) + '╣';
  const DAY_SEP= '╟' + '─'.repeat(totalW) + '╢';
  const BOT    = '╚' + '═'.repeat(totalW) + '╝';

  let html = `<pre class="forecast-table">`;
  html += `<span class="tbl-border">${escHtml(TOP)}\n</span>`;
  html += `<span class="tbl-header">║  ${pad('DATE',COL_DATE)}${pad('TIME',COL_TIME)}  ${pad('WAVES',COL_WAVES)}${pad('PERIOD',COL_PERIOD)}${pad('WIND',COL_WIND)}${pad('TIDE',COL_TIDE)}${pad('RATING',COL_STARS)}${pad('PARKING',COL_PARK)}  ║\n</span>`;
  html += `<span class="tbl-border">${escHtml(HDR_SEP)}\n</span>`;

  rows.forEach(row => {
    if (row.type === 'separator') {
      html += `<span class="tbl-border">${escHtml(DAY_SEP)}\n</span>`;
      const label = row.isToday ? `── ${row.day} (TODAY) ──` : `── ${row.day} ──`;
      html += `<span class="tbl-header">║  ${pad(label, totalW - 2)}║\n</span>`;
    } else {
      const cls    = row.isNow ? 'tbl-current' : '';
      const prefix = row.isNow ? '▶ ' : '  ';
      html += `<span class="tbl-border ${cls}">║</span>`;
      html += `<span class="tbl-data ${cls}">${prefix}${pad(row.timeStr, COL_DATE + COL_TIME)}`;
      html += `  </span><span class="${row.waveCls} ${cls}">${pad(row.waveStr, COL_WAVES)}</span>`;
      html += `<span class="tbl-data ${cls}">${pad(row.periodStr, COL_PERIOD)}`;
      html += `${pad(row.windStr, COL_WIND)}${pad(row.tideStr, COL_TIDE)}</span>`;
      html += `<span class="tbl-data ${cls}">${renderStars(row.stars)}  </span>`;
      html += `<span class="${row.parkCls} ${cls}">${pad(row.parkStr, COL_PARK)}  </span>`;
      html += `<span class="tbl-border ${cls}">║\n</span>`;
    }
  });

  html += `<span class="tbl-border">${escHtml(BOT)}\n</span>`;
  html += `</pre>`;

  wrap.innerHTML = html;
}

function computeStarRating(waveMin, waveMax, period, windSpeed, windType) {
  let stars = 2;
  const mid = (waveMin + waveMax) / 2;
  // JL sweet spot: 2-4ft slow and clean
  if (mid >= 2 && mid <= 4)       stars += 2;
  else if (mid >= 1 && mid < 2)   stars += 1;
  else if (mid > 4 && mid <= 5)   stars += 0.5;
  else if (mid > 5)               stars -= 1.5;  // too big
  else if (mid < 0.5)             stars -= 1;    // flat
  // Long slow period = better for longboarding
  if (period >= 14)                stars += 1;
  else if (period >= 11)           stars += 0.5;
  else if (period < 7)             stars -= 0.5;
  // Glassy/offshore = massive bonus
  if (!windSpeed || windSpeed < 3) stars += 1;   // glassy
  else if (windType === 'Offshore' && windSpeed < 10) stars += 0.5;
  else if (windType === 'Onshore' && windSpeed > 8) stars -= 1;
  return Math.max(0, Math.min(5, Math.round(stars * 2) / 2));
}

function renderStars(rating) {
  // 5-star scale in half-star increments, rendered with ★ and ☆
  const full  = Math.floor(rating);
  const half  = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    `<span class="star-filled">${'★'.repeat(full)}</span>` +
    (half ? `<span class="star-filled">½</span>` : '') +
    `<span class="star-empty">${'☆'.repeat(empty)}</span>`
  );
}

// ─── Render: Buoy Panel ───────────────────────────────────────────────────────
function renderBuoyPanel(buoyDataArr) {
  const wrap = document.getElementById('buoy-data-wrap');
  if (!wrap) return;

  const arr = Array.isArray(buoyDataArr) ? buoyDataArr : [buoyDataArr];
  if (!arr.length) {
    wrap.innerHTML = buildErrorBox('BUOY DATA UNAVAILABLE');
    return;
  }

  wrap.innerHTML = arr.map(buoyData => buildBuoyCard(buoyData)).join('');
}

function buildBuoyCard(buoyData) {
  if (!buoyData || buoyData.error) {
    return buildErrorBox(buoyData ? `BUOY ERROR: ${buoyData.error}` : 'BUOY DATA UNAVAILABLE');
  }

  const b = buoyData.latest;
  if (!b) return buildErrorBox(`NO READINGS: ${buoyData.name || buoyData.buoyId}`);

  const name      = (buoyData.name || `BUOY ${buoyData.buoyId}`).toUpperCase();
  const wvht      = b.waveHeightFt   !== null ? `${b.waveHeightFt} FT`            : 'N/A';
  const period    = b.dominantPeriod !== null ? `${b.dominantPeriod}s`             : 'N/A';
  const windSpeed = b.windSpeedKts   !== null ? `${b.windSpeedKts} KT`             : 'N/A';
  const windDir   = b.windDirection  || 'N/A';
  const waterTemp = b.waterTempF     !== null ? `${b.waterTempF}°F`               : 'N/A';
  const swellDir  = b.swellDirectionCompass   || 'N/A';
  const gust      = b.windGustKts    !== null ? `${b.windGustKts} KT`             : 'N/A';

  const updated = b.timestamp
    ? new Date(b.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' })
    : 'UNKNOWN';

  const W = 42; // inner content width
  function row(label, value) {
    const l = label.padEnd(12);
    const v = value.padEnd(W - 14);
    return `│ <span class="buoy-label">${escHtml(l)}</span><span class="buoy-value">${escHtml(v)}</span>│\n`;
  }
  const titlePad = '─'.repeat(Math.max(0, W - name.length - 1));

  let html = `<pre class="buoy-card">`;
  html += `<span class="buoy-border">┌─ </span><span class="buoy-title">${escHtml(name)}</span><span class="buoy-border"> ${titlePad}┐\n</span>`;
  html += row('WAVE HT:',    wvht);
  html += row('PERIOD:',     period);
  html += row('SWELL DIR:',  swellDir);
  html += row('WIND:',       `${windDir} ${windSpeed}`);
  html += row('GUSTS:',      gust);
  html += row('WATER TEMP:', waterTemp);
  html += row('UPDATED:',    updated);
  html += `<span class="buoy-border">└${'─'.repeat(W + 2)}┘\n</span>`;
  html += `</pre>`;
  return html;
}

// ─── Render: Error ────────────────────────────────────────────────────────────
function renderError(message) {
  const wrap = document.getElementById('forecast-table-wrap');
  if (wrap) {
    wrap.innerHTML = buildErrorBox(`DATA FEED ERROR: ${message}`);
  }

  const verdictBox = document.getElementById('verdict-box');
  if (verdictBox) {
    verdictBox.className = 'poor';
    const vt = document.getElementById('verdict-text');
    if (vt) vt.textContent = '[ ERROR: SURF DATA UNAVAILABLE ]';
  }
}

function buildErrorBox(msg) {
  const inner = msg.toUpperCase();
  const w     = Math.max(inner.length + 4, 48);
  return `<pre class="error-box"><span class="err-border">╔${'═'.repeat(w)}╗\n║  </span><span class="err-text">${escHtml(inner.padEnd(w - 2))}</span><span class="err-border">║\n╚${'═'.repeat(w)}╝</span></pre>`;
}

// ─── Render: Spot Selector ────────────────────────────────────────────────────
function renderSpotSelector() {
  const el = document.getElementById('spot-selector');
  if (!el) return;

  const html = Object.entries(SPOTS).map(([key, spot]) => {
    const active = key === state.currentSpot ? ' active' : '';
    return `<button class="spot-btn${active}" onclick="selectSpot('${key}')" data-spot="${key}">${escHtml(spot.name.toUpperCase())}</button>`;
  }).join('');

  el.innerHTML = html;
}

window.selectSpot = function(spotKey) {
  if (spotKey === state.currentSpot) return;
  state.currentSpot = spotKey;
  state.currentDay  = 0;

  // Update button states
  document.querySelectorAll('.spot-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.spot === spotKey);
  });

  // Update footer coords
  const spot = SPOTS[spotKey];
  if (spot) {
    const coordEl = document.getElementById('coord-line');
    if (coordEl) {
      const latDir = spot.lat >= 0 ? 'N' : 'S';
      const lonDir = spot.lon <= 0 ? 'W' : 'E';
      coordEl.textContent = `LAT: ${Math.abs(spot.lat).toFixed(4)}° ${latDir}  |  LON: ${Math.abs(spot.lon).toFixed(4)}° ${lonDir}  |  ${spot.name.toUpperCase()}, ${spot.region.toUpperCase()}, CA`;
    }
  }

  loadForecast(spotKey);
};

// ─── Render: Date Nav ─────────────────────────────────────────────────────────
function renderDateNav() {
  updateDayDisplay();
}

function updateDayDisplay() {
  const el = document.getElementById('day-display');
  if (!el) return;

  const MAX_DAYS = 4;
  const labels   = ['TODAY', 'TOMORROW', '+2 DAYS', '+3 DAYS', '+4 DAYS'];

  el.textContent = labels[state.currentDay] || `+${state.currentDay} DAYS`;

  const prev = document.getElementById('btn-prev');
  const next = document.getElementById('btn-next');
  if (prev) prev.disabled = state.currentDay <= 0;
  if (next) next.disabled = state.currentDay >= MAX_DAYS;
}

window.prevDay = function() {
  if (state.currentDay > 0) {
    state.currentDay--;
    if (state.forecastData) render();
  }
};

window.nextDay = function() {
  if (state.currentDay < 4) {
    state.currentDay++;
    if (state.forecastData) render();
  }
};

// ─── Loading State ────────────────────────────────────────────────────────────
function setLoading(bool) {
  state.loading = bool;

  const fill  = document.getElementById('loading-fill');
  const label = document.getElementById('loading-label');

  if (bool) {
    if (fill)  { fill.classList.add('loading-pulse'); fill.style.width = '0%'; }
    if (label) label.textContent = 'FETCHING...';
  } else {
    if (fill)  { fill.classList.remove('loading-pulse'); fill.style.width = '100%'; }
    if (label) label.textContent = 'READY';
    // Reset fill to 0 after a moment
    setTimeout(() => { if (fill) fill.style.width = '0%'; }, 1500);
  }
}

// ─── Timestamp ────────────────────────────────────────────────────────────────
function updateTimestamp() {
  const el = document.getElementById('last-updated');
  if (!el || !state.lastUpdated) return;

  const d = state.lastUpdated;
  el.textContent = d.toLocaleTimeString('en-US', {
    hour:     '2-digit',
    minute:   '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short'
  });
}

// ─── NES Canvas Animation ─────────────────────────────────────────────────────
//
// Pixel-art longboarder cruising in the pocket of a slow, clean wave.
// NES-style: 4px per logical pixel, flat colors, crisp edges, ~3fps sprite.
// Beach palette — colorblind friendly (no red/green reliance).

const NES = {
  PX:  4,    // logical pixel → screen pixel scale
  FPS: 1.5,  // sprite animation FPS (slow, lazy longboard feel)
};

// ── NES-style palette — beach blues + surfer colors ──────────────────────────
const C = {
  // Sky & distant water
  sky1:   '#a8d4ee',  // pale sky upper
  sky2:   '#c8e6f8',  // lighter sky near horizon
  horiz:  '#5a9ec8',  // horizon line
  far:    '#2e78b0',  // far ocean
  mid:    '#1e5a90',  // mid-distance water
  // Wave face
  wface:  '#1a6e60',  // transparent green-blue (classic clean face)
  deep:   '#0e2e50',  // deep trough
  // Foam & whitewater
  foam2:  '#eef8ff',  // bright white foam
  foam1:  '#b8daf2',  // light foam
  spray:  '#ddeeff',  // fine mist/spray
  ww:     '#4e80b0',  // whitewater base
  wwf:    '#88b8d8',  // whitewater foam
  // Surfer — bald guy with big gray beard
  bald:   '#c87848',  // sun-burned bald pate (darker, more distinct)
  skin:   '#e8b068',  // warm golden skin
  beard:  '#c8c8c4',  // gray beard — light so it reads clearly
  beardD: '#909090',  // beard shadow
  suit:   '#1e4880',  // wetsuit blue
  suitD:  '#142e58',  // dark wetsuit shadow
  board:  '#e8cc3a',  // yellow longboard
  boardD: '#b89820',  // board rail/shadow
  wax:    '#f0ead8',  // deck wax / feet
};

// ── Surfer sprite: 2 frames, 18×16 logical pixels ────────────────────────────
// Left-facing in canvas space → right-facing after horizontal mirror.
// Column 0 = nose end (screen right, direction of travel).
// Columns 0-6: body over the nose. Columns 0-17: long board.
// Big bald dome, massive gray beard, noserider stance.
const FRAMES = [
  // Frame 0 — arms out wide for balance on the nose
  [
    //0       1       2       3       4       5       6       7  …17
    [null,  null,  'bald','bald','bald','bald', null,  null,  null,null,null,null,null,null,null,null,null,null], // dome top
    ['bald','bald','bald','bald','bald','bald','bald', null,  null,null,null,null,null,null,null,null,null,null], // dome wide
    ['skin','skin','skin','skin','skin','skin','bald', null,  null,null,null,null,null,null,null,null,null,null], // face
    ['beard','beard','skin','skin','skin','suit',null, null,  null,null,null,null,null,null,null,null,null,null], // chin
    ['beard','beard','beard','beard','beard','suit','suit',null,null,null,null,null,null,null,null,null,null,null], // beard
    ['beard','beard','beard','beard','beard','beard','suit',null,null,null,null,null,null,null,null,null,null,null], // beard peak
    ['beard','beard','beard','beard','beard','beard',null,null,null,null,null,null,null,null,null,null,null,null], // widest
    [null,'beard','beard','beard','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null],   // beard base
    [null,'suit','suit','suit','suit','suit','suit', null,null,null,null,null,null,null,null,null,null,null],     // torso
    ['skin','suit','suit','suit','suit',null,'skin',null,null,null,null,null,null,null,null,null,null,null],      // arms wide
    [null, null,'suit','suit','suit', null, null,  null,null,null,null,null,null,null,null,null,null,null],       // lower body
    [null,'suitD','suit','suitD',null, null, null,  null,null,null,null,null,null,null,null,null,null,null],      // knees
    ['suitD','suit',null,'suit', null, null, null,  null,null,null,null,null,null,null,null,null,null,null],      // legs
    ['wax','wax',  null,'wax',  null, null, null,  null,null,null,null,null,null,null,null,null,null,null],       // feet at nose
    ['board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','boardD'], // longboard deck
    [null,'boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD',null], // board underside
  ],
  // Frame 1 — arms shift, lazy weight adjustment
  [
    [null,  null,  'bald','bald','bald','bald', null,  null,  null,null,null,null,null,null,null,null,null,null],
    ['bald','bald','bald','bald','bald','bald','bald', null,  null,null,null,null,null,null,null,null,null,null],
    ['skin','skin','skin','skin','skin','skin','bald', null,  null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','skin','skin','skin','suit',null, null,  null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','suit','suit',null,null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','beard','suit',null,null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','beard',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,'beard','beard','beard','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null],
    [null,'suit','suit','suit','suit','suit','suit', null,null,null,null,null,null,null,null,null,null,null],
    [null,'skin','suit','suit','suit','suit',null,'skin',null,null,null,null,null,null,null,null,null,null],       // arms shifted
    [null, null,'suit','suit','suit', null, null,  null,null,null,null,null,null,null,null,null,null,null],
    [null,'suitD','suit','suitD',null, null, null,  null,null,null,null,null,null,null,null,null,null,null],
    ['suitD','suit',null,'suit', null, null, null,  null,null,null,null,null,null,null,null,null,null,null],
    ['wax','wax',  null,'wax',  null, null, null,  null,null,null,null,null,null,null,null,null,null,null],
    ['board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','boardD'],
    [null,'boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD',null],
  ],
];

const SPRITE_W = 18;
const SPRITE_H = 16;

function drawSprite(ctx, frame, x, y) {
  const rows = FRAMES[frame % FRAMES.length];
  rows.forEach((row, ry) => {
    row.forEach((key, rx) => {
      if (!key || !C[key]) return;
      ctx.fillStyle = C[key];
      ctx.fillRect(
        Math.floor(x + rx * NES.PX),
        Math.floor(y + ry * NES.PX),
        NES.PX, NES.PX
      );
    });
  });
}

function drawScene(canvas, t) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const W  = canvas.width;
  const H  = canvas.height;
  const PX = NES.PX;
  const NW = Math.ceil(W / PX);
  const NH = Math.ceil(H / PX);

  // Foam animation scroll (~12s per full cycle)
  const scrollPx = (t * 0.000083) % 1;
  const scrollN  = Math.floor(scrollPx * NW);

  // ── Horizontal ride: surfer glides from left to right across canvas (25s) ──
  // In canvas space (flipped), surferNX decreases as surfer moves visually right.
  const rideDur     = 25000;
  const rideProgress = (t % rideDur) / rideDur;         // 0→1
  const surferNX    = Math.floor(NW * (0.78 - rideProgress * 0.44));
  // Visual position: starts ~22% from left, reaches ~66% from left, then resets.

  // Subtle bob — ±1 row only
  const bob      = Math.round(Math.sin(t * 0.0009) * 1);
  // Wave peak is BEHIND the surfer (negative dist = screen-left).
  // Surfer rides the right face — the downslope past the peak.
  const peakNY   = Math.floor(NH * 0.33);   // wave peak height
  const faceNY   = Math.floor(NH * 0.58);   // surfer's position on right face
  const wwNY     = Math.floor(NH * 0.66);   // settled whitewater level (left of peak)
  const flatNY   = NH - 4;
  const peakDist = -10;                      // peak is 10 cols behind surfer
  const wwBndry  = peakDist - 10;           // whitewater starts 10 cols left of peak
  const surferFaceY = faceNY + bob;

  // Wave surface height for any canvas column.
  // dist = surferNX - nx: positive = to surfer's right on screen (open shoulder),
  //                       negative = to surfer's left on screen (broken, behind).
  function waveSurface(nx) {
    const dist = surferNX - nx;
    if (dist < wwBndry) {
      // Far left: settled broken water, slopes to flat
      const beyond = Math.min(1, (wwBndry - dist) / 14);
      return Math.round(wwNY + (flatNY - wwNY) * beyond);
    } else if (dist < peakDist) {
      // Left of peak: wave face rising toward peak
      const frac = (dist - wwBndry) / (peakDist - wwBndry);
      return Math.round(wwNY - (wwNY - peakNY) * frac);
    } else if (dist < 0) {
      // Right face of peak down to surfer level (surfer on the right slope)
      const frac = (dist - peakDist) / (-peakDist);
      return Math.round(peakNY + (faceNY - peakNY) * frac);
    } else if (dist <= 3) {
      return faceNY;                         // at surfer
    } else if (dist <= 26) {
      // Open shoulder: gentle slope back to flat
      const frac = (dist - 3) / 23;
      return Math.round(faceNY + (flatNY - faceNY) * frac);
    } else {
      return flatNY;
    }
  }

  // ── Mirror entire scene: surfer faces right, wave breaks left (behind him) ──
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-W, 0);

  // ── Background ────────────────────────────────────────────────────────────
  // Fill ocean blue, then paint sky & horizon on top
  ctx.fillStyle = C.mid;
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < 5; y++) {
    ctx.fillStyle = y < 3 ? C.sky2 : C.sky1;
    ctx.fillRect(0, y * PX, W, PX);
  }
  ctx.fillStyle = C.horiz;
  ctx.fillRect(0, 5 * PX, W, PX);
  ctx.fillStyle = C.far;
  ctx.fillRect(0, 6 * PX, W, 3 * PX);

  // ── Wave columns ──────────────────────────────────────────────────────────
  for (let nx = 0; nx < NW; nx++) {
    const dist     = surferNX - nx;  // flipped to match waveSurface
    const crestNY  = waveSurface(nx);
    const x        = nx * PX;

    // Zone classification based on position relative to peak and surfer
    const isWhitewater = dist < wwBndry;                           // far left, settled
    const isLeftFace   = dist >= wwBndry && dist < peakDist;       // wave rising to peak
    const atPeak       = dist >= peakDist && dist < peakDist + 4;  // peak/breaking zone
    const isRightFace  = dist >= peakDist + 4 && dist <= 3;        // clean right face (surfer's side)
    const isShoulder   = dist > 3;                                 // open shoulder ahead

    // ── Lip foam at the peak (behind surfer, wave breaking there) ────────
    if (atPeak) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, crestNY * PX, PX, PX);
      ctx.fillStyle = C.foam1;
      ctx.fillRect(x, (crestNY + 1) * PX, PX, PX);
    }

    // ── Spray above the peak ──────────────────────────────────────────────
    if (atPeak && dist >= peakDist && dist < peakDist + 3) {
      for (let sy = 1; sy <= 3; sy++) {
        const n = ((nx * 5 + sy * 11 + Math.floor(scrollN * 3)) % 9);
        if (n < 4) {
          ctx.fillStyle = n < 2 ? C.foam2 : C.spray;
          ctx.fillRect(x, (crestNY - sy) * PX, PX, PX);
        }
      }
    }

    // ── Wave body from surface to bottom ──────────────────────────────────
    for (let ny = crestNY; ny < NH; ny++) {
      const depth = ny - crestNY;
      let col;
      if (isWhitewater) {
        // Settled — sparse flecks, mostly dark ocean
        const fn = ((nx * 7 + ny * 3 + Math.floor(scrollN * 4)) % 31);
        col = fn < 2 ? C.foam1 : fn < 5 ? C.ww : C.mid;
      } else if (atPeak || isLeftFace) {
        // Breaking / steep left face
        if (depth < 2)       col = C.foam1;
        else if (depth < 8)  col = C.wface;
        else if (depth < 14) col = C.mid;
        else                 col = C.deep;
      } else {
        // Clean right face / shoulder — surfer's side
        if (depth < 3)       col = C.wface;
        else if (depth < 10) col = C.mid;
        else                 col = C.deep;
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, ny * PX, PX, PX);
    }
  }

  // ── Surfer ────────────────────────────────────────────────────────────────
  // Anchor nose (col 0) 2 cols to the right of surferNX in canvas space;
  // after flip this puts the nose slightly ahead. Board tail extends left on screen.
  const spriteX   = surferNX * PX - 2 * PX;
  const spriteY   = surferFaceY * PX - SPRITE_H * PX;

  // Gentle sway — no dramatic tilt, just a slow lazy lean
  const wobble    = Math.sin(t * 0.0004) * 0.018;
  const tiltAngle = wobble;
  const pivotX = spriteX + (SPRITE_W * PX) / 2;
  const pivotY = spriteY + SPRITE_H * PX;

  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(tiltAngle);
  ctx.translate(-pivotX, -pivotY);
  const frame = Math.floor(t / (1000 / NES.FPS)) % FRAMES.length;
  drawSprite(ctx, frame, spriteX, spriteY);
  ctx.restore();  // sprite tilt

  ctx.restore();  // horizontal mirror
}

function startSurferAnimation() {
  const canvas = document.getElementById('surf-canvas');
  if (!canvas) return;

  // Size canvas to match its CSS-rendered dimensions
  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function loop(ts) {
    drawScene(canvas, ts);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ─── Format Helpers ───────────────────────────────────────────────────────────
function formatWaveHeight(min, max) {
  if (min === 0 && max === 0) return 'FLAT';
  if (min === max)             return `${min} FT`;
  return `${min}-${max} FT`;
}

function formatWind(speed, dir) {
  if (speed === null || speed === undefined) return 'N/A';
  return `${dir} ${Math.round(speed)}kts`;
}

function formatTimestamp(unix) {
  if (!unix) return '--:--';
  return new Date(unix * 1000).toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// ─── HTML Escaping ────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
