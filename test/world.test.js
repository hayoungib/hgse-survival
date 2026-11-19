const { test } = require('node:test');
const assert = require('node:assert');
const { makeWorld, runMinutes, setup, flush, seeded } = require('./helpers');
const { applyEffects, createPlayer } = require('../src/player');
const { evaluateDreamJob } = require('../src/dreamJob');
const { validateSetup } = require('../src/data/catalog');
const { activityMenu } = require('../src/activities');
const MAP = require('../src/data/map');

test('setup validation requires 4 valid courses and known options', () => {
  assert.equal(validateSetup(setup('A')).ok, true);
  assert.equal(validateSetup(setup('A', { courses: ['childDev'] })).ok, false);
  assert.equal(validateSetup(setup('A', { housing: 'mansion' })).ok, false);
  assert.equal(validateSetup(setup('   ')).ok, false);
});

test('walking time matches the design: Kronkite ~2 min, Peabody ~25 min from HGSE', () => {
  const edge = (id) => MAP.distanceTo(MAP.centerOf(id).x, MAP.centerOf(id).y, 'larsen');
  const minutes = (id) => edge(id) / 44;
  assert.ok(minutes('kronkite') < 3, `kronkite ${minutes('kronkite')}`);
  const peabody = MAP.distanceTo(MAP.centerOf('peabody').x, MAP.centerOf('peabody').y, 'longfellow') / 44;
  assert.ok(peabody > 18 && peabody < 28, `peabody ${peabody}`);
});

test('the river blocks movement except at bridges', () => {
  assert.equal(MAP.isBlocked(1000, 1040), true);
  assert.equal(MAP.isBlocked(600, 1040), false);
});

test('concentration modifiers apply to network gains', () => {
  const eloe = createPlayer({ id: 'a', setup: setup('A', { concentration: 'ELOE' }) }, 0);
  const hde = createPlayer({ id: 'b', setup: setup('B', { concentration: 'HDE' }) }, 1);
  applyEffects(eloe, { network: 10 });
  applyEffects(hde, { network: 10 });
  assert.equal(eloe.network, 14);
  assert.equal(hde.network, 9);
});

test('lost ID locks HGSE activities with a clear reason', () => {
  const { world } = makeWorld();
  const p = world.players.get('p0');
  p.location = 'gutman';
  p.hasId = false;
  const study = activityMenu(p, world).find((i) => i.key.startsWith('study'));
  assert.match(study.reason, /Harvard ID/);
});

test('an activity costs energy up front and pays off when finished', () => {
  const { world } = makeWorld();
  const p = world.players.get('p0');
  Object.assign(p, { location: 'longfellow', x: 1115, y: 595 });
  world.minute = 9 * 60;
  const before = p.energy;
  const r = world.startActivity('p0', 'attend:edTechLab');
  assert.equal(r.ok, true);
  assert.ok(p.energy < before);
  runMinutes(world, 95);
  assert.equal(p.busy, null);
  assert.ok(p.courses.edTechLab.mastery > 5);
});

test('a strike cancels classes', () => {
  const { world } = makeWorld();
  const p = world.players.get('p0');
  Object.assign(p, { location: 'longfellow' });
  world.minute = 9 * 60;
  world.strikeUntilDay = world.day;
  assert.equal(world.startActivity('p0', 'attend:edTechLab').ok, false);
});

test('burnout: collapse until tomorrow; burning out MORE than maxBurnouts ends the run', () => {
  const { world, io } = makeWorld({ config: { maxBurnouts: 3, semesterDays: 10 } });
  const p = world.players.get('p0');
  for (let i = 1; i <= 3; i++) {
    world.effect(p, { energy: -200 });
    assert.equal(p.status, 'collapsed', `burnout ${i}`);
    assert.equal(p.burnouts, i);
    world.endDay(); // next morning
    assert.equal(p.status, 'active');
  }
  world.effect(p, { energy: -200 });
  assert.equal(p.status, 'eliminated');
  assert.equal(io.events('p0', 'eliminated').length, 1);
  assert.equal(world.over, true, 'a world with no live players ends');
});

