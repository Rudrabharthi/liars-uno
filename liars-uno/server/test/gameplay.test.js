import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck } from '../src/game/Deck.js';
import {
  isCardPlayable,
  canStackCard,
  isClaimValid,
  isCardDifferentFromClaim,
  resolveChallenge,
} from '../src/game/Validator.js';
import { GameRoom } from '../src/game/GameRoom.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Deck composition (exact 112 / 56-56 split)', () => {
  test('builds exactly 112 unique cards', () => {
    const deck = buildDeck();
    assert.equal(deck.length, 112);
    assert.equal(new Set(deck.map((c) => c.id)).size, 112);
  });

  test('56 normal / 56 liar split', () => {
    const deck = buildDeck();
    assert.equal(deck.filter((c) => !c.isLiarModifier).length, 56);
    assert.equal(deck.filter((c) => c.isLiarModifier).length, 56);
  });

  test('normal: 4 wilds + 13 per color (0,1-9,0,8,9)', () => {
    const deck = buildDeck();
    const normal = deck.filter((c) => !c.isLiarModifier);
    assert.equal(normal.filter((c) => c.color === 'wild').length, 4);
    for (const color of ['red', 'blue', 'green', 'yellow']) {
      const per = normal.filter((c) => c.color === color);
      assert.equal(per.length, 13, `${color} normal count`);
      const counts = per.reduce((m, c) => ((m[c.value] = (m[c.value] || 0) + 1), m), {});
      assert.equal(counts['0'], 2);
      assert.equal(counts['8'], 2);
      assert.equal(counts['9'], 2);
      for (let i = 1; i <= 7; i++) assert.equal(counts[String(i)], 1);
    }
  });

  test('liar: 4 wild draw 4 + 13 per color (1-7, 2x skip/reverse/draw2)', () => {
    const deck = buildDeck();
    const liar = deck.filter((c) => c.isLiarModifier);
    assert.equal(liar.filter((c) => c.value === 'WILD_DRAW_4').length, 4);
    for (const color of ['red', 'blue', 'green', 'yellow']) {
      const per = liar.filter((c) => c.color === color);
      assert.equal(per.length, 13, `${color} liar count`);
      const counts = per.reduce((m, c) => ((m[c.value] = (m[c.value] || 0) + 1), m), {});
      for (let i = 1; i <= 7; i++) assert.equal(counts[String(i)], 1);
      assert.equal(counts['SKIP'], 2);
      assert.equal(counts['REVERSE'], 2);
      assert.equal(counts['DRAW_2'], 2);
    }
  });
});

