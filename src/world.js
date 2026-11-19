const crypto = require('crypto');
const MAP = require('./data/map');
const { COURSES, HOUSING, DREAM_JOBS } = require('./data/catalog');
const { activityMenu, resolveActivity } = require('./activities');
const { rollPersonalEvent, rollGlobalEvent, OPPORTUNITY_LABELS } = require('./events');
const { evaluateDreamJob } = require('./dreamJob');
const { createPlayer, applyEffects, summarizeEffects, mod, clamp, freshDaily, homeRecovery } = require('./player');
const { mockImprovise } = require('./narrator');

const DAY_START = 8 * 60;
const DAY_END = 24 * 60;
const EXAM_MINUTE = 10 * 60;          // midterms & finals, Longfellow Hall
const PRESENTATION_MINUTE = 14 * 60;  // presentations, Larsen Hall
const NOT_AT_HOME_PENALTY = 15;       // fell asleep somewhere other than home
const DEBT_PENALTY = 10;              // stress from negative money
const IMPROVISE_COOLDOWN = 120;       // game minutes

const fmtTime = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const LIVE = new Set(['active', 'collapsed']);

/**
 * One shared campus. Every player runs their own student; world events
 * (strikes, opportunity overloads, exams) hit everyone at once.
 */
class World {
  constructor({ io, narrator, players, config, rng = Math.random, onEnd = () => {} }) {
    this.id = `world-${crypto.randomUUID()}`;
    this.io = io;
    this.narrator = narrator;
    this.config = config;
    this.rng = rng;
    this.onEnd = onEnd;

    this.day = 1;
    this.minute = DAY_START;
    this.finalDay = config.semesterDays;
    this.midtermDay = Math.max(1, Math.ceil(config.semesterDays / 2));
    if (this.midtermDay >= this.finalDay) this.midtermDay = null; // very short test semesters
    this.strikeUntilDay = 0;
    this.lastStrikeDay = -99;
    this.opportunities = [];
    this.tickCount = 0;
    this.interval = null;
    this.over = false;
    this.finished = false;

    this.players = new Map();
    players.forEach((pl, i) => {
      const p = createPlayer(pl, i);
      this.assignPresentations(p);
      this.players.set(p.id, p);
    });
  }

  // ---------- helpers ----------
  get abs() { return this.day * 1440 + this.minute; }
  get hour() { return Math.floor(this.minute / 60); }
  get strikeToday() { return this.day <= this.strikeUntilDay; }
  emitAll(ev, data) { this.io.to(this.id).emit(ev, data); }
  emitTo(id, ev, data) { this.io.to(id).emit(ev, data); }
  livePlayers() { return [...this.players.values()].filter((p) => LIVE.has(p.status)); }
  activePlayers() { return [...this.players.values()].filter((p) => p.status === 'active'); }

  assignPresentations(p) {
    let days = [];
    for (let d = 2; d < this.finalDay; d++) if (d !== this.midtermDay) days.push(d);
    if (!days.length) days = [this.finalDay];
    p.presentations = Object.keys(p.courses).map((course) => ({
      course, day: days[Math.floor(this.rng() * days.length)], done: false,
    }));
  }

  /** Applies effects and handles burnout. Returns the applied effects. */
  effect(p, eff) {
    const applied = applyEffects(p, eff);
    this.checkBurnout(p);
    return applied;
  }

  /** Engine text goes out immediately-ish; AI flavor replaces it when available. */
  announce(target, template, applied, facts = {}, kind = 'event') {
    const summary = summarizeEffects(applied);
    this.narrator.narrate({ day: this.day, time: fmtTime(this.minute), ...facts }, template).then((text) => {
      const payload = { text: summary ? `${text} (${summary})` : text, kind, day: this.day, time: fmtTime(this.minute) };
      if (target === 'all') this.emitAll('event', payload);
      else this.emitTo(target, 'event', payload);
    });
  }

  notify(target, text, kind = 'info') {
    const payload = { text, kind, day: this.day, time: fmtTime(this.minute) };
    if (target === 'all') this.emitAll('event', payload);
    else this.emitTo(target, 'event', payload);
  }

  teleportHome(p) {
    const c = MAP.centerOf(p.housing);
    p.x = c.x;
    p.y = c.y;
    p.location = p.housing;
  }

