'use strict';

require('dotenv').config();

const axios = require('axios');
const surfline = require('../scrapers/surfline');

const siteUrl = (process.env.SURFLINE_SNAPSHOT_SITE_URL || '').replace(/\/$/, '');
const token = process.env.SURFLINE_SNAPSHOT_TOKEN || '';
const spotKey = process.env.SURFLINE_SNAPSHOT_SPOT || 'bolinas';

async function main() {
  if (!siteUrl) {
    throw new Error('SURFLINE_SNAPSHOT_SITE_URL is required');
  }
  if (!token) {
    throw new Error('SURFLINE_SNAPSHOT_TOKEN is required');
  }

  const spot = surfline.SPOTS[spotKey];
  if (!spot) {
    throw new Error(`Unknown spot: ${spotKey}`);
  }

  const [wave, wind, tides, conditions] = await Promise.all([
    surfline.getWaveForecast(spot.id),
    surfline.getWindForecast(spot.id),
    surfline.getTideForecast(spot.id),
    surfline.getConditions(spot.id)
  ]);

  const payload = {
    wave,
    wind,
    tides,
    conditions,
    fetchedAt: new Date().toISOString()
  };

  const res = await axios.post(
    `${siteUrl}/api/internal/surfline-snapshot/${spotKey}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  console.log(JSON.stringify({
    ok: true,
    siteUrl,
    spotKey,
    counts: {
      wave: wave.length,
      wind: wind.length,
      tides: tides.length,
      conditions: conditions.length
    },
    response: res.data
  }, null, 2));
}

main().catch(err => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
