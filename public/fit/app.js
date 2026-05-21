'use strict';

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

// Edit these targets as your plan changes.
const TARGETS = {
  eatingWindow: '12pm-10pm',
  netCarbs: '20-30g/day',
  protein: '140-170g/day',
  calories: '1,900-2,300/day',
  water: '4+ Owalla bottles/day',
  electrolytes: 'Sodium, potassium, magnesium',
  alcohol: '1 drink max per occasion, 1-2/week'
};

const KETO_RULES = [
  'Protein first',
  'Keep carbs under 30g net',
  'No grazing after dinner',
  'No keto junk food',
  'Hydrate aggressively',
  'Magnesium at night'
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  renderDate();
  renderTargets();
  setupCopyButton();

  // Edit daily WODs in public/fit/data/wods.json.
  const wodData = await fetch('data/wods.json').then(response => response.json());
  const logs = await fetch('data/logs.json').then(response => response.json());
  renderTodayWod(wodData);
  renderWeeklyBoard(wodData);
  renderTracking(logs);
  renderLastUpdated();
}

function renderDate() {
  const now = new Date();
  const dateText = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(now);

  document.getElementById('today-date').textContent = dateText;
}

function renderTargets() {
  document.getElementById('target-window').textContent = TARGETS.eatingWindow;
  document.getElementById('target-carbs').textContent = TARGETS.netCarbs;
  document.getElementById('target-protein').textContent = TARGETS.protein;
  document.getElementById('target-calories').textContent = TARGETS.calories;
  document.getElementById('target-water').textContent = TARGETS.water;
  document.getElementById('target-electrolytes').textContent = TARGETS.electrolytes;
  document.getElementById('target-alcohol').textContent = TARGETS.alcohol;

  const rulesEl = document.getElementById('keto-rules');
  KETO_RULES.forEach(rule => {
    const li = document.createElement('li');
    li.textContent = rule;
    rulesEl.appendChild(li);
  });
}

function renderTodayWod(wodData) {
  const todayName = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: 'long'
  }).format(new Date()).toLowerCase();
  const wod = wodData[todayName];

  document.getElementById('today-focus').textContent = wod.focus;
  document.getElementById('wod-title').textContent = wod.title;
  document.getElementById('wod-duration').textContent = wod.duration;
  document.getElementById('wod-intensity').textContent = wod.intensity;
  document.getElementById('wod-equipment').textContent = wod.equipment;
  document.getElementById('wod-benefit').textContent = wod.surfBenefit;

  renderList('wod-warmup', wod.warmup);
  renderList('wod-main', wod.main);
  renderList('wod-cooldown', wod.cooldown);
}

function renderList(id, items) {
  const list = document.getElementById(id);
  list.textContent = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
}

function renderWeeklyBoard(wodData) {
  const todayName = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: 'long'
  }).format(new Date()).toLowerCase();
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const grid = document.getElementById('weekly-grid');

  days.forEach(day => {
    const card = document.createElement('article');
    card.className = `weekly-day${day === todayName ? ' is-today' : ''}`;
    card.innerHTML = `<strong>${titleCase(day)}</strong><p>${wodData[day].weeklyPlan}</p>`;
    grid.appendChild(card);
  });
}

function setupCopyButton() {
  const button = document.getElementById('copy-log');
  const status = document.getElementById('copy-status');
  const template = document.getElementById('log-template');

  button.addEventListener('click', async () => {
    const copied = await copyText(template.textContent);
    status.textContent = copied ? 'Template copied.' : 'Select the template text to copy.';
    setTimeout(() => {
      status.textContent = '';
    }, 2200);
  });
}

function renderTracking(logs) {
  const sortedLogs = logs.slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedLogs[sortedLogs.length - 1];

  renderLineChart('weight-chart', sortedLogs, 'weightLbs', '#5b9bd5');
  renderLineChart('water-chart', sortedLogs, 'waterBottles', '#4db6a0');
  renderBarChart('workout-chart', sortedLogs);
  renderHeroStats(sortedLogs);

  document.getElementById('weight-trend-value').textContent = latest?.weightLbs
    ? `${latest.weightLbs} lbs`
    : '--';
  document.getElementById('water-trend-value').textContent = latest?.waterBottles
    ? `${latest.waterBottles} bottles`
    : '--';
  document.getElementById('workout-trend-value').textContent = `${sortedLogs.filter(log => log.workoutDone || log.surfDone).length}/${sortedLogs.length || 0}`;
  document.getElementById('current-weight').textContent = latest?.weightLbs ? `${latest.weightLbs} lbs` : '245 lbs';
  renderLatestLog(latest);
  renderLogHistory(sortedLogs);
}