  // ---------- lifecycle ----------
  start() {
    this.emitAll('gameStarted', {
      map: MAP.publicMap(),
      party: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, concentration: p.concentration })),
      rules: { semesterDays: this.config.semesterDays, maxBurnouts: this.config.maxBurnouts },
    });
    this.startDay();
    let last = Date.now();
    this.interval = setInterval(() => {
      const now = Date.now();
      this.tick(now - last);
      last = now;
    }, this.config.tickMs);
  }

  tick(dtMs) {
    if (this.over || this.finished) return;
    const dMin = dtMs * this.config.gameMinPerRealMs;
    this.moveAll(dtMs, dMin);
    this.advance(dMin);
    if (this.over) return;
    this.tickCount += 1;
    if (this.tickCount % this.config.broadcastEveryTicks === 0) this.broadcast();
    if (this.tickCount % this.config.selfEveryTicks === 0) this.sendSelfAll();
  }

  moveAll(dtMs, dMin) {
    const step = this.config.walkSpeedPxPerMs * dtMs;
    for (const p of this.players.values()) {
      if (p.status !== 'active' || p.busy) continue;
      let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      if (!dx && !dy) continue;
      const len = Math.hypot(dx, dy);
      dx = (dx / len) * step;
      dy = (dy / len) * step;
      let moved = false;
      if (!MAP.isBlocked(p.x + dx, p.y)) { p.x += dx; moved = true; }
      if (!MAP.isBlocked(p.x, p.y + dy)) { p.y += dy; moved = true; }
      if (moved) {
        const loc = MAP.locationAt(p.x, p.y);
        p.location = loc ? loc.id : null;
        this.effect(p, { energy: -this.config.walkCostPerGameMinute * dMin });
      }
    }
  }

  /** Advances the clock, stopping at each hour boundary to roll events. */
  advance(dMin) {
    let remaining = dMin;
    while (remaining > 1e-9 && !this.over && !this.finished) {
      const nextHour = (Math.floor(this.minute / 60) + 1) * 60;
      const step = Math.min(remaining, nextHour - this.minute);
      const prev = this.minute;
      this.minute += step;
      remaining -= step;

      this.drain(step);
      this.checkSchedule(prev, this.minute);
      this.completeBusy();
      if (this.minute >= nextHour - 1e-9) {
        this.minute = nextHour;
        this.onHour(nextHour / 60);
      }
      if (this.minute >= DAY_END) this.endDay();
    }
  }

  drainPerHour() {
    return this.config.decayBase + this.config.decayPerDay * (this.day - 1);
  }

  drain(stepMin) {
    const loss = (this.drainPerHour() / 60) * stepMin;
    for (const p of this.activePlayers()) this.effect(p, { energy: -loss });
  }

  checkBurnout(p) {
    if (p.status !== 'active' || p.energy > 0) return;
    p.energy = 0;
    p.busy = null;
    p.burnouts += 1;
    if (p.burnouts > this.config.maxBurnouts) {
      p.status = 'eliminated';
      this.emitTo(p.id, 'eliminated', { burnouts: p.burnouts, day: this.day });
      this.notify('all', `${p.name} burned out for good on day ${this.day} and has to start over.`, 'danger');
      this.checkEnd();
    } else {
      p.status = 'collapsed';
      this.teleportHome(p);
      const left = this.config.maxBurnouts - p.burnouts;
      this.notify(p.id, `You burned out before the day was over (${p.burnouts}/${this.config.maxBurnouts}). ` +
        `You collapse at home until tomorrow. ${left === 0 ? 'One more burnout ends your run.' : `${left} more allowed.`}`, 'danger');
    }
  }

  onHour(h) {
    if (h >= 24) return;
    this.opportunities = this.opportunities.filter((o) => o.expiresAt > this.abs);

    const g = rollGlobalEvent(this, this.rng);
    if (g) this.runGlobalEvent(g.id);

    for (const p of this.activePlayers()) {
      const e = rollPersonalEvent(p, this, this.rng);
      if (!e) continue;
      const r = e.resolve(p, this, this.rng);
      const applied = this.effect(p, r.effects);
      this.announce(p.id, r.text, applied, { event: e.id, player: p.name, location: p.location });
    }
  }

  runGlobalEvent(id) {
    if (id === 'opportunity_overload') {
      const spots = MAP.LOCATIONS.filter((l) => l.kind !== 'housing');
      for (let i = 0; i < 3; i++) {
        const l = spots[Math.floor(this.rng() * spots.length)];
        this.opportunities.push({
          id: crypto.randomUUID().slice(0, 8),
          x: l.x + l.w / 2 + (this.rng() * 60 - 30),
          y: l.y + l.h + 25,
          label: OPPORTUNITY_LABELS[Math.floor(this.rng() * OPPORTUNITY_LABELS.length)],
          expiresAt: this.abs + 120,
        });
      }
      this.announce('all', 'Too many opportunities at Harvard! Three events just popped up on the map (gold stars). They vanish in 2 hours, and only the first student to arrive gets each one.',
        {}, { event: 'opportunity_overload' }, 'world');
    } else if (id === 'strike') {
      this.strikeUntilDay = this.day + 1;
      this.lastStrikeDay = this.day;
      this.announce('all', 'TFs and professors are on strike! Classes and office hours are cancelled today and tomorrow. Exams and presentations are postponed.',
        {}, { event: 'strike' }, 'world');
      for (const p of this.activePlayers()) {
        const cost = mod(p, 'strikeEnergy', 0);
        if (cost) this.notify(p.id, `As a policy student you get pulled into the strike debate. (${summarizeEffects(this.effect(p, { energy: -cost }))})`);
      }
    }
  }

  // ---------- exams & presentations (difficulty spikes) ----------
  checkSchedule(prev, now) {
    const crossed = (m) => prev < m && now >= m;
    const examType = this.day === this.finalDay ? 'final' : this.day === this.midtermDay ? 'midterm' : null;
    if (crossed(9 * 60) && examType && !(examType === 'midterm' && this.strikeToday)) {
      this.notify('all', `${examType === 'final' ? 'Finals' : 'Midterms'} start at 10:00 in Longfellow Hall. Be inside or score zero.`, 'warning');
    }
    if (crossed(EXAM_MINUTE) && examType) this.runExam(examType);
    if (crossed(13 * 60)) {
      for (const p of this.activePlayers()) {
        for (const pr of p.presentations) {
          if (!pr.done && pr.day === this.day && !this.strikeToday) {
            this.notify(p.id, `Your ${COURSES[pr.course].name} presentation is at 14:00 in Larsen Hall.`, 'warning');
          }
        }
      }
    }
    if (crossed(PRESENTATION_MINUTE)) this.runPresentations();
  }

  examScore(p, base, weights) {
    const noise = this.rng() * 16 - 8;
    const idPenalty = p.hasId ? 0 : 20; // you got in, eventually
    return Math.round(clamp(base * weights + p.energy * 0.25 + noise - idPenalty));
  }

  runExam(type) {
    if (type === 'midterm' && this.strikeToday) {
      this.midtermDay = this.day + 2 < this.finalDay ? this.day + 2 : null;
      this.notify('all', this.midtermDay ? `Midterms postponed to day ${this.midtermDay} because of the strike.` : 'Midterms are cancelled. Your final will count double.', 'world');
      return;
    }
    for (const p of this.livePlayers()) {
      const present = p.status === 'active' && p.location === 'longfellow';
      const scores = [];
      for (const c of Object.values(p.courses)) {
        c[type] = present ? this.examScore(p, c.mastery, 0.75) : 0;
        scores.push(c[type]);
      }
      if (present) {
        const applied = this.effect(p, { energy: -20 });
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        this.announce(p.id, `${p.name} sits the ${type}. Average score: ${avg}/100.`, applied, { event: type, average: avg }, 'exam');
      } else {
        this.notify(p.id, `You missed the ${type}. Zero in every course.`, 'danger');
      }
    }
  }

  runPresentations() {
    for (const p of this.livePlayers()) {
      for (const pr of p.presentations) {
        if (pr.done || pr.day !== this.day) continue;
        if (this.strikeToday) { pr.day = Math.min(this.day + 2, this.finalDay); continue; }
        pr.done = true;
        const c = p.courses[pr.course];
        const present = p.status === 'active' && p.location === 'larsen';
        if (!present) {
          c.presentation = 0;
          this.notify(p.id, `You missed your ${COURSES[pr.course].name} presentation. Zero.`, 'danger');
          continue;
        }
        c.presentation = Math.round(clamp(this.examScore(p, c.mastery, 0.6) + 0.15 * p.network + mod(p, 'presentation', 0)));
        const applied = this.effect(p, { energy: -12 });
        this.announce(p.id, `${p.name} presents for ${COURSES[pr.course].name}. Score: ${c.presentation}/100.`, applied, { event: 'presentation', score: c.presentation }, 'exam');
      }
    }
  }

  // ---------- day cycle ----------
  startDay() {
    const lines = [`Day ${this.day} of ${this.finalDay}. Energy drains ${this.drainPerHour().toFixed(1)}/hour today.`];
    if (this.day === this.midtermDay) lines.push('MIDTERMS today at 10:00, Longfellow Hall.');
    if (this.day === this.finalDay) lines.push('FINALS today at 10:00, Longfellow Hall. Survive to midnight to graduate.');
    if (this.strikeToday) lines.push('The strike continues: no classes today.');
    for (const p of this.activePlayers()) {
      const own = [...lines];
      for (const pr of p.presentations) {
        if (!pr.done && pr.day === this.day) own.push(`Presentation today at 14:00, Larsen Hall: ${COURSES[pr.course].name}.`);
      }
      if (p.money < 60) own.push(`Money is tight ($${p.money}). Rent is $${HOUSING[p.housing].rent}/night.`);
      this.notify(p.id, own.join(' '), 'schedule');
    }
  }

  endDay() {
    for (const p of this.livePlayers()) {
      p.dayEndEnergies.push(p.status === 'collapsed' ? 0 : Math.round(p.energy));
    }
    if (this.day >= this.finalDay) {
      this.graduateAll();
      return;
    }
    for (const p of this.livePlayers()) {
      const atHome = p.status === 'collapsed' || p.location === p.housing;
      const rent = HOUSING[p.housing].rent;
      p.money -= rent;
      let energy = p.energy + homeRecovery(p) - (atHome ? 0 : NOT_AT_HOME_PENALTY);
      if (p.money < 0) energy -= DEBT_PENALTY;
      p.energy = clamp(Math.round(energy), 5, 100);
      p.status = 'active';
      p.busy = null;
      p.homeClosed = false;
      p.daily = freshDaily();
      this.teleportHome(p);
      const notes = [`Overnight: rent -$${rent}, woke with ${p.energy} energy.`];
      if (!atHome) notes.push('You fell asleep away from home and slept badly.');
      if (p.money < 0) notes.push('You are in debt, and the stress costs you energy.');
      this.notify(p.id, notes.join(' '), 'info');
    }
    this.day += 1;
    this.minute = DAY_START;
    this.opportunities = [];
    this.startDay();
  }

  graduateAll() {
    this.finished = true; // stop the clock; end() runs once narration is done
    clearInterval(this.interval);
    const graduates = this.livePlayers();
    const tasks = graduates.map((p) => {
      p.status = 'graduated';
      p.busy = null;
      p.result = evaluateDreamJob(p, this.rng);
      const r = p.result;
      const template = r.success
        ? `${p.name} graduates from HGSE and lands their dream job: ${r.job}!`
        : `${p.name} graduates from HGSE, but the ${r.job} offer goes to someone else this time.`;
      return this.narrator.narrate({ event: 'graduation', ...r }, template).then((text) => {
        this.emitTo(p.id, 'graduation', { result: r, text });
        this.notify('all', template, r.success ? 'success' : 'info');
      });
    });
    this.notify('all', `Commencement! ${graduates.length} student(s) survived the semester.`, 'success');
    this.sendSelfAll();
    return Promise.all(tasks).then(() => this.end());
  }

  // ---------- player actions ----------
  setInput(id, input = {}) {
    const p = this.players.get(id);
    if (!p) return;
    p.input = { up: !!input.up, down: !!input.down, left: !!input.left, right: !!input.right };
  }

  startActivity(id, key) {
    const p = this.players.get(id);
    if (!p || p.status !== 'active') return { ok: false, error: 'You cannot act right now.' };
    if (p.busy) return { ok: false, error: 'You are busy.' };
    const r = resolveActivity(p, this, key);
    if (r.error) return { ok: false, error: r.error };
    if (r.opportunityId) {
      const i = this.opportunities.findIndex((o) => o.id === r.opportunityId);
      if (i < 0) return { ok: false, error: 'Someone got there first.' };
      this.opportunities.splice(i, 1);
    }
    this.effect(p, r.def.cost(p, this));
    if (p.status !== 'active') return { ok: true };
    p.busy = { key, def: r.def, course: r.course, label: r.label, endsAt: this.abs + r.def.minutes, total: r.def.minutes };
    return { ok: true };
  }

  improvise(id, rawText) {
    const p = this.players.get(id);
    if (!p || p.status !== 'active') return { ok: false, error: 'You cannot act right now.' };
    if (p.busy) return { ok: false, error: 'You are busy.' };
    if (!p.location) return { ok: false, error: 'Walk into a building or landmark first.' };
    if (this.abs < p.improviseReadyAt) return { ok: false, error: 'You can improvise again in a couple of game hours.' };
    const text = typeof rawText === 'string' ? rawText.trim().slice(0, 200) : '';
    if (!text) return { ok: false, error: 'Describe what you try.' };
    if (p.energy <= 8) return { ok: false, error: 'Not enough energy.' };

    this.effect(p, { energy: -8 });
    p.improviseReadyAt = this.abs + IMPROVISE_COOLDOWN;
    const token = { result: null };
    p.busy = { key: 'improvise', label: 'Improvising...', endsAt: this.abs + 30, total: 30, token, attempt: text };
    const loc = MAP.locById(p.location);
    this.narrator.improvise({
      player: p.name, concentration: p.concentration, dreamJob: DREAM_JOBS[p.dreamJob].name,
      location: loc.name, locationKind: loc.kind, time: fmtTime(this.minute), energy: Math.round(p.energy), action: text,
    }).then((r) => { token.result = r; });
    this.notify(p.id, `You try: "${text}"`, 'info');
    return { ok: true };
  }

  completeBusy() {
    for (const p of this.activePlayers()) {
      if (!p.busy || p.busy.endsAt > this.abs + 1e-9) continue;
      const b = p.busy;
      p.busy = null;
      if (b.key === 'improvise') {
        const r = b.token.result || mockImprovise(this.rng);
        const eff = { great: { network: 4, career: 3, energy: 5 }, ok: { network: 2 }, bad: { energy: -8 } }[r.outcome];
        const applied = this.effect(p, eff);
        const s = summarizeEffects(applied);
        this.notify(p.id, `${r.narration}${s ? ` (${s})` : ''}`, r.outcome === 'bad' ? 'danger' : 'event');
        continue;
      }
      const out = b.def.reward(p, this, b.course, this.rng) || {};
      const applied = this.effect(p, out.effects || {});
      const text = out.text || `Finished: ${b.label}.`;
      if (out.narrate) this.announce(p.id, text, applied, { ...out.narrate, player: p.name });
      else {
        const s = summarizeEffects(applied);
        this.notify(p.id, s ? `${text} (${s})` : text, 'info');
      }
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.notify('all', `${p.name} has left campus.`, 'info');
    this.checkEnd();
  }

  checkEnd() {
    if (!this.livePlayers().length && !this.over) this.end();
  }

  end() {
    if (this.over) return;
    this.over = true;
    clearInterval(this.interval);
    this.emitAll('gameEnded', {});
    this.onEnd(this);
  }

  // ---------- network state ----------
  broadcast() {
    this.emitAll('state', {
      day: this.day,
      minute: this.minute,
      time: fmtTime(this.minute),
      strike: this.strikeToday,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, x: Math.round(p.x), y: Math.round(p.y),
        status: p.status, busy: p.busy ? p.busy.label : null,
      })),
      opportunities: this.opportunities.map(({ id, x, y, label }) => ({ id, x, y, label })),
    });
  }

  selfState(p) {
    const loc = p.location ? MAP.locById(p.location) : null;
    return {
      status: p.status,
      energy: Math.round(p.energy),
      money: p.money,
      network: Math.round(p.network),
      career: Math.round(p.career),
      allies: { hks: Math.round(p.allies.hks), gsd: Math.round(p.allies.gsd) },
      hasId: p.hasId,
      laptopOk: p.laptopOk,
      homeClosed: p.homeClosed,
      burnouts: p.burnouts,
      maxBurnouts: this.config.maxBurnouts,
      day: this.day,
      finalDay: this.finalDay,
      midtermDay: this.midtermDay,
      drainPerHour: Math.round(this.drainPerHour() * 10) / 10,
      location: loc ? loc.name : 'Walking outside',
      busy: p.busy ? { label: p.busy.label, remaining: Math.max(0, Math.round(p.busy.endsAt - this.abs)), total: p.busy.total } : null,
      courses: Object.entries(p.courses).map(([id, c]) => ({
        id, name: COURSES[id].name, mastery: Math.round(c.mastery), midterm: c.midterm, final: c.final, presentation: c.presentation,
        presentationDay: (p.presentations.find((pr) => pr.course === id) || {}).day,
      })),
      activities: p.status === 'active' && !p.busy ? activityMenu(p, this) : [],
      canImprovise: p.status === 'active' && !p.busy && !!p.location && this.abs >= p.improviseReadyAt,
      result: p.result,
    };
  }

  sendSelfAll() {
    for (const p of this.players.values()) this.emitTo(p.id, 'self', this.selfState(p));
  }
}

module.exports = { World, DAY_START, DAY_END, fmtTime };
