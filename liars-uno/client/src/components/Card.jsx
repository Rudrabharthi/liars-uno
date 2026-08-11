import { motion } from 'framer-motion';
import { COLOR_CLASS, VALUE_LABEL } from '../utils/cardLogic.js';

/**
 * Render a single card.
 * props:
 *  - card         { color, value, isLiarModifier } (face-up) or declared form
 *  - faceDown     boolean — draw the card back
 *  - playable     boolean — pulsing glow
 *  - dim          boolean — grey out
 *  - selected     boolean — raised + yellow ring
 *  - interactive  boolean — hover lift
 *  - onClick
 *  - size         'sm' | 'md' | 'lg'
 *  - ghostLabel   string — "declared as +2 blue" chip on table bluffs
 *  - liarBadge    boolean — show the dark circle indicator
 */
export default function Card({
  card,
  faceDown = false,
  playable = false,
  dim = false,
  selected = false,
  interactive = false,
  onClick,
  size = 'md',
  ghostLabel = null,
  liarBadge = null,
  style,
  zIndex,
}) {
  const sizeClass = size === 'sm' ? 'card-small' : size === 'lg' ? 'card-lg' : size === 'tiny' ? 'card-tiny' : '';

  if (faceDown) {
    return (
      <motion.div
        whileHover={interactive ? { y: -8 } : undefined}
        onClick={onClick}
        className={`card card-back ${sizeClass} ${playable ? 'card-playable' : ''} ${interactive ? 'card-interactive' : ''} ${dim ? 'card-dim' : ''} ${selected ? 'card-selected' : ''}`}
        style={style}
        data-z={zIndex}
      >
        <div className="back-diamond" />
        {(liarBadge === true) && <div className="liar-indicator-badge" />}
      </motion.div>
    );
  }

  const color = card?.color;
  const value = card?.value;
  const isWild = color === 'wild';
  const label = VALUE_LABEL[value] ?? value;

  return (
    <motion.div
      whileHover={interactive ? { y: -8 } : undefined}
      onClick={onClick}
      className={`card ${sizeClass} ${COLOR_CLASS[color] ?? 'card--wild'} ${playable ? 'card-playable' : ''} ${interactive ? 'card-interactive' : ''} ${dim ? 'card-dim' : ''} ${selected ? 'card-selected' : ''}`}
      style={style}
      data-z={zIndex}
    >
      {card?.isLiarModifier === true && <div className="liar-indicator-badge" />}
      <div className="card-corner">
        {isWild ? '★' : value}
      </div>
      <div className="card-center">{label}</div>
      <div className="card-corner" style={{ transform: 'rotate(180deg)' }}>
        {isWild ? '★' : value}
      </div>
      {ghostLabel && <div className="card-ghost-chip">{ghostLabel}</div>}
    </motion.div>
  );
}