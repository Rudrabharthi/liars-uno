import { useEffect } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';

const RANK_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

/**
 * Final podium modal — full tournament standings + victory confetti.
 */
export default function GameOverModal({ winners, myId, onClose }) {
  useEffect(() => {
    const end = Date.now() + 2500;
    const colors = ['#FF0000', '#FFFF00', '#008000', '#0000FF'];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    return () => confetti.reset();
  }, []);

  if (!winners || winners.length === 0) return null;

  const ranked = [...winners].sort((a, b) => a.rank - b.rank);
  const myRank = ranked.find((w) => w.id === myId)?.rank ?? null;
  const top3 = ranked.slice(0, 3);

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="modal-card"
        style={{ maxWidth: 520 }}
        initial={{ scale: 0.8, y: 40 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
      >
        <h2 className="panel-title" style={{ textAlign: 'center', fontSize: 26, margin: 0 }}>
          {myRank === 1 ? '🏆 VICTORY!' : myRank ? `You placed #${myRank}` : 'Game Over'}
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--text-mid)', fontSize: 13, margin: '6px 0 0' }}>
          Final tournament standings
        </p>

        <div className="game-over-podium">
          {top3.map((w) => (
            <div className="podium-entry" key={w.id}>
              <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-hi)' }}>{w.name}</div>
              <div className={`podium-block podium-rank-${w.rank}`}>{RANK_LABEL[w.rank]}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {ranked.slice(3).map((w) => (
            <div
              key={w.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 700 }}>{w.name}</span>
              <span style={{ color: 'var(--text-mid)' }}>
                {RANK_LABEL[w.rank] ?? `#${w.rank}`} {w.rank === ranked.length ? '💀' : ''}
              </span>
            </div>
          ))}
        </div>

        {onClose && (
          <button className="btn-primary" onClick={onClose} style={{ width: '100%', marginTop: 18 }}>
            Back to room
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}