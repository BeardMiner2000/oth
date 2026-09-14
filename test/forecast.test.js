'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({ Intl, Date, console, document: { addEventListener() {} }, window: {} });
vm.runInContext(fs.readFileSync('public/app.js', 'utf8'), context);
function slot(hour, speed = 2, tide = 1) {
  return { timestamp: Date.parse(`2099-09-15T${hour}:00:00-07:00`) / 1000,
    surf: { min: 2, max: 3 }, swells: [{ height: 3, period: 14, direction: 290 }],
    wind: { speed, direction: 20 }, tide: { height: tide } };
}
test('best slot can move beyond dawn and distinguishes capped scores', () => {
  const dawn = slot('09', 2), noon = slot('12', 0);
  assert.equal(context.getBestInterval([dawn, noon]).timestamp, noon.timestamp);
  assert.equal(context.getBestInterval([slot('09', 0), slot('12', 10)]).timestamp, dawn.timestamp);
});
test('tide changes affect the preferred slot', () => {
  const dawn = slot('09', 2, 5), noon = slot('12', 2, 1);
  assert.equal(context.getBestInterval([dawn, noon]).timestamp, noon.timestamp);
});
test('missing wind is unknown, never glassy', () => {
  const e = slot('09'); e.wind = null;
  const result = context.computeScore(context.buildVerdictInput([e]));
  assert.ok(result.reasons.some(r => r.text === 'WIND UNKNOWN'));
  assert.ok(!result.reasons.some(r => r.text.includes('GLASSY')));
});
test('expired and nighttime forecasts cannot yield a recommendation', () => {
  assert.equal(context.getBestInterval([{ ...slot('09'), timestamp: 1 }]), null);
  assert.equal(context.getBestInterval([slot('03')]), null);
  assert.equal(context.calculateVerdict(null).verdict, '[ NO DATA ]');
});
test('push scales with squared swell height and period', () => {
  const e = slot('09'); e.swells[0].period = 10;
  assert.match(context.describePush(e), /1.0×/);
  e.swells[0].height = 6;
  assert.match(context.describePush(e), /4.0×/);
  e.swells[0].period = 20;
  assert.match(context.describePush(e), /8.0×/);
  assert.equal(context.describePush(null), 'UNKNOWN');
});
test('far-away tides are not attached to another day', () => {
  assert.equal(context.closestByTimestamp([{timestamp: 1, height: 2}], 100000), null);
});
test('tiny waves do not get an epic verdict from light wind alone', () => {
  const e = slot('09', 0); e.surf = { min: 0.5, max: 1 };
  assert.ok(context.calculateVerdict(context.buildVerdictInput([e])).score <= 55);
});
test('backup uses the swell component and preserves hourly resolution', () => {
  const rows = context.normalizeStormglassForTable([{ timestamp: slot('10').timestamp, waveHeightFt: 6, wavePeriod: 7, swellHeightFt: 3, swellPeriod: 12, swellDirection: 270, windSpeedKts: 0, windDirectionDeg: 0 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].swells[0].height, 3);
  assert.equal(rows[0].swells[0].period, 12);
  assert.equal(rows[0].wind.speed, 0);
});
test('west-northwest wind is onshore at Bolinas', () => {
  const result = context.computeScore({ spotKey: 'bolinas', wave: {min:2,max:3,period:10}, wind: {speed:7,direction:'WNW'} });
  assert.ok(result.reasons.some(r => r.text.includes('ONSHORE')));
});
