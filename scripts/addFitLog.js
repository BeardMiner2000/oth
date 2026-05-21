'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'public', 'fit', 'data', 'logs.json');

main();

function main() {
  const input = readInput();
  const newLogs = splitLogEntries(input).map(parseLog);
  const logs = readLogs();

  newLogs.forEach(log => {
    const existingIndex = logs.findIndex(entry => entry.date === log.date);

    if (existingIndex >= 0) {
      logs[existingIndex] = { ...logs[existingIndex], ...log };
    } else {
      logs.push(log);
    }
  });

  logs.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(LOG_PATH, `${JSON.stringify(logs, null, 2)}\n`);
  console.log(`Saved ${newLogs.length} Surf/Fit log(s) to ${path.relative(process.cwd(), LOG_PATH)}`);
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
    estimatedMacros: fields['estimated macros'] || '',
    caloriesEstimate: averageRangeFromText(fields['estimated macros'], /calories:\s*~?([\d,]+)\s*[-–]\s*([\d,]+)/i),
    proteinEstimate: averageRangeFromText(fields['estimated macros'], /protein:\s*~?(\d+)\s*[-–]\s*(\d+)g/i),
    netCarbsEstimate: averageRangeFromText(fields['estimated macros'], /net carbs:\s*~?(\d+)\s*[-–]\s*(\d+)g/i),
    coachNotes: fields['coach notes'] || '',
    raw
  };
}

function splitLogEntries(input) {
  const entries = input
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/(?=^Date:\s*$)/m)
    .map(entry => entry.trim())
    .filter(entry => /^Date:\s*$/m.test(entry));

  return entries.length ? entries : [input.trim()].filter(Boolean);
}

function parseFields(input) {
  const fields = {};
  let currentKey = null;
  const knownKeys = new Set([
    'date',
    'weight',
    'fasting window',
    'food',
    'water/electrolytes',
    'creatine',
    'workout/surf',
    'sleep',
    'energy/mood',
    'alcohol',
    'estimated macros',
    'coach notes'
  ]);

  input.split(/\r?\n/).forEach(line => {
    if (/^=+$/.test(line.trim()) || /^surf\/fit daily log$/i.test(line.trim())) {
      return;
    }

    const match = line.match(/^([^:]{2,40}):\s*(.*)$/);
    const key = match ? match[1].trim().toLowerCase() : '';

    if (match && knownKeys.has(key)) {
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

function averageRangeFromText(value, pattern) {
  if (!value) return null;
  const match = String(value).match(pattern);
  if (!match) return null;
  const low = Number(match[1].replace(',', ''));
  const high = Number(match[2].replace(',', ''));
  return Math.round((low + high) / 2);
}

function waterBottlesFromText(value) {
  if (!value) return null;
  const bottleMatch = String(value).match(/(\d+(\.\d+)?)\s*(\+)?\s*(owalla|owala|bottle)/i);
  if (bottleMatch) {
    return Number(bottleMatch[1]);
  }

  const ounceMatch = String(value).match(/(\d+(\.\d+)?)\s*(oz|ounces)/i);
  if (ounceMatch) {
    return Number((Number(ounceMatch[1]) / 24).toFixed(1));
  }

  return numberFromText(value);
}
