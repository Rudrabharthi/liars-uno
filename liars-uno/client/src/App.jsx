import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useSocket } from './context/SocketContext.jsx';
import Lobby from './components/Lobby.jsx';
import Card from './components/Card.jsx';
import DiscardPile from './components/DiscardPile.jsx';
import DrawDeck from './components/DrawDeck.jsx';
import PlayerHand from './components/PlayerHand.jsx';
import OpponentSeat from './components/OpponentSeat.jsx';
import DeclareCardModal from './components/DeclareCardModal.jsx';
import ChallengeBanner from './components/ChallengeBanner.jsx';
import UnoButton from './components/UnoButton.jsx';
import RevealOverlay from './components/RevealOverlay.jsx';
import GameOverModal from './components/GameOverModal.jsx';
import { COLOR_SWATCH } from './utils/cardLogic.js';
import sfx from './utils/soundEffects.js';

const DEG = Math.PI / 180;

function seatPositions(playerIndex, total) {
  const rx = 45;
  const ry = 41;
  const positions = [];
  for (let i = 0; i < total; i++) {
    const angle = (90 + (360 / total) * ((i - playerIndex + total) % total)) * DEG;
    positions.push({
      x: 50 + rx * Math.cos(angle),
      y: 50 + ry * Math.sin(angle),
    });
  }
  return positions;
}

