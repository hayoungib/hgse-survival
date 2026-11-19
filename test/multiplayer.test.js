const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createAppServer } = require('../src/app');
const { createMockNarrator } = require('../src/narrator');
const { loadConfig } = require('../src/config');
const { setup } = require('./helpers');

let server, url;
const clients = [];

before(async () => {
  ({ server } = createAppServer({ narrator: createMockNarrator(), config: loadConfig({ dayRealMinutes: 0.5, semesterDays: 3 }) }));
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});
after(() => { clients.forEach((c) => c.close()); server.close(); });

function client() {
  const c = connect(url, { forceNew: true, transports: ['websocket'] });
  clients.push(c);
  return c;
}
const emit = (c, ev, data) => new Promise((r) => c.emit(ev, data, r));
const once = (c, ev) => new Promise((r) => c.once(ev, r));

test('catalog endpoint lists all five concentrations', async () => {
  const cat = await (await fetch(`${url}/api/catalog`)).json();
  assert.deepEqual(cat.concentrations.map((c) => c.id), ['ELOE', 'LDIT', 'EPA', 'HDE', 'TTF']);
  assert.equal(cat.housing.length, 4);
});

test('joining requires a complete character', async () => {
  const c = client();
  assert.equal((await emit(c, 'join', { name: 'X' })).ok, false);
});

test('any player can start; everyone in the room shares one campus; a fresh room opens', async () => {
  const a = client(), b = client(), late = client();
  await emit(a, 'join', setup('Aria'));
  await emit(b, 'join', setup('Bram', { concentration: 'HDE', housing: 'peabody' }));
  const sa = once(a, 'gameStarted');
  const sb = once(b, 'gameStarted');
  assert.equal((await emit(b, 'startGame', {})).ok, true);
  const [ga] = await Promise.all([sa, sb]);
  assert.deepEqual(ga.party.map((p) => p.name), ['Aria', 'Bram']);

  const snap = await once(a, 'state');
  assert.equal(snap.players.length, 2);
  const self = await once(b, 'self');
  assert.equal(self.location, 'Peabody Terrace');

  const lobby = once(late, 'lobbyUpdate');
  await emit(late, 'join', setup('Cale'));
  assert.deepEqual((await lobby).players.map((p) => p.name), ['Cale']);
  await emit(late, 'startGame', {}); // clear the room for the next test
});

test('room auto-starts at 8 players', async () => {
  const eight = Array.from({ length: 8 }, () => client());
  const started = once(eight[0], 'gameStarted');
  for (let i = 0; i < 8; i++) await emit(eight[i], 'join', setup(`P${i}`));
  assert.equal((await started).party.length, 8);
});

test('movement input moves the player on the server', async () => {
  const a = client();
  await emit(a, 'join', setup('Walker'));
  const started = once(a, 'gameStarted');
  await emit(a, 'startGame', {});
  await started;
  const first = await once(a, 'state');
  const x0 = first.players.find((p) => p.name === 'Walker').x;
  a.emit('input', { left: true });
  await new Promise((r) => setTimeout(r, 400));
  const later = await once(a, 'state');
  assert.ok(later.players.find((p) => p.name === 'Walker').x < x0);
});
