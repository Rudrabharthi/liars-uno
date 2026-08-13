import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Persistent bottom-right action panel — "CALL LIAR!" + "ACCEPT".
 * Enabled only for the server-authoritative eligible next player (challengePlayerId).
 */
export default function ChallengeBanner({ game, myId, onCallLiar, onAcceptBluff }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!game || game.turnState !== 'AWAITING_CHALLENGE' || !game.challengeExpiresAt) return;
    const tick = () => {
      const r = Math.max(0, Math.ceil((game.challengeExpiresAt - Date.now()) / 1000));
      setRemaining(r);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [game]);

  if (!game || game.turnState !== 'AWAITING_CHALLENGE') return null;

  const eligible = game.challengePlayerId === myId;
  const targetPlayer = game.players?.find((p) => p.id === game.challengePlayerId);

  return (
    <motion.div
      className="challenge-banner"
      initial={{ x: 80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
    >
      <div className="challenge-title">A bluff is on the table</div>
      {!eligible && (
        <div className="challenge-timer">
          {targetPlayer?.name} decides…
        </div>
      )}
      {eligible && <div className="challenge-timer">You decide · {remaining}s</div>}
      <button className="btn-liar" disabled={!eligible} onClick={onCallLiar}>
        ⚠ CALL LIAR!
      </button>
      <button className="btn-accept" disabled={!eligible} onClick={onAcceptBluff}>
        ✓ ACCEPT
      </button>
    </motion.div>
  );
}