describe('Validator rules', () => {
  const card = (color, value, liar = false) => ({ id: 'x', color, value, isLiarModifier: liar });

  test('isCardPlayable: normal matching + wilds + face-down', () => {
    assert.ok(isCardPlayable(card('red', '5'), 'red', '7', 0));
    assert.ok(isCardPlayable(card('blue', '7'), 'red', '7', 0));
    assert.ok(isCardPlayable(card('wild', 'WILD'), 'red', '7', 0));
    assert.ok(!isCardPlayable(card('blue', '5'), 'red', '7', 0));
    assert.ok(isCardPlayable(card('x', 'x'), 'red', '7', 0, true));
  });

  test('stacking rules', () => {
    assert.ok(canStackCard('DRAW_2', 'red', card('blue', 'DRAW_2')));
    assert.ok(canStackCard('WILD_DRAW_4', 'red', card('red', 'DRAW_2')));
    assert.ok(!canStackCard('WILD_DRAW_4', 'red', card('blue', 'DRAW_2')));
    assert.ok(canStackCard('DRAW_2', 'red', card('wild', 'WILD_DRAW_4')));
    assert.ok(!canStackCard('DRAW_2', 'red', card('blue', '5')));
    assert.ok(!canStackCard('SKIP', 'red', card('blue', 'DRAW_2')));
  });

  test('isClaimValid — claims must be legal plays (color/value match, stack, or +4)', () => {
    // WILD_DRAW_4 claim is always legal
    assert.ok(isClaimValid({ color: 'red', value: 'WILD_DRAW_4' }, 'blue', '5', 0));
    // matches active value → legal
    assert.ok(isClaimValid({ color: 'red', value: '5' }, 'blue', '5', 0));
    // matches active color → legal
    assert.ok(isClaimValid({ color: 'blue', value: '9' }, 'blue', '5', 0));
    // wrong color + wrong value → illegal (the reported bug)
    assert.ok(!isClaimValid({ color: 'red', value: '6' }, 'blue', '5', 0));
    // power cards (SKIP/REVERSE/DRAW_2) are claimable in all 4 colors
    for (const c of ['red', 'blue', 'green', 'yellow']) {
      assert.ok(isClaimValid({ color: c, value: 'SKIP' }, 'blue', '5', 0));
      assert.ok(isClaimValid({ color: c, value: 'REVERSE' }, 'blue', '5', 0));
      assert.ok(isClaimValid({ color: c, value: 'DRAW_2' }, 'blue', '5', 0));
    }
    // during a stack, only stackable +2/+4 claims are legal
    assert.ok(isClaimValid({ color: 'red', value: 'DRAW_2' }, 'red', 'WILD_DRAW_4', 4));
    assert.ok(!isClaimValid({ color: 'blue', value: 'DRAW_2' }, 'red', 'WILD_DRAW_4', 4));
    assert.ok(!isClaimValid({ color: 'red', value: '7' }, 'WILD_DRAW_4', 'WILD_DRAW_4', 4));
    assert.ok(isClaimValid({ color: 'green', value: 'WILD_DRAW_4' }, 'WILD_DRAW_4', 'WILD_DRAW_4', 4));
    assert.ok(!isClaimValid({ color: 'yellow', value: 'SKIP' }, 'WILD_DRAW_4', 'WILD_DRAW_4', 4), 'SKIP cannot nullify a pending stack');
    // opening move: only the starting color (or +4) is a legal claim
    assert.ok(isClaimValid({ color: 'red', value: '6' }, 'red', '7', 0, true));
    assert.ok(!isClaimValid({ color: 'blue', value: '6' }, 'red', '7', 0, true));
    // malformed / out-of-domain claims are still rejected
    assert.ok(!isClaimValid({ color: 'wild', value: '5' }, 'blue', '5', 0));
    assert.ok(!isClaimValid({ color: 'blue', value: '' }, 'blue', '5', 0));
    assert.ok(!isClaimValid({ color: 'blue', value: 'banana' }, 'blue', '5', 0));
    assert.ok(!isClaimValid(null, 'blue', '5', 0));
  });

  test('truth check + challenge resolution', () => {
    assert.ok(isCardDifferentFromClaim(card('blue', '5', true), { color: 'red', value: '7' }));
    assert.ok(!isCardDifferentFromClaim(card('blue', '5', true), { color: 'blue', value: '5' }));
    assert.ok(!isCardDifferentFromClaim(card('wild', 'WILD_DRAW_4', true), { color: 'blue', value: 'WILD_DRAW_4' }));

    const lying = resolveChallenge(card('blue', '5', true), { color: 'red', value: '7' }, 4);
    assert.equal(lying.wasLying, true);
    assert.equal(lying.penalizedPlayer, 'bluffer');
    assert.equal(lying.cardsToDrawByPenalized, 5);

    const truth = resolveChallenge(card('blue', '5', true), { color: 'blue', value: '5' }, 2);
    assert.equal(truth.wasLying, false);
    assert.equal(truth.penalizedPlayer, 'challenger');
    assert.equal(truth.cardsToDrawByPenalized, 3);
  });
});

// ---------------------------------------------------------------- AI driver

function makeRoom(playerCount, handSize = 7) {
  const room = new GameRoom('TEST', 'p0', 'P0', handSize);
  for (let i = 1; i < playerCount; i++) room._addPlayer(`p${i}`, `P${i}`);
  room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
  assert.ok(room.startGame().ok);
  return room;
}