test('energy drains faster each day', () => {
  const { world } = makeWorld({ config: { semesterDays: 10 } });
  const d1 = world.drainPerHour();
  world.day = 8;
  assert.ok(world.drainPerHour() > d1);
});

test('missing the midterm scores zero; attending scores by mastery and energy', () => {
  const { world } = makeWorld({ players: [setup('Here'), setup('Away')], config: { semesterDays: 6 } });
  const here = world.players.get('p0');
  const away = world.players.get('p1');
  world.day = world.midtermDay;
  world.minute = 9 * 60 + 50;
  Object.assign(here, { location: 'longfellow', x: 1115, y: 595 });
  for (const c of Object.values(here.courses)) c.mastery = 70;
  away.location = 'kronkite';
  runMinutes(world, 15);
  for (const c of Object.values(here.courses)) assert.ok(c.midterm > 40, `midterm ${c.midterm}`);
  for (const c of Object.values(away.courses)) assert.equal(c.midterm, 0);
});

test('surviving the last day graduates the player with a dream-job result', async () => {
  const { world, io } = makeWorld({ config: { semesterDays: 2 } });
  const p = world.players.get('p0');
  p.energy = 100;
  // Keep the student alive with naps at home.
  for (let day = 0; day < 2 && !world.finished; day++) {
    for (let i = 0; i < 16 && !world.finished; i++) {
      p.energy = 100;
      runMinutes(world, 60);
    }
  }
  await flush();
  await flush();
  assert.equal(p.status, 'graduated');
  assert.ok(p.result);
  assert.equal(typeof p.result.success, 'boolean');
  assert.equal(io.events('p0', 'graduation').length, 1);
  assert.equal(world.over, true);
});

test('dream-job odds rise with everything the student did', () => {
  const base = createPlayer({ id: 'a', setup: setup('A') }, 0);
  const strong = createPlayer({ id: 'b', setup: setup('B') }, 1);
  base.dayEndEnergies = [10, 10, 10];
  base.burnouts = 2;
  Object.assign(strong, { network: 80, career: 80, allies: { hks: 40, gsd: 90 }, dayEndEnergies: [70, 65, 80] });
  for (const c of Object.values(strong.courses)) Object.assign(c, { mastery: 85, midterm: 80, final: 85, presentation: 90 });
  const a = evaluateDreamJob(base, seeded(3));
  const b = evaluateDreamJob(strong, seeded(3));
  assert.ok(b.chance > a.chance + 40, `${a.chance} vs ${b.chance}`);
  assert.equal(b.factors.relevance, 75); // 3 of the 4 test courses match the founder job tags
  assert.ok(a.chance >= 5 && b.chance <= 95);
});

test('opportunity markers are first come, first served', () => {
  const { world } = makeWorld({ players: [setup('A'), setup('B')] });
  world.runGlobalEvent('opportunity_overload');
  const o = world.opportunities[0];
  for (const id of ['p0', 'p1']) Object.assign(world.players.get(id), { x: o.x, y: o.y, location: null });
  assert.equal(world.startActivity('p0', `opportunity:${o.id}`).ok, true);
  assert.equal(world.startActivity('p1', `opportunity:${o.id}`).ok, false);
});

test('a full simulated semester with random events never crashes', async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { world } = makeWorld({
      players: ['ELOE', 'LDIT', 'EPA', 'HDE', 'TTF'].map((c, i) => setup(`P${i}`, { concentration: c, housing: ['kronkite', 'peabody', 'southCampus', 'somerville', 'kronkite'][i] })),
      config: { semesterDays: 6 }, rng: seeded(seed),
    });
    let guard = 0;
    while (!world.finished && !world.over && guard++ < 20000) {
      for (const p of world.activePlayers()) {
        if (!p.busy) {
          const opts = activityMenu(p, world).filter((i) => !i.reason);
          if (opts.length && world.rng() < 0.5) world.startActivity(p.id, opts[0].key);
        }
      }
      world.advance(10);
    }
    await flush();
    assert.ok(world.finished || world.over, `seed ${seed} did not finish`);
  }
});
