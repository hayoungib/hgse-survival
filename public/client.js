/* HGSE Survival – browser client.
   The server is authoritative: this file only sends inputs and draws state. */

const socket = io();
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const c of children) n.append(c);
  return n;
};
// All server/AI text is inserted with textContent / text nodes, never innerHTML.

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

/* ================= Setup ================= */
const choice = { concentration: null, housing: null, dreamJob: null, courses: new Set() };
let catalog = null;

function card(group, item, title, lines, multi = false) {
  const c = el('button', { type: 'button', className: 'card' }, el('strong', { textContent: title }));
  for (const line of lines) c.append(el('span', { textContent: line }));
  c.addEventListener('click', () => {
    if (multi) {
      if (choice.courses.has(item.id)) choice.courses.delete(item.id);
      else if (choice.courses.size < catalog.coursesRequired) choice.courses.add(item.id);
      c.classList.toggle('selected', choice.courses.has(item.id));
      $('course-count').textContent = `(${choice.courses.size}/${catalog.coursesRequired} chosen)`;
    } else {
      choice[group] = item.id;
      for (const sib of c.parentElement.children) sib.classList.toggle('selected', sib === c);
    }
  });
  return c;
}

fetch('/api/catalog').then((r) => r.json()).then((cat) => {
  catalog = cat;
  $('concentrations').append(...cat.concentrations.map((c) =>
    card('concentration', c, `${c.id} · ${c.difficulty}`, [c.name, `+ ${c.strengths}`, `− ${c.weaknesses}`])));
  $('housing').append(...cat.housing.map((h) => card('housing', h, h.name, [h.blurb, `Rent $${h.rent}/night`])));
  $('dream-jobs').append(...cat.dreamJobs.map((j) => card('dreamJob', j, j.name, [`Values: ${j.tags.join(', ')}`, `Key ally: ${j.ally.toUpperCase()}`])));
  $('courses').append(...cat.courses.map((c) => card('courses', c, c.name, [c.tags.join(', ')], true)));
  $('course-count').textContent = `(0/${cat.coursesRequired} chosen)`;
  const r = cat.rules;
  $('rules').textContent = `Semester: ${r.semesterDays} days. Each day lasts ${r.dayRealMinutes} real minutes. ` +
    `Burn out more than ${r.maxBurnouts} times and you start over. No extra chances.`;
});

$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('join', {
    name: $('name').value,
    concentration: choice.concentration,
    housing: choice.housing,
    dreamJob: choice.dreamJob,
    courses: [...choice.courses],
  }, (res) => {
    if (!res.ok) { $('setup-error').textContent = res.error; return; }
    show('lobby-screen');
  });
});

/* ================= Lobby ================= */
socket.on('lobbyUpdate', ({ players, max }) => {
  $('lobby-count').textContent = `(${players.length}/${max})`;
  $('lobby-players').replaceChildren(...players.map((p) => el('li', { textContent: `${p.name} · ${p.concentration}` })));
});
$('start-button').addEventListener('click', () => {
  socket.emit('startGame', {}, (res) => { if (!res.ok) $('lobby-error').textContent = res.error; });
});

/* ================= Game state ================= */
let map = null;
let state = null;      // latest public snapshot
let me = null;         // latest private stats
const drawPos = new Map(); // smoothed positions per player id

socket.on('gameStarted', (data) => {
  map = data.map;
  show('game-screen');
  resizeCanvas();
  requestAnimationFrame(draw);
});
socket.on('state', (s) => { state = s; });
socket.on('self', (s) => { me = s; renderHud(); });
socket.on('event', (e) => addLog(e));
socket.on('eliminated', ({ burnouts, day }) => {
  overlay('Burned out', [
    `You burned out ${burnouts} times and couldn't go on. You lasted until day ${day}.`,
    'No extra chances: start over from the beginning.',
  ], 'Start over');
});
socket.on('graduation', ({ result, text }) => {
  const f = result.factors;
  overlay(result.success ? 'Dream job: offered!' : 'Dream job: not this time', [
    text,
    `Dream job: ${result.job}`,
    `Your odds were ${result.chance}% (score ${result.score}/100). The roll was ${result.roll}.`,
    `Grades ${f.grades} · Course relevance ${f.relevance} · Network ${f.network} · Allies ${f.allies} · Career prep ${f.career} · Energy management ${f.energy}`,
    result.relevantCourses.length ? `Relevant courses: ${result.relevantCourses.join(', ')}` : 'None of your courses matched this job.',
  ], 'Play again');
});
socket.on('gameEnded', () => {
  if ($('overlay').hidden) overlay('The semester is over', ['Thanks for playing.'], 'Play again');
});
socket.on('disconnect', () => addLog({ text: 'Disconnected from the server. Refresh to rejoin.', kind: 'danger' }));

