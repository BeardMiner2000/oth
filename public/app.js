'use strict';

/* ═══════════════════════════════════════════════════════════════════════════════
   JL WOULD GO — Frontend Application
   ═══════════════════════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  currentSpot:  'bolinas',
  currentDay:   0,         // 0 = today, 1 = tomorrow, ...
  forecastData: null,
  loading:      false,
  lastUpdated:  null
};

// ─── Spot Definitions (mirrors server) ───────────────────────────────────────
const SPOTS = {
  bolinas:      { id: '5842041f4e65fad6a77089c2', name: 'Bolinas', region: 'Marin', lat: 37.9051, lon: -122.6815 }
};
const PACIFIC_TZ = 'America/Los_Angeles';
const PACIFIC_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const PACIFIC_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  weekday: 'long'
});
const PACIFIC_DATE_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  weekday: 'long',
  month: 'long',
  day: 'numeric'
});
const PACIFIC_SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  month: 'short',
  day: 'numeric'
});
const PACIFIC_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  hour: 'numeric',
  minute: '2-digit'
});
const PACIFIC_HOUR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  hour: 'numeric',
  hourCycle: 'h23'
});
const PACIFIC_MINUTE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  minute: '2-digit'
});

function getPacificDateParts(date) {
  const parts = PACIFIC_DAY_FORMATTER.formatToParts(date);
  return {
    year: Number(parts.find(part => part.type === 'year').value),
    month: Number(parts.find(part => part.type === 'month').value),
    day: Number(parts.find(part => part.type === 'day').value)
  };
}

function shiftPacificDate(dayOffset) {
  const today = getPacificDateParts(new Date());
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0));
  target.setUTCDate(target.getUTCDate() + dayOffset);
  return target;
}

function getPacificDayKey(date) {
  return PACIFIC_DAY_FORMATTER.format(date);
}

function getPacificDayKeyFromTimestamp(timestamp) {
  return PACIFIC_DAY_FORMATTER.format(new Date(timestamp * 1000));
}

function getPacificHour(timestamp) {
  return Number(PACIFIC_HOUR_FORMATTER.format(new Date(timestamp * 1000)));
}

function getPacificMinute(timestamp) {
  return Number(PACIFIC_MINUTE_FORMATTER.format(new Date(timestamp * 1000)));
}

// ─── Wind direction helpers ───────────────────────────────────────────────────
const DIR_NAMES = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function degToCompass(deg) {
  if (deg === null || deg === undefined) return '---';
  if (typeof deg === 'string') return deg || '---'; // already a compass label
  if (isNaN(deg)) return '---';
  return DIR_NAMES[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function isBolinasSpot(spotKey = state.currentSpot) {
  return spotKey === 'bolinas';
}

function buildSurfRange(heightFt, minFactor, maxFactor) {
  if (!heightFt) {
    return { min: 0, max: 0 };
  }
  return {
    min: Math.max(0.5, Math.round((heightFt * minFactor) * 2) / 2),
    max: Math.max(1.0, Math.round((heightFt * maxFactor) * 2) / 2)
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
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
    const forecast = await fetch(`/api/forecast/${spotId}`).then(r => {
      if (!r.ok) throw new Error(`Forecast API returned ${r.status}`);
      return r.json();
    });

    state.forecastData = forecast;
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
  const stormglassNorm     = normalizeStormglassForTable(state.forecastData.stormglass || []);
  const useSurfline        = surflineData.length > 0;
  const useStormglass      = stormglassNorm.length > 0;

  // Surfline is the source of truth. Stormglass stays as backup if Surfline fails.
  let tableData, verdictSource;
  if (useSurfline) {
    tableData = surflineData;
    verdictSource = 'surfline';
  } else if (useStormglass) {
    tableData = stormglassNorm;
    verdictSource = 'stormglass';
  } else {
    tableData = [];
    verdictSource = 'none';
  }

  // Verdict uses the selected day's slice
  const dayData       = getDaySlice(tableData, state.currentDay);
  const verdictInput  = buildVerdictInput(
    dayData,
    verdictSource
  );
  const verdict = calculateVerdict(verdictInput);

  // Best time to surf today (only shown when viewing today)
  const todayIntervals = getDaySlice(tableData, 0);
  const bestTime = state.currentDay === 0
    ? findBestSurfTimeToday(todayIntervals, state.forecastData.tides)
    : null;

  renderVerdictPanel(verdict, bestTime);
  renderFridayFocus(tableData, state.forecastData.tides, verdictSource);
  renderTideChart(tableData, state.forecastData.tides);

  // 5-day summary
  renderForecastTable(tableData, state.forecastData.tides, state.forecastData.conditions);

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
      surf: isBolinasSpot()
        ? buildSurfRange(e.waveHeightFt, 0.85, 0.95)
        : buildSurfRange(e.waveHeightFt, 0.9, 1.0),
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
      surf: isBolinasSpot()
        ? buildSurfRange(e.waveHeightFt, 0.30, 0.40)
        : buildSurfRange(e.waveHeightFt, 0.9, 1.0),
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

  const targetDay = getPacificDayKey(shiftPacificDate(dayOffset));

  return intervals.filter(entry => {
    return getPacificDayKeyFromTimestamp(entry.timestamp) === targetDay;
  });
}

/**
 * Pick best single representative interval from a day slice.
 * Scores each interval with computeScore() and returns the highest-scoring one.
 * Restricted to daylight hours (6am–8pm) unless no daylight slot exists.
 */
