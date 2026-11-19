// All tunable numbers live here so balancing doesn't require hunting through code.
// Most can be overridden with environment variables (see .env.example).

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

function loadConfig(overrides = {}) {
  const c = {
    // One in-game day (08:00 to midnight) lasts this many real minutes.
    dayRealMinutes: num(process.env.DAY_REAL_MINUTES, 24),
    // Number of days until graduation.
    semesterDays: num(process.env.SEMESTER_DAYS, 14),
    // Burnouts allowed. Burning out MORE than this many times ends the run.
    maxBurnouts: num(process.env.MAX_BURNOUTS, 3),
    maxPlayers: 8,

    // Energy drain per game hour = decayBase + decayPerDay * (day - 1). Harder every day.
    decayBase: 2.5,
    decayPerDay: 0.25,
    walkCostPerGameMinute: 0.12,

    // Chance per game hour of a personal random event (grows each day, capped).
    eventBase: 0.06,
    eventPerDay: 0.025,
    eventCap: 0.45,
    // Chance per game hour of a world event (strike, opportunity overload).
    globalBase: 0.03,
    globalPerDay: 0.01,
    globalCap: 0.25,

    // Map scale: pixels walked per game minute. Peabody is ~1,050px from HGSE = ~24 min.
    pxPerGameMinute: 44,

    tickMs: 50,
    broadcastEveryTicks: 2, // 10 public snapshots per second
    selfEveryTicks: 4,      // 5 private stat updates per second
    ...overrides,
  };
  c.gameMinutesPerDay = 16 * 60;
  c.gameMinPerRealMs = c.gameMinutesPerDay / (c.dayRealMinutes * 60_000);
  c.walkSpeedPxPerMs = c.pxPerGameMinute * c.gameMinPerRealMs;
  return c;
}

module.exports = { loadConfig };
