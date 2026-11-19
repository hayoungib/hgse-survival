const { CONCENTRATIONS, HOUSING } = require('./data/catalog');
const { centerOf } = require('./data/map');

const COLORS = ['#e8c547', '#5bc0eb', '#9bc53d', '#fa7921', '#c879ff', '#ff5d8f', '#4ecdc4', '#f4f1de'];
const BASE_MONEY = 450;

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Concentration modifier with a default. */
function mod(p, key, def = 1) {
  const v = CONCENTRATIONS[p.concentration].mods[key];
  return v === undefined ? def : v;
}

function freshDaily() {
  return { coffees: 0, meals: 0, naps: 0, riverWalk: false };
}

function createPlayer({ id, setup }, index) {
  const home = centerOf(setup.housing);
  const courses = {};
  for (const c of setup.courses) courses[c] = { mastery: 0, midterm: null, final: null, presentation: null };
  return {
    id,
    name: setup.name,
    color: COLORS[index % COLORS.length],
    concentration: setup.concentration,
    housing: setup.housing,
    dreamJob: setup.dreamJob,
    courses,
    presentations: [], // [{ course, day, done }]
    energy: 100,
    money: BASE_MONEY + mod({ concentration: setup.concentration }, 'startMoney', 0),
    network: 0,
    career: 0,
    allies: { hks: 0, gsd: 0 },
    hasId: true,
    laptopOk: true,
    homeClosed: false,
    burnouts: 0,
    status: 'active', // active | collapsed | eliminated | graduated | left
    busy: null,
    x: home.x,
    y: home.y,
    input: { up: false, down: false, left: false, right: false },
    location: setup.housing,
    daily: freshDaily(),
    dayEndEnergies: [],
    improviseReadyAt: 0,
    result: null,
  };
}

/**
 * Applies an effects object to a player. Effects shape:
 * { energy, money, network, career, hks, gsd, mastery: { all: n } | { [courseId]: n }, set: { flag: value } }
 * Concentration modifiers for network and alliances are applied here, once,
 * so individual activities don't need to repeat them.
 * Returns the effects actually applied (after modifiers), for display.
 */
function applyEffects(p, eff = {}) {
  const applied = {};
  if (eff.energy) {
    const before = p.energy;
    p.energy = clamp(p.energy + eff.energy);
    applied.energy = Math.round(p.energy - before);
  }
  if (eff.money) {
    p.money = Math.round(p.money + eff.money); // money can go negative (debt)
    applied.money = Math.round(eff.money);
  }
  if (eff.network) {
    const gain = eff.network > 0 ? eff.network * mod(p, 'network') : eff.network;
    const before = p.network;
    p.network = clamp(p.network + gain);
    applied.network = Math.round(p.network - before);
  }
  if (eff.career) {
    const before = p.career;
    p.career = clamp(p.career + eff.career);
    applied.career = Math.round(p.career - before);
  }
  for (const ally of ['hks', 'gsd']) {
    if (!eff[ally]) continue;
    const gain = eff[ally] > 0 ? eff[ally] * mod(p, ally) : eff[ally];
    const before = p.allies[ally];
    p.allies[ally] = clamp(p.allies[ally] + gain);
    applied[ally] = Math.round(p.allies[ally] - before);
  }
  if (eff.mastery) {
    const targets = eff.mastery.all !== undefined
      ? Object.keys(p.courses).map((c) => [c, eff.mastery.all])
      : Object.entries(eff.mastery).filter(([c]) => p.courses[c]);
    let total = 0;
    for (const [c, n] of targets) {
      const course = p.courses[c];
      // Diminishing returns: the closer to mastery, the slower the gain.
      const gain = n > 0 ? n * (1 - course.mastery / 125) : n;
      const before = course.mastery;
      course.mastery = clamp(course.mastery + gain);
      total += course.mastery - before;
    }
    if (targets.length) applied.mastery = Math.round((total / targets.length) * 10) / 10;
  }
  if (eff.set) {
    Object.assign(p, eff.set);
    applied.set = eff.set;
  }
  return applied;
}

const LABELS = {
  energy: 'energy', network: 'network', career: 'career prep',
  hks: 'HKS alliance', gsd: 'GSD alliance', mastery: 'course mastery',
};

/** Human-readable summary like "+12 energy, -$6". */
function summarizeEffects(eff = {}) {
  const parts = [];
  for (const key of ['energy', 'money', 'mastery', 'network', 'career', 'hks', 'gsd']) {
    const v = eff[key];
    if (!v) continue;
    if (key === 'money') parts.push(`${v > 0 ? '+' : '-'}$${Math.abs(v)}`);
    else parts.push(`${v > 0 ? '+' : ''}${v} ${LABELS[key]}`);
  }
  return parts.join(', ');
}

function homeRecovery(p) {
  return HOUSING[p.housing].recovery + mod(p, 'recovery', 0);
}

module.exports = { createPlayer, applyEffects, summarizeEffects, mod, clamp, freshDaily, homeRecovery };