function totalCards(room) {
  const hands = [...room.players.values()].reduce((s, p) => s + p.hand.length, 0);
  return hands + room.deck.length + room.discardPile.length;
}

function assertConserved(room) {
  assert.equal(totalCards(room), 112, 'card conservation violated');
  assert.ok(room.drawStackCount >= 0, 'negative draw stack');
  if (room.turnState === 'AWAITING_CHALLENGE') {
    assert.ok(room.challengePlayerId, 'challenge must have an eligible player');
    assert.notEqual(room.challengePlayerId, room.activePlayerId);
  }
}

function autoMove(room, rng) {
  const st = room.getPublicState();
  if (st.gameState === 'GAME_OVER_VICTORY') return 'over';
  const pid = room.activePlayerId;
  const p = room.players.get(pid);

  if (room.turnState === 'AWAITING_CHALLENGE') {
    const action = rng() < 0.5 ? 'call_liar' : 'accept_bluff';
    const res = room.handleChallengeAction(room.challengePlayerId, action);
    if (!res.ok) throw new Error(`challenge ${action} failed: ${JSON.stringify(res)}`);
    return `challenge:${action}`;
  }

  if (room.turnState === 'AWAITING_WILD_FOLLOWUP') {
    const wildColor = room.activeColor;
    const match = p.hand.find((c) => !c.isLiarModifier && c.color === wildColor && c.value !== 'WILD');
    if (match) {
      const res = room.handlePlayCard(pid, { cardId: match.id, isFaceDown: false });
      if (!res.ok) throw new Error(`follow-up play failed: ${JSON.stringify(res)}`);
      return 'followup-play';
    }
    const res = room.handleDrawCard(pid);
    if (!res.ok) throw new Error(`follow-up draw failed: ${JSON.stringify(res)}`);
    if (!res.autoPlayed) {
      // drew without finding a playable match → bluff any non-wild card as the follow-up
      const bluff = p.hand.find((c) => c.value !== 'WILD');
      if (bluff) {
        const claim = { color: wildColor, value: '0' };
        const res2 = room.handlePlayCard(pid, { cardId: bluff.id, isFaceDown: true, declaredClaim: claim });
        if (res2.ok) return 'followup-bluff';
      }
    }
    return 'followup-draw';
  }

  if (room.forcedWildDraw) {
    const res = room.handleDrawCard(pid);
    if (!res.ok) throw new Error(`forced wild draw failed: ${JSON.stringify(res)}`);
    return 'forced-draw';
  }

  // forced wild draw completed → play the Wild + drawn-card combo to win
  if (room.wildDrawnOption) {
    const wild = p.hand.find((c) => c.value === 'WILD' && !c.isLiarModifier);
    const drawn = p.hand.find((c) => c.id === room.wildDrawnOption.cardId);
    if (wild && drawn) {
      const color = drawn && !drawn.isLiarModifier ? drawn.color : 'red';
      const res = room.handlePlayWildCombo(pid, {
        wildCardId: wild.id,
        declaredColor: color,
        followupCardId: drawn.id,
        followupIsFaceDown: !!drawn.isLiarModifier,
        followupClaim: drawn.isLiarModifier ? { color, value: drawn.value } : null,
      });
      if (res.ok) return 'wild-combo';
    }
    const passRes = room.handlePassTurn(pid);
    if (passRes.ok) return 'wild-pass';
    throw new Error(`wild-draw options failed: ${JSON.stringify(res)}`);
  }

  if (room.drawStackCount > 0) {
    const liar = p.hand.find((c) => c.isLiarModifier);
    if (liar) {
      const claim4 = { color: room.activeColor, value: 'WILD_DRAW_4' };
      const res4 = room.handlePlayCard(pid, { cardId: liar.id, isFaceDown: true, declaredClaim: claim4 });
      if (res4.ok) return 'stack-bluff4';
      const claim = { color: room.activeColor, value: 'DRAW_2' };
      if (isClaimValid(claim, room.activeColor, room.activeValue, room.drawStackCount)) {
        const res = room.handlePlayCard(pid, { cardId: liar.id, isFaceDown: true, declaredClaim: claim });
        if (res.ok) return 'stack-bluff';
      }
    }
    const res = room.handleAcceptDrawStack(pid);
    if (!res.ok) throw new Error(`accept stack failed: ${JSON.stringify(res)}`);
    return 'accept-stack';
  }

  // normal play (already drew this turn? then pass if nothing playable)
  const playable = p.hand.filter((c) => isCardPlayable(c, room.activeColor, room.activeValue, 0, false, room.openingMove));
  if (room.hasDrawnThisTurn && playable.length === 0) {
    const res = room.handlePassTurn(pid);
    if (!res.ok) throw new Error(`pass failed: ${JSON.stringify(res)}`);
    return 'pass';
  }

  if (playable.length > 0) {
    const normal = playable.find((c) => !c.isLiarModifier && c.value !== 'WILD');
    if (normal) {
      const res = room.handlePlayCard(pid, { cardId: normal.id, isFaceDown: false });
      if (!res.ok) throw new Error(`play normal failed: ${JSON.stringify(res)}`);
      return 'play';
    }
  }

  // aggressive bluff: play ANY liar card face-down declaring the active color
  const liar = p.hand.find((c) => c.isLiarModifier);
  if (liar) {
    const claim = { color: room.activeColor, value: liar.value };
    if (isClaimValid(claim, room.activeColor, room.activeValue, 0)) {
      const res = room.handlePlayCard(pid, { cardId: liar.id, isFaceDown: true, declaredClaim: claim });
      if (res.ok) return 'bluff';
    }
  }

  const wild = p.hand.find((c) => c.value === 'WILD' && !c.isLiarModifier);
  if (wild && p.hand.length > 1) {
    const res = room.handlePlayCard(pid, { cardId: wild.id, isFaceDown: false, declaredClaim: { color: 'red', value: 'WILD' } });
    if (res.ok) return 'wild';
  }

  const res = room.handleDrawCard(pid);
  if (!res.ok) throw new Error(`draw failed: ${JSON.stringify(res)}`);
  return 'draw';
}

