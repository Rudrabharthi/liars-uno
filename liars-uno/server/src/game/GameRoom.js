import { buildDeck, shuffle } from './Deck.js';
import {
  TURN_STATES,
  CHALLENGE_TIMER_MS,
  UNO_CATCH_WINDOW_MS,
} from './StateMachine.js';
import {
  isCardPlayable,
  isClaimValid,
  resolveChallenge,
  isWildValue,
  PLAYABLE_COLORS,
} from './Validator.js';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 7;

/** 6-character ambiguous-safe room code. */
export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function sanitizeName(name) {
  const s = String(name || '').trim().slice(0, 16);
  return s || 'Player';
}

/**
 * Authoritative server-side game room.
 * Emitter (set via setEmitter) is how this room pushes masked state to sockets.
 */
export class GameRoom {
  constructor(roomId, hostSocketId, hostName, startingHandSize) {
    this.roomId = roomId;
    this.hostId = hostSocketId;
    this.startingHandSize = Math.max(1, Math.min(15, parseInt(startingHandSize, 10) || 7));
    this.players = new Map(); // key: socketId -> player object
    this.gameState = TURN_STATES.LOBBY;
    this.turnState = TURN_STATES.LOBBY;

    this.deck = [];
    this.discardPile = [];

    this.activePlayerId = null;
    this.activeColor = null;
    this.activeValue = null;
    this.direction = 1;

    this.drawStackCount = 0;
    this.challengePlayerId = null;
    this.challengeExpiresAt = null;
    this.pendingEffects = { skip: false };

    this.forcedWildDraw = false;
    this.wildDrawnOption = null;
    this.hasDrawnThisTurn = false;

    this.unoCatchWindow = null;
    this.winners = [];
    this.timers = new Map();

    this.emitter = null;

    this._addPlayer(hostSocketId, hostName);
  }

  // ---------------------------------------------------------------- emitter

  setEmitter(emitter) {
    this.emitter = emitter;
  }

  _roomBroadcast(event, payload) {
    if (this.emitter) this.emitter.roomBroadcast(this.roomId, event, payload);
  }

  _socketEmit(socketId, event, payload) {
    if (this.emitter) this.emitter.socketEmit(socketId, event, payload);
  }

  // ---------------------------------------------------------------- helpers

  _addPlayer(socketId, name) {
    const player = {
      id: socketId,
      name: sanitizeName(name),
      hand: [],
      isConnected: true,
      isSpectator: false,
      hasCalledUno: false,
      rank: null,
    };
    this.players.set(socketId, player);
    return player;
  }

  _seatOrder() {
    return [...this.players.keys()];
  }

  _isActive(id) {
    const p = this.players.get(id);
    return !!p && !p.isSpectator && p.isConnected;
  }

  _activeIds() {
    return this._seatOrder().filter((id) => this._isActive(id));
  }

  _activeCount() {
    return this._activeIds().length;
  }

  _connectedPlayerCount() {
    return [...this.players.values()].filter((p) => p.isConnected).length;
  }

  _isEmpty() {
    return this.players.size === 0;
  }

  /**
   * Next active player id after `fromPlayerId`, respecting direction & pending skip.
   * Skips spectators, winners and disconnected players.
   */
  _getNextPlayerId(fromPlayerId, { skip = this.pendingEffects.skip } = {}) {
    const order = this._seatOrder();
    if (order.length === 0) return null;
    const activeIds = order.filter((id) => this._isActive(id));
    if (activeIds.length === 0) return null;
    if (activeIds.length === 1) return activeIds[0];

    let pos = order.indexOf(fromPlayerId);
    if (pos === -1) pos = this.direction > 0 ? -1 : order.length;
    let first = null;
    for (let i = 0; i < order.length; i++) {
      pos = (pos + this.direction + order.length) % order.length;
      const candidate = order[pos];
      if (this._isActive(candidate)) {
        if (first === null) first = candidate;
        if (skip) {
          skip = false;
          continue;
        }
        return candidate;
      }
    }
    return first;
  }

  /** Challenge eligibility computed at bluff time — the immediate next player. */
  _computeChallengeNext(blufferId) {
    let next = this._getNextPlayerId(blufferId);
    if (next === null || next === blufferId) {
      const alt = this._seatOrder().find((id) => this._isActive(id) && id !== blufferId);
      next = alt ?? blufferId;
    }
    return next;
  }

