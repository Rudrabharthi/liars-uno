import { GameRoom, generateRoomCode } from '../game/GameRoom.js';
import { TURN_STATES } from '../game/StateMachine.js';

/**
 * Socket.io event listeners. Zero-trust masking happens here:
 * private hands go only to the owning socket; public masked state goes to the room.
 */
export function registerHandlers(io, socket, rooms) {
  const emitToRoom = (roomId, event, payload) => io.to(roomId).emit(event, payload);
  const emitToSocket = (socketId, event, payload) => {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.emit(event, payload);
  };

  const attachRoom = (room) => room.setEmitter({ roomBroadcast: emitToRoom, socketEmit: emitToSocket });

  const ack = (fn, res) => {
    if (typeof fn === 'function') fn(res);
  };

  // ------------------------------------------------------------ room lifecycle

  socket.on('create_room', ({ playerName, startingHandSize } = {}, fn) => {
    if (socket.data.roomId) return ack(fn, { ok: false, error: 'Already in a room' });
    let roomId;
    do {
      roomId = generateRoomCode();
    } while (rooms.has(roomId));
    const room = new GameRoom(roomId, socket.id, playerName, startingHandSize);
    rooms.set(roomId, room);
    attachRoom(room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    room._broadcastRoom();
    ack(fn, { ok: true, roomId, playerId: socket.id });
  });

  socket.on('join_room', ({ roomId, playerName } = {}, fn) => {
    if (socket.data.roomId) return ack(fn, { ok: false, error: 'Already in a room' });
    const code = String(roomId || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack(fn, { ok: false, error: 'Room not found' });
    if (room.gameState !== TURN_STATES.LOBBY) return ack(fn, { ok: false, error: 'Game already in progress' });
    if (room._connectedPlayerCount() >= 7) return ack(fn, { ok: false, error: 'Room is full' });
    if (room.players.has(socket.id)) return ack(fn, { ok: false, error: 'Already in this room' });

    room._addPlayer(socket.id, playerName);
    socket.join(code);
    socket.data.roomId = code;
    room._broadcastRoom();
    room._broadcast();
    ack(fn, { ok: true, roomId: code, playerId: socket.id });
  });

  socket.on('leave_room', (_payload, fn) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return ack(fn, { ok: false, error: 'Not in a room' });
    socket.leave(roomId);
    socket.data.roomId = null;
    room.handleDisconnect(socket.id);
    if (room._isEmpty()) rooms.delete(roomId);
    ack(fn, { ok: true });
  });

  socket.on('configure_room', ({ startingHandSize } = {}, fn) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return ack(fn, { ok: false, error: 'Not in a room' });
    if (socket.id !== room.hostId) return ack(fn, { ok: false, error: 'Host only' });
    const res = room.configureRoom(startingHandSize);
    room._broadcastRoom();
    ack(fn, res);
  });

  socket.on('start_game', (_payload, fn) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return ack(fn, { ok: false, error: 'Not in a room' });
    if (socket.id !== room.hostId) return ack(fn, { ok: false, error: 'Host only' });
    const res = room.startGame();
    ack(fn, res);
  });

  // ------------------------------------------------------------ gameplay

  const gameplay =
    (handler) =>
    (payload, fn) => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return ack(fn, { ok: false, error: 'Not in a room' });
      const res = handler(room, socket.id, payload);
      if (res && res.ok && res.event) {
        emitToRoom(room.roomId, res.event, res.payload);
      }
      ack(fn, res);
    };

  socket.on('play_card', gameplay((room, sid, data) => room.handlePlayCard(sid, data)));
  socket.on('play_wild_combo', gameplay((room, sid, data) => room.handlePlayWildCombo(sid, data)));
  socket.on('draw_card', gameplay((room, sid) => room.handleDrawCard(sid)));
  socket.on('accept_draw_stack', gameplay((room, sid) => room.handleAcceptDrawStack(sid)));
  socket.on('pass_turn', gameplay((room, sid) => room.handlePassTurn(sid)));

  socket.on('call_liar', gameplay((room, sid) => room.handleChallengeAction(sid, 'call_liar')));
  socket.on('accept_bluff', gameplay((room, sid) => room.handleChallengeAction(sid, 'accept_bluff')));

  socket.on('call_uno', gameplay((room, sid) => room.handleCallUno(sid)));
  socket.on('report_missed_uno', gameplay((room, sid, { targetPlayerId } = {}) =>
    room.handleReportMissedUno(sid, targetPlayerId)));

  // ------------------------------------------------------------ reconnect snapshot

  // On a fresh connection into an existing room's socket namespace we cannot
  // restore a session; the client re-creates/joins rooms from the Lobby.
  // This handler re-syncs a socket that already holds room data in a later session.
  socket.on('request_state', (_payload, fn) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return ack(fn, { ok: false, error: 'Not in a room' });
    room._broadcast();
    ack(fn, { ok: true });
  });
}