'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');

// For Bolinas, fetch both The Patch and Bolinas Jetty (closest to The Channel)
// and merge them into a composite reading.
const SURF_FORECAST_SLUGS = {
  bolinas:      ['The-Patch', 'Bolinas'],
  stinson:      'Stinson-Beach',
  oceanBeachSF: 'Ocean-Beach',
  lindaMar:     'Linda-Lane-Beach',
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
const PACIFIC_TZ = 'America/Los_Angeles';
const PACIFIC_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});
const PACIFIC_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TZ,
  timeZoneName: 'shortOffset'
});

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
  const dayNum = parseInt(match[1], 10);
  const now    = getPacificDateParts(new Date());
  let month = now.month;
  let year  = now.year;

  // Handle month roll-over (day number looks earlier than today)
  if (dayNum < now.day - 1) {
    month++;
    if (month > 11) { month = 0; year++; }
  }

  // Map time labels to hours: both "AM/PM/Night" and numeric times like "8 AM", "11 AM", etc.
  const hourMap = {
    AM: 6, PM: 14, Night: 22, Midnight: 0, Noon: 12,
    '8 AM': 8, '11 AM': 11, '2 PM': 14, '5 PM': 17,
    '8 PM': 20, '11 PM': 23, '2 AM': 2, '5 AM': 5
  };

  // Trim timeSlot to remove any hidden whitespace
  const trimmedSlot = (timeSlot || '').trim();
  let hour = hourMap[trimmedSlot];
  if (hour === undefined) {
    const slotMatch = trimmedSlot.match(/(\d+)/);
    hour = slotMatch ? parseInt(slotMatch[1], 10) : 6;
  }
  return zonedDateTimeToUnix(year, month, dayNum, hour, PACIFIC_TZ);
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
/**
 * Parse a single HTML page of surf-forecast.com data into intervals.
 * dayStride: how many unique days are in the table (used to compute day index).
 * For /latest: days repeat twice in the row but stride = uniqueDayCount (8 times/day).
 * For /six_day: days repeat twice, stride = uniqueDayCount, 3 times/day.
 */
function parseHtmlToIntervals(html, dayStride) {
  const $ = cheerio.load(html);
  const intervals = [];

  function row(name) {
    const cells = [];
    $(`tr[data-row-name="${name}"] td`).each((_, el) => cells.push($(el).text().trim()));
    return cells;
  }

  const days       = row('days');
  const timesRaw   = row('time');
  const times      = timesRaw.map(t => t.replace(/[\s\u2009]/g, ' '));
  const waveRaw    = row('wave-height');
  const periods    = row('periods');
  const winds      = row('wind');
  const windStates = row('wind-state');
  const energy     = row('energy-maxenergy');

  const ratings = [];
  $('tr[data-row-name="rating"] td').each((_, el) => {
    const dv = $(el).find('[data-value]').attr('data-value') || $(el).attr('data-value');
    ratings.push(dv !== undefined ? String(dv) : $(el).text().trim());
  });

  const highTides = row('high-tide');
  const lowTides  = row('low-tide');

  const N = Math.min(times.length, waveRaw.length);
  if (N === 0) return intervals;

  // Unique days (first half of days array — second half is a duplicate section)
  const uniqueDays = days.slice(0, dayStride);
  if (uniqueDays.length === 0) return intervals;
  const intervalsPerDay = dayStride === 8 ? 8 : Math.max(1, Math.round(N / uniqueDays.length));

  for (let i = 0; i < N; i++) {
    // Map column index to day: for /latest 8 cols per day, for /six_day cycle through unique days
    const dayIndex = Math.min(uniqueDays.length - 1, Math.floor(i / intervalsPerDay));
    const dayLabel = uniqueDays[dayIndex] || uniqueDays[uniqueDays.length - 1];
    const ts = parseSlotTimestamp(dayLabel, times[i]);
    if (!ts) continue;

    const wave = parseWaveCell(waveRaw[i] || '');
    const wind = parseWindCell(winds[i] || '');

    const periodMatch = (periods[i] || '').match(/(\d+)/);
    const period = periodMatch ? parseInt(periodMatch[1]) : null;

    const ratingMatch = (ratings[i] || '').match(/([\d.]+)/);
    const rating10 = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    const ws = (windStates[i] || '').trim();
    const windState = ws ? ws.charAt(0).toUpperCase() + ws.slice(1) : '';

    const energyMatch = (energy[i] || '').match(/(\d+)/);
    const energyKj = energyMatch ? parseInt(energyMatch[1]) : null;

    function parseTideTimes(tideStr) {
      if (!tideStr) return [];
      const times = [];
      const matches = tideStr.matchAll(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/gi);
      for (const match of matches) times.push(match[1].trim());
      return times;
    }

    intervals.push({
      timestamp:     ts,
      dayLabel,
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
      highTideTimes: parseTideTimes(highTides[i]),
      lowTideTimes:  parseTideTimes(lowTides[i])
    });
  }
  return intervals;
}

