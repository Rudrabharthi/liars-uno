import { motion, AnimatePresence } from 'framer-motion';
import { useSocket } from '../context/SocketContext.jsx';
import Card from './Card.jsx';
import { VALUE_TEXT } from '../utils/cardLogic.js';

/**
 * Full-screen center reveal shown when a challenge is resolved — the Liar
 * card is exposed for 5 seconds so everyone sees what was really played.
 */
export default function RevealOverlay() {
  const { reveal } = useSocket();
  if (!reveal) return null;

  const {
    wasLying,
    blufferName,
    challengerName,
    declaredColor,
    declaredValue,
    realCard,
    penalizedName,
    cardsDrawn,
  } = reveal;

  const declaredLabel = `${VALUE_TEXT[declaredValue] ?? declaredValue} ${declaredColor}`;
  const realLabel = realCard ? `${VALUE_TEXT[realCard.value] ?? realCard.value} ${realCard.color}` : null;

  return (
    <AnimatePresence>
      <motion.div
        className="reveal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className={`reveal-panel ${wasLying ? 'reveal-danger' : 'reveal-ok'}`}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
        >
          <div className={`reveal-title ${wasLying ? 'reveal-title-danger' : 'reveal-title-ok'}`}>
            {wasLying ? 'BLUFF EXPOSED!' : 'BLUFF WAS TRUTHFUL!'}
          </div>
          <div className="reveal-sub">
            {blufferName} played a Liar card face-down
          </div>

          <div className="reveal-cards">
            {realCard && (
              <div className="reveal-card-slot">
                <Card card={realCard} size="lg" liarBadge={realCard.isLiarModifier} />
                <div className="reveal-card-caption">The real card</div>
              </div>
            )}
            <div className="reveal-card-slot">
              <Card card={{ color: declaredColor, value: declaredValue }} size="lg" liarBadge />
              <div className="reveal-card-caption">Declared claim</div>
            </div>
          </div>

          <div className="reveal-details">
            <div>
              Claimed as <strong>{declaredLabel}</strong>
            </div>
            {realLabel && wasLying && (
              <div>
                Actually <strong>{realLabel}</strong>
              </div>
            )}
            <div>
              Challenged by <strong>{challengerName}</strong>
            </div>
            <div className="reveal-penalty">
              {penalizedName} drew {cardsDrawn} cards
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}