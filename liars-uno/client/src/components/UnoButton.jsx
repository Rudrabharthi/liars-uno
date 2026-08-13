import { motion } from 'framer-motion';

/**
 * Prominent "UNO!" shout button (shown to the active player on 1–2 cards)
 * and the "Catch UNO!" report button for opponents during a catch window.
 */
export default function UnoButton({ game, myId, onCallUno, onReportMissedUno }) {
  if (!game || !myId) return null;

  const me = game.players?.find((p) => p.id === myId);
  const isMyTurn = game.activePlayerId === myId;

  // MY "UNO!" shout — when on my turn with 1 or 2 cards, not yet called
  const showShout = isMyTurn && me && (me.cardCount === 1 || me.cardCount === 2) && !me.hasCalledUno;

  // Opponent catch window
  const catchWin = game.unoCatchWindow;
  const showCatch = catchWin && catchWin.targetPlayerId !== myId;

  if (!showShout && !showCatch) return null;

  return (
    <div style={{ position: 'fixed', bottom: 30, left: 18, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {showShout && (
        <motion.button
          className="uno-button"
          onClick={onCallUno}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.95 }}
        >
          UNO!
        </motion.button>
      )}
      {showCatch && (
        <motion.button
          className="btn-catch"
          onClick={() => onReportMissedUno(catchWin.targetPlayerId)}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          Catch UNO! ({catchWin.targetName})
        </motion.button>
      )}
    </div>
  );
}