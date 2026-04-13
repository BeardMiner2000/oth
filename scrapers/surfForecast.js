'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');

// For Bolinas, fetch both The Patch and Bolinas Jetty (closest to The Channel)
// and merge them into a composite reading.
const SURF_FORECAST_SLUGS = {
  bolinas:      ['The-Patch', 'Bolinas'],
  stinson:      'Stinson-Beach',
  oceanBeachSF: 'Ocean-Beach-San-Francisco',
  lindaMar:     'Linda-Mar-State-Beach',
  mavericks:    'Mavericks',
  dillonBeach:  'Dillon-Beach',
  salmonCreek:  'Salmon-Creek'
};

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection':      'keep-alive'
};

const M_TO_FT   = 3.28084;
const KMH_TO_KTS = 0.539957;

async function fetchHtml(url) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await axios.get(url, { headers: HEADERS, timeout: 15000, maxRedirects: 5 });
      return res.data;
    } catch (err) {
      lastErr = err;
      if (i < 2) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Convert AM/PM/Night slot label + day-of-month string to a unix timestamp.
 * dayLabel: "Mon 13"  timeSlot: "AM" | "PM" | "Night" | "Noon" | "Midnight"
 */
function parseSlotTimestamp(dayLabel, timeSlot) {
  const match = dayLabel.match(/(\d{1,2})$/);
  if (!match) return null;
  const dayNum = parseInt(match[1]);
  const now    = new Date();
  let month = now.getMonth();
  let year  = now.getFullYear();

  // Handle month roll-over (day number looks earlier than today)
  if (dayNum < now.getDate() - 1) {
    month++;
    if (month > 11) { month = 0; year++; }
  }

  // Map time labels to hours: both "AM/PM/Night" and numeric times like "8 AM", "11 AM", etc.
  const hourMap = {
    AM: 6, PM: 14, Night: 22, Midnight: 0, Noon: 12,
    '8 AM': 8, '11 AM': 11, '2 PM': 14, '5 PM': 17,
    '8 PM': 20, '11 PM': 23, '2 AM': 2, '5 AM': 5
  };
  // Try direct lookup first, then try extracting hour from "8 AM" format
  let hour = hourMap[timeSlot];
  if (hour === undefined) {
    const match = timeSlot.match(/(\d+)/);
    hour = match ? parseInt(match[1]) : 6;
  }
  return Math.floor(new Date(year, month, dayNum, hour, 0, 0).getTime() / 1000);
}

/**
 * Parse a wave-height cell: "1.4 W", "2.1 WNW", "1.4m W"
 * surf-forecast.com shows local surf height in metres.
 */
function parseWaveCell(text) {
  const clean = text.replace(/[^\d.\s\w]/g, ' ').trim();
  const parts = clean.split(/\s+/);
  const m = parseFloat(parts[0]);
  return {
    heightM:  isNaN(m) ? 0 : m,
    heightFt: isNaN(m) ? 0 : Math.round(m * M_TO_FT * 10) / 10,
    direction: parts[1] || ''
  };
}

/**
 * Parse a wind cell: "15 SW", "12 NW", "8 NNE"
 * surf-forecast.com reports wind in km/h.
 */
function parseWindCell(text) {
  const clean = text.replace(/[^\d.\s\w]/g, ' ').trim();
  const parts = clean.split(/\s+/);
  const kmh   = parseFloat(parts[0]);
  return {
    speedKmh: isNaN(kmh) ? 0 : kmh,
    speedKts: isNaN(kmh) ? 0 : Math.round(kmh * KMH_TO_KTS * 10) / 10,
    direction: parts[1] || ''
  };
}

/**
 * Scrape hourly forecast for one surf-forecast.com break slug.
 * Returns: { spotSlug, data: [...], error: null|string, fetchedAt }
 *
 * Data shape per interval:
 *   { timestamp, dayLabel, timeSlot,
 *     waveHeightM, waveHeightFt, waveDirection,
 *     period, windSpeedKmh, windSpeedKts, windDir, windState,
 *     rating10 }
 */
async function scrapeSpotForecast(spotSlug) {
  const url    = `https://www.surf-forecast.com/breaks/${spotSlug}/forecasts/latest`;
  const result = { spotSlug, data: [], error: null, fetchedAt: new Date().toISOString() };

  let html;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    result.error = `Fetch failed: ${err.message}`;
    return result;
  }

  try {
    const $ = cheerio.load(html);

    // surf-forecast.com uses <tr data-row-name="..."> for each data type
    function row(name) {
      const cells = [];
      $(`tr[data-row-name="${name}"] td`).each((_, el) => cells.push($(el).text().trim()));
      return cells;
    }

    const days       = row('days');
    const times      = row('time');  // Already formatted as "8 AM", "11 AM", "2 PM", etc.
    const waveRaw    = row('wave-height');
    const periods    = row('periods');
    const winds      = row('wind');
    const windStates = row('wind-state');
    const energy     = row('energy-maxenergy');

    // Ratings — try data-value attribute on inner element first, fall back to text
    const ratings = [];
    $('tr[data-row-name="rating"] td').each((_, el) => {
      const dv = $(el).find('[data-value]').attr('data-value') || $(el).attr('data-value');
      ratings.push(dv !== undefined ? String(dv) : $(el).text().trim());
    });

    // Tides (high/low) — collect all text from cells, may have multiple per cell
    const highTides = row('high-tide');
    const lowTides  = row('low-tide');

    // Also try collecting from cell contents in case multiple tides are shown
    const allHighTideTexts = [];
    $('tr[data-row-name="high-tide"] td').each((_, el) => {
      const text = $(el).text().trim();
      if (text) allHighTideTexts.push(text);
    });
    const allLowTideTexts = [];
    $('tr[data-row-name="low-tide"] td').each((_, el) => {
      const text = $(el).text().trim();
      if (text) allLowTideTexts.push(text);
    });

    const N = Math.min(times.length, waveRaw.length);
    if (N === 0) {
      result.error = 'No columns found — surf-forecast.com may have changed structure';
      return result;
    }

    for (let i = 0; i < N; i++) {
      // Map time index to day: assume 8 times per day (3-hour intervals)
      const dayIndex = Math.floor(i / 8);
      const dayLabel = days[dayIndex] || days[Math.min(dayIndex, days.length - 1)];
      const ts = parseSlotTimestamp(dayLabel, times[i]);
      if (!ts) continue;

      const wave = parseWaveCell(waveRaw[i] || '');
      const wind = parseWindCell(winds[i] || '');

      const periodMatch = (periods[i] || '').match(/(\d+)/);
      const period = periodMatch ? parseInt(periodMatch[1]) : null;

      const ratingMatch = (ratings[i] || '').match(/([\d.]+)/);
      const rating10 = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

      // windState values: "offshore", "onshore", "glassy", "cross-shore", etc.
      // Capitalise first letter so it matches Surfline's "Offshore" / "Onshore" format
      const ws = (windStates[i] || '').trim();
      const windState = ws ? ws.charAt(0).toUpperCase() + ws.slice(1) : '';

      // Energy/power: extract number in kJ, e.g. "1200 kJ" → 1200
      const energyMatch = (energy[i] || '').match(/(\d+)/);
      const energyKj = energyMatch ? parseInt(energyMatch[1]) : null;

      // Parse tide times: "8:54 AM 1.0" or similar → extract all times
      function parseTideTimes(tideStr) {
        if (!tideStr) return [];
        const times = [];
        const matches = tideStr.matchAll(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/gi);
        for (const match of matches) {
          times.push(match[1].trim());
        }
        return times;
      }

      result.data.push({
        timestamp:     ts,
        dayLabel:      dayLabel,
        timeSlot:      times[i],
        waveHeightM:   wave.heightM,
        waveHeightFt:  wave.heightFt,
        waveDirection: wave.direction,
        period,
        windSpeedKmh:  wind.speedKmh,
        windSpeedKts:  wind.speedKts,
        windDir:       wind.direction,
        windState,
        rating10,
        energyKj,
        highTideTimes: parseTideTimes(highTides[i]),  // array of times
        lowTideTimes:  parseTideTimes(lowTides[i])    // array of times
      });
    }

    if (result.data.length === 0) {
      result.error = 'Rows found but no parseable data — structure may have changed';
    }
  } catch (err) {
    result.error = `Parse error: ${err.message}`;
  }

  return result;
}

/**
 * Merge two or more arrays of forecast intervals by timestamp.
 * Averages numeric fields when the same time slot appears in multiple sources.
 */
function mergeIntervals(arrays) {
  const byTs = {};
  arrays.forEach(arr => {
    arr.forEach(entry => {
      if (!entry.timestamp) return;
      if (!byTs[entry.timestamp]) byTs[entry.timestamp] = [];
      byTs[entry.timestamp].push(entry);
    });
  });

  return Object.values(byTs).map(group => {
    if (group.length === 1) return group[0];
    function avg(key) {
      const vals = group.map(e => e[key]).filter(v => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return {
      ...group[0],
      waveHeightM:  avg('waveHeightM'),
      waveHeightFt: avg('waveHeightFt'),
      period:       avg('period'),
      windSpeedKmh: avg('windSpeedKmh'),
      windSpeedKts: avg('windSpeedKts'),
      rating10:     avg('rating10'),
      energyKj:     avg('energyKj')
    };
  }).sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = {
  SURF_FORECAST_SLUGS,
  scrapeSpotForecast,
  mergeIntervals
};
