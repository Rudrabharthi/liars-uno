import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { registerHandlers } from './socket/gameHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

export function startServer(port = process.env.PORT || 3001) {
  const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'liars-uno-server', time: Date.now() });
  });

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // roomId -> GameRoom
  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log(`[connect] ${socket.id}`);

    registerHandlers(io, socket, rooms);

    socket.on('disconnect', (reason) => {
      console.log(`[disconnect] ${socket.id} (${reason})`);
      const roomId = socket.data.roomId;
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.handleDisconnect(socket.id);
          if (room._isEmpty()) {
            rooms.delete(roomId);
            console.log(`[room] ${roomId} removed (empty)`);
          }
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({ app, server, io, rooms, port: server.address().port });
    });
  });
}

// allow `npm start` / `npm run dev` to boot directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}