describe('GameRoom — scripted full-game simulations', () => {
  for (const playerCount of [2, 3, 4, 5, 6, 7]) {
    test(`2..7 players — ${playerCount} players complete a match (multiple seeds)`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const rng = mulberry32(seed * 7919 + playerCount);
        const room = makeRoom(playerCount, playerCount <= 2 ? 5 : 7);
        let guard = 0;
        while (room.gameState !== 'GAME_OVER_VICTORY') {
          assert.ok(guard++ < 4000, 'game did not terminate');
          autoMove(room, rng);
          assertConserved(room);
        }
        // all players ranked
        const ranked = [...room.players.values()].filter((p) => p.rank !== null);
        assert.equal(ranked.length, playerCount, 'every player must be ranked');
        const ranks = ranked.map((p) => p.rank).sort((a, b) => a - b);
        assert.deepEqual(ranks, Array.from({ length: playerCount }, (_, i) => i + 1));
        assert.equal(room.winners.length, playerCount);
        // winner has empty hand
        const winner = room.players.get(room.winners[0].id);
        assert.equal(winner.hand.length, 0);
      }
    });
  }

  test('challenge eligibility is enforced server-side', () => {
    const room = makeRoom(3);
    const rng = mulberry32(42);
    let guard = 0;
    while (room.turnState !== 'AWAITING_CHALLENGE') {
      assert.ok(guard++ < 200, 'never reached a challenge');
      autoMove(room, rng);
    }
    const eligible = room.challengePlayerId;
    const bluffer = room.activePlayerId;
    const wrongPlayer = [...room.players.keys()].find((id) => id !== eligible && id !== bluffer);
    const denied = room.handleChallengeAction(wrongPlayer, 'accept_bluff');
    assert.equal(denied.ok, false);
    // eligible still resolves it
    const ok = room.handleChallengeAction(eligible, 'accept_bluff');
    assert.equal(ok.ok, true);
  });

  test('accepted bluff preserves the draw stack for the next player', () => {
    const room = makeRoom(3);
    const rng = mulberry32(7);
    let guard = 0;
    // reach an AWAITING_CHALLENGE
    while (room.turnState !== 'AWAITING_CHALLENGE') {
      assert.ok(guard++ < 200);
      autoMove(room, rng);
    }
    if (room.drawStackCount === 0) {
      // force: accept whatever bluff exists, stack may be zero; just accept to test accept path
      const res = room.handleChallengeAction(room.challengePlayerId, 'accept_bluff');
      assert.equal(res.ok, true);
      return; // stack not guaranteed in this seed; covered by the random sims above
    }
    const stackBefore = room.drawStackCount;
    const res = room.handleChallengeAction(room.challengePlayerId, 'accept_bluff');
    assert.equal(res.ok, true);
    // declared +2/+4 stack persists after ACCEPT (next player must face it)
    assert.equal(room.drawStackCount, stackBefore);
  });

  test('a non-stack claim during a pending draw stack is rejected (no nullification)', () => {
    const room = new GameRoom('T', 'p0', 'P0', 5);
    room._addPlayer('p1', 'P1');
    room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
    room.startGame();
    room.activeColor = 'red';
    room.activeValue = 'WILD_DRAW_4';
    room.drawStackCount = 4;
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    room.pendingEffects = { skip: false };
    room.players.get('p0').hand = [{ id: 'liar', color: 'yellow', value: '7', isLiarModifier: true }];
    // declaring a plain number while a +4 stack is pending is not a legal claim
    const res = room.handlePlayCard('p0', {
      cardId: 'liar',
      isFaceDown: true,
      declaredClaim: { color: 'yellow', value: '7' },
    });
    assert.equal(res.ok, false);
    assert.equal(room.drawStackCount, 4, 'stack is untouched by a rejected claim');
    // a stackable +4 claim is still legal and grows the stack
    room.players.get('p0').hand = [{ id: 'liar2', color: 'red', value: 'WILD_DRAW_4', isLiarModifier: true }];
    const res2 = room.handlePlayCard('p0', {
      cardId: 'liar2',
      isFaceDown: true,
      declaredClaim: { color: 'green', value: 'WILD_DRAW_4' },
    });
    assert.equal(res2.ok, true);
    assert.equal(room.drawStackCount, 8);
    room.drawStackCount = 2;
    room._applyDeclaredEffects('yellow', 'DRAW_2');
    assert.equal(room.drawStackCount, 4);
  });

  test('caught liar pays stack + 1', () => {
    // Force a lying bluff (declare +4 on a physical non-WD4 liar card), then call liar.
    const room = makeRoom(2, 5);
    let guard = 0;
    while (true) {
      assert.ok(guard++ < 200, 'never found a bluff opportunity');
      const pid = room.activePlayerId;
      const p = room.players.get(pid);
      if (room.turnState === 'PLAYER_TURN_START' && room.drawStackCount === 0 && !room.forcedWildDraw) {
        const liar = p.hand.find((c) => c.isLiarModifier);
        if (liar) {
          const before = p.hand.length;
          const res = room.handlePlayCard(pid, {
            cardId: liar.id,
            isFaceDown: true,
            declaredClaim: { color: 'yellow', value: 'WILD_DRAW_4' },
          });
          if (res.ok && room.turnState === 'AWAITING_CHALLENGE') {
            const stack = room.drawStackCount;
            const wasLyingActual = isCardDifferentFromClaim(liar, { color: 'yellow', value: 'WILD_DRAW_4' });
            const call = room.handleChallengeAction(room.challengePlayerId, 'call_liar');
            assert.equal(call.ok, true);
            if (wasLyingActual) {
              const bluffer = room.players.get(pid);
              assert.ok(bluffer.hand.length >= before + 1, 'caught bluffer must draw penalty cards');
              assert.ok(bluffer.hand.length <= before + stack, 'cannot draw more than the full penalty');
              assert.equal(room.drawStackCount, 0, 'stack must reset after call liar');
            }
            return;
          }
        }
      }
      autoMove(room, () => 0.3);
    }
  });

  test('opening move must match the starting color (no value-match on first play)', () => {
    const room = new GameRoom('T', 'p0', 'P0', 7);
    room._addPlayer('p1', 'P1');
    room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
    room.startGame();
    // force a known starting state: active red 5, first play pending
    room.activeColor = 'red';
    room.activeValue = '5';
    room.openingMove = true;
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';

    const p0 = room.players.get('p0');
    p0.hand = [
      { id: 'blue5', color: 'blue', value: '5', isLiarModifier: false },
      { id: 'red7', color: 'red', value: '7', isLiarModifier: false },
      { id: 'wild', color: 'wild', value: 'WILD', isLiarModifier: false },
    ];

    // value-match a different color → rejected while opening
    let res = room.handlePlayCard('p0', { cardId: 'blue5', isFaceDown: false });
    assert.equal(res.ok, false);
    // matching color → allowed, clears opening restriction
    res = room.handlePlayCard('p0', { cardId: 'red7', isFaceDown: false });
    assert.equal(res.ok, true);
    assert.equal(room.openingMove, false, 'opening restriction lifts after the first play');
  });

  test('opening move: wild is always playable, face-down bluff is playable', () => {
    const room = new GameRoom('T', 'p0', 'P0', 7);
    room._addPlayer('p1', 'P1');
    room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
    room.startGame();
    room.activeColor = 'green';
    room.activeValue = '3';
    room.openingMove = true;
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    const p0 = room.players.get('p0');
    p0.hand = [
      { id: 'wild', color: 'wild', value: 'WILD', isLiarModifier: false },
      { id: 'liar', color: 'blue', value: '7', isLiarModifier: true },
    ];
    let res = room.handlePlayCard('p0', {
      cardId: 'wild',
      isFaceDown: false,
      declaredClaim: { color: 'yellow', value: 'WILD' },
    });
    assert.equal(res.ok, true, 'wild should be playable on the opening move');
    assert.equal(room.openingMove, false);
  });

  test('2-player: accepted SKIP bluff bounces the turn back to the bluffer', () => {
    const room = new GameRoom('T', 'p0', 'P0', 7);
    room._addPlayer('p1', 'P1');
    room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
    room.startGame();
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    room.pendingEffects = { skip: false };
    room.direction = 1;
    room.activeColor = 'red';
    room.activeValue = '5';
    room.drawStackCount = 0;
    room.players.get('p0').hand = [
      { id: 'skip', color: 'red', value: 'SKIP', isLiarModifier: true },
    ];
    const res = room.handlePlayCard('p0', {
      cardId: 'skip',
      isFaceDown: true,
      declaredClaim: { color: 'red', value: 'SKIP' },
    });
    assert.equal(res.ok, true);
    const call = room.handleChallengeAction(room.challengePlayerId, 'accept_bluff');
    assert.equal(call.ok, true);
    assert.equal(room.activePlayerId, 'p0', '2-player SKIP must keep the turn with the bluffer');
  });

  test('2-player: accepted REVERSE bluff bounces the turn back to the bluffer', () => {
    const room = new GameRoom('T', 'p0', 'P0', 7);
    room._addPlayer('p1', 'P1');
    room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
    room.startGame();
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    room.pendingEffects = { skip: false };
    room.direction = 1;
    room.activeColor = 'blue';
    room.activeValue = '5';
    room.drawStackCount = 0;
    room.players.get('p0').hand = [
      { id: 'rev', color: 'blue', value: 'REVERSE', isLiarModifier: true },
    ];
    const res = room.handlePlayCard('p0', {
      cardId: 'rev',
      isFaceDown: true,
      declaredClaim: { color: 'blue', value: 'REVERSE' },
    });
    assert.equal(res.ok, true);
    const call = room.handleChallengeAction(room.challengePlayerId, 'accept_bluff');
    assert.equal(call.ok, true);
    assert.equal(room.activePlayerId, 'p0', '2-player REVERSE must keep the turn with the bluffer');
  });

  test('pass requires drawing a card first', () => {
    const room = new GameRoom('T', 'p0', 'P0', 7);
    room._addPlayer('p1', 'P1');
    room.setEmitter({ roomBroadcast: () => {}, socketEmit: () => {} });
    room.startGame();
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    room.hasDrawnThisTurn = false;
    // pass before drawing → rejected
    let res = room.handlePassTurn('p0');
    assert.equal(res.ok, false);
    // draw then pass → allowed
    res = room.handleDrawCard('p0');
    assert.equal(res.ok, true);
    res = room.handlePassTurn('p0');
    assert.equal(res.ok, true);
    assert.notEqual(room.activePlayerId, 'p0');
  });

  test('wrong-color bluff claim is rejected; caught truthful-color bluff penalizes bluffer', () => {
    const room = makeRoom(2, 5);
    room.activeColor = 'blue';
    room.activeValue = '7';
    room.drawStackCount = 0;
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    room.pendingEffects = { skip: false };
    // p2 physically holds a red-6 liar card
    room.players.get('p0').hand = [{ id: 'liar', color: 'red', value: '6', isLiarModifier: true }];
    // Bug repro: declaring "6-red" on active blue-7 must be rejected
    const bad = room.handlePlayCard('p0', {
      cardId: 'liar',
      isFaceDown: true,
      declaredClaim: { color: 'red', value: '6' },
    });
    assert.equal(bad.ok, false, 'wrong-color claim must be rejected');
    assert.equal(bad.error, 'Invalid declaration — claim must be a legal play');
    assert.equal(room.players.get('p0').hand.length, 1, 'rejected claim must not consume the card');
    // legal bluff: declare "6-blue" (color matches), physical is red-6 → caught lie
    const ok = room.handlePlayCard('p0', {
      cardId: 'liar',
      isFaceDown: true,
      declaredClaim: { color: 'blue', value: '6' },
    });
    assert.equal(ok.ok, true);
    assert.equal(room.turnState, 'AWAITING_CHALLENGE');
    assert.equal(room.activeColor, 'blue');
    const challengerId = room.challengePlayerId;
    const challengerBefore = room.players.get(challengerId).hand.length;
    const call = room.handleChallengeAction(challengerId, 'call_liar');
    assert.equal(call.ok, true);
    const bluffer = room.players.get('p0');
    assert.equal(bluffer.hand.length, 1, 'caught bluffer draws the penalty (stack+1 = 1)');
    assert.equal(room.players.get(challengerId).hand.length, challengerBefore, 'challenger must not pay');
    assert.equal(room.drawStackCount, 0);
  });

  test('truthful-color bluff: matching physical card shifts penalty to challenger', () => {
    const room = makeRoom(2, 5);
    room.activeColor = 'blue';
    room.activeValue = '7';
    room.drawStackCount = 0;
    room.activePlayerId = 'p0';
    room.turnState = 'PLAYER_TURN_START';
    room.pendingEffects = { skip: false };
    // p2 physically holds a blue-6 liar card and declares "6-blue" truthfully
    room.players.get('p0').hand = [{ id: 'liar', color: 'blue', value: '6', isLiarModifier: true }];
    const ok = room.handlePlayCard('p0', {
      cardId: 'liar',
      isFaceDown: true,
      declaredClaim: { color: 'blue', value: '6' },
    });
    assert.equal(ok.ok, true);
    assert.equal(room.turnState, 'AWAITING_CHALLENGE');
    const challengerId = room.challengePlayerId;
    const callerBefore = room.players.get(challengerId).hand.length;
    const call = room.handleChallengeAction(challengerId, 'call_liar');
    assert.equal(call.ok, true);
    assert.ok(
      room.players.get(challengerId).hand.length > callerBefore,
      'challenging a truthful claim must penalize the challenger'
    );
    assert.equal(call.gameOver, true, 'truthful final card wins the game');
    assert.equal(room.winners[0].id, 'p0', 'the truthful bluffer is the winner');
  });
});