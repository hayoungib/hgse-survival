const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Lobby } = require('./lobby');
const { publicCatalog } = require('./data/catalog');

/**
 * Builds the HTTP + Socket.IO server. Kept separate from server.js
 * so tests can start it on a random port with a mock narrator.
 */
function createAppServer({ narrator, config }) {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/catalog', (_req, res) => res.json(publicCatalog(config)));

  const server = http.createServer(app);
  const io = new Server(server);
  const lobby = new Lobby(io, narrator, config);
  io.on('connection', (socket) => lobby.handleConnection(socket));

  return { app, server, io, lobby };
}

module.exports = { createAppServer };