async function scrapeSpotForecast(spotSlug) {
  const result = { spotSlug, data: [], error: null, fetchedAt: new Date().toISOString() };

  // Fetch both endpoints in parallel:
  // /latest      → 3 days × 8 intervals (3-hour granularity, days row has colspan 8)
  // /six_day     → 7 days × 3 intervals (AM/PM/Night, days row repeated twice with 7 unique days)
  const [latestHtml, sixDayHtml] = await Promise.allSettled([
    fetchHtml(`https://www.surf-forecast.com/breaks/${spotSlug}/forecasts/latest`),
    fetchHtml(`https://www.surf-forecast.com/breaks/${spotSlug}/forecasts/latest/six_day`)
  ]);

  try {
    // Parse granular near-term data (8/day for 3 days)
    const latestIntervals = latestHtml.status === 'fulfilled'
      ? parseHtmlToIntervals(latestHtml.value, 8)
      : [];

    // Parse extended data (3/day for 7 days)
    const sixDayIntervals = sixDayHtml.status === 'fulfilled'
      ? parseHtmlToIntervals(sixDayHtml.value, 7)
      : [];

    if (latestIntervals.length === 0 && sixDayIntervals.length === 0) {
      result.error = 'Both endpoints returned no data';
      return result;
    }

    // Build set of timestamps already covered by /latest (granular data takes priority)
    const latestDays = new Set(latestIntervals.map(e => e.dayLabel));

    // Combine: use /latest for overlapping days, /six_day only for days beyond /latest range
    const extended = sixDayIntervals.filter(e => !latestDays.has(e.dayLabel));
    const combined = [...latestIntervals, ...extended]
      .sort((a, b) => a.timestamp - b.timestamp);

    result.data = combined;

    if (result.data.length === 0) {
      result.error = 'No parseable data from either endpoint';
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
    function mode(key) {
      const counts = new Map();
      let winner = null;
      let winnerCount = 0;
      group
        .map(entry => entry[key])
        .filter(Boolean)
        .forEach(value => {
          const count = (counts.get(value) || 0) + 1;
          counts.set(value, count);
          if (count > winnerCount) {
            winner = value;
            winnerCount = count;
          }
        });
      return winner;
    }
    return {
      ...group[0],
      waveHeightM:  avg('waveHeightM'),
      waveHeightFt: avg('waveHeightFt'),
      waveDirection: mode('waveDirection') || group[0].waveDirection,
      period:       avg('period'),
      windSpeedKmh: avg('windSpeedKmh'),
      windSpeedKts: avg('windSpeedKts'),
      windDir:      mode('windDir') || group[0].windDir,
      windState:    mode('windState') || group[0].windState,
      rating10:     avg('rating10'),
      energyKj:     avg('energyKj')
    };
  }).sort((a, b) => a.timestamp - b.timestamp);
}

function getPacificDateParts(date) {
  const parts = PACIFIC_DATE_FORMATTER.formatToParts(date);
  const values = {};
  parts.forEach(part => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = parseInt(part.value, 10);
    }
  });
  return {
    year: values.year,
    month: values.month - 1,
    day: values.day
  };
}

function zonedDateTimeToUnix(year, month, day, hour, timeZone) {
  const utcGuess = Date.UTC(year, month, day, hour, 0, 0);
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  return Math.floor((utcGuess - (offsetMinutes * 60 * 1000)) / 1000);
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const tzPart = PACIFIC_OFFSET_FORMATTER
    .formatToParts(date)
    .find(part => part.type === 'timeZoneName');
  const label = tzPart ? tzPart.value : 'GMT';
  if (timeZone !== PACIFIC_TZ) {
    return 0;
  }

  const match = label.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] || '0', 10);
  return sign * ((hours * 60) + minutes);
}

module.exports = {
  SURF_FORECAST_SLUGS,
  scrapeSpotForecast,
  mergeIntervals
};