function renderHeroStats(logs) {
  const thisWeekLogs = logs.filter(log => isThisWeek(log.date));
  const ketoStreak = countTrailing(logs, log => Number(log.netCarbsEstimate) <= 30);
  const workoutStreak = countTrailing(logs, log => log.workoutDone || log.surfDone);
  const surfCount = thisWeekLogs.filter(log => log.surfDone).length;
  const alcoholCount = thisWeekLogs.reduce((total, log) => total + (Number(log.alcoholDrinks) || 0), 0);

  document.getElementById('keto-streak').textContent = `${ketoStreak} day${ketoStreak === 1 ? '' : 's'}`;
  document.getElementById('workout-streak').textContent = `${workoutStreak} day${workoutStreak === 1 ? '' : 's'}`;
  document.getElementById('surf-week').textContent = `${surfCount} / 2`;
  document.getElementById('alcohol-week').textContent = `${alcoholCount} / 2`;
}

function renderLineChart(id, logs, key, color) {
  const points = logs
    .map((log, index) => ({ index, value: Number(log[key]) }))
    .filter(point => Number.isFinite(point.value));
  const el = document.getElementById(id);

  if (points.length < 2) {
    el.innerHTML = '<div class="empty-chart">Need 2 logs</div>';
    return;
  }

  const width = 320;
  const height = 92;
  const padding = 12;
  const values = points.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lastIndex = points[points.length - 1].index || 1;
  const path = points.map((point, index) => {
    const x = padding + (point.index / lastIndex) * (width - padding * 2);
    const y = height - padding - ((point.value - min) / range) * (height - padding * 2);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
      <path d="M${padding} ${height - padding}H${width - padding}" stroke="rgba(91,155,213,.22)" />
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function renderBarChart(id, logs) {
  const recent = logs.slice(-14);
  const el = document.getElementById(id);

  if (!recent.length) {
    el.innerHTML = '<div class="empty-chart">No logs yet</div>';
    return;
  }

  const width = 320;
  const height = 92;
  const gap = 5;
  const barWidth = (width - gap * (recent.length - 1)) / recent.length;
  const bars = recent.map((log, index) => {
    const active = log.workoutDone || log.surfDone;
    const barHeight = active ? 68 : 18;
    const x = index * (barWidth + gap);
    const y = height - barHeight - 8;
    const color = log.surfDone ? '#4db6a0' : (active ? '#5b9bd5' : 'rgba(91,155,213,.22)');
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" fill="${color}" rx="1" />`;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
      ${bars}
    </svg>
  `;
}

function renderLatestLog(log) {
  const list = document.getElementById('latest-log-list');
  list.textContent = '';

  if (!log) {
    list.innerHTML = '<dt>Status</dt><dd>No daily logs yet.</dd>';
    return;
  }

  const rows = [
    ['Date', log.date],
    ['Fasting', log.fastingWindow || '--'],
    ['Food', log.food || '--'],
    ['Water / electrolytes', log.waterElectrolytes || '--'],
    ['Creatine', log.creatine || '--'],
    ['Workout / surf', log.workoutSurf || '--'],
    ['Sleep', log.sleep || '--'],
    ['Energy / mood', log.energyMood || '--'],
    ['Alcohol', log.alcohol || '--'],
    ['Estimated macros', log.estimatedMacros || '--'],
    ['Coach notes', log.coachNotes || '--']
  ];

  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    appendLogValue(dd, value);
    list.append(dt, dd);
  });
}

function renderLogHistory(logs) {
  const history = document.getElementById('log-history');
  history.textContent = '';

  logs.slice(-7).reverse().forEach(log => {
    const card = document.createElement('article');
    card.className = 'history-entry';

    const title = document.createElement('h4');
    title.textContent = formatDateLabel(log.date);

    const meta = document.createElement('p');
    const workoutLabel = log.surfDone ? 'Surf' : (log.workoutDone ? 'Workout' : 'Recovery');
    meta.textContent = `${log.weightLbs || '--'} lbs · ${log.waterBottles || '--'} bottles · ${workoutLabel} · ${Number(log.alcoholDrinks) || 0} drinks`;

    const notes = document.createElement('p');
    notes.textContent = log.coachNotes || log.energyMood || log.workoutSurf || 'Logged.';

    card.append(title, meta, notes);
    history.appendChild(card);
  });
}

function appendLogValue(parent, value) {
  const text = String(value || '--');
  const items = text.split(/\s+-\s+/).map(item => item.replace(/^-\s*/, '').trim()).filter(Boolean);

  if (items.length < 2) {
    parent.textContent = text;
    return;
  }

  const list = document.createElement('ul');
  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  parent.appendChild(list);
}

function countTrailing(logs, predicate) {
  let count = 0;

  for (let i = logs.length - 1; i >= 0; i -= 1) {
    if (!predicate(logs[i])) break;
    count += 1;
  }

  return count;
}

function isThisWeek(date) {
  const today = new Date();
  const day = today.getDay() || 7;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() - day + 1);

  const logDate = new Date(`${date}T12:00:00`);
  return logDate >= monday && logDate <= today;
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(`${date}T12:00:00`));
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    // Fall through to the older selection-based copy path.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

function renderLastUpdated() {
  const updated = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date());

  document.getElementById('last-updated').textContent = updated;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
