import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { io } from 'socket.io-client';
import sfx from '../utils/soundEffects.js';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

const SocketContext = createContext(null);

const initialState = {
  connected: false,
  playerId: null,
  roomId: null,
  room: null,
  game: null,
  hand: [],
  gameOver: null,
  toasts: [],
  reveal: null,
};

let toastSeq = 0;

function reducer(state, action) {
  switch (action.type) {
    case 'CONNECTED':
      return { ...state, connected: action.connected };
    case 'ROOM_JOINED':
      return { ...state, roomId: action.roomId, playerId: action.playerId };
    case 'ROOM_UPDATE':
      return { ...state, room: action.room, roomId: action.room.roomId };
    case 'GAME_STATE':
      return { ...state, game: action.game, roomId: action.game.roomId, gameOver: null };
    case 'HAND_SYNC':
      return { ...state, hand: action.hand };
    case 'GAME_OVER':
      return { ...state, gameOver: action.winners };
    case 'LEAVE':
      return { ...state, roomId: null, playerId: null, room: null, game: null, hand: [], gameOver: null };
    case 'TOAST_ADD':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'TOAST_REMOVE':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'REVEAL_SHOW':
      return { ...state, reveal: action.reveal };
    case 'REVEAL_CLEAR':
      return { ...state, reveal: null };
    default:
      return state;
  }
}

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const revealTimeoutRef = useRef(null);
  const [state, dispatch] = useReducer(reducer, initialState);
  const handLenRef = useRef(0);

  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastSeq;
    dispatch({ type: 'TOAST_ADD', toast: { id, message, type } });
    setTimeout(() => dispatch({ type: 'TOAST_REMOVE', id }), 3800);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
    });
    socketRef.current = socket;

    socket.on('connect', () => dispatch({ type: 'CONNECTED', connected: true }));
    socket.on('disconnect', () => dispatch({ type: 'CONNECTED', connected: false }));

    socket.on('room_update', (room) => dispatch({ type: 'ROOM_UPDATE', room }));

    socket.on('game_state_update', (game) => dispatch({ type: 'GAME_STATE', game }));

    socket.on('private_hand_sync', ({ hand }) => {
      if (hand.length > handLenRef.current) sfx.draw();
      if (hand.length < handLenRef.current) sfx.slap();
      handLenRef.current = hand.length;
      dispatch({ type: 'HAND_SYNC', hand });
    });

    socket.on('challenge_resolved', (r) => {
      if (r.wasLying === true) sfx.buzzer();
      else if (r.wasLying === false) sfx.buzzer();
      const reveal = {
        id: ++toastSeq,
        wasLying: r.wasLying,
        blufferName: r.blufferName,
        challengerName: r.challengerName,
        declaredColor: r.declaredColor,
        declaredValue: r.declaredValue,
        realCard: r.realCard,
        penalizedName: r.penalizedName,
        cardsDrawn: r.cardsDrawn,
      };
      dispatch({ type: 'REVEAL_SHOW', reveal });
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = setTimeout(() => dispatch({ type: 'REVEAL_CLEAR' }), 5000);
      addToast(
        r.wasLying
          ? r.penalizedPlayerId === socket.id
            ? 'You got caught! You drew penalty cards.'
            : 'A bluff was exposed!'
          : 'The bluff was truthful — challenger pays the penalty!',
        r.wasLying ? 'danger' : 'warn'
      );
    });

    socket.on('bluff_accepted', () => {
      sfx.slap();
      addToast('Bluff accepted. The declared card stands!', 'success');
    });

    socket.on('uno_called', ({ playerName }) => {
      sfx.uno();
      addToast(`${playerName} called UNO!`, 'success');
    });

    socket.on('uno_catch_window', ({ targetName }) => {
      sfx.heartbeat();
      addToast(`${targetName} forgot to call UNO — catch them!`, 'warn');
    });

    socket.on('uno_penalty', ({ targetName, reporterName, cardsDrawn }) => {
      sfx.drawPenalty();
      addToast(`${targetName} was caught by ${reporterName} and drew ${cardsDrawn} cards!`, 'danger');
    });

    socket.on('game_over', (payload) => {
      const winners = payload.winners || [];
      const me = winners.find((w) => w.id === socket.id);
      if (me && me.rank === 1) sfx.win();
      else if (me) sfx.lose();
      else sfx.win();
      dispatch({ type: 'GAME_OVER', winners });
    });

    socket.on('player_disconnected', ({ socketId }) => {
      addToast('A player disconnected.', 'warn');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [addToast]);

  // ---- actions (with server acks) ----

  const emitAck = useCallback((event, payload) => {
    const socket = socketRef.current;
    if (!socket) return Promise.resolve({ ok: false, error: 'Not connected' });
    return new Promise((resolve) => {
      socket.emit(event, payload || {}, (res) => resolve(res || { ok: false, error: 'No response' }));
    });
  }, []);

  const createRoom = useCallback(
    async ({ playerName, startingHandSize }) => {
      const res = await emitAck('create_room', { playerName, startingHandSize });
      if (res.ok) dispatch({ type: 'ROOM_JOINED', roomId: res.roomId, playerId: res.playerId });
      return res;
    },
    [emitAck]
  );

  const joinRoom = useCallback(
    async ({ roomId, playerName }) => {
      const res = await emitAck('join_room', { roomId, playerName });
      if (res.ok) dispatch({ type: 'ROOM_JOINED', roomId: res.roomId, playerId: res.playerId });
      return res;
    },
    [emitAck]
  );

  const leaveRoom = useCallback(async () => {
    await emitAck('leave_room', {});
    dispatch({ type: 'LEAVE' });
  }, [emitAck]);

  const configureRoom = useCallback(
    (startingHandSize) => emitAck('configure_room', { startingHandSize }),
    [emitAck]
  );
  const startGame = useCallback(() => emitAck('start_game', {}), [emitAck]);

  const playCard = useCallback(
    (cardId, isFaceDown, declaredClaim) =>
      emitAck('play_card', { cardId, isFaceDown, declaredClaim }).then((res) => {
        if (res.ok) sfx.slap();
        return res;
      }),
    [emitAck]
  );

  const playWildCombo = useCallback(
    (payload) =>
      emitAck('play_wild_combo', payload).then((res) => {
        if (res.ok) sfx.slap();
        return res;
      }),
    [emitAck]
  );

  const drawCard = useCallback(
    () =>
      emitAck('draw_card', {}).then((res) => {
        if (res.ok) sfx.draw();
        return res;
      }),
    [emitAck]
  );

  const acceptDrawStack = useCallback(
    () =>
      emitAck('accept_draw_stack', {}).then((res) => {
        if (res.ok) sfx.drawPenalty();
        return res;
      }),
    [emitAck]
  );

  const passTurn = useCallback(() => emitAck('pass_turn', {}), [emitAck]);

  const callLiar = useCallback(() => {
    sfx.buzzer();
    return emitAck('call_liar', {});
  }, [emitAck]);

  const acceptBluff = useCallback(
    () =>
      emitAck('accept_bluff', {}).then((res) => {
        if (res.ok) sfx.slap();
        return res;
      }),
    [emitAck]
  );

  const callUno = useCallback(
    () =>
      emitAck('call_uno', {}).then((res) => {
        if (res.ok) sfx.uno();
        return res;
      }),
    [emitAck]
  );

  const reportMissedUno = useCallback(
    (targetPlayerId) => emitAck('report_missed_uno', { targetPlayerId }),
    [emitAck]
  );

  const value = {
    ...state,
    socket: socketRef,
    addToast,
    createRoom,
    joinRoom,
    leaveRoom,
    configureRoom,
    startGame,
    playCard,
    playWildCombo,
    drawCard,
    acceptDrawStack,
    passTurn,
    callLiar,
    acceptBluff,
    callUno,
    reportMissedUno,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}