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
  if (deg === null || deg === undefined || isNaN(deg)) return '---';
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

  // Get the currently displayed day's data slice
  const surflineData = state.forecastData.surfline || [];
  const dayData = getDaySlice(surflineData, state.currentDay);

  // Fall back to Open-Meteo if no Surfline data for this day
  const openMeteoData = state.forecastData.openMeteo || [];
  const openMeteoDayData = getDaySlice(openMeteoData, state.currentDay);

  // Verdict — prefer Surfline, fall back to Open-Meteo then buoy
  const verdictInput = buildVerdictInput(
    dayData.length ? dayData : openMeteoDayData,
    Array.isArray(state.buoyData) ? state.buoyData[0] : state.buoyData,
    dayData.length ? 'surfline' : (openMeteoDayData.length ? 'open-meteo' : 'buoy')
  );
  const verdict = calculateVerdict(verdictInput);
  renderVerdictPanel(verdict);

  // Forecast table
  renderForecastTable(state.forecastData.surfline, state.forecastData.tides);

  // Buoy panel
  renderBuoyPanel(state.buoyData);

  // Update timestamp
  updateTimestamp();
  updateDayDisplay();
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
      return {
        wave:   { min: b.waveHeightFt || 0, max: (b.waveHeightFt || 0) * 1.2, period: b.dominantPeriod },
        wind:   { speed: b.windSpeedKts || 0, direction: b.windDirection || '' },
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

  return {
    wave: {
      min:    interval.surf ? interval.surf.min : 0,
      max:    interval.surf ? interval.surf.max : 0,
      period: (interval.swells && interval.swells[0]) ? interval.swells[0].period : 0,
      swellDir
    },
    wind: {
      speed:     interval.wind ? interval.wind.speed         : 0,
      direction: windDirName,
      gust:      interval.wind ? interval.wind.gust          : 0,
      type:      interval.wind ? interval.wind.directionType : ''
    },
    tide:   interval.tide || null,
    source: 'surfline'
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

  if (flat) {
    verdict = '[ SWIM DAY! ]';
    cls     = 'swim';
  } else if (scary) {
    // Override score label when wave height alone says scary
    if (score < 25) {
      verdict = '[ KINDA SCARY ]';
      cls     = 'scary';
    } else {
      verdict = '[ TOO CHUNKY ]';
      cls     = 'chunky';
    }
  } else if (score >= 80) {
    verdict = '[ HUGE STOKE! ]';
    cls     = 'epic';
  } else if (score >= 62) {
    verdict = '[ JL WOULD GO ]';
    cls     = 'good';
  } else if (score >= 44) {
    verdict = '[ MAYBE... ]';
    cls     = 'marginal';
  } else if (score >= 28) {
    verdict = '[ TOO CHUNKY ]';
    cls     = 'chunky';
  } else {
    verdict = '[ KINDA SCARY ]';
    cls     = 'scary';
  }

  return { verdict, score, cls, reasons };
}

// ─── Render: Verdict Panel ────────────────────────────────────────────────────
function renderVerdictPanel(verdict) {
  const box      = document.getElementById('verdict-box');
  const textEl   = document.getElementById('verdict-text');
  const labelEl  = document.getElementById('verdict-label');
  const stokeEl  = document.getElementById('stoke-bar');
  const reasonEl = document.getElementById('verdict-reasons');

  if (!box || !textEl) return;

  // Update class
  box.className = verdict.cls;

  textEl.textContent = verdict.verdict;

  // Label
  const labels = {
    epic:     'SURF REPORT // SLOW CLEAN PERFECTION',
    good:     'SURF REPORT // CONDITIONS FAVORABLE',
    marginal: 'SURF REPORT // MARGINAL CONDITIONS',
    chunky:   'SURF REPORT // GETTING A BIT MUCH',
    scary:    'SURF REPORT // TOO MUCH POWER IN THE WATER',
    swim:     'SURF REPORT // GREAT DAY FOR A SWIM + EXERCISE'
  };
  if (labelEl) labelEl.textContent = labels[verdict.cls] || 'SURF REPORT';

  // Stoke meter
  if (stokeEl) {
    stokeEl.textContent = buildStokeMeter(verdict.score);
  }

  // Reasons
  if (reasonEl) {
    reasonEl.innerHTML = verdict.reasons
      ? verdict.reasons.map(r => `<span class="reason-item ${r.cls}">[ ${r.text} ]</span>`).join(' ')
      : '';
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
function renderForecastTable(intervals, tides) {
  const wrap = document.getElementById('forecast-table-wrap');
  if (!wrap) return;

  if (!intervals || intervals.length === 0) {
    wrap.innerHTML = buildErrorBox('NO SURFLINE DATA AVAILABLE');
    return;
  }

  // Build one row per interval, grouped visually by day
  const rows = [];
  let lastDay = '';

  intervals.forEach(entry => {
    const dt       = new Date(entry.timestamp * 1000);
    const dayStr   = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }).toUpperCase();
    const timeStr  = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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

    // Tide (closest)
    const tideHeight = entry.tide ? entry.tide.height : null;
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

    rows.push({
      type: 'data',
      dayStr, timeStr, waveStr, periodStr, windStr, tideStr, stars, waveCls,
      isNow
    });
  });

  // Build ASCII table string
  const COL_DATE   = 11;
  const COL_TIME   = 6;
  const COL_WAVES  = 10;
  const COL_PERIOD = 8;
  const COL_WIND   = 12;
  const COL_TIDE   = 7;
  const COL_STARS  = 7;

  function pad(s, len) {
    const str = String(s);
    return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
  }

  const totalW = COL_DATE + COL_TIME + COL_WAVES + COL_PERIOD + COL_WIND + COL_TIDE + COL_STARS + 16; // pipes and spaces

  const TOP    = '╔' + '═'.repeat(totalW) + '╗';
  const HDR_SEP= '╠' + '═'.repeat(totalW) + '╣';
  const DAY_SEP= '╟' + '─'.repeat(totalW) + '╢';
  const BOT    = '╚' + '═'.repeat(totalW) + '╝';

  const header = `║  ${pad('DATE',COL_DATE)}${pad('TIME',COL_TIME)}  ${pad('WAVES',COL_WAVES)}${pad('PERIOD',COL_PERIOD)}${pad('WIND',COL_WIND)}${pad('TIDE',COL_TIDE)}${pad('RATING',COL_STARS)}  ║`;

  let html = `<pre class="forecast-table">`;
  html += `<span class="tbl-border">${escHtml(TOP)}\n`;
  html += `</span><span class="tbl-header">║  ${pad('DATE',COL_DATE)}${pad('TIME',COL_TIME)}  ${pad('WAVES',COL_WAVES)}${pad('PERIOD',COL_PERIOD)}${pad('WIND',COL_WIND)}${pad('TIDE',COL_TIDE)}${pad('RATING',COL_STARS)}  ║\n</span>`;
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
  // Surfer — bald guy with gray beard
  bald:   '#d4956a',  // sun-beaten bald pate
  skin:   '#e8b468',  // warm golden skin
  beard:  '#a8a8a4',  // gray beard
  beardD: '#787874',  // beard shadow
  suit:   '#1e4880',  // wetsuit blue
  suitD:  '#142e58',  // dark wetsuit shadow
  board:  '#e8cc3a',  // yellow longboard
  boardD: '#b89820',  // board rail/shadow
  wax:    '#f0ead8',  // deck wax / feet
};

// ── Surfer sprite: 2 frames, 10×14 logical pixels ────────────────────────────
// Bald head, big gray beard, noseriding — left-facing profile.
// Nose of board is on the LEFT (direction of wave travel).
const FRAMES = [
  // Frame 0 — arms spread wide, classic noserider balance
  [
    [null, 'bald','bald','bald', null,  null,  null, null, null, null],
    ['bald','bald','bald','bald','bald', null,  null, null, null, null],
    ['skin','skin','skin','skin','bald', null,  null, null, null, null],
    ['beard','beard','skin','suit', null,  null,  null, null, null, null],
    ['beard','beard','beard','suit','suit', null,  null, null, null, null],
    ['beard','beard','suit','suit','suit','suit', null, null, null, null],
    [null, 'suit','suit','suit','suit','suit', null, null, null, null],
    ['skin','suit','suit','suit','suit', null, 'skin', null, null, null],
    [null,  null, 'suit','suit','suit', null,  null, null, null, null],
    [null, 'suitD','suit','suitD', null,  null,  null, null, null, null],
    ['suitD','suit', null, 'suit', null,  null,  null, null, null, null],
    ['wax', 'wax',  null, 'wax',  null,  null,  null, null, null, null],
    ['board','board','board','board','board','board','board','board','board','boardD'],
    [null,'boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD', null],
  ],
  // Frame 1 — slight weight shift, arms lift a hair
  [
    [null, 'bald','bald','bald', null,  null,  null, null, null, null],
    ['bald','bald','bald','bald','bald', null,  null, null, null, null],
    ['skin','skin','skin','skin','bald', null,  null, null, null, null],
    ['beard','beard','skin','suit', null,  null,  null, null, null, null],
    ['beard','beard','beard','suit','suit', null,  null, null, null, null],
    ['beard','suit','suit','suit','suit','suit', null, null, null, null],
    [null, 'suit','suit','suit','suit','suit', null, null, null, null],
    [null, 'skin','suit','suit','suit','suit','skin', null, null, null],
    [null,  null, 'suit','suit','suit', null,  null, null, null, null],
    [null, 'suitD','suit','suitD', null,  null,  null, null, null, null],
    ['suitD','suit', null, 'suit', null,  null,  null, null, null, null],
    ['wax', 'wax',  null, 'wax',  null,  null,  null, null, null, null],
    ['board','board','board','board','board','board','board','board','board','boardD'],
    [null,'boardD','boardD','boardD','boardD','boardD','boardD','boardD','boardD', null],
  ],
];

const SPRITE_W = 10;
const SPRITE_H = 14;

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

  // Slow scroll for ripple/foam animation (~12s per full cycle)
  const scrollPx = (t * 0.000083) % 1;
  const scrollN  = Math.floor(scrollPx * NW);

  // Surfer locked in the pocket at 40% from left
  const surferNX = Math.floor(NW * 0.40);

  // Wave profile heights (logical Y — smaller = higher on screen)
  const pocketNY = Math.floor(NH * 0.50);  // tallest point (pocket)
  const wwNY     = Math.floor(NH * 0.62);  // already-broken whitewater surface
  const flatNY   = NH - 4;                 // flat outside swell

  // Wave surface for any column (relative to surfer)
  function waveSurface(nx) {
    const dist = nx - surferNX;
    if (dist < -14) {
      // Whitewater — flat, already broken
      return wwNY;
    } else if (dist < -1) {
      // Crashing/pitching zone — rises sharply to pocket height
      const frac = (dist + 14) / 13;
      return Math.round(wwNY - (wwNY - pocketNY) * frac);
    } else if (dist <= 2) {
      // Pocket — maximum height
      return pocketNY;
    } else if (dist <= 22) {
      // Shoulder — gracefully flattens out
      const frac = Math.min(1, (dist - 2) / 20);
      return Math.round(pocketNY + (flatNY - pocketNY) * frac);
    } else {
      return flatNY;
    }
  }

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
    const dist     = nx - surferNX;
    const crestNY  = waveSurface(nx);
    const x        = nx * PX;

    const isWhitewater = dist < -14;
    const isCrashing   = dist >= -14 && dist < -1;
    const isPocket     = dist >= -1 && dist <= 2;

    // ── Pitching lip arch — white pixels curling above crest in crash zone ──
    if (isCrashing && dist > -9) {
      const archH = Math.max(0, Math.floor((dist + 9) / 2));
      ctx.fillStyle = C.foam2;
      ctx.fillRect(x, (crestNY - archH) * PX, PX, PX);
    }

    // ── Flying spray above the crashing section ───────────────────────────
    if (isCrashing && dist > -11) {
      const intensity = 1 - Math.abs(dist + 5) / 6;
      const rows = Math.ceil(intensity * 3);
      for (let sy = 1; sy <= rows; sy++) {
        const n = ((nx * 3 + sy * 7 + Math.floor(scrollN * 2.5)) % 9);
        if (n < 4) {
          ctx.fillStyle = n < 2 ? C.foam2 : C.spray;
          ctx.fillRect(x, (crestNY - sy) * PX, PX, PX);
        }
      }
    }

    // ── Crest / lip foam ──────────────────────────────────────────────────
    if (isCrashing || isPocket) {
      ctx.fillStyle = dist < -6 ? C.foam2 : '#ffffff';
      ctx.fillRect(x, crestNY * PX, PX, PX);
      ctx.fillStyle = C.foam1;
      ctx.fillRect(x, (crestNY + 1) * PX, PX, PX);
    } else if (isWhitewater) {
      // Scattered foam dots bobbing above whitewater surface
      const fn = ((nx * 5 + Math.floor(scrollN * 3)) % 13);
      if (fn < 5) {
        ctx.fillStyle = C.foam2;
        ctx.fillRect(x, (crestNY - 1) * PX, PX, PX);
      }
    }

    // ── Wave body from crest to bottom ────────────────────────────────────
    const startNY = (isCrashing || isPocket) ? crestNY + 2 : crestNY;
    for (let ny = startNY; ny < NH; ny++) {
      const depth = ny - crestNY;
      let col;
      if (isWhitewater) {
        // Animated foam texture — three-tone churn
        const fn = ((nx * 7 + ny * 3 + Math.floor(scrollN * 4)) % 13);
        col = fn < 3 ? C.foam2 : fn < 7 ? C.wwf : C.ww;
      } else if (isCrashing) {
        if (depth < 3)       col = C.foam1;
        else if (depth < 8)  col = C.wface;  // transparent green face
        else if (depth < 14) col = C.mid;
        else                 col = C.deep;
      } else {
        // Shoulder / pocket — clean unbroken face
        if (depth === 0)     col = C.foam1;
        else if (depth < 6)  col = C.wface;
        else if (depth < 13) col = C.mid;
        else                 col = C.deep;
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, ny * PX, PX, PX);
    }
  }

  // ── Surfer ────────────────────────────────────────────────────────────────
  const surfaceNY = waveSurface(surferNX);   // = pocketNY (flat in the pocket)

  // Board rail (row 13 of sprite) aligns with wave surface
  const spriteX = surferNX * PX - Math.floor((SPRITE_W * PX) / 2);
  const spriteY = (surfaceNY + 1) * PX - SPRITE_H * PX;

  // Subtle sway (slope is ~0 in pocket, so add a gentle wobble)
  const slope = waveSurface(surferNX + 2) - waveSurface(surferNX - 2);
  const wobble = Math.sin(t * 0.0003) * 0.018;
  const tiltAngle = slope * 0.035 + wobble;
  const pivotX = spriteX + (SPRITE_W * PX) / 2;
  const pivotY = spriteY + SPRITE_H * PX;

  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(tiltAngle);
  ctx.translate(-pivotX, -pivotY);
  const frame = Math.floor(t / (1000 / NES.FPS)) % FRAMES.length;
  drawSprite(ctx, frame, spriteX, spriteY);
  ctx.restore();
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
