import { motion } from 'framer-motion';

const RANK_MEDAL = { 1: '👑', 2: '🥈', 3: '🥉' };

const AVATAR_HUES = [210, 330, 160, 45, 280, 190, 100];

/**
 * Dynamic oval seating around the table for 2–7 players.
 * Positioning is driven by x/y percentages passed from the layout.
 */
export default function OpponentSeat({ player, isActive, x, y }) {
  const hue = AVATAR_HUES[(player.id.length + player.name.length) % AVATAR_HUES.length];
  const medal = player.rank ? RANK_MEDAL[player.rank] : null;
  const initial = (player.name || '?').charAt(0).toUpperCase();

  return (
    <motion.div
      className="seat"
      style={{ left: `${x}%`, top: `${y}%` }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: player.isConnected ? 1 : 0.4, scale: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
    >
      <div className={`seat-avatar ${isActive ? 'seat-active' : ''}`} style={{ background: `linear-gradient(145deg, hsl(${hue} 45% 32%), hsl(${hue} 55% 18%))` }}>
        {initial}
        {player.hasCalledUno && player.cardCount === 1 && (
          <div className="seat-uno-flag">UNO</div>
        )}
        {medal && (
          <div className="seat-rank-medal">{medal}</div>
        )}
      </div>
      <div className="seat-name">
        {player.name}
        {!player.isConnected && ' (disconnected)'}
      </div>
      <div className="seat-cards">
        {player.isSpectator ? 'Out' : `${player.cardCount} cards`}
      </div>
    </motion.div>
  );
}