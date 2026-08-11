import { motion } from 'framer-motion';
import Card from './Card.jsx';

/**
 * Interactive draw pile. Shows the deck count, and a +N badge when a
 * draw-stack penalty is pending. Clicking accepts the stack or draws a card.
 */
export default function DrawDeck({ deckCount, drawStackCount = 0, onClick, disabled = false, size = 'md' }) {
  const cardSize = size === 'lg' ? 'lg' : 'md';
  return (
    <div className="pile-stack">
      <motion.div
        animate={{ rotate: [0, 1.5, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ position: 'absolute', transform: 'rotate(4deg) translateX(4px)', opacity: 0.75 }}
      >
        <Card faceDown size={cardSize} liarBadge />
      </motion.div>
      <motion.div
        whileTap={disabled ? undefined : { scale: 0.92 }}
        onClick={disabled ? undefined : onClick}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      >
        <Card faceDown size={cardSize} liarBadge />
      </motion.div>
      {drawStackCount > 0 && <div className="stack-badge">+{drawStackCount}</div>}
      <div className="pile-count-badge">{deckCount}</div>
      <div className="pile-label">Deck · Click to draw</div>
    </div>
  );
}