function getBestInterval(daySlice) {
  if (!daySlice || daySlice.length === 0) return null;

  const daylight = daySlice.filter(e => {
    const h = getPacificHour(e.timestamp);
    return h >= 6 && h <= 20;
  });
  const candidates = daylight.length > 0 ? daylight : daySlice;

  let best = candidates[0];
  let bestScore = -1;
  candidates.forEach(entry => {
    const dominantSwell = (entry.swells || []).find(s => s.height > 0);
    const swellDir = entry.swells && entry.swells.length > 0
      ? degToCompass(entry.swells.reduce((a, b) => a.height >= b.height ? a : b).direction)
      : '';
    const input = {
      spotKey: state.currentSpot,
      wave: {
        min:      entry.surf ? entry.surf.min : 0,
        max:      entry.surf ? entry.surf.max : 0,
        period:   dominantSwell ? dominantSwell.period : 0,
        swellDir
      },
      wind: {
        speed:     entry.wind ? entry.wind.speed         : 0,
        direction: entry.wind ? degToCompass(entry.wind.direction) : '---',
        gust:      entry.wind ? entry.wind.gust          : 0,
        type:      entry.wind ? entry.wind.directionType : ''
      },
      tide: entry.tide || null
    };
    const { score } = computeScore(input);
    if (score > bestScore) { bestScore = score; best = entry; }
  });
  return best;
}

/**
 * Build a simplified object for the verdict algorithm.
 * sourceHint: 'surfline' | 'stormglass'
 */
