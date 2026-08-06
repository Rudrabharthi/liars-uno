import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { startServer } from '../src/server.js';

let srv;
let base;

before(async () => {
  srv = await startServer(0);
  base = `http://localhost:${srv.port}`;
});

after(() => {
  srv.io.close();
  srv.server.close();
});

function connect() {
  const socket = ioc(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload || {}, (res) => resolve(res)));
}

function waitFor(socket, event, filter, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.on(event, function on(data) {
      if (filter && !filter(data)) return;
      clearTimeout(timer);
      socket.off(event, on);
      resolve(data);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Socket.io integration — zero-trust masking', () => {
  test('create/join/start → private hands + masked public state', async () => {
    const a = await connect();
    const b = await connect();
    try {
      const created = await emitAck(a, 'create_room', { playerName: 'Alice', startingHandSize: 5 });
      assert.ok(created.ok, JSON.stringify(created));
      const joined = await emitAck(b, 'join_room', { roomId: created.roomId, playerName: 'Bob' });
      assert.ok(joined.ok, JSON.stringify(joined));

      // register waiters BEFORE the action that fires them
      const stateA = waitFor(a, 'game_state_update');
      const stateB = waitFor(b, 'game_state_update');
      const handA = waitFor(a, 'private_hand_sync');
      const handB = waitFor(b, 'private_hand_sync');

      const started = await emitAck(a, 'start_game', {});
      assert.ok(started.ok, JSON.stringify(started));

      const [sA, sB, hA, hB] = await Promise.all([stateA, stateB, handA, handB]);
      assert.equal(sA.roomId, created.roomId);
      assert.equal(sA.players.length, 2);
      assert.ok(sA.drawDeckCount > 0);
      assert.equal(hA.hand.length, 5);
      assert.equal(hB.hand.length, 5);

      // zero-trust: public state must never contain any hand arrays
      const publicPayloads = JSON.stringify(sA) + JSON.stringify(sB);
      assert.ok(!publicPayloads.includes('"hand"'), 'public state leaked a hand');
      // private sync only ever carries the owner's own cards
      assert.ok(!JSON.stringify(hA.hand).includes(`"ownerId":"${b.id}"`), 'A received another player\'s card');
      assert.ok(!JSON.stringify(hB.hand).includes(`"ownerId":"${a.id}"`), 'B received another player\'s card');

      // only the active player may act
      const other = a.id === sA.activePlayerId ? b : a;
      const active = other === a ? b : a;
      const denied = await emitAck(other, 'draw_card', {});
      assert.equal(denied.ok, false);

      const handAfterP = waitFor(active, 'private_hand_sync', (h) => h.hand.length === 6);
      const stateAfterP = waitFor(active, 'game_state_update', (s) => s.activePlayerId === active.id && s.hasDrawnThisTurn);
      const drawRes = await emitAck(active, 'draw_card', {});
      assert.ok(drawRes.ok, JSON.stringify(drawRes));
      const [handAfter, stateAfter] = await Promise.all([handAfterP, stateAfterP]);
      assert.equal(handAfter.hand.length, 6);
      assert.equal(stateAfter.players.find((p) => p.id === active.id).cardCount, 6);
    } finally {
      a.close();
      b.close();
    }
  });

  test('bluff opens AWAITING_CHALLENGE only for the immediate next player', async () => {
    const a = await connect();
    const b = await connect();
    try {
      const created = await emitAck(a, 'create_room', { playerName: 'Alice', startingHandSize: 7 });
      const joined = await emitAck(b, 'join_room', { roomId: created.roomId, playerName: 'Bob' });
      assert.ok(joined.ok, JSON.stringify(joined));

      const initP = waitFor(a, 'game_state_update');
      const handAP = waitFor(a, 'private_hand_sync');
      const handBP = waitFor(b, 'private_hand_sync');
      const started = await emitAck(a, 'start_game', {});
      assert.ok(started.ok, JSON.stringify(started));
      const state = await initP;

      const active = a.id === state.activePlayerId ? a : b;
      const opponent = active === a ? b : a;
      let hand = await (active === a ? handAP : handBP);
      let liar = hand.hand.find((c) => c.isLiarModifier);
      while (!liar) {
        const handP = waitFor(active, 'private_hand_sync', (h) => h.hand.length > hand.hand.length);
        const res = await emitAck(active, 'draw_card', {});
        assert.ok(res.ok, JSON.stringify(res));
        hand = await handP;
        liar = hand.hand.find((c) => c.isLiarModifier);
      }

      const challengeP = waitFor(opponent, 'game_state_update', (s) => s.turnState === 'AWAITING_CHALLENGE');
      const bluff = await emitAck(active, 'play_card', {
        cardId: liar.id,
        isFaceDown: true,
        declaredClaim: { color: state.activeColor, value: liar.value },
      });
      assert.ok(bluff.ok, JSON.stringify(bluff));
      const challengeState = await challengeP;
      assert.equal(challengeState.challengePlayerId, opponent.id, 'immediate next player must be eligible');

      const denied = await emitAck(active, 'accept_bluff', {});
      assert.equal(denied.ok, false, 'bluffer must not be allowed to accept');

      const afterP = waitFor(opponent, 'game_state_update', (s) => s.turnState !== 'AWAITING_CHALLENGE');
      const accepted = await emitAck(opponent, 'accept_bluff', {});
      assert.ok(accepted.ok, JSON.stringify(accepted));
      const after = await afterP;
      assert.notEqual(after.turnState, 'AWAITING_CHALLENGE');
      // declared form persists permanently on the discard pile
      assert.equal(after.topCard.declaredColor, state.activeColor);
      assert.equal(after.topCard.declaredValue, liar.value);
    } finally {
      a.close();
      b.close();
    }
  });

  test('room_update flows to all players; disconnect removes host in lobby', async () => {
    const a = await connect();
    const b = await connect();
    try {
      const created = await emitAck(a, 'create_room', { playerName: 'Alice', startingHandSize: 7 });
      assert.ok(created.ok);
      await emitAck(b, 'join_room', { roomId: created.roomId, playerName: 'Bob' });

      const roomAfterP = waitFor(b, 'room_update', (r) => r.players.length === 1);
      a.close();
      const roomAfter = await roomAfterP;
      assert.equal(roomAfter.players.length, 1);
      assert.notEqual(roomAfter.players[0].id, a.id);
    } finally {
      b.close();
      await sleep(100);
    }
  });
});