function overlay(title, lines, button) {
  const card = $('overlay-card');
  card.replaceChildren(el('h2', { textContent: title }), ...lines.map((l) => el('p', { textContent: l })));
  const b = el('button', { textContent: button });
  b.addEventListener('click', () => location.reload());
  card.append(b);
  $('overlay').hidden = false;
}

function addLog({ text, kind = 'info', day, time }) {
  const prefix = day ? `Day ${day} ${time} · ` : '';
  const row = el('div', { className: `log-${kind}`, textContent: prefix + text });
  $('log').prepend(row);
  while ($('log').children.length > 80) $('log').lastChild.remove();
}

/* ================= HUD ================= */
function renderHud() {
  if (!me) return;
  const e = me.energy;
  $('energy-bar').style.width = `${e}%`;
  $('energy-bar').className = e < 20 ? 'low' : e < 45 ? 'mid' : '';
  $('energy-val').textContent = e;
  $('stats').replaceChildren(
    statLine('Money', `$${me.money}`, me.money < 0 ? 'bad' : ''),
    statLine('Day', `${me.day}/${me.finalDay}${me.midtermDay ? ` · midterm day ${me.midtermDay}` : ''}`),
    statLine('Burnouts', `${me.burnouts}/${me.maxBurnouts}`, me.burnouts >= me.maxBurnouts ? 'bad' : ''),
    statLine('Drain', `${me.drainPerHour} energy/hour`),
    statLine('Network', me.network),
    statLine('Career prep', me.career),
    statLine('Allies', `HKS ${me.allies.hks} · GSD ${me.allies.gsd}`),
  );
  const flags = [];
  if (!me.hasId) flags.push('Harvard ID lost');
  if (!me.laptopOk) flags.push('Laptop dead');
  if (me.homeClosed) flags.push('Kitchen closed (fire)');
  if (me.status === 'collapsed') flags.push('Collapsed until tomorrow');
  $('flags').replaceChildren(...flags.map((f) => el('span', { className: 'flag', textContent: f })));

  $('location').textContent = me.location;
  $('busy').textContent = me.busy ? `${me.busy.label} (${me.busy.remaining} min left)` : '';

  $('activities').replaceChildren(...me.activities.slice(0, 9).map((a, i) => {
    const b = el('button', { type: 'button', disabled: !!a.reason },
      el('strong', { textContent: `${i + 1}. ${a.label}` }),
      el('span', { textContent: ` ${a.minutes} min · ${a.cost}` }));
    if (a.reason) b.append(el('em', { textContent: ` ${a.reason}` }));
    b.addEventListener('click', () => doActivity(a.key));
    return el('li', {}, b);
  }));
  $('improvise-form').hidden = !me.canImprovise;

  $('courses-table').replaceChildren(
    el('tr', {}, ...['Course', 'Mastery', 'Mid', 'Final', 'Pres. (day)'].map((h) => el('th', { textContent: h }))),
    ...me.courses.map((c) => el('tr', {},
      el('td', { textContent: c.name }), el('td', { textContent: c.mastery }),
      el('td', { textContent: c.midterm ?? '–' }), el('td', { textContent: c.final ?? '–' }),
      el('td', { textContent: c.presentation ?? `day ${c.presentationDay}` }))),
  );
}
function statLine(label, value, cls = '') {
  return el('div', { className: `stat ${cls}` }, el('span', { textContent: label }), el('b', { textContent: String(value) }));
}

function doActivity(key) {
  socket.emit('activity', { key }, (res) => { if (!res.ok) addLog({ text: res.error, kind: 'warning' }); });
}

$('improvise-form').addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('improvise', { text: $('improvise').value }, (res) => {
    if (!res.ok) addLog({ text: res.error, kind: 'warning' });
    else $('improvise').value = '';
  });
  $('improvise').blur();
});

/* ================= Input ================= */
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
function typing() { const t = document.activeElement; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); }
function setKey(e, down) {
  if (typing() || $('game-screen').hidden) return;
  const dir = KEYMAP[e.key.toLowerCase()];
  if (dir) {
    e.preventDefault();
    if (keys[dir] !== down) { keys[dir] = down; socket.emit('input', keys); }
    return;
  }
  if (down && /^[1-9]$/.test(e.key) && me && me.activities[Number(e.key) - 1]) {
    doActivity(me.activities[Number(e.key) - 1].key);
  }
}
window.addEventListener('keydown', (e) => setKey(e, true));
window.addEventListener('keyup', (e) => setKey(e, false));
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; socket.emit('input', keys); });

