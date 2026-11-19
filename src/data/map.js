// Stylized top-down map. Not to scale, but distances are tuned so walking time
// matches the design: Kronkite ~2 game minutes from HGSE, Peabody ~25.
// Coordinates are in world pixels; (0,0) is the top-left (north-west).

const WORLD = { width: 2450, height: 1550 };

// kind controls color and meaning: hgse | housing | ally | enemy | rival | neutral | nature
const LOCATIONS = [
  { id: 'gutman', name: 'Gutman Library', kind: 'hgse', x: 930, y: 560, w: 110, h: 70 },
  { id: 'longfellow', name: 'Longfellow Hall', kind: 'hgse', x: 1060, y: 560, w: 110, h: 70 },
  { id: 'larsen', name: 'Larsen Hall', kind: 'hgse', x: 995, y: 650, w: 110, h: 70 },
  { id: 'kronkite', name: 'Kronkite', kind: 'housing', x: 1120, y: 650, w: 80, h: 50 },
  { id: 'gsd', name: 'Graduate School of Design', kind: 'ally', x: 1100, y: 420, w: 120, h: 70 },
  { id: 'smith', name: 'Smith Campus Center', kind: 'neutral', x: 1280, y: 470, w: 130, h: 70 },
  { id: 'hls', name: 'Harvard Law School', kind: 'enemy', x: 880, y: 250, w: 150, h: 80 },
  { id: 'hds', name: 'Harvard Divinity School', kind: 'neutral', x: 1260, y: 170, w: 130, h: 60 },
  { id: 'somerville', name: 'Harvard Housing (Somerville)', kind: 'housing', x: 1080, y: 60, w: 150, h: 70 },
  { id: 'hks', name: 'Harvard Kennedy School', kind: 'ally', x: 580, y: 820, w: 140, h: 80 },
  { id: 'riverbank', name: 'Charles River Bank', kind: 'nature', x: 1250, y: 930, w: 180, h: 55 },
  { id: 'peabody', name: 'Peabody Terrace', kind: 'housing', x: 2000, y: 890, w: 150, h: 80 },
  { id: 'mit', name: 'MIT', kind: 'rival', x: 2200, y: 420, w: 180, h: 130 },
  { id: 'stadium', name: 'Harvard Stadium', kind: 'neutral', x: 460, y: 1240, w: 200, h: 130 },
  { id: 'hbs', name: 'Harvard Business School', kind: 'enemy', x: 780, y: 1190, w: 190, h: 110 },
  { id: 'ilab', name: 'Harvard i-lab', kind: 'neutral', x: 1080, y: 1260, w: 130, h: 80 },
  { id: 'southCampus', name: '100 South Campus Drive', kind: 'housing', x: 700, y: 1400, w: 150, h: 70 },
];

// The Charles River blocks movement except at three bridges.
const RIVER = { y: 1000, h: 80 };
const BRIDGES = [[560, 640], [1480, 1560], [1980, 2060]];
const BLOCKED = (() => {
  const rects = [];
  let x = 0;
  for (const [a, b] of BRIDGES) {
    rects.push({ x, y: RIVER.y, w: a - x, h: RIVER.h });
    x = b;
  }
  rects.push({ x, y: RIVER.y, w: WORLD.width - x, h: RIVER.h });
  return rects;
})();

const PLAYER_RADIUS = 10;
const byId = new Map(LOCATIONS.map((l) => [l.id, l]));
const locById = (id) => byId.get(id);

function inRect(x, y, r, pad = 0) {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

function locationAt(x, y) {
  return LOCATIONS.find((l) => inRect(x, y, l, 6)) || null;
}

function isBlocked(x, y) {
  const r = PLAYER_RADIUS;
  if (x < r || y < r || x > WORLD.width - r || y > WORLD.height - r) return true;
  return BLOCKED.some((b) => x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h);
}

/** Distance from a point to the edge of a location's rectangle (0 if inside). */
function distanceTo(x, y, id) {
  const l = byId.get(id);
  const dx = Math.max(l.x - x, 0, x - (l.x + l.w));
  const dy = Math.max(l.y - y, 0, y - (l.y + l.h));
  return Math.hypot(dx, dy);
}

function centerOf(id) {
  const l = byId.get(id);
  return { x: l.x + l.w / 2, y: l.y + l.h / 2 };
}

function publicMap() {
  return { world: WORLD, locations: LOCATIONS, river: RIVER, bridges: BRIDGES };
}

module.exports = {
  WORLD, LOCATIONS, BLOCKED, PLAYER_RADIUS,
  locById, locationAt, isBlocked, distanceTo, centerOf, publicMap,
};
