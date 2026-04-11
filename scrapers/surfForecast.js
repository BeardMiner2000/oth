'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');

const SURF_FORECAST_SLUGS = {
  bolinas:      'Bolinas',
  stinson:      'Stinson-Beach',
  oceanBeachSF: 'Ocean-Beach-San-Francisco',
  lindaMar:     'Linda-Mar-State-Beach',
  mavericks:    'Mavericks'
};

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control':   'max-age=0'
};

/**
 * Attempt a single HTTP GET with timeout.
 */
async function fetchWithRetry(url, attempts = 3, delayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get(url, {
        headers: HEADERS,
        timeout: 15000,
        maxRedirects: 5
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Convert star rating text/count to numeric 1-5.
 */
function parseStars(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Parse wave height string like "3-4ft" or "4ft" to { min, max }.
 */
function parseWaveHeight(text) {
  if (!text) return { min: 0, max: 0 };
  const clean = text.replace(/[^\d\-\.]/g, '');
  const parts = clean.split('-');
  if (parts.length === 2) {
    return { min: parseFloat(parts[0]) || 0, max: parseFloat(parts[1]) || 0 };
  }
  const single = parseFloat(clean) || 0;
  return { min: single, max: single };
}

/**
 * Scrape 6-day forecast for a spot.
 * Returns: { spotSlug, data: [...], error: null|string, fetchedAt }
 */
async function scrapeSpotForecast(spotSlug) {
  const url = `https://www.surf-forecast.com/breaks/${spotSlug}/forecasts/latest/six_day`;
  const result = {
    spotSlug,
    data:      [],
    error:     null,
    fetchedAt: new Date().toISOString()
  };

  let html;
  try {
    html = await fetchWithRetry(url);
  } catch (err) {
    result.error = `Fetch failed: ${err.message}`;
    return result;
  }

  try {
    const $ = cheerio.load(html);

    // surf-forecast.com uses a forecast table with class 'forecast-table'
    // Row structure varies by version; we attempt multiple selector strategies.

    const forecastRows = [];

    // Strategy 1: look for the forecast table
    const table = $('table.forecast-table, .forecast-table__cell, [class*="forecast"]');

    // Try to extract time headers
    const timeHeaders = [];
    $('tr.forecast-table__row--time td, tr.forecast-table__row--date td, .forecast-table__cell--time').each((i, el) => {
      timeHeaders.push($(el).text().trim());
    });

    // Extract wave heights
    const waveHeights = [];
    $('tr.forecast-table__row--wave td, .forecast-table__cell--wave-height').each((i, el) => {
      waveHeights.push($(el).text().trim());
    });

    // Extract periods
    const periods = [];
    $('tr.forecast-table__row--period td, .forecast-table__cell--period').each((i, el) => {
      periods.push($(el).text().trim());
    });

    // Extract wind speed
    const windSpeeds = [];
    $('tr.forecast-table__row--wind td, .forecast-table__cell--wind').each((i, el) => {
      windSpeeds.push($(el).text().trim());
    });

    // Extract ratings
    const ratings = [];
    $('tr.forecast-table__row--rating td, .forecast-table__cell--rating, .rating').each((i, el) => {
      ratings.push($(el).text().trim());
    });

    // Strategy 2: look for JSON-LD or embedded data
    let jsonData = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const parsed = JSON.parse($(el).html());
        if (parsed && (parsed.forecast || parsed.surfForecast)) {
          jsonData = parsed;
        }
      } catch (e) { /* ignore */ }
    });

    // Build forecast entries from whatever we could extract
    const maxLen = Math.max(timeHeaders.length, waveHeights.length, 1);

    if (waveHeights.length > 0 || timeHeaders.length > 0) {
      for (let i = 0; i < maxLen; i++) {
        const wh = parseWaveHeight(waveHeights[i] || '');
        forecastRows.push({
          time:      timeHeaders[i]  || '',
          waveMin:   wh.min,
          waveMax:   wh.max,
          period:    parseFloat((periods[i]    || '').replace(/[^\d\.]/g, '')) || null,
          wind:      windSpeeds[i]   || '',
          rating:    parseStars(ratings[i] || ''),
          ratingRaw: ratings[i]      || ''
        });
      }
    }

    // Strategy 3: generic table row scraping as fallback
    if (forecastRows.length === 0) {
      $('table tr').each((rowIdx, row) => {
        if (rowIdx === 0) return; // skip header
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          const texts = [];
          cells.each((i, cell) => texts.push($(cell).text().trim()));
          const wh = parseWaveHeight(texts[1] || texts[0] || '');
          forecastRows.push({
            time:    texts[0] || `Period ${rowIdx}`,
            waveMin: wh.min,
            waveMax: wh.max,
            period:  parseFloat((texts[2] || '').replace(/[^\d\.]/g, '')) || null,
            wind:    texts[3] || '',
            rating:  parseStars(texts[4] || ''),
            ratingRaw: texts[4] || ''
          });
        }
      });
    }

    result.data = forecastRows;

    if (forecastRows.length === 0) {
      result.error = 'No forecast data found in page (site may have changed structure)';
    }
  } catch (parseErr) {
    result.error = `Parse error: ${parseErr.message}`;
  }

  return result;
}

module.exports = {
  SURF_FORECAST_SLUGS,
  scrapeSpotForecast
};