function buildVerdictInput(daySlice, sourceHint = 'surfline') {
  const interval = getBestInterval(daySlice);
  if (!interval) {
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
    spotKey: state.currentSpot,
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
  } else if (waveMid >= 2.5 && waveMid <= 3.8) {
    // JL's ideal zone
    score += 35;
    reasons.push({ text: `${waveStr} PERFECT SIZE`, cls: 'reason-good' });
  } else if (waveMid > 3.8 && waveMid <= 5.0) {
    score -= 8;
    reasons.push({ text: `${waveStr} MAYBE TOO BIG`, cls: 'reason-warn' });
  } else if (waveMid > 5.0 && waveMid <= 6.0) {
    scary = true;
    score -= 20;
    reasons.push({ text: `${waveStr} WORTH A LOOK, MAYBE`, cls: 'reason-warn' });
  } else {
    scary = true;
    score -= 40;
    reasons.push({ text: `${waveStr} CHECK DORAN INSTEAD`, cls: 'reason-bad' });
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

  // ── Tide (Bolinas only; generic tide preferences are too spot-specific) ──────
  const tideHeight = data.tide ? data.tide.height : null;
  const tideType   = data.tide ? (data.tide.type || '') : '';

  if (data.spotKey === 'bolinas' && tideHeight !== null) {
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
    parking = { text: 'PATCH LOT: MOSTLY BEARDS + GOOD VIBES', cls: 'reason-good' };
  } else {
    parking = { text: 'PATCH LOT: SHORTBOARD CIRCUS POSSIBLE', cls: 'reason-bad' };
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
    const h = getPacificHour(entry.timestamp);
    if (h < 6 || h > 20) return; // daylight only

    // Attach closest tide if not already present
    const tideEntry = entry.tide || (tides && tides.length
      ? tides.reduce((b, c) => Math.abs(c.timestamp - entry.timestamp) < Math.abs(b.timestamp - entry.timestamp) ? c : b)
      : null);

    const swellDir = entry.swells && entry.swells.length > 0
      ? degToCompass(entry.swells.reduce((a, b) => a.height >= b.height ? a : b).direction)
      : null;

    const dominantSwell = (entry.swells || []).find(s => s.height > 0);
    const verdictInput = {
      spotKey: state.currentSpot,
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
    epic:     'OTH WOULD GO? // OLD GUY GLIDE ALERT',
    good:     'OTH WOULD GO? // YES, CALL THE CREW',
    marginal: 'OTH WOULD GO? // POKE YOUR HEAD OUT',
    chunky:   'OTH WOULD GO? // MAYBE, BUT KEEP EXPECTATIONS LOW',
    scary:    'OTH WOULD GO? // HARD PASS, MAYBE DORAN',
    swim:     'OTH WOULD GO? // COFFEE WALK, NOT A SURF'
  };
  if (labelEl) labelEl.textContent = labels[verdict.cls] || 'OTH WOULD GO?';

  // Stoke meter
  if (stokeEl) {
    stokeEl.textContent = buildStokeMeter(verdict.score);
  }

  // Reasons + data source tag
  if (reasonEl) {
    const srcMap = { surfline: 'SURFLINE', stormglass: 'STORMGLASS BACKUP' };
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
      const timeLabel = formatHourLabel(bestTime.entry.timestamp);
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
      bestEl.innerHTML = `<span class="reason-item reason-good">[ BEST GLIDE WINDOW: ${timeLabel} — ${desc} ]</span>`;
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

function renderFridayFocus(intervals, tides, source) {
  const wrap = document.getElementById('friday-focus-wrap');
  if (!wrap) return;

  const { date: friday, isCurrentFriday } = getUpcomingFridayDate();
  const fridaySlice = getDaySliceForDate(intervals, friday);
  if (!fridaySlice.length) {
    wrap.innerHTML = buildErrorBox('NO FRIDAY DAWN PATROL DATA AVAILABLE');
    return;
  }

  const dawnWindow = getSessionWindow(fridaySlice, 6, 9);
  const session = summarizeWindow(dawnWindow.length ? dawnWindow : fridaySlice, tides, source);
  const verdict = calculateVerdict(buildVerdictInput(dawnWindow.length ? dawnWindow : fridaySlice, source));
  const patchCall = buildPatchChannelCall(session);
  const fridayLabel = PACIFIC_DATE_LABEL_FORMATTER.format(friday).toUpperCase();
  const tideRange = session.minTide !== null && session.maxTide !== null
    ? `${session.minTide.toFixed(1)}-${session.maxTide.toFixed(1)} FT`
    : 'NO TIDE';
  const fridayKicker = isCurrentFriday ? 'THIS FRIDAY' : 'NEXT FRIDAY';

  wrap.innerHTML = `
    <div class="focus-card">
      <div class="focus-kicker">${escHtml(fridayKicker)} // ${escHtml(fridayLabel)}</div>
      <div class="focus-headline ${verdict.cls}">${escHtml(buildFridayHeadline(verdict, session))}</div>
      <div class="focus-copy">${escHtml(buildFridayCopy(session, verdict))}</div>
      <div class="focus-grid">
        <div class="focus-stat">
          <div class="focus-stat-label">DAWN WINDOW</div>
          <div class="focus-stat-value">${escHtml(session.windowLabel)}</div>
        </div>
        <div class="focus-stat">
          <div class="focus-stat-label">STOKE METER</div>
          <div class="focus-stat-value">${escHtml(`${verdict.score}%`)}</div>
        </div>
        <div class="focus-stat">
          <div class="focus-stat-label">SURF</div>
          <div class="focus-stat-value">${escHtml(session.waveLabel)}</div>
        </div>
        <div class="focus-stat">
          <div class="focus-stat-label">TIDE RANGE</div>
          <div class="focus-stat-value">${escHtml(tideRange)}</div>
        </div>
      </div>
      <div class="focus-reasons">${session.reasons.map(r => `<span class="reason-pill ${r.cls}">${escHtml(r.text)}</span>`).join(' ')}</div>
    </div>
    <div class="call-card">
      <div class="call-kicker">PATCH OR CHANNEL // JL THINKS...</div>
      <div class="call-direction ${patchCall.cls}">${escHtml(patchCall.headline)}</div>
      <div class="call-copy">${escHtml(patchCall.copy)}</div>
      <div class="call-reasons">${patchCall.reasons.map(reason => `<div class="reason-line"><strong>•</strong> ${escHtml(reason)}</div>`).join('')}</div>
    </div>
  `;
}

function renderTideChart(intervals, tides) {
  const wrap = document.getElementById('tide-chart-wrap');
  if (!wrap) return;

  const targetDate = getDateForOffset(state.currentDay);
  const dayTides = getDaySliceForDate(tides || [], targetDate);
  if (!dayTides.length) {
    wrap.innerHTML = buildErrorBox('NO TIDE DATA AVAILABLE FOR THIS DAY');
    return;
  }

  const width = 760;
  const height = 220;
  const padX = 34;
  const padY = 24;
  const minHeight = Math.min(...dayTides.map(t => t.height));
  const maxHeight = Math.max(...dayTides.map(t => t.height));
  const axisMin = Math.floor(minHeight - 0.5);
  const axisMax = Math.ceil(maxHeight + 0.5);
  const range = Math.max(1, axisMax - axisMin);
  const points = dayTides.map((entry, index) => {
    const x = padX + ((width - padX * 2) * index / Math.max(1, dayTides.length - 1));
    const y = height - padY - (((entry.height - axisMin) / range) * (height - padY * 2));
    return { ...entry, x, y };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const highlights = points.filter(point => point.type === 'HIGH' || point.type === 'LOW');
  const yTicks = [];
  for (let heightMark = axisMin; heightMark <= axisMax; heightMark += 1) {
    const y = height - padY - (((heightMark - axisMin) / range) * (height - padY * 2));
    yTicks.push({ value: heightMark, y });
  }
  const tideEvents = dayTides.filter(point => point.type === 'HIGH' || point.type === 'LOW');
  const hourTicks = points.filter((point, index) => {
    const hour = getPacificHour(point.timestamp);
    const minute = getPacificMinute(point.timestamp);
    if (index === 0 || index === points.length - 1) return true;
    return minute === 0 && hour % 2 === 0;
  });
  const label = PACIFIC_DATE_LABEL_FORMATTER.format(targetDate).toUpperCase();

  wrap.innerHTML = `
    <div class="tide-chart-card">
      <div class="tide-chart-title">TIDE CURVE // ${escHtml(label)}</div>
      <div class="tide-chart-meta">SURFLINE PRIMARY, NOAA BACKUP. LOW TIDE PATCH WINDOW, HIGH TIDE CHANNEL WINDOW.</div>
      <svg class="tide-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tide chart for selected day">
        ${yTicks.map(tick => `
          <line class="tide-grid tide-grid-h" x1="${padX}" y1="${tick.y}" x2="${width - padX}" y2="${tick.y}" />
          <text class="tide-label tide-height-label" x="${padX - 8}" y="${tick.y + 4}">${escHtml(`${tick.value}FT`)}</text>
        `).join('')}
        ${hourTicks.map(point => `
          <line class="tide-grid tide-grid-v" x1="${point.x}" y1="${padY}" x2="${point.x}" y2="${height - padY}" />
          <line class="tide-axis" x1="${point.x}" y1="${height - padY}" x2="${point.x}" y2="${height - padY + 6}" />
        `).join('')}
        <line class="tide-grid tide-axis-line" x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" />
        <line class="tide-grid tide-axis-line" x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" />
        <path class="tide-line" d="${path}" />
        ${points.map(point => `<circle class="tide-dot" cx="${point.x}" cy="${point.y}" r="1.8" />`).join('')}
        ${highlights.map(point => `
          <circle class="tide-point" cx="${point.x}" cy="${point.y}" r="3.5" />
          <text class="tide-highlight" x="${point.x + 6}" y="${point.y - 10}">${escHtml(`${point.type} ${point.height.toFixed(1)}FT`)}</text>
          <text class="tide-highlight tide-highlight-time" x="${point.x + 6}" y="${point.y + 4}">${escHtml(formatTimestamp(point.timestamp))}</text>
        `).join('')}
        ${hourTicks.map(point => `<text class="tide-label tide-time-label" x="${point.x}" y="${height - 6}">${escHtml(formatHourShort(point.timestamp))}</text>`).join('')}
      </svg>
      <div class="tide-events">
        ${tideEvents.map(point => `<span class="tide-event ${point.type === 'LOW' ? 'low' : 'high'}">${escHtml(`${point.type} ${formatTimestamp(point.timestamp)} ${point.height.toFixed(1)}FT`)}</span>`).join('')}
      </div>
    </div>
  `;
}

function getDateForOffset(dayOffset) {
  return shiftPacificDate(dayOffset);
}

function getUpcomingFridayDate() {
  const today = shiftPacificDate(0);
  const friday = new Date(today);
  const diff = (5 - today.getUTCDay() + 7) % 7;
  friday.setUTCDate(today.getUTCDate() + diff);
  return {
    date: friday,
    isCurrentFriday: diff === 0
  };
}

function getDaySliceForDate(intervals, date) {
  const targetDay = getPacificDayKey(date);
  return (intervals || []).filter(entry => getPacificDayKeyFromTimestamp(entry.timestamp) === targetDay);
}

function getSessionWindow(daySlice, startHour, endHour) {
  return (daySlice || []).filter(entry => {
    const hour = getPacificHour(entry.timestamp);
    return hour >= startHour && hour <= endHour;
  });
}

function summarizeWindow(entries, tides, source = 'surfline') {
  const safeEntries = entries || [];
  const first = safeEntries[0] || null;
  const last = safeEntries[safeEntries.length - 1] || first;
  const waveMids = safeEntries.map(entry => ((entry.surf?.min || 0) + (entry.surf?.max || 0)) / 2);
  const avgWave = waveMids.length ? waveMids.reduce((a, b) => a + b, 0) / waveMids.length : 0;
  const avgPeriod = average(safeEntries.map(entry => dominantSwell(entry)?.period || 0));
  const avgPower = average(safeEntries.map(entry => entry.power || 0));
  const avgWind = average(safeEntries.map(entry => entry.wind?.speed || 0));
  const tidePoints = safeEntries
    .map(entry => entry.tide || closestByTimestamp(tides, entry.timestamp))
    .filter(Boolean);
  const tideHeights = tidePoints.map(point => point.height);
  const minTide = tideHeights.length ? Math.min(...tideHeights) : null;
  const maxTide = tideHeights.length ? Math.max(...tideHeights) : null;
  const tideDelta = minTide !== null && maxTide !== null ? maxTide - minTide : 0;
  const tideAverage = average(tideHeights);
  const windowStart = first ? formatHourLabel(first.timestamp) : '--';
  const windowEnd = last ? formatHourLabel(last.timestamp) : '--';
  const best = getBestInterval(safeEntries);
  const verdict = calculateVerdict(buildVerdictInput(safeEntries, source));
  const reasons = [];

  if (avgWave >= 1.5 && avgWave <= 3.8) reasons.push({ text: 'LONGBOARD GLIDE SIZE', cls: 'reason-good' });
  else if (avgWave > 5) reasons.push({ text: 'GETTING PRETTY CHUNKY', cls: 'reason-warn' });
  else reasons.push({ text: 'SMALL BUT MAYBE CRUISEY', cls: 'reason-neutral' });

  if (avgWind < 4) reasons.push({ text: 'LIGHT WIND', cls: 'reason-good' });
  else if (avgWind > 10) reasons.push({ text: 'WINDY ENOUGH TO ANNOY OLD MEN', cls: 'reason-bad' });

  if (tideAverage !== null && tideAverage <= 1.2) reasons.push({ text: 'PATCH TIDE WINDOW', cls: 'reason-good' });
  else if (tideAverage !== null && tideAverage >= 3) reasons.push({ text: 'CHANNEL TIDE WINDOW', cls: 'reason-neutral' });

  return {
    entries: safeEntries,
    first,
    last,
    avgWave,
    avgPeriod,
    avgPower,
    avgWind,
    minTide,
    maxTide,
    tideAverage,
    tideDelta,
    best,
    verdict,
    reasons,
    waveLabel: safeEntries.length ? formatWaveHeightRange(safeEntries) : 'NO SURF DATA',
    windowLabel: `${windowStart}-${windowEnd}`,
    bestLabel: best ? `${formatHourLabel(best.timestamp)} // ${formatWaveHeight(best.surf.min, best.surf.max)}` : 'NO CLEAN WINDOW'
  };
}

function buildPatchChannelCall(session) {
  const reasons = [];
  const avgTide = session.tideAverage;
  const tideDelta = session.tideDelta;
  const avgPower = session.avgPower || 0;
  const avgWave = session.avgWave || 0;
  let headline;
  let cls;
  let copy;

  if (avgTide !== null && avgTide <= 1.2 && avgPower >= 45 && avgWave <= 4.5) {
    headline = 'LEAN RIGHT // THE PATCH';
    cls = 'patch';
    copy = 'JL thinks the Patch should have enough push without making everybody sprint before breakfast.';
    reasons.push('Lower tide usually opens up the Patch better than the Channel.');
  } else if (avgTide !== null && avgTide >= 2.8) {
    headline = tideDelta >= 1.8 ? 'LEAN LEFT // CHANNEL, BUT RIPPY' : 'LEAN LEFT // CHANNEL';
    cls = 'channel';
    copy = tideDelta >= 1.8
      ? 'JL thinks the Channel fits the tide, but somebody is going to complain about the flush.'
      : 'JL thinks the higher tide points the crew left toward the Channel.';
    reasons.push('Higher tide generally makes the Channel the safer bet.');
  } else {
    headline = 'COIN FLIP // PEEK BOTH SIDES';
    cls = 'split';
    copy = 'JL thinks this is a boat-launch decision day: squint, sip coffee, and see which side looks less dumb.';
    reasons.push('Mid tide can leave both options kinda in play.');
  }

  if (avgPower < 40) reasons.push('There may not be enough push for a dreamy Patch slide.');
  else if (avgPower > 140) reasons.push('There is enough water moving around to keep everybody honest.');

  if (tideDelta >= 1.8) reasons.push('Big tide swing means the Channel can feel like a lazy-river punishment session.');
  if ((session.avgWind || 0) < 4) reasons.push('Light wind helps either call look more civilized.');
  if ((session.avgWave || 0) > 5) reasons.push('If it feels like a shortboard convention, nobody wins.');

  return { headline, cls, copy, reasons };
}

function buildFridayHeadline(verdict, session) {
  if (verdict.cls === 'epic') return 'FRIDAY LOOKS LIKE A PROPER BEARD PATROL';
  if (verdict.cls === 'good') return 'FRIDAY LOOKS WORTH THE EARLY ALARM';
  if (verdict.cls === 'marginal') return 'FRIDAY IS A CHECK THE CAM, POUR COFFEE TYPE';
  if (verdict.cls === 'chunky') return 'FRIDAY MIGHT BE A LITTLE TOO SPICY';
  if (verdict.cls === 'scary') return 'FRIDAY LOOKS LIKE A SHORTBOARD PROBLEM';
  return 'FRIDAY LOOKS MORE LIKE A SHORE HANG';
}

function buildFridayCopy(session, verdict) {
  const surf = session.waveLabel.toLowerCase();
  if (verdict.cls === 'scary') return `Dawn patrol is showing ${surf}, and JL is already muttering about protected bays.`;
  if (verdict.cls === 'chunky') return `Dawn patrol is showing ${surf}. Maybe worth a squint, but keep the heroics in the truck.`;
  return `Dawn patrol is showing ${surf}. This is the read for the 7-9AM old-guy glide window.`;
}

function buildForecastCard(date, offset, session, patchCall) {
  const label = offset === 0
    ? 'TODAY'
    : PACIFIC_WEEKDAY_FORMATTER.format(date).toUpperCase();
  const verdict = session.verdict;
  return `
    <article class="forecast-card ${verdict.cls}">
      <div class="forecast-card-title">
        <span>${escHtml(label)}</span>
        <span class="forecast-card-score">${escHtml(`${verdict.score}%`)}</span>
      </div>
      <div class="forecast-meta">${escHtml(PACIFIC_SHORT_DATE_FORMATTER.format(date).toUpperCase())}</div>
      <div class="forecast-card-copy">${escHtml(buildCardCopy(session, verdict))}</div>
      <div class="forecast-card-grid">
        <div class="mini">
          <div class="mini-label">DAWN</div>
          <div class="mini-value">${escHtml(session.waveLabel)}</div>
        </div>
        <div class="mini">
          <div class="mini-label">PATCH/CALL</div>
          <div class="mini-value">${escHtml(shortPatchLabel(patchCall.headline))}</div>
        </div>
        <div class="mini">
          <div class="mini-label">BEST SLOT</div>
          <div class="mini-value">${escHtml(session.bestLabel)}</div>
        </div>
        <div class="mini">
          <div class="mini-label">TIDE</div>
          <div class="mini-value">${escHtml(session.minTide !== null && session.maxTide !== null ? `${session.minTide.toFixed(1)}-${session.maxTide.toFixed(1)} FT` : 'N/A')}</div>
        </div>
      </div>
      ${session.reasons.slice(0, 2).map(r => `<div class="reason-line">${escHtml(r.text)}</div>`).join('')}
    </article>
  `;
}

function buildCardCopy(session, verdict) {
  if (verdict.cls === 'epic') return 'Longboarders should stop texting and start waxing.';
  if (verdict.cls === 'good') return 'Looks surfable without unnecessary drama.';
  if (verdict.cls === 'marginal') return 'Could still be a very decent hang.';
  if (verdict.cls === 'chunky') return 'Maybe check it, maybe protect your back.';
  if (verdict.cls === 'scary') return 'Probably not the move unless somebody got younger overnight.';
  return 'Might be more coffee than surf.';
}

function shortPatchLabel(headline) {
  if (headline.includes('PATCH')) return 'PATCH';
  if (headline.includes('CHANNEL')) return 'CHANNEL';
  return 'PEEK BOTH';
}

function dominantSwell(entry) {
  return entry && entry.swells && entry.swells.length
    ? entry.swells.reduce((a, b) => a.height >= b.height ? a : b)
    : null;
}

function formatWaveHeightRange(entries) {
  const mins = entries.map(entry => entry.surf?.min || 0);
  const maxes = entries.map(entry => entry.surf?.max || 0);
  return formatWaveHeight(Math.min(...mins), Math.max(...maxes));
}

function formatHourLabel(timestamp) {
  const parts = PACIFIC_TIME_FORMATTER.formatToParts(new Date(timestamp * 1000));
  const hour = parts.find(part => part.type === 'hour').value;
  const dayPeriod = parts.find(part => part.type === 'dayPeriod').value;
  return `${hour}${dayPeriod.toUpperCase()}`;
}

function formatHourShort(timestamp) {
  const parts = PACIFIC_TIME_FORMATTER.formatToParts(new Date(timestamp * 1000));
  const hour = parts.find(part => part.type === 'hour').value;
  const dayPeriod = parts.find(part => part.type === 'dayPeriod').value;
  return `${hour}${dayPeriod[0].toUpperCase()}`;
}

function closestByTimestamp(entries, timestamp) {
  if (!entries || !entries.length) return null;
  return entries.reduce((best, current) =>
    Math.abs(current.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? current : best
  );
}

function average(values) {
  const nums = (values || []).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}


// ─── Render: 5-Day Forecast Cards ─────────────────────────────────────────────
function renderForecastTable(intervals, tides) {
  const wrap = document.getElementById('forecast-cards-wrap');
  if (!wrap) return;

  if (!intervals || intervals.length === 0) {
    wrap.innerHTML = buildErrorBox('NO FORECAST DATA AVAILABLE');
    return;
  }

  const cards = [];
  for (let offset = 0; offset <= 4; offset++) {
    const daySlice = getDaySlice(intervals, offset);
    if (!daySlice.length) continue;
    const targetDate = getDateForOffset(offset);
    const dawn = getSessionWindow(daySlice, 6, 9);
    const session = summarizeWindow(dawn.length ? dawn : daySlice, tides, intervals[0]?.power !== undefined ? 'surfline' : 'stormglass');
    const patchCall = buildPatchChannelCall(session);
    cards.push(buildForecastCard(targetDate, offset, session, patchCall));
  }

  wrap.innerHTML = cards.join('');
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
  const wrap = document.getElementById('forecast-cards-wrap');
  if (wrap) {
    wrap.innerHTML = buildErrorBox(`DATA FEED ERROR: ${message}`);
  }

  const friday = document.getElementById('friday-focus-wrap');
  if (friday) {
    friday.innerHTML = buildErrorBox(`FRIDAY CHECK FAILED: ${message}`);
  }

  const tide = document.getElementById('tide-chart-wrap');
  if (tide) {
    tide.innerHTML = buildErrorBox(`TIDE CURVE OFFLINE: ${message}`);
  }

  const verdictBox = document.getElementById('verdict-box');
  if (verdictBox) {
    verdictBox.className = 'scary';
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
  const targetDate = shiftPacificDate(state.currentDay);

  el.textContent = state.currentDay === 0
    ? 'TODAY'
    : PACIFIC_WEEKDAY_FORMATTER.format(targetDate).toUpperCase();

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
// Pixel-art longboarder cruising on a slow shoulder.
// Slightly finer than the original pass, still retro and intentionally chunky.

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
  beard:  '#d9d9d4',  // gray beard — light so it reads clearly
  beardD: '#8c8c88',  // beard shadow
  suit:   '#1e4880',  // wetsuit blue
  suitD:  '#142e58',  // dark wetsuit shadow
  board:  '#e8cc3a',  // yellow longboard
  boardD: '#b89820',  // board rail/shadow
  wax:    '#f0ead8',  // deck wax / feet
};

// ── Surfer sprite: 2 frames, 20×18 logical pixels ────────────────────────────
// Left-facing in canvas space → right-facing after horizontal mirror.
// Big bald dome, huge gray beard, lazy noserider stance on a long yellow board.
const FRAMES = [
  [
    [null,null,null,'bald','bald','bald','bald','bald',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'bald','bald','bald','bald','bald','bald','bald',null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'bald','bald','bald','skin','skin','skin','bald',null,null,null,null,null,null,null,null,null,null,null],
    [null,'skin','skin','skin','skin','skin','skin','skin','skin',null,null,null,null,null,null,null,null,null,null,null],
    [null,'beardD','beard','beard','skin','skin','skin','skin','suit',null,null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','beard','beard','suit','suit','skin',null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','beard','beard','beard','suit','suit','skin',null,null,null,null,null,null,null,null,null],
    [null,'beard','beard','beard','beard','beard','beard','beard','suit','suit',null,null,null,null,null,null,null,null,null,null],
    [null,null,'beard','beard','beard','beard','suit','suit','suit','suit',null,null,null,null,null,null,null,null,null,null],
    ['skin',null,'suit','suit','suit','suit','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'suit','suit','suit','suit','suit','suit','suit','skin',null,null,null,null,null,null,null,null,null,null],
    [null,'skin','suit','suit','suit','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'suitD','suit','suit','suitD','suit','suit',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,'suitD','suit',null,'suit','suit',null,'suit','suitD',null,null,null,null,null,null,null,null,null,null,null],
    ['wax','wax',null,null,'wax','wax',null,null,null,null,null,null,null,null,null,null,null,null,null,null],
    ['board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','boardD'],
    [null,'boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD',null],
    [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]
  ],
  [
    [null,null,null,'bald','bald','bald','bald','bald',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'bald','bald','bald','bald','bald','bald','bald',null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'bald','bald','bald','skin','skin','skin','bald',null,null,null,null,null,null,null,null,null,null,null],
    [null,'skin','skin','skin','skin','skin','skin','skin','skin',null,null,null,null,null,null,null,null,null,null,null],
    [null,'beardD','beard','beard','skin','skin','skin','skin','suit',null,null,null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','beard','beard','suit','suit',null,'skin',null,null,null,null,null,null,null,null,null],
    ['beard','beard','beard','beard','beard','beard','beard','beard','suit','suit',null,'skin',null,null,null,null,null,null,null,null],
    [null,'beard','beard','beard','beard','beard','beard','beard','suit','suit',null,null,null,null,null,null,null,null,null,null],
    [null,null,'beard','beard','beard','beard','suit','suit','suit','suit',null,null,null,null,null,null,null,null,null,null],
    [null,'skin','suit','suit','suit','suit','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null],
    [null,null,'suit','suit','suit','suit','suit','suit','suit','skin',null,null,null,null,null,null,null,null,null,null],
    [null,null,'skin','suit','suit','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,'suitD','suit','suit','suitD','suit','suit','suit',null,null,null,null,null,null,null,null,null,null,null,null],
    [null,'suitD','suit',null,'suit','suit',null,'suit','suitD',null,null,null,null,null,null,null,null,null,null,null],
    ['wax','wax',null,null,'wax','wax',null,null,null,null,null,null,null,null,null,null,null,null,null,null],
    ['board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','board','boardD'],
    [null,'boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD',null],
    [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]
  ],
];

const SPRITE_W = 20;
const SPRITE_H = 18;

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

  const scrollPx = (t * 0.00009) % 1;
  const scrollN  = Math.floor(scrollPx * NW);

  // A slow glide across a small peeling shoulder.
  const rideDur = 26000;
  const rideProgress = (t % rideDur) / rideDur;
  const surferNX = Math.floor(NW * (0.78 - rideProgress * 0.42));
  const bob = Math.round(Math.sin(t * 0.001) * 1);
  const horizonNY = Math.floor(NH * 0.27);
  const flatNY = NH - 4;
  const shoulderBase = Math.floor(NH * 0.59);
  const lipTop = Math.floor(NH * 0.42);
  const foamBase = Math.floor(NH * 0.57);
  const whitewaterFloor = Math.floor(NH * 0.67);
  const pocketDist = -6;
  const foamStartDist = pocketDist - 12;
  const shoulderRun = 54;
  const surferFaceY = shoulderBase + bob - 1;

  function waveSurface(nx) {
    const dist = surferNX - nx;
    if (dist < foamStartDist) {
      const frac = Math.min(1, (foamStartDist - dist) / 22);
      return Math.round(whitewaterFloor + (flatNY - whitewaterFloor) * frac);
    }
    if (dist < pocketDist) {
      const frac = (dist - foamStartDist) / (pocketDist - foamStartDist);
      return Math.round(foamBase - (foamBase - lipTop) * frac);
    }
    if (dist < 4) {
      const frac = (dist - pocketDist) / (4 - pocketDist);
      return Math.round(lipTop + (shoulderBase - lipTop) * frac);
    }
    if (dist < shoulderRun) {
      const frac = (dist - 4) / (shoulderRun - 4);
      return Math.round(shoulderBase + (flatNY - shoulderBase) * frac);
    }
    return flatNY;
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
  ctx.fillRect(0, 6 * PX, W, Math.max(PX * 2, (horizonNY - 6) * PX));

  // ── Wave columns ──────────────────────────────────────────────────────────
  for (let nx = 0; nx < NW; nx++) {
    const dist = surferNX - nx;
    const crestNY = waveSurface(nx);
    const x = nx * PX;
    const inWhitewater = dist < foamStartDist;
    const inPocket = dist >= foamStartDist && dist < 1;
    const onShoulder = dist >= 1 && dist < shoulderRun;

    if (dist >= pocketDist - 1 && dist <= 0) {
      ctx.fillStyle = C.foam2;
      ctx.fillRect(x, crestNY * PX, PX, PX);
      ctx.fillStyle = C.foam1;
      ctx.fillRect(x, (crestNY + 1) * PX, PX, PX);
      ctx.fillRect(x, (crestNY + 2) * PX, PX, PX);
      const lipOverhang = Math.max(0, Math.round((0 - dist) / 2));
      if (lipOverhang > 0) {
        ctx.fillStyle = C.spray;
        ctx.fillRect(x, Math.max(0, crestNY - 1) * PX, PX, PX);
      }
    }

    if (dist >= pocketDist - 2 && dist <= pocketDist + 2) {
      for (let sy = 1; sy <= 4; sy++) {
        const n = ((nx * 3 + sy * 9 + Math.floor(scrollN * 4)) % 10);
        if (n < 5) {
          ctx.fillStyle = n < 2 ? C.foam2 : C.spray;
          ctx.fillRect(x, Math.max(0, crestNY - sy) * PX, PX, PX);
        }
      }
    }

    for (let ny = crestNY; ny < NH; ny++) {
      const depth = ny - crestNY;
      let col;
      if (inWhitewater) {
        const fn = ((nx * 7 + ny * 3 + Math.floor(scrollN * 5)) % 29);
        col = fn < 4 ? C.foam1 : fn < 8 ? C.wwf : C.mid;
      } else if (inPocket) {
        if (depth < 3) col = C.foam1;
        else if (depth < 5) col = C.wface;
        else if (depth < 11) col = C.mid;
        else col = C.deep;
      } else if (onShoulder) {
        if (depth < 2) col = C.foam1;
        else if (depth < 6) col = C.wface;
        else if (depth < 12) col = C.mid;
        else col = C.deep;
      } else {
        if (depth < 2) col = C.wface;
        else if (depth < 8) col = C.mid;
        else col = C.deep;
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, ny * PX, PX, PX);
    }
  }

  // ── Surfer ────────────────────────────────────────────────────────────────
  // Anchor nose a few cols to the right of surferNX in canvas space;
  // after flip this puts the nose slightly ahead. Board tail extends left on screen.
  const spriteX   = surferNX * PX - 4 * PX;
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
  return PACIFIC_TIME_FORMATTER.format(new Date(unix * 1000)).toUpperCase();
}

// ─── HTML Escaping ────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
