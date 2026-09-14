'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const timestamp = Math.floor(Date.now() / 1000) + 3600;

function collector(feeds) {
  const requested = [];
  const context = vm.createContext({
    require(name) {
      if (name === 'axios') return { get: async url => {
        const parsed = new URL(url);
        const feed = parsed.pathname.split('/').at(-1);
        requested.push(parsed);
        if (feeds[feed] instanceof Error) throw feeds[feed];
        return { data: { data: feeds[feed] } };
      } };
      if (name === 'child_process') return { execFile: (file, args, options, callback) => callback(new Error('unavailable')) };
      return require(name);
    },
    console: { error() {} }, module: { exports: {} }
  });
  vm.runInContext(fs.readFileSync('scrapers/surfline.js', 'utf8'), context);
  return { api: context.module.exports, requested };
}

function feeds() {
  return {
    surf: { surf: [
      { timestamp, surf: { min: 1, max: 2, raw: { min: 0.5, max: 1.7 } } },
      { timestamp: timestamp + 10800, surf: { min: 2, max: 3 } }
    ] },
    swells: { swells: [
      { timestamp: timestamp + 10800, power: 60, swells: [{ height: 4, period: 12, direction: 270 }] },
      { timestamp, power: 30, swells: [{ height: 2, period: 10, direction: 0 }] }
    ] },
    energy: { energy: [{ timestamp, nearshore: 36.4, offshore: 126.5 }] }
  };
}

test('join current split feeds by timestamp with explicit feet units', async () => {
  const c = collector(feeds());
  const rows = await c.api.getWaveForecast('bolinas');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].surf.rawMin, 0.5);
  assert.equal(rows[0].swells[0].height, 2);
  assert.equal(rows[0].swells[0].direction, 0);
  assert.equal(rows[1].swells[0].height, 4);
  assert.equal(rows[0].energy.nearshoreKj, 36.4);
  assert.equal(rows[0].power, 30); // Legacy swell power is not nearshore energy.
  assert.equal(rows[1].energy, null); // Never attach another slot's energy.
  assert.equal(c.requested.find(u => u.pathname.endsWith('/surf')).searchParams.get('units[waveHeight]'), 'FT');
  assert.equal(c.requested.find(u => u.pathname.endsWith('/swells')).searchParams.get('units[swellHeight]'), 'FT');
  assert.ok(c.requested.every(u => !u.pathname.endsWith('/wave')));
});

test('supplemental feed outages preserve valid surf heights without inventing push', async () => {
  const d = feeds(); d.swells = Error('unavailable'); d.energy = Error('unavailable');
  const rows = await collector(d).api.getWaveForecast('bolinas');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].surf.max, 2);
  assert.equal(rows[0].swells.length, 0);
  assert.equal(rows[0].power, null);
  assert.equal(rows[0].energy, null);
});

test('empty, expired and malformed surf heights cannot become a fresh relay snapshot', async () => {
  for (const surf of [[], [{timestamp: 1, surf: {min: 1, max: 2}}], [{timestamp, surf: {min: null, max: 2}}]]) {
    const d = feeds(); d.surf = {surf};
    await assert.rejects(collector(d).api.getWaveForecast('bolinas'), /no current surf forecast/);
  }
});

test('zero surf and zero nearshore energy remain valid values', async () => {
  const d = feeds(); d.surf.surf[0].surf = {min:0,max:0}; d.energy.energy[0].nearshore = 0;
  const [row] = await collector(d).api.getWaveForecast('bolinas');
  assert.equal(row.surf.min,0);
  assert.equal(row.energy.nearshoreKj,0);
});
