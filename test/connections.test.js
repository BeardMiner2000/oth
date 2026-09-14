'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('expired relay rows cannot mask current backup data, even after fresh upload', async () => {
  const routes = {};
  const app = { use() {}, get(route, handler) { routes[route] = handler; }, post() {}, listen() {} };
  const express = Object.assign(() => app, { json: () => () => {}, static: () => () => {} });
  const now = Date.now() / 1000;
  const snapshot = { fetchedAt: new Date().toISOString(), receivedAt: new Date().toISOString(), wave: [{timestamp: now - 3600}], wind: [], tides: [], conditions: [] };
  const mockFs = { mkdirSync() {}, existsSync: () => true, readFileSync: () => JSON.stringify({ bolinas: snapshot }) };
  const surfline = { SPOTS: { bolinas: { id: 'test', lat: 37.9, lon: -122.7 } }, getWaveForecast: async () => { throw Error('403'); }, getWindForecast: async () => [], getTideForecast: async () => [], getConditions: async () => [] };
  const mocks = { dotenv: {config() {}}, express, cors: () => () => {}, fs: mockFs, path,
    'node-cache': class { get() {} set() {} }, './scrapers/surfline': surfline,
    './scrapers/noaa': { getTidePredictions: async () => [{ timestamp: now, height: 2 }] },
    './scrapers/stormglass': {}, './scrapers/openMeteo': { getMarineForecast: async () => [{ timestamp: now + 3600, waveHeightFt: 4 }] } };
  const ctx = vm.createContext({ require: name => mocks[name], __dirname: path.resolve('.'), process: { env: {} }, console, setInterval() {}, module: {} });
  vm.runInContext(fs.readFileSync('server.js', 'utf8'), ctx);
  let payload;
  await routes['/api/forecast/:spotId']({params: {spotId:'bolinas'}}, {json: value => { payload = value; }}, err => { throw err; });
  assert.equal(payload.sources.waves, 'openMeteo');
  assert.equal(payload.sources.tides, 'noaa');
  assert.equal(payload.surfline.length, 0);
  assert.equal(payload.openMeteo.length, 1);
  assert.equal(ctx.isFreshSnapshot({fetchedAt:'2000-01-01',receivedAt:new Date().toISOString()}), false);
  assert.equal(ctx.mergeWaveWind([{timestamp:now}], [ {timestamp:1,speed:0} ])[0].wind, null);
});

test('Open-Meteo timestamps are absolute and calm/north wind are preserved', async () => {
  const timestamp = 1789369200;
  const mocks = { axios: { get: async url => {
    assert.equal(new URL(url).searchParams.get('timeformat'), 'unixtime');
    return { data: { hourly: url.includes('marine-api')
      ? {time:[timestamp], wave_height:[0], swell_wave_height:[0], swell_wave_period:[10]}
      : {time:[timestamp], wind_speed_10m:[0],wind_direction_10m:[0],wind_gusts_10m:[0]} } };
  } } };
  const ctx = vm.createContext({require:name=>mocks[name], URLSearchParams, module:{exports:{}}});
  vm.runInContext(fs.readFileSync('scrapers/openMeteo.js','utf8'),ctx);
  const [row] = await ctx.module.exports.getMarineForecast(37.9,-122.7);
  assert.equal(row.timestamp,timestamp);
  assert.equal(row.windSpeedKts,0);
  assert.equal(row.windDirectionDeg,0);
  assert.equal(row.waveHeightFt,0);
});