  maxStartingHandSize() {
    return Math.max(1, Math.floor(112 / Math.max(2, this._connectedPlayerCount())) - 1);
  }

  // ---------------------------------------------------------------- deck

  _drawFromDeck() {
    if (this.deck.length === 0) this._recycleDiscard();
    return this.deck.pop() || null;
  }

  /** §9 — keep top discard, reshuffle underlying cards into a new draw pile. */
  _recycleDiscard() {
    if (this.discardPile.length > 1) {
      const top = this.discardPile.pop();
      const rest = this.discardPile;
      this.discardPile = [top];
      this.deck = shuffle(rest);
    }
  }

  _drawNCards(player, n) {
    for (let i = 0; i < n; i++) {
      const card = this._drawFromDeck();
      if (!card) break;
      player.hand.push(card);
    }
  }

  // ---------------------------------------------------------------- game lifecycle

  startGame() {
    if (this.gameState !== TURN_STATES.LOBBY && this.gameState !== TURN_STATES.GAME_OVER_VICTORY) {
      return { ok: false, error: 'Game already in progress' };
    }
    const active = [...this.players.values()].filter((p) => p.isConnected);
    if (active.length < 2) return { ok: false, error: 'Need at least 2 players to start' };

    const maxSafe = Math.floor(112 / active.length) - 1;
    this.startingHandSize = Math.max(1, Math.min(this.startingHandSize, maxSafe));

    this.gameState = TURN_STATES.GAME_INITIALIZE_DEAL;
    this.turnState = TURN_STATES.GAME_INITIALIZE_DEAL;
    this.deck = shuffle(buildDeck());
    this.discardPile = [];
    this.drawStackCount = 0;
    this.direction = 1;
    this.challengePlayerId = null;
    this.challengeExpiresAt = null;
    this.unoCatchWindow = null;
    this.pendingEffects = { skip: false };
    this.winners = [];

    for (const p of active) {
      p.hand = [];
      p.isSpectator = false;
      p.hasCalledUno = false;
      p.rank = null;
      for (let i = 0; i < this.startingHandSize; i++) p.hand.push(this.deck.pop());
    }

    this._flipFirstDiscard();
    this.activePlayerId = this._activeIds()[0] ?? null;
    this._beginTurn(this.activePlayerId);
    this._broadcastRoom();
    this._broadcast();
    return { ok: true };
  }

  _flipFirstDiscard() {
    while (this.deck.length > 0) {
      const card = this.deck.pop();
      this.discardPile.push(card);
      if (!isWildValue(card.value)) {
        this.activeColor = card.color;
        this.activeValue = card.value;
        return;
      }
    }
    this.activeColor = 'red';
    this.activeValue = '0';
  }

  configureRoom(startingHandSize) {
    if (this.gameState !== TURN_STATES.LOBBY) return { ok: false, error: 'Game already started' };
    const val = parseInt(startingHandSize, 10);
    if (!val || val < 1) return { ok: false, error: 'Invalid starting hand size' };
    this.startingHandSize = Math.min(val, this.maxStartingHandSize());
    return { ok: true, startingHandSize: this.startingHandSize };
  }

  _beginTurn(playerId) {
    this.activePlayerId = playerId;
    this.turnState = TURN_STATES.PLAYER_TURN_START;
    this.pendingEffects = { skip: false };
    this.forcedWildDraw = false;
    this.wildDrawnOption = null;
    this.hasDrawnThisTurn = false;
    const p = playerId ? this.players.get(playerId) : null;
    if (p) p.hasCalledUno = false;

    // §7.2 — Wild as sole last card cannot win directly; forces a 1-card draw.
    if (
      p &&
      this.drawStackCount === 0 &&
      p.hand.length === 1 &&
      p.hand[0].value === 'WILD' &&
      !p.hand[0].isLiarModifier
    ) {
      this.forcedWildDraw = true;
    }
  }

  /** §8 — open a 5s catch window for a player who dropped to 1 card silently. */
  _openUnoCatchWindow(player) {
    this.unoCatchWindow = {
      targetPlayerId: player.id,
      targetName: player.name,
      expiresAt: Date.now() + UNO_CATCH_WINDOW_MS,
    };
    this._roomBroadcast('uno_catch_window', {
      targetPlayerId: player.id,
      targetName: player.name,
      duration: UNO_CATCH_WINDOW_MS,
      expiresAt: this.unoCatchWindow.expiresAt,
    });
    const timer = setTimeout(() => {
      if (this.unoCatchWindow && this.unoCatchWindow.targetPlayerId === player.id) {
        this.unoCatchWindow = null;
        this._broadcast();
      }
    }, UNO_CATCH_WINDOW_MS);
    this.timers.set(`uno-${player.id}`, timer);
  }

  /**
   * Advance rotation after a resolved play (effects already applied).
   * Opens a missed-UNO catch window for a leaving player on 1 card.
   */
  _advanceTurn(fromPlayerId) {
    const from = this.players.get(fromPlayerId);
    if (from && !from.isSpectator && from.hand.length === 1 && !from.hasCalledUno) {
      this._openUnoCatchWindow(from);
    }
    const next = this._getNextPlayerId(fromPlayerId);
    if (next) this._beginTurn(next);
  }

  /**
   * §10 — register a winner; when only 1 player remains they get last place
   * and the match ends with full standings.
   */
  _registerWinner(p) {
    const rank = this.winners.length + 1;
    p.rank = rank;
    p.isSpectator = true;
    this.winners.push({ id: p.id, name: p.name, rank });

    const remaining = this._activeIds().length;
    if (remaining <= 1) {
      const last = this._activeIds()[0];
      if (last) {
        const lp = this.players.get(last);
        if (lp && lp.rank === null) {
          lp.rank = this.winners.length + 1;
          lp.isSpectator = true;
          this.winners.push({ id: last, name: lp.name, rank: lp.rank });
        }
      }
      // leftover ranks (e.g. disconnected players) in seat order
      let r = this.winners.length + 1;
      for (const id of this._seatOrder()) {
        const p2 = this.players.get(id);
        if (p2 && p2.rank === null) {
          p2.rank = r;
          p2.isSpectator = true;
          this.winners.push({ id, name: p2.name, rank: r });
          r += 1;
        }
      }
      this.gameState = TURN_STATES.GAME_OVER_VICTORY;
      this.turnState = TURN_STATES.GAME_OVER_VICTORY;
      this._roomBroadcast('game_over', {
        winners: [...this.winners].sort((a, b) => a.rank - b.rank),
      });
      return { gameOver: true };
    }
    return { gameOver: false };
  }

  _postPlayAdvance(p) {
    if (p.hand.length === 0) {
      const res = this._registerWinner(p);
      if (res.gameOver) return { gameOver: true };
    }
    this._advanceTurn(p.id);
    return { gameOver: false };
  }

  // ---------------------------------------------------------------- action card effects

  _applyFaceUpEffects(card, declaredClaim) {
    if (card.value === 'WILD') {
      const color = declaredClaim?.color;
      if (!PLAYABLE_COLORS.includes(color)) return { error: 'Wild requires a declared color' };
      this.activeColor = color;
      this.activeValue = 'WILD';
      this.pendingEffects = { skip: false };
      this.turnState = TURN_STATES.AWAITING_WILD_FOLLOWUP;
      return { wild: true };
    }
    this.activeColor = card.color;
    this.activeValue = card.value;
    this.pendingEffects = { skip: false };
    if (card.value === 'SKIP') this.pendingEffects.skip = true;
    if (card.value === 'REVERSE') {
      if (this._activeCount() === 2) this.pendingEffects.skip = true;
      else this.direction *= -1;
    }
    if (card.value === 'DRAW_2') this.drawStackCount += 2;
    return {};
  }

  _applyDeclaredEffects(color, value) {
    this.activeColor = color;
    this.activeValue = value;
    this.pendingEffects = { skip: false };
    if (value === 'SKIP') this.pendingEffects.skip = true;
    if (value === 'REVERSE') {
      if (this._activeCount() === 2) this.pendingEffects.skip = true;
      else this.direction *= -1;
    }
    if (value === 'DRAW_2') {
      this.drawStackCount += 2;
    } else if (value === 'WILD_DRAW_4') {
      this.drawStackCount += 4;
    } else {
      // full-freedom: a non-stack declared claim nullifies any pending stack
      this.drawStackCount = 0;
    }
  }

  // ---------------------------------------------------------------- play actions

  handlePlayCard(socketId, data = {}) {
    if (this.gameState === TURN_STATES.GAME_OVER_VICTORY) return { ok: false, error: 'Game over' };
    if (socketId !== this.activePlayerId) return { ok: false, error: 'Not your turn' };
    const p = this.players.get(socketId);
    if (!p || p.isSpectator) return { ok: false, error: 'Invalid player' };
    if (this.turnState !== TURN_STATES.PLAYER_TURN_START && this.turnState !== TURN_STATES.AWAITING_WILD_FOLLOWUP) {
      return { ok: false, error: 'Cannot play right now' };
    }

    const { cardId, isFaceDown = false, declaredClaim = null } = data;
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: 'Card not in hand' };

    if (isFaceDown) {
      if (!isClaimValid(declaredClaim)) {
        return { ok: false, error: 'Invalid declaration' };
      }
      return this._playFaceDown(p, card, declaredClaim);
    }

    if (card.isLiarModifier) return { ok: false, error: 'Liar cards must be played face-down' };
    if (card.value === 'WILD' && this.turnState === TURN_STATES.AWAITING_WILD_FOLLOWUP) {
      return { ok: false, error: 'Wild cannot be a follow-up card' };
    }
    if (!isCardPlayable(card, this.activeColor, this.activeValue, this.drawStackCount)) {
      return { ok: false, error: 'Card not playable' };
    }
    return this._playFaceUp(p, card, declaredClaim);
  }

  _playFaceUp(p, card, declaredClaim) {
    p.hand = p.hand.filter((c) => c.id !== card.id);
    this.discardPile.push(card);

    if (card.value === 'WILD') {
      const color = declaredClaim?.color;
      if (!PLAYABLE_COLORS.includes(color)) {
        p.hand.push(card);
        this.discardPile.pop();
        return { ok: false, error: 'Wild requires a declared color' };
      }
      this.activeColor = color;
      this.activeValue = 'WILD';
      this.pendingEffects = { skip: false };
      this.turnState = TURN_STATES.AWAITING_WILD_FOLLOWUP;
      this._broadcast();
      return { ok: true, state: TURN_STATES.AWAITING_WILD_FOLLOWUP };
    }

    this.activeColor = card.color;
    this.activeValue = card.value;
    this.pendingEffects = { skip: false };
    if (card.value === 'SKIP') this.pendingEffects.skip = true;
    if (card.value === 'REVERSE') {
      if (this._activeCount() === 2) this.pendingEffects.skip = true;
      else this.direction *= -1;
    }
    if (card.value === 'DRAW_2') this.drawStackCount += 2;

    this._postPlayAdvance(p);
    this._broadcast();
    return { ok: true };
  }

  /**
   * §5 — face-down bluff play. Card keeps its declared form permanently on the
   * discard pile; identity never revealed. Enters AWAITING_CHALLENGE with
   * server-authoritative challengePlayerId.
   */
  _playFaceDown(p, card, declaredClaim) {
    const { color, value } = declaredClaim;
    p.hand = p.hand.filter((c) => c.id !== card.id);
    card.isFaceDownPlayed = true;
    card.declaredColor = color;
    card.declaredValue = value;
    this.discardPile.push(card);

    this._applyDeclaredEffects(color, value);

    this.turnState = TURN_STATES.AWAITING_CHALLENGE;
    this.challengePlayerId = this._computeChallengeNext(p.id);
    this.challengeExpiresAt = Date.now() + CHALLENGE_TIMER_MS;
    this._broadcast();
    return { ok: true, state: TURN_STATES.AWAITING_CHALLENGE };
  }

  /**
   * §7 — Wild + mandatory second card (atomic combo).
   * Works in AWAITING_WILD_FOLLOWUP (wild already down) or for a fresh wild.
   */
  handlePlayWildCombo(socketId, data = {}) {
    if (this.gameState === TURN_STATES.GAME_OVER_VICTORY) return { ok: false, error: 'Game over' };
    if (socketId !== this.activePlayerId) return { ok: false, error: 'Not your turn' };
    const p = this.players.get(socketId);
    if (!p || p.isSpectator) return { ok: false, error: 'Invalid player' };

    const { wildCardId, declaredColor, followupCardId, followupIsFaceDown = false, followupClaim = null } = data;
    if (!PLAYABLE_COLORS.includes(declaredColor)) return { ok: false, error: 'Invalid declared color' };

    let wild = null;

    if (this.turnState === TURN_STATES.AWAITING_WILD_FOLLOWUP) {
      // wild already played — this call supplies just the follow-up;
      // the authoritative declared color is the server's activeColor.
      return this._playFollowUp(p, followupCardId, followupIsFaceDown, followupClaim, this.activeColor);
    }

    if (this.turnState !== TURN_STATES.PLAYER_TURN_START) {
      return { ok: false, error: 'Cannot play right now' };
    }

    if (this.forcedWildDraw) {
      // §7.2 Branch B — wild + drawn-card combo to win
      wild = p.hand.find((c) => c.value === 'WILD' && !c.isLiarModifier);
      if (!wild) return { ok: false, error: 'No wild card in hand' };
    } else {
      wild = p.hand.find((c) => c.id === wildCardId);
      if (!wild || wild.value !== 'WILD') return { ok: false, error: 'Invalid wild card' };
    }

    const followup = p.hand.find((c) => c.id === followupCardId);
    if (!followup) return { ok: false, error: 'Follow-up card not in hand' };
    if (followup.id === wild.id) return { ok: false, error: 'Follow-up cannot be the wild itself' };
    if (followup.value === 'WILD' && !followup.isLiarModifier) {
      return { ok: false, error: 'Wild cannot be a follow-up card' };
    }

    this.wildDrawnOption = null;
    p.hand = p.hand.filter((c) => c.id !== wild.id);
    this.discardPile.push(wild);
    this.activeColor = declaredColor;
    this.activeValue = 'WILD';
    this.pendingEffects = { skip: false };
    this.turnState = TURN_STATES.AWAITING_WILD_FOLLOWUP;

    return this._playFollowUp(p, followupCardId, followupIsFaceDown, followupClaim, declaredColor);
  }

  _playFollowUp(p, followupCardId, isFaceDown, claim, wildColor) {
    const card = p.hand.find((c) => c.id === followupCardId);
    if (!card) return { ok: false, error: 'Follow-up card not in hand' };
    if (card.value === 'WILD' && !card.isLiarModifier) return { ok: false, error: 'Wild cannot be a follow-up card' };

    if (isFaceDown) {
      if (!isClaimValid(claim)) {
        return { ok: false, error: 'Invalid follow-up declaration' };
      }
      return this._playFaceDown(p, card, claim);
    }

    if (card.isLiarModifier) return { ok: false, error: 'Liar card must be played face-down' };
    if (!isCardPlayable(card, wildColor, 'WILD', this.drawStackCount)) {
      return { ok: false, error: 'Follow-up card not playable' };
    }

    p.hand = p.hand.filter((c) => c.id !== card.id);
    this.discardPile.push(card);
    this.activeColor = card.color;
    this.activeValue = card.value;
    this.pendingEffects = { skip: false };
    this.turnState = TURN_STATES.PLAYER_TURN_START;

    const res = this._postPlayAdvance(p);
    this._broadcast();
    return { ok: true, gameOver: !!res.gameOver };
  }

  /** §9 — draw from the deck (recycling handled inside). */
  handleDrawCard(socketId) {
    if (this.gameState === TURN_STATES.GAME_OVER_VICTORY) return { ok: false, error: 'Game over' };
    if (socketId !== this.activePlayerId) return { ok: false, error: 'Not your turn' };
    const p = this.players.get(socketId);
    if (!p || p.isSpectator) return { ok: false, error: 'Invalid player' };

    if (this.turnState !== TURN_STATES.PLAYER_TURN_START && this.turnState !== TURN_STATES.AWAITING_WILD_FOLLOWUP) {
      return { ok: false, error: 'Cannot draw right now' };
    }

    if (this.turnState === TURN_STATES.PLAYER_TURN_START && this.hasDrawnThisTurn) {
      return { ok: false, error: 'Already drew this turn — play or pass' };
    }

    if (this.drawStackCount > 0) return this._acceptStack(p);

    if (this.forcedWildDraw) {
      // §7.2 — forced 1-card draw
      const drawn = this._drawFromDeck();
      if (!drawn) return { ok: false, error: 'Deck is empty' };
      p.hand.push(drawn);
      this.hasDrawnThisTurn = true;
      this.forcedWildDraw = false;
      if (isWildValue(drawn.value)) {
        // Branch A — drawn another Wild → auto-pass turn
        this._advanceTurn(p.id);
        this._broadcast();
        return { ok: true, forcedWild: 'auto-pass' };
      }
      // Branch B — option to pass or play the combo
      this.wildDrawnOption = { cardId: drawn.id };
      this._broadcast();
      return { ok: true, forcedWild: 'option' };
    }

    if (this.turnState === TURN_STATES.AWAITING_WILD_FOLLOWUP) {
      return this._drawUntilPlayable(p);
    }

    const drawn = this._drawFromDeck();
    if (!drawn) return { ok: false, error: 'Deck is empty' };
    p.hand.push(drawn);
    this.hasDrawnThisTurn = true;
    this._broadcast();
    return { ok: true, drawn: 1 };
  }

  /**
   * §7.1 — during a wild combo, drawing continues until a playable non-liar card
   * matching the declared color is found and immediately played.
   */
  _drawUntilPlayable(p) {
    const wildColor = this.activeColor;
    let drawnCards = 0;
    for (let i = 0; i < 60; i++) {
      const card = this._drawFromDeck();
      if (!card) break;
      drawnCards += 1;
      if (card.value === 'WILD' || (card.value === 'WILD_DRAW_4' && card.isLiarModifier)) {
        // wilds cannot be the follow-up; keep drawing per the rules
        p.hand.push(card);
        continue;
      }
      if (!card.isLiarModifier && card.color === wildColor) {
        // playable → immediately play as the follow-up
        p.hand.push(card);
        this.hasDrawnThisTurn = true;
        const res = this._playFollowUp(p, card.id, false, null, wildColor);
        return { ok: true, drawn: drawnCards, autoPlayed: true, gameOver: !!res.gameOver };
      }
      p.hand.push(card);
    }
    this.hasDrawnThisTurn = true;
    this._broadcast();
    return { ok: true, drawn: drawnCards, autoPlayed: false };
  }

  /** §6.3 — accept the accumulated +2/+4 penalty stack. */
  handleAcceptDrawStack(socketId) {
    if (socketId !== this.activePlayerId) return { ok: false, error: 'Not your turn' };
    const p = this.players.get(socketId);
    if (!p || p.isSpectator) return { ok: false, error: 'Invalid player' };
    if (this.drawStackCount <= 0) return { ok: false, error: 'No pending draw stack' };
    return this._acceptStack(p);
  }

  _acceptStack(p) {
    const n = this.drawStackCount;
    this._drawNCards(p, n);
    this.drawStackCount = 0;
    this._advanceTurn(p.id);
    this._broadcast();
    return { ok: true, cardsDrawn: n };
  }

  /** §5.5 / §5.7 — CALL LIAR / ACCEPT resolution (eligible player only). */
  handleChallengeAction(socketId, action) {
    if (this.gameState === TURN_STATES.GAME_OVER_VICTORY) return { ok: false, error: 'Game over' };
    if (this.turnState !== TURN_STATES.AWAITING_CHALLENGE) return { ok: false, error: 'No pending challenge' };
    if (socketId !== this.challengePlayerId) return { ok: false, error: 'Only the eligible next player may act' };

    const bluffer = this.players.get(this.activePlayerId);
    const challenger = this.players.get(this.challengePlayerId);
    const topCard = this.discardPile[this.discardPile.length - 1];
    const declared = { color: topCard.declaredColor, value: topCard.declaredValue };
    const stack = this.drawStackCount;

    let wasLying = null;
    let penalizedPlayerId = null;
    let cardsDrawn = 0;

    if (action === 'call_liar') {
      const outcome = resolveChallenge(topCard, declared, stack);
      wasLying = outcome.wasLying;
      if (wasLying) {
        penalizedPlayerId = bluffer.id;
        cardsDrawn = outcome.cardsToDrawByPenalized;
        this._drawNCards(bluffer, cardsDrawn);
      } else {
        penalizedPlayerId = challenger.id;
        cardsDrawn = outcome.cardsToDrawByPenalized;
        this._drawNCards(challenger, cardsDrawn);
      }
      // the accumulated stack has been paid by the penalized player → reset
      this.drawStackCount = 0;
    }
    // accept_bluff: the declared stack (+2/+4) PERSISTS for the next player.

    this.challengePlayerId = null;
    this.challengeExpiresAt = null;
    this.pendingEffects = { skip: false };
    this.turnState = TURN_STATES.PLAYER_TURN_START;

    const resolvedPayload = {
      challengerId: challenger.id,
      challengerName: challenger.name,
      blufferId: bluffer.id,
      blufferName: bluffer.name,
      wasLying,
      declaredColor: declared.color,
      declaredValue: declared.value,
      realCard:
        action === 'call_liar'
          ? {
              color: topCard.color,
              value: topCard.value,
              isLiarModifier: !!topCard.isLiarModifier,
            }
          : null,
      revealedCard: { color: declared.color, value: declared.value },
      penalizedPlayerId,
      penalizedName: penalizedPlayerId ? this.players.get(penalizedPlayerId)?.name : null,
      cardsDrawn,
    };

    this._roomBroadcast(
      action === 'call_liar' ? 'challenge_resolved' : 'bluff_accepted',
      resolvedPayload
    );

    let gameOver = false;
    if (bluffer.hand.length === 0) {
      const res = this._registerWinner(bluffer);
      gameOver = res.gameOver;
    }
    if (!gameOver) {
      this._advanceTurn(bluffer.id);
    }
    this._broadcast();
    return { ok: true, gameOver, resolvedPayload };
  }

  // ---------------------------------------------------------------- UNO

  handleCallUno(socketId) {
    if (socketId !== this.activePlayerId) return { ok: false, error: 'Not your turn' };
    const p = this.players.get(socketId);
    if (!p || p.isSpectator) return { ok: false, error: 'Invalid player' };
    if (p.hand.length !== 1 && p.hand.length !== 2) return { ok: false, error: 'UNO is only for a 1-card hand' };
    p.hasCalledUno = true;
    this._roomBroadcast('uno_called', { playerId: p.id, playerName: p.name });
    this._broadcast();
    return { ok: true };
  }

  handleReportMissedUno(socketId, targetPlayerId) {
    if (!this.unoCatchWindow || this.unoCatchWindow.targetPlayerId !== targetPlayerId) {
      return { ok: false, error: 'No active catch window' };
    }
    if (Date.now() >= this.unoCatchWindow.expiresAt) {
      this.unoCatchWindow = null;
      return { ok: false, error: 'Catch window expired' };
    }
    const reporter = this.players.get(socketId);
    const target = this.players.get(targetPlayerId);
    if (!reporter || !target || target.isSpectator || targetPlayerId === socketId) {
      return { ok: false, error: 'Invalid report' };
    }
    const timer = this.timers.get(`uno-${targetPlayerId}`);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(`uno-${targetPlayerId}`);
    }
    this.unoCatchWindow = null;
    this._drawNCards(target, 2);
    this._roomBroadcast('uno_penalty', {
      targetPlayerId: target.id,
      targetName: target.name,
      reporterName: reporter.name,
      cardsDrawn: 2,
    });
    this._broadcast();
    return { ok: true, cardsDrawn: 2 };
  }

  /** Pass after drawing (or the wild-last-card Option 1). */
  handlePassTurn(socketId) {
    if (socketId !== this.activePlayerId) return { ok: false, error: 'Not your turn' };
    const p = this.players.get(socketId);
    if (!p || p.isSpectator) return { ok: false, error: 'Invalid player' };
    if (this.drawStackCount > 0) return { ok: false, error: 'Must accept the draw stack' };
    if (this.forcedWildDraw) return { ok: false, error: 'Must draw the forced wild card first' };
    if (this.turnState === TURN_STATES.AWAITING_WILD_FOLLOWUP) {
      return { ok: false, error: 'Must complete the wild combo' };
    }
    if (this.wildDrawnOption) {
      // §7.2 Branch B — Option 1 (Pass): keep both cards; turn ends.
      this.wildDrawnOption = null;
      this._advanceTurn(p.id);
      this._broadcast();
      return { ok: true, passed: 'wild-draw' };
    }
    if (!this.hasDrawnThisTurn) return { ok: false, error: 'Must play or draw first' };
    this.hasDrawnThisTurn = false;
    this._advanceTurn(p.id);
    this._broadcast();
    return { ok: true };
  }

  // ---------------------------------------------------------------- disconnect

  handleDisconnect(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;
    p.isConnected = false;

    if (this.gameState === TURN_STATES.LOBBY) {
      this.players.delete(socketId);
      if (this.hostId === socketId) {
        this.hostId = [...this.players.keys()][0] || null;
      }
      this._broadcastRoom();
      return;
    }

    // player who just disconnected may no longer be challenged
    if (this.turnState === TURN_STATES.AWAITING_CHALLENGE && this.challengePlayerId === socketId) {
      this._reassignChallengeAfterDisconnect();
    }

    // their turn is forfeited — advance so the game never stalls
    if (this.activePlayerId === socketId && this.turnState !== TURN_STATES.AWAITING_CHALLENGE) {
      this._advanceTurn(socketId);
    }

    this._roomBroadcast('player_disconnected', { socketId });
    this._broadcast();
  }

  _reassignChallengeAfterDisconnect() {
    const blufferId = this.activePlayerId;
    const candidates = this._seatOrder().filter((id) => this._isActive(id) && id !== blufferId);
    if (candidates.length === 0) {
      // nobody left to challenge → declared claim becomes official
      this.challengePlayerId = blufferId;
      this.handleChallengeAction(blufferId, 'accept_bluff');
      return;
    }
    const order = this._seatOrder();
    let pos = order.indexOf(blufferId);
    for (let i = 0; i < order.length; i++) {
      pos = (pos + this.direction + order.length) % order.length;
      if (candidates.includes(order[pos])) {
        this.challengePlayerId = order[pos];
        this.challengeExpiresAt = Date.now() + CHALLENGE_TIMER_MS;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- broadcast

  _broadcast() {
    if (!this.emitter) return;
    this._roomBroadcast('game_state_update', this.getPublicState());
    for (const [sid, p] of this.players) {
      this._socketEmit(sid, 'private_hand_sync', { hand: p.hand });
    }
  }

  _broadcastRoom() {
    if (!this.emitter) return;
    this._roomBroadcast('room_update', this.getRoomPayload());
  }

  getRoomPayload() {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      startingHandSize: this.startingHandSize,
      maxStartingHandSize: this.maxStartingHandSize(),
      gameState: this.gameState,
      players: this._seatOrder().map((id) => {
        const p = this.players.get(id);
        return {
          id: p.id,
          name: p.name,
          isConnected: p.isConnected,
          isHost: id === this.hostId,
          cardCount: p.hand.length,
          rank: p.rank,
        };
      }),
    };
  }

  /** Masked public state — never leaks hidden identities or opponent hands. */
  getPublicState() {
    const now = Date.now();
    const top = this.discardPile[this.discardPile.length - 1] || null;
    const topCard = top
      ? top.isFaceDownPlayed
        ? {
            isFaceDown: this.turnState === TURN_STATES.AWAITING_CHALLENGE,
            declaredColor: top.declaredColor,
            declaredValue: top.declaredValue,
          }
        : { isFaceDown: false, color: top.color, value: top.value }
      : null;

    return {
      roomId: this.roomId,
      hostId: this.hostId,
      gameState: this.gameState,
      turnState: this.turnState,
      activePlayerId: this.activePlayerId,
      direction: this.direction,
      activeColor: this.activeColor,
      activeValue: this.activeValue,
      topCard,
      drawDeckCount: this.deck.length,
      drawStackCount: this.drawStackCount,
      challengePlayerId: this.challengePlayerId,
      challengeTimeRemaining: this.challengeExpiresAt
        ? Math.max(0, Math.ceil((this.challengeExpiresAt - now) / 1000))
        : 0,
      challengeExpiresAt: this.challengeExpiresAt,
      forcedWildDraw: this.forcedWildDraw,
      wildDrawnOption: this.wildDrawnOption,
      hasDrawnThisTurn: this.hasDrawnThisTurn,
      unoCatchWindow: this.unoCatchWindow
        ? {
            targetPlayerId: this.unoCatchWindow.targetPlayerId,
            targetName: this.unoCatchWindow.targetName,
            expiresAt: this.unoCatchWindow.expiresAt,
          }
        : null,
      winners: [...this.winners].sort((a, b) => a.rank - b.rank),
      startingHandSize: this.startingHandSize,
      players: this._seatOrder().map((id) => {
        const p = this.players.get(id);
        return {
          id: p.id,
          name: p.name,
          cardCount: p.hand.length,
          hasCalledUno: p.hasCalledUno,
          isConnected: p.isConnected,
          isSpectator: p.isSpectator,
          isHost: id === this.hostId,
          rank: p.rank,
        };
      }),
    };
  }
}