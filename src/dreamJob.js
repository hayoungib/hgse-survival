// The end-of-game "random engine". Luck still decides, but the odds are
// built from everything the student did over the semester.

const { COURSES, DREAM_JOBS } = require('./data/catalog');
const { clamp } = require('./player');

const WEIGHTS = {
  grades: 0.25,     // final course grades
  relevance: 0.15,  // how many of your courses match your dream job
  network: 0.15,    // networking
  allies: 0.10,     // HKS/GSD alliances (the one your dream job values counts more)
  career: 0.15,     // career services, pitch nights, debates
  energy: 0.20,     // energy management: average end-of-day energy minus burnouts
};
const BURNOUT_PENALTY = 15;
const MIN_CHANCE = 0.05;
const MAX_CHANCE = 0.95;

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Missing midterm (e.g. cancelled by a strike) falls back to the final. */
function courseGrade(c) {
  const final = c.final ?? 0;
  const midterm = c.midterm ?? final;
  return clamp(0.4 * c.mastery + 0.2 * midterm + 0.25 * final + 0.15 * (c.presentation ?? 0));
}

function evaluateDreamJob(p, rng = Math.random) {
  const job = DREAM_JOBS[p.dreamJob];
  const ids = Object.keys(p.courses);

  const grades = avg(ids.map((id) => courseGrade(p.courses[id])));
  const relevantCourses = ids.filter((id) => COURSES[id].tags.some((t) => job.tags.includes(t)));
  const relevance = (100 * relevantCourses.length) / ids.length;
  const other = job.ally === 'hks' ? 'gsd' : 'hks';
  const allies = 0.7 * p.allies[job.ally] + 0.3 * p.allies[other];
  const energy = clamp(avg(p.dayEndEnergies) - BURNOUT_PENALTY * p.burnouts);

  const factors = { grades, relevance, network: p.network, allies, career: p.career, energy };
  let score = 0;
  for (const [k, wt] of Object.entries(WEIGHTS)) score += wt * factors[k];

  const chance = MIN_CHANCE + (MAX_CHANCE - MIN_CHANCE) * (score / 100);
  const roll = rng();
  const round = (n) => Math.round(n);

  return {
    job: job.name,
    success: roll < chance,
    score: round(score),
    chance: Math.round(chance * 100),
    roll: Math.round(roll * 100),
    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, round(v)])),
    weights: WEIGHTS,
    relevantCourses: relevantCourses.map((id) => COURSES[id].name),
    burnouts: p.burnouts,
  };
}

module.exports = { evaluateDreamJob, courseGrade, WEIGHTS };
