const { World } = require('../src/world');
const { createMockNarrator } = require('../src/narrator');
const { loadConfig } = require('../src/config');

/** Captures everything the world emits, by room. */
class FakeIo {
  constructor() { this.log = []; }
  to(room) { return { emit: (event, data) => this.log.push({ room, event, data }) }; }
  events(room, event) { return this.log.filter((e) => (!room || e.room === room) && (!event || e.event === event)); }
}

/** Deterministic RNG. */
function seeded(seed = 1) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const setup = (name, extra = {}) => ({
  name,
  concentration: 'ELOE',
  housing: 'kronkite',
  dreamJob: 'edtechFounder',
  courses: ['edEntrepreneurship', 'edTechLab', 'leadingChange', 'learningDesign'],
  ...extra,
});

function makeWorld({ players = [setup('Ana')], config = {}, rng = seeded(7) } = {}) {
  const io = new FakeIo();
  const cfg = loadConfig({ dayRealMinutes: 1, semesterDays: 4, ...config });
  const world = new World({
    io, narrator: createMockNarrator(), config: cfg, rng,
    players: players.map((s, i) => ({ id: `p${i}`, setup: s })),
  });
  return { world, io, cfg };
}

/** Advances the clock by game minutes without the real-time interval. */
function runMinutes(world, minutes, chunk = 5) {
  for (let m = 0; m < minutes && !world.finished && !world.over; m += chunk) world.advance(chunk);
}

const flush = () => new Promise((r) => setImmediate(r));

module.exports = { FakeIo, seeded, setup, makeWorld, runMinutes, flush };