/* ================= Rendering ================= */
const canvas = $('map');
const ctx = canvas.getContext('2d');
const KIND_COLORS = {
  hgse: ['#a51c30', '#ffd9de'],     // crimson
  housing: ['#8a6d46', '#f5e6cc'],
  ally: ['#2f7d4f', '#d6f5e3'],
  enemy: ['#b5542a', '#ffe1d1'],
  rival: ['#5a0f16', '#ffb3bb'],
  neutral: ['#566070', '#e4e8ee'],
  nature: ['#3f7f3a', '#e2f3dc'],
};
const KIND_TAGS = { ally: 'ALLY', enemy: 'ENEMY', rival: 'RIVAL' };

function resizeCanvas() {
  const wrap = $('canvas-wrap');
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

function draw() {
  requestAnimationFrame(draw);
  if (!map) return;
  const W = canvas.width;
  const H = canvas.height;
  const self = state && state.players.find((p) => p.id === socket.id);

  // smooth positions toward the latest server snapshot
  if (state) {
    for (const p of state.players) {
      const d = drawPos.get(p.id) || { x: p.x, y: p.y };
      d.x += (p.x - d.x) * 0.35;
      d.y += (p.y - d.y) * 0.35;
      drawPos.set(p.id, d);
    }
  }
  const focus = self ? drawPos.get(self.id) : { x: map.world.width / 2, y: map.world.height / 2 };
  const camX = Math.max(0, Math.min(map.world.width - W, focus.x - W / 2));
  const camY = Math.max(0, Math.min(map.world.height - H, focus.y - H / 2));

  ctx.save();
  ctx.translate(-camX, -camY);

  // ground + a faint grid of "streets"
  ctx.fillStyle = '#cfe0b8';
  ctx.fillRect(0, 0, map.world.width, map.world.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 14;
  for (let x = 200; x < map.world.width; x += 400) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, map.river.y); ctx.stroke(); }
  for (let y = 150; y < map.river.y; y += 300) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(map.world.width, y); ctx.stroke(); }

  // river and bridges
  ctx.fillStyle = '#5f9fd6';
  ctx.fillRect(0, map.river.y, map.world.width, map.river.h);
  ctx.fillStyle = '#9a8f80';
  for (const [a, b] of map.bridges) ctx.fillRect(a, map.river.y - 6, b - a, map.river.h + 12);
  ctx.fillStyle = '#e8f2fb';
  ctx.font = 'italic 16px Georgia';
  ctx.fillText('Charles River', 120, map.river.y + 46);

  // buildings
  for (const l of map.locations) {
    const [stroke, fill] = KIND_COLORS[l.kind];
    const mine = me && l.name === me.location;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = mine ? 5 : 3;
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle = stroke;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    wrapText(l.name, l.x + l.w / 2, l.y + l.h / 2, l.w - 8, 14);
    if (KIND_TAGS[l.kind]) {
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(KIND_TAGS[l.kind], l.x + l.w / 2, l.y - 6);
    }
    ctx.textAlign = 'left';
  }

  // opportunity markers
  if (state) {
    for (const o of state.opportunities) {
      star(o.x, o.y, 13, '#f2b705');
      ctx.fillStyle = '#5a4300';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.label, o.x, o.y + 26);
      ctx.textAlign = 'left';
    }
  }

  // players
  if (state) {
    for (const p of state.players) {
      if (p.status === 'eliminated' || p.status === 'left') continue;
      const d = drawPos.get(p.id);
      ctx.globalAlpha = p.status === 'collapsed' ? 0.4 : 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = p.id === socket.id ? 4 : 2;
      ctx.strokeStyle = p.id === socket.id ? '#111' : '#333';
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = `${p.id === socket.id ? 'bold ' : ''}12px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const label = p.name + (p.status === 'collapsed' ? ' (zzz)' : p.busy ? ' …' : '');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeText(label, d.x, d.y - 16);
      ctx.fillText(label, d.x, d.y - 16);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  if (state) {
    $('clock').textContent = `Day ${state.day} · ${state.time}${state.strike ? ' · STRIKE' : ''}`;
  }
}

function wrapText(text, x, y, maxW, lineH) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  const top = y - ((lines.length - 1) * lineH) / 2 + 4;
  lines.forEach((l, i) => ctx.fillText(l, x, top + i * lineH));
}

function star(x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r / 2.2 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#7a5b00';
  ctx.lineWidth = 2;
  ctx.stroke();
}
