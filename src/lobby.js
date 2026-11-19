const crypto = require('crypto');
const { validateSetup } = require('./data/catalog');
const { World } = require('./world');

/**
 * There is always exactly one open waiting room. Players who join are
 * added to it. When any player in it presses Start (or it fills to
 * maxPlayers), everyone in it moves to a new shared campus, and a fresh
 * waiting room opens for the next arrivals.
 */
class Lobby {
  constructor(io, narrator, config) {
    this.io = io;
    this.narrator = narrator;
    this.config = config;
    this.room = this.createRoom();
    this.worlds = new Map();       // worldId -> World
    this.playerWorld = new Map();  // socketId -> World
  }

  createRoom() {
    return { id: `room-${crypto.randomUUID()}`, players: new Map() };
  }

  handleConnection(socket) {
    const safe = (fn) => (payload, ack) => fn.call(this, socket, payload || {}, typeof ack === 'function' ? ack : () => {});
    socket.on('join', safe(this.onJoin));
    socket.on('startGame', safe(this.onStart));
    socket.on('input', (payload) => this.playerWorld.get(socket.id)?.setInput(socket.id, payload));
    socket.on('activity', safe((s, p, ack) => this.inWorld(s, ack, (w) => w.startActivity(s.id, p.key))));
    socket.on('improvise', safe((s, p, ack) => this.inWorld(s, ack, (w) => w.improvise(s.id, p.text))));
    socket.on('disconnect', () => this.onDisconnect(socket));
  }

  inWorld(socket, ack, fn) {
    const w = this.playerWorld.get(socket.id);
    if (!w) return ack({ ok: false, error: 'You are not in a game.' });
    ack(fn(w));
  }

  onJoin(socket, payload, ack) {
    if (this.room.players.has(socket.id) || this.playerWorld.has(socket.id)) {
      return ack({ ok: false, error: 'You have already joined.' });
    }
    const v = validateSetup(payload);
    if (!v.ok) return ack(v);
    const taken = [...this.room.players.values()].some((p) => p.setup.name.toLowerCase() === v.setup.name.toLowerCase());
    if (taken) return ack({ ok: false, error: 'That name is taken in this waiting room.' });

    this.room.players.set(socket.id, { id: socket.id, setup: v.setup });
    socket.join(this.room.id);
    ack({ ok: true });
    this.broadcastRoom();

    if (this.room.players.size >= this.config.maxPlayers) this.startGame();
  }

  onStart(socket, _payload, ack) {
    // If two players click at the same moment, the second click finds
    // itself no longer in the current room and is rejected harmlessly.
    if (!this.room.players.has(socket.id)) return ack({ ok: false, error: 'You are not in the waiting room.' });
    ack({ ok: true });
    this.startGame();
  }

  onDisconnect(socket) {
    if (this.room.players.delete(socket.id)) return this.broadcastRoom();
    const w = this.playerWorld.get(socket.id);
    if (w) {
      this.playerWorld.delete(socket.id);
      w.removePlayer(socket.id);
    }
  }

  broadcastRoom() {
    this.io.to(this.room.id).emit('lobbyUpdate', {
      players: [...this.room.players.values()].map((p) => ({ name: p.setup.name, concentration: p.setup.concentration })),
      max: this.config.maxPlayers,
    });
  }

  startGame() {
    const room = this.room;
    this.room = this.createRoom();
    const players = [...room.players.values()];

    const world = new World({
      io: this.io,
      narrator: this.narrator,
      players,
      config: this.config,
      onEnd: (w) => {
        this.worlds.delete(w.id);
        for (const [sid, pw] of this.playerWorld) if (pw === w) this.playerWorld.delete(sid);
      },
    });
    this.worlds.set(world.id, world);

    for (const p of players) {
      const s = this.io.sockets.sockets.get(p.id);
      if (!s) continue;
      s.leave(room.id);
      s.join(world.id);
      this.playerWorld.set(p.id, world);
    }
    world.start();
    return world;
  }
}

module.exports = { Lobby };
