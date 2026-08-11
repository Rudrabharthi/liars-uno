import Card from './Card.jsx';
import { VALUE_TEXT } from '../utils/cardLogic.js';

/**
 * Center-table discard stack. A face-down-played card permanently keeps its
 * declared form — the hidden identity is never revealed.
 */
export default function DiscardPile({ topCard, drawStackCount = 0, size = 'md' }) {
  if (!topCard) return null;

  const isBluff = topCard.isFaceDown || topCard.declaredColor;
  const declared = {
    color: topCard.declaredColor ?? topCard.color,
    value: topCard.declaredValue ?? topCard.value,
  };

  const ghostLabel = isBluff
    ? `declared ${VALUE_TEXT[declared.value] ?? declared.value}`
    : null;

  return (
    <div className="pile-stack">
      {/* fake stack offsets */}
      <div style={{ position: 'absolute', transform: 'rotate(6deg) translate(6px, 4px)', opacity: 0.7 }}>
        <Card faceDown size={size === 'lg' ? 'lg' : 'md'} liarBadge />
      </div>
      <div style={{ position: 'absolute', transform: 'rotate(-5deg) translate(-5px, 3px)', opacity: 0.85 }}>
        <Card faceDown size={size === 'lg' ? 'lg' : 'md'} liarBadge />
      </div>
      <Card
        card={declared}
        faceDown={false}
        liarBadge={isBluff}
        size={size}
        ghostLabel={ghostLabel}
        style={{ transform: 'rotate(-2deg)' }}
      />
      <div className="pile-label">Top</div>
      {drawStackCount > 0 && <div className="stack-badge">+{drawStackCount}</div>}
    </div>
  );
}