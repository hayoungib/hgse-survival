const { COURSES, HOUSING } = require('./data/catalog');
const { mod, summarizeEffects } = require('./player');

// How effective studying / class is, given laptop state and concentration.
function studyFactor(p) {
  return mod(p, 'mastery') * (p.laptopOk ? 1 : mod(p, 'laptopBroken', 0.5));
}
function classFactor(p) {
  return mod(p, 'classMastery') * (p.laptopOk ? 1 : mod(p, 'laptopBroken', 1));
}
const coursesWithTags = (p, tags) =>
  Object.keys(p.courses).filter((c) => COURSES[c].tags.some((t) => tags.includes(t)));

/**
 * Activity definitions.
 *  at:       location ids where it's offered, or 'home' (the player's own housing)
 *  hours:    [open, close) in 24h game hours
 *  hgse:     requires a Harvard ID (Gutman, Longfellow, Larsen)
 *  noStrike: cancelled during a TF/professor strike
 *  perCourse: one menu entry per enrolled course
 *  cost:     effects applied when starting (pay energy/money up front)
 *  reward:   effects applied when finished; may return a custom text and narrate:true
 */
const ACTIVITIES = [
  // --- Gutman Library ---
  {
    id: 'study', at: ['gutman'], minutes: 60, hgse: true, perCourse: true,
    label: (c) => `Study: ${COURSES[c].name}`,
    cost: () => ({ energy: -12 }),
    reward: (p, w, c) => ({ effects: { mastery: { [c]: 5 * studyFactor(p) } } }),
  },
  {
    id: 'coffee', at: ['gutman'], minutes: 15, label: 'Coffee at Gutman Café',
    cost: () => ({ money: -6 }),
    reward: (p) => {
      const gain = [12, 8, 4, 0][Math.min(p.daily.coffees, 3)];
      p.daily.coffees += 1;
      return { effects: { energy: gain }, text: gain ? 'The caffeine kicks in.' : 'Your body no longer responds to coffee today.' };
    },
  },
  {
    id: 'lunch', at: ['gutman'], minutes: 30, label: 'Eat at Gutman Café',
    cost: () => ({ money: -14 }),
    reward: (p) => {
      const gain = p.daily.meals < 3 ? 20 : 5;
      p.daily.meals += 1;
      return { effects: { energy: gain } };
    },
  },

  // --- Longfellow Hall ---
  {
    id: 'attend', at: ['longfellow'], minutes: 90, hours: [9, 17], hgse: true, noStrike: true, perCourse: true,
    label: (c) => `Attend class: ${COURSES[c].name}`,
    cost: (p) => ({ energy: -Math.round(10 * mod(p, 'classEnergy')) }),
    reward: (p, w, c) => ({ effects: { mastery: { [c]: 7 * classFactor(p) } } }),
  },

  // --- Larsen Hall ---
  {
    id: 'officeHours', at: ['larsen'], minutes: 30, hours: [10, 17], hgse: true, noStrike: true,
    label: 'Go to office hours (all courses)',
    cost: () => ({ energy: -6 }),
    reward: () => ({ effects: { mastery: { all: 2 } } }),
  },
  {
    id: 'careerServices', at: ['larsen'], minutes: 45, hours: [9, 17], hgse: true,
    label: 'Career services appointment',
    cost: () => ({ energy: -8 }),
    reward: () => ({ effects: { career: 6 } }),
  },

  // --- Smith Campus Center (neutral services) ---
  {
    id: 'partTimeJob', at: ['smith'], minutes: 120, hours: [8, 22], label: 'Part-time job shift',
    cost: () => ({ energy: -18 }),
    reward: () => ({ effects: { money: 60 } }),
  },
  {
    id: 'replaceId', at: ['smith'], minutes: 20, label: 'Replace lost Harvard ID',
    visible: (p) => !p.hasId,
    cost: () => ({ money: -30 }),
    reward: () => ({ effects: { set: { hasId: true } }, text: 'New Harvard ID in hand. HGSE buildings are open to you again.' }),
  },
  {
    id: 'repairLaptop', at: ['smith'], minutes: 60, label: 'Repair laptop',
    visible: (p) => !p.laptopOk,
    cost: () => ({ money: -120 }),
    reward: () => ({ effects: { set: { laptopOk: true } }, text: 'Your laptop lives again.' }),
  },
  {
    id: 'socialMixer', at: ['smith'], minutes: 60, hours: [18, 24], label: 'Grad student social mixer',
    cost: (p) => (mod(p, 'socialRestores', false) ? {} : { energy: -10 }),
    reward: (p) => ({ effects: { network: 5, energy: mod(p, 'socialRestores', false) ? 8 : 0 } }),
  },

  // --- Home (your own housing only) ---
  {
    id: 'nap', at: 'home', minutes: 60, label: 'Take a nap',
    cost: () => ({}),
    reward: (p) => {
      const gain = p.daily.naps < 2 ? 18 : 6;
      p.daily.naps += 1;
      return { effects: { energy: gain } };
    },
  },
  {
    id: 'cook', at: 'home', minutes: 45, label: 'Cook a meal',
    cost: () => ({ money: -8 }),
    reward: (p, w, c, rng) => {
      if (rng() < 0.08) {
        return {
          effects: { energy: -15, money: -60, set: { homeClosed: true } },
          text: `${p.name}'s stove catches fire! The kitchen is off-limits until tomorrow.`,
          narrate: { event: 'stove_fire' },
        };
      }
      return { effects: { energy: 22 } };
    },
  },

  // --- Nature ---
  {
    id: 'riverWalk', at: ['riverbank'], minutes: 30, label: 'Walk along the Charles',
    reasonFn: (p) => (p.daily.riverWalk ? 'You already walked the river today.' : null),
    cost: () => ({}),
    reward: (p) => {
      p.daily.riverWalk = true;
      return { effects: { energy: 10 + (HOUSING[p.housing].riverBonus || 0) } };
    },
  },

  // --- Neutral: i-lab, Stadium ---
  {
    id: 'pitchNight', at: ['ilab'], minutes: 90, hours: [10, 22], label: 'i-lab pitch night',
    cost: () => ({ energy: -20 }),
    reward: (p) => {
      const m = mod(p, 'ilab') * (HOUSING[p.housing].ilab || 1);
      return { effects: { network: 8 * m, career: 4 * m } };
    },
  },
  {
    id: 'gameNight', at: ['stadium'], minutes: 90, hours: [17, 23], label: 'Harvard game at the Stadium',
    cost: (p) => (mod(p, 'socialRestores', false) ? {} : { energy: -10 }),
    reward: (p) => ({ effects: { network: 4, energy: mod(p, 'socialRestores', false) ? 6 : 0 } }),
  },

  // --- Allies ---
  {
    id: 'policyForum', at: ['hks'], minutes: 60, hours: [9, 20], label: 'HKS policy forum',
    cost: () => ({ energy: -12 }),
    reward: () => ({ effects: { network: 5, hks: 8 } }),
  },
  {
    id: 'designCrit', at: ['gsd'], minutes: 60, hours: [9, 21], label: 'GSD design critique',
    cost: () => ({ energy: -12 }),
    reward: (p) => {
      const rel = coursesWithTags(p, ['design', 'technology']);
      const mastery = rel.length ? Object.fromEntries(rel.map((c) => [c, 4])) : { all: 1 };
      return { effects: { gsd: 8, mastery } };
    },
  },

  // --- Enemies ---
  {
    id: 'caseMixer', at: ['hbs'], minutes: 60, hours: [12, 22], label: 'HBS case-competition mixer (risky)',
    cost: () => ({ energy: -15 }),
    reward: (p, w, c, rng) => {
      if (rng() < 0.4) {
        return {
          effects: { network: 2, energy: -5 },
          text: `An HBS student talked over ${p.name} the entire evening.`,
          narrate: { event: 'hbs_spotlight' },
        };
      }
      return { effects: { network: 9 }, text: 'You held your own among the MBAs.' };
    },
  },
  {
    id: 'mootDebate', at: ['hls'], minutes: 60, hours: [10, 20], label: 'Debate HLS students (risky)',
    cost: () => ({ energy: -18 }),
    reward: (p, w, c, rng) => {
      if (rng() < 0.5) {
        return { effects: { career: 6, network: 4 }, text: `${p.name} out-argued a future lawyer.`, narrate: { event: 'hls_win' } };
      }
      return { effects: { energy: -10 }, text: `${p.name} was cross-examined into exhaustion.`, narrate: { event: 'hls_loss' } };
    },
  },

  // --- Hardcore rival ---
  {
    id: 'crossReg', at: ['mit'], minutes: 120, hours: [9, 18], label: 'Cross-register for an MIT lecture (very risky)',
    cost: () => ({ energy: -28 }),
    reward: (p, w, c, rng) => {
      const rel = coursesWithTags(p, ['technology', 'data']);
      const mastery = rel.length ? Object.fromEntries(rel.map((id) => [id, 9])) : { all: 4 };
      if (rng() < 0.3) {
        return {
          effects: { mastery, energy: -Math.round(15 * mod(p, 'mitDamage')) },
          text: `An MIT professor cold-called ${p.name} on a proof. It did not go well.`,
          narrate: { event: 'mit_humiliation' },
        };
      }
      return { effects: { mastery }, text: 'You survived MIT and learned a lot.' };
    },
  },
];

// Pseudo-activity for opportunity markers spawned by the "too many opportunities" event.
const OPPORTUNITY = {
  id: 'opportunity', minutes: 45,
  cost: (p) => ({ energy: -Math.round(15 * mod(p, 'opportunityEnergy')) }),
  reward: () => ({ effects: { network: 7, career: 3 } }),
};

const OPPORTUNITY_RADIUS = 45;
const byId = new Map(ACTIVITIES.map((a) => [a.id, a]));

function offeredHere(p, def) {
  if (def.at === 'home') return p.location === p.housing;
  return def.at.includes(p.location);
}

function blockReason(p, def, w) {
  if (def.hours && (w.hour < def.hours[0] || w.hour >= def.hours[1])) {
    return `Open ${def.hours[0]}:00 to ${def.hours[1]}:00.`;
  }
  if (def.hgse && !p.hasId) return 'You lost your Harvard ID. Replace it at Smith Campus Center.';
  if (def.noStrike && w.strikeToday) return 'Cancelled: TFs and professors are on strike.';
  if (def.at === 'home' && p.homeClosed) return 'Your kitchen is a fire scene until tomorrow.';
  if (def.reasonFn) return def.reasonFn(p, w);
  return null;
}

function affordReason(p, cost) {
  if (cost.money && p.money + cost.money < 0) return 'Not enough money.';
  if (cost.energy && p.energy + cost.energy <= 0) return 'Not enough energy. You would burn out.';
  return null;
}

/** What the player can do right where they are standing. */
function activityMenu(p, w) {
  const items = [];
  if (!p.location) {
    // Out in the open: only opportunity markers.
  } else {
    for (const def of ACTIVITIES) {
      if (!offeredHere(p, def)) continue;
      if (def.visible && !def.visible(p, w)) continue;
      const entries = def.perCourse ? Object.keys(p.courses).map((c) => ({ key: `${def.id}:${c}`, course: c })) : [{ key: def.id }];
      for (const e of entries) {
        const cost = def.cost(p, w);
        items.push({
          key: e.key,
          label: typeof def.label === 'function' ? def.label(e.course) : def.label,
          minutes: def.minutes,
          cost: summarizeEffects(cost) || 'free',
          reason: blockReason(p, def, w) || affordReason(p, cost),
        });
      }
    }
  }
  for (const o of w.opportunities) {
    if (Math.hypot(o.x - p.x, o.y - p.y) > OPPORTUNITY_RADIUS) continue;
    const cost = OPPORTUNITY.cost(p);
    items.push({
      key: `opportunity:${o.id}`,
      label: `Opportunity: ${o.label}`,
      minutes: OPPORTUNITY.minutes,
      cost: summarizeEffects(cost),
      reason: affordReason(p, cost),
    });
  }
  return items;
}

/** Resolves a menu key to its definition, or returns { error }. */
function resolveActivity(p, w, key) {
  const entry = activityMenu(p, w).find((i) => i.key === key);
  if (!entry) return { error: 'You cannot do that here.' };
  if (entry.reason) return { error: entry.reason };
  const [id, arg] = String(key).split(':');
  if (id === 'opportunity') return { def: OPPORTUNITY, opportunityId: arg, label: entry.label };
  return { def: byId.get(id), course: arg, label: entry.label };
}

module.exports = { ACTIVITIES, OPPORTUNITY, activityMenu, resolveActivity };
