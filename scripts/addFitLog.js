'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'public', 'fit', 'data', 'logs.json');

main();

function main() {
  const input = readInput();
  const log = parseLog(input);
  const logs = readLogs();
  const existingIndex = logs.findIndex(entry => entry.date === log.date);

  if (existingIndex >= 0) {
    logs[existingIndex] = { ...logs[existingIndex], ...log };
  } else {
    logs.push(log);
  }

  logs.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(LOG_PATH, `${JSON.stringify(logs, null, 2)}\n`);
  console.log(`Saved Surf/Fit log for ${log.date} to ${path.relative(process.cwd(), LOG_PATH)}`);
}

function readInput() {
  const fileArg = process.argv[2];
  if (fileArg) {
    return fs.readFileSync(path.resolve(fileArg), 'utf8');
  }

  return fs.readFileSync(0, 'utf8');
}

function readLogs() {
  if (!fs.existsSync(LOG_PATH)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
}

function parseLog(input) {
  const fields = parseFields(input);
  const raw = input.trim();
  const date = normalizeDate(fields.date) || new Date().toISOString().slice(0, 10);
  const weight = fields.weight || '';
  const waterElectrolytes = fields['water/electrolytes'] || fields.water || '';
  const workoutSurf = fields['workout/surf'] || fields.workout || fields.surf || '';
  const energyMood = fields['energy/mood'] || fields.energy || fields.mood || '';
  const alcohol = fields.alcohol || '';

  return {
    date,
    weight,
    weightLbs: numberFromText(weight),
    fastingWindow: fields['fasting window'] || '',
    food: fields.food || '',
    waterElectrolytes,
    waterBottles: waterBottlesFromText(waterElectrolytes),
    creatine: fields.creatine || '',
    workoutSurf,
    workoutDone: /\b(workout|wod|walk|run|hike|lift|strength|mobility|zone 2|cardio|circuit)\b/i.test(workoutSurf),
    surfDone: /\bsurf(ed|ing)?\b/i.test(workoutSurf),
    sleep: fields.sleep || '',
    energyMood,
    alcohol,
    alcoholDrinks: numberFromText(alcohol) || 0,
    raw
  };
}

function parseFields(input) {
  const fields = {};
  let currentKey = null;

  input.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([^:]{2,40}):\s*(.*)$/);
    if (match) {
      currentKey = match[1].trim().toLowerCase();
      fields[currentKey] = match[2].trim();
      return;
    }

    if (currentKey && line.trim()) {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim();
    }
  });

  return fields;
}

function normalizeDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  return null;
}

function numberFromText(value) {
  if (!value) return null;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function waterBottlesFromText(value) {
  if (!value) return null;
  const bottleMatch = String(value).match(/(\d+(\.\d+)?)\s*(\+)?\s*(owalla|bottle)/i);
  return bottleMatch ? Number(bottleMatch[1]) : numberFromText(value);
}