export default function App() {
  const {
    connected,
    roomId,
    room,
    game,
    hand,
    playerId,
    gameOver,
    toasts,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    playCard,
    drawCard,
    acceptDrawStack,
    passTurn,
    callLiar,
    acceptBluff,
    callUno,
    reportMissedUno,
    addToast,
  } = useSocket();

  const myId = playerId;
  const [bluffCard, setBluffCard] = useState(null);
  const [wildCard, setWildCard] = useState(null);
  const [showPodium, setShowPodium] = useState(false);

  // ---- seating (computed unconditionally to keep hooks before any return) ----
  const seatOrder = game?.players?.map((p) => p.id) ?? [];
  const myIndex = Math.max(0, seatOrder.indexOf(myId ?? ''));
  const positions = useMemo(
    () => seatPositions(myIndex, Math.max(1, game?.players?.length ?? 1)),
    [myIndex, game?.players?.length]
  );

  // auto-join via invite link
  useEffect(() => {
    const m = window.location.hash.match(/#join=(\w{6})/);
    if (m && !roomId) {
      const savedName = localStorage.getItem('liarsuno-name') || 'Player';
      joinRoom({ roomId: m[1].toUpperCase(), playerName: savedName }).then((res) => {
        if (!res.ok) addToast(res.error || 'Could not join invite room', 'danger');
      });
    }
  }, [roomId, joinRoom, addToast]);

  useEffect(() => {
    if (game?.gameState === 'GAME_OVER_VICTORY') setShowPodium(true);
  }, [game?.gameState]);

  if (!roomId || !room) return <Lobby />;

  const inGame = game && game.gameState !== 'LOBBY';
  if (!inGame) return <Lobby />;

  const isMyTurn = game.activePlayerId === myId;
  const myPlayer = game.players.find((p) => p.id === myId);
  const isHost = game.hostId === myId;
  const canAct =
    isMyTurn &&
    (game.turnState === 'PLAYER_TURN_START' || game.turnState === 'AWAITING_WILD_FOLLOWUP');

  // ---------- actions ----------
  const toastErr = (res) => {
    if (res && !res.ok) addToast(res.error || 'Action rejected', 'danger');
  };

  const handlePlayCard = (cardId) => playCard(cardId, false, null).then(toastErr);
  const handleBluffSubmit = (claim) => {
    const card = bluffCard;
    setBluffCard(null);
    if (card) playCard(card.id, true, claim).then(toastErr);
  };
  const handleWildColor = (color) => {
    const card = wildCard;
    setWildCard(null);
    if (card) playCard(card.id, false, { color, value: 'WILD' }).then(toastErr);
  };
  const handleDrawClick = () => {
    if (!canAct) return;
    sfx.click();
    if (game.drawStackCount > 0) acceptDrawStack().then(toastErr);
    else drawCard().then(toastErr);
  };

  // ---------- seating ----------
  const opponents = game.players.filter((p) => p.id !== myId);

  const activePlayerName = game.players.find((p) => p.id === game.activePlayerId)?.name;
  const turnMsg = !isMyTurn
    ? `${activePlayerName}'s turn`
    : game.forcedWildDraw
      ? 'Your last card is a Wild — draw to play it'
      : game.drawStackCount > 0
        ? `Draw stack +${game.drawStackCount} — stack or accept`
        : game.turnState === 'AWAITING_WILD_FOLLOWUP'
          ? 'Complete your Wild combo — play a matching card or draw'
          : "Your turn";

  const mySeatPos = positions[myIndex];

  return (
    <div className="table-felt" style={{ height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* ---------- HUD ---------- */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          right: 14,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          zIndex: 40,
          pointerEvents: 'none',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="hud-chip">Room <strong>{game.roomId}</strong></span>
          <span className="hud-chip">
            Direction <strong>{game.direction === 1 ? 'CW →' : '← CCW'}</strong>
          </span>
          {game.drawStackCount > 0 && (
            <span className="hud-chip" style={{ color: 'var(--uno-red)' }}>
              Stack <strong>+{game.drawStackCount}</strong>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, pointerEvents: 'auto' }}>
          {isHost && game.gameState === 'GAME_OVER_VICTORY' && (
            <button className="btn-primary" onClick={() => startGame().then(toastErr)} style={{ padding: '6px 14px', fontSize: 12 }}>
              Play again
            </button>
          )}
          <button className="btn-ghost" onClick={() => leaveRoom()} style={{ padding: '6px 12px', fontSize: 12 }}>
            Leave
          </button>
        </div>
      </div>

      {/* ---------- turn banner ---------- */}
      <div className="turn-banner">
        <span
          className="hud-chip"
          style={{
            color: isMyTurn ? 'var(--uno-yellow)' : 'var(--text-hi)',
            borderColor: isMyTurn ? 'rgba(254,228,64,0.5)' : undefined,
            fontSize: 14,
            padding: '8px 18px',
          }}
        >
          {turnMsg}
        </span>
        <span
          className="hud-chip"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            padding: '6px 14px',
            marginTop: 6,
            borderColor: 'rgba(255,255,255,0.18)',
          }}
        >
          Active color
          <span
            style={{
              display: 'inline-block',
              width: 16,
              height: 16,
              borderRadius: 4,
              background: COLOR_SWATCH[game.activeColor] ?? '#888',
              border: '1px solid rgba(255,255,255,0.55)',
            }}
          />
          <strong style={{ textTransform: 'uppercase' }}>{game.activeColor}</strong>
        </span>
      </div>

      {/* ---------- table oval ---------- */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 40,
        }}
      >
        <div className="table-oval">
          <div className="pile-zone">
            <DiscardPile topCard={game.topCard} drawStackCount={game.drawStackCount} size="md" />
            <DrawDeck
              deckCount={game.drawDeckCount}
              drawStackCount={game.drawStackCount}
              onClick={handleDrawClick}
              disabled={!canAct}
            />
          </div>
        </div>
      </div>

      {/* ---------- opponent seats ---------- */}
      {opponents.map((p) => {
        const idx = seatOrder.indexOf(p.id);
        const pos = positions[idx] || positions[0];
        return (
          <OpponentSeat
            key={p.id}
            player={p}
            isActive={game.activePlayerId === p.id}
            x={pos.x}
            y={pos.y}
          />
        );
      })}

      {/* ---------- my seat chip ---------- */}
      {mySeatPos && (
        <div className="seat" style={{ left: `${mySeatPos.x}%`, top: `${mySeatPos.y}%`, zIndex: 8 }}>
          <div className={`seat-avatar ${isMyTurn ? 'seat-active' : ''}`} style={{ background: 'linear-gradient(145deg,#2a3f8f,#16224a)' }}>
            {(myPlayer?.name || '?').charAt(0).toUpperCase()}
            {myPlayer?.hasCalledUno && myPlayer?.cardCount === 1 && <div className="seat-uno-flag">UNO</div>}
          </div>
          <div className="seat-name">{myPlayer?.name}</div>
          <div className="seat-cards">{myPlayer?.cardCount} cards</div>
        </div>
      )}

      {/* ---------- hand ---------- */}
      <PlayerHand
        hand={hand}
        game={game}
        myId={myId}
        onPlayCard={handlePlayCard}
        onBluff={(card, isWild = false) => {
          sfx.click();
          if (isWild) setWildCard(card);
          else setBluffCard(card);
        }}
        onDraw={() => drawCard().then(toastErr)}
        onAcceptStack={() => acceptDrawStack().then(toastErr)}
        onPass={() => passTurn().then(toastErr)}
      />

      {/* ---------- action panel & uno ---------- */}
      <ChallengeBanner
        game={game}
        myId={myId}
        onCallLiar={() => callLiar().then(toastErr)}
        onAcceptBluff={() => acceptBluff().then(toastErr)}
      />
      <UnoButton
        game={game}
        myId={myId}
        onCallUno={() => callUno().then(toastErr)}
        onReportMissedUno={(targetId) => reportMissedUno(targetId).then(toastErr)}
      />

      {/* ---------- bluff reveal overlay ---------- */}
      <RevealOverlay />

      {/* ---------- modals ---------- */}
      <DeclareCardModal
        open={!!bluffCard}
        mode="bluff"
        card={bluffCard}
        activeColor={game.activeColor}
        activeValue={game.activeValue}
        drawStackCount={game.drawStackCount}
        openingMove={game.openingMove}
        onClose={() => setBluffCard(null)}
        onSubmit={handleBluffSubmit}
      />
      <DeclareCardModal
        open={!!wildCard}
        mode="wild"
        card={wildCard}
        onClose={() => setWildCard(null)}
        onColor={handleWildColor}
      />
      {(showPodium || game.gameState === 'GAME_OVER_VICTORY') && (
        <GameOverModal winners={gameOver || game.winners} myId={myId} onClose={() => setShowPodium(false)} />
      )}

      {/* ---------- toasts ---------- */}
      <div className="toast-region">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast-${t.type}`}
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {t.message}
          </motion.div>
        ))}
      </div>
    </div>
  );
}