/**
 * Authoritative turn-state machine for a Liar's UNO room.
 * State constants are the single source of truth for both server logic
 * and the masked client broadcasts.
 */
export const TURN_STATES = {
  LOBBY: 'LOBBY',
  GAME_INITIALIZE_DEAL: 'GAME_INITIALIZE_DEAL',
  PLAYER_TURN_START: 'PLAYER_TURN_START',
  PLAY_NORMAL: 'PLAY_NORMAL',
  PLAY_FACE_DOWN: 'PLAY_FACE_DOWN',
  PLAY_WILD_START: 'PLAY_WILD_START',
  AWAITING_CHALLENGE: 'AWAITING_CHALLENGE',
  AWAITING_WILD_FOLLOWUP: 'AWAITING_WILD_FOLLOWUP',
  RESOLVE_DRAW_STACK: 'RESOLVE_DRAW_STACK',
  CHECK_UNO_PENALTY: 'CHECK_UNO_PENALTY',
  CHECK_WIN_CONDITION: 'CHECK_WIN_CONDITION',
  ADVANCE_TURN_ROTATION: 'ADVANCE_TURN_ROTATION',
  GAME_OVER_VICTORY: 'GAME_OVER_VICTORY',
};

/** Challenge window is display-only; state persists until CALL LIAR / ACCEPT. */
export const CHALLENGE_TIMER_MS = 10_000;

/** Auto-closes the missed-UNO catch window after this duration. */
export const UNO_CATCH_WINDOW_MS = 5_000;

/** States during which the active player may interact with their hand. */
export const ACTIVE_TURN_STATES = new Set([
  TURN_STATES.PLAYER_TURN_START,
  TURN_STATES.PLAY_NORMAL,
  TURN_STATES.PLAY_FACE_DOWN,
  TURN_STATES.PLAY_WILD_START,
  TURN_STATES.AWAITING_WILD_FOLLOWUP,
]);
