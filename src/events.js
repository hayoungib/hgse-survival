// Random events. The engine decides WHAT happens and applies the numbers;
// the AI narrator only describes it. Every event has a plain-text template
// so the game works fully without an API key.

const { distanceTo } = require('./data/map');
const { mod } = require('./player');

const near = (p, id, r = 300) => distanceTo(p.x, p.y, id) <= r;
const avgMastery = (p) => {
  const v = Object.values(p.courses).map((c) => c.mastery);
  return v.reduce((a, b) => a + b, 0) / v.length;
};
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

const PERSONAL_EVENTS = [
  {
    id: 'laptop_dies',
    weight: (p) => (p.laptopOk ? 2 : 0),
    resolve: (p) => ({
      effects: { set: { laptopOk: false } },
      text: `${p.name}'s laptop dies mid-assignment. Studying is less effective until it's repaired at Smith Campus Center ($120).`,
    }),
  },
  {
    id: 'lost_id',
    weight: (p) => (p.hasId ? 2 : 0),
    resolve: (p) => ({
      effects: { set: { hasId: false } },
      text: `${p.name} lost their Harvard ID. Gutman, Longfellow and Larsen are locked until it's replaced at Smith Campus Center ($30).`,
    }),
  },
  {
    id: 'surprise_expense',
    weight: () => 3,
    resolve: (p, w, rng) => {
      const amount = 40 + Math.round(rng() * 50);
      const what = pick(['a required course reader', 'a cracked phone screen', 'a T-pass top-up', 'a birthday dinner you could not skip', 'printing for a group project'], rng);
      return { effects: { money: -amount }, text: `Surprise expense for ${p.name}: ${what}.` };
    },
  },
  {
    id: 'afternoon_slump',
    weight: (p, w) => (w.hour >= 13 && w.hour < 17 ? 3 : 0),
    resolve: (p) => ({ effects: { energy: -10 }, text: `The afternoon slump hits ${p.name} hard.` }),
  },
  {
    id: 'stove_fire',
    weight: (p) => (p.location === p.housing && !p.homeClosed ? 1 : 0),
    resolve: (p) => ({
      effects: { energy: -15, money: -60, set: { homeClosed: true } },
      text: `${p.name}'s stove catches fire! The kitchen is off-limits until tomorrow.`,
    }),
  },
  {
    id: 'too_many_events',
    weight: () => 2,
    resolve: (p) => ({
      effects: { energy: -8 },
      text: `${p.name}'s inbox explodes with talks, panels and info sessions. Just deciding what to skip is exhausting.`,
    }),
  },
  // --- Faction encounters ---
  {
    id: 'hbs_poach',
    weight: (p) => (near(p, 'hbs') ? 4 : 0),
    resolve: (p) => ({ effects: { network: -4 }, text: `An HBS student pitches over ${p.name} and walks off with a contact.` }),
  },
  {
    id: 'hls_argue',
    weight: (p) => (near(p, 'hls') ? 4 : p.housing === 'somerville' ? 2 : 0),
    resolve: (p) => ({ effects: { energy: -8 }, text: `An HLS neighbor drags ${p.name} into a 40-minute argument about nothing.` }),
  },
  {
    id: 'mit_challenge',
    weight: (p, w) => (near(p, 'mit', 350) ? 6 : w.day >= 4 ? 1 : 0),
    resolve: (p) => {
      if (avgMastery(p) > 55) {
        return { effects: { career: 6, network: 5 }, text: `MIT students challenge ${p.name} to a hackathon, and ${p.name} holds their own.` };
      }
      return {
        effects: { energy: -Math.round(15 * mod(p, 'mitDamage')) },
        text: `MIT students challenge ${p.name} to a hackathon. It is brutal.`,
      };
    },
  },
  {
    id: 'hks_help',
    weight: (p) => (near(p, 'hks') ? 4 : 0),
    resolve: (p) => ({ effects: { energy: 8, hks: 3 }, text: `A friend from the Kennedy School buys ${p.name} a coffee and shares contacts.` }),
  },
  {
    id: 'gsd_help',
    weight: (p) => (near(p, 'gsd') ? 4 : 0),
    resolve: (p) => ({ effects: { gsd: 3, mastery: { all: 2 } }, text: `A GSD student helps ${p.name} storyboard a project.` }),
  },
];

function weightedPick(list, weightOf, rng) {
  const weighted = list.map((e) => [e, weightOf(e)]).filter(([, wt]) => wt > 0);
  const total = weighted.reduce((s, [, wt]) => s + wt, 0);
  if (!total) return null;
  let r = rng() * total;
  for (const [e, wt] of weighted) {
    r -= wt;
    if (r <= 0) return e;
  }
  return weighted[weighted.length - 1][0];
}

/** Chance of a personal event this hour grows every day. */
function rollPersonalEvent(p, w, rng) {
  const c = w.config;
  const chance = Math.min(c.eventCap, c.eventBase + c.eventPerDay * (w.day - 1));
  if (rng() >= chance) return null;
  return weightedPick(PERSONAL_EVENTS, (e) => e.weight(p, w), rng);
}

const GLOBAL_EVENTS = [
  {
    id: 'opportunity_overload',
    weight: () => 3,
  },
  {
    id: 'strike',
    // Never in the first two days, never overlapping finals, at most once every 4 days.
    weight: (w) => (w.day >= 3 && w.day + 1 <= w.finalDay - 1 && !w.strikeToday && w.day - w.lastStrikeDay >= 4 ? 1 : 0),
  },
];

function rollGlobalEvent(w, rng) {
  const c = w.config;
  const chance = Math.min(c.globalCap, c.globalBase + c.globalPerDay * (w.day - 1));
  if (rng() >= chance) return null;
  return weightedPick(GLOBAL_EVENTS, (e) => e.weight(w), rng);
}

const OPPORTUNITY_LABELS = [
  'Ed-tech founder fireside chat', 'Free-pizza info session', 'Superintendent panel',
  'Alumni coffee chat', 'Research lab open house', 'Nonprofit career fair',
];

module.exports = { PERSONAL_EVENTS, rollPersonalEvent, rollGlobalEvent, OPPORTUNITY_LABELS, avgMastery };
