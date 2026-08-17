import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Card from './Card.jsx';
import { COLOR_SWATCH, VALUE_TEXT, allowedClaimValues, isClaimValid } from '../utils/cardLogic.js';
import sfx from '../utils/soundEffects.js';

const COLOR_NAMES = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow' };

const VALUE_ORDER = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'SKIP', 'REVERSE', 'DRAW_2', 'WILD_DRAW_4',
];

function valueShort(v) {
  if (v === 'WILD_DRAW_4') return '+4';
  if (v === 'DRAW_2') return '+2';
  return VALUE_TEXT[v] ?? v;
}

/**
 * 2-Step Declaration Modal for face-down bluff claims (Step 1 color → Step 2 value).
 * In mode="wild" it becomes a single-step color picker for the Wild combo.
 */
export default function DeclareCardModal({
  open,
  mode = 'bluff',
  card,
  activeColor,
  activeValue,
  drawStackCount,
  openingMove = false,
  onClose,
  onSubmit,
  onColor,
}) {
  const [step, setStep] = useState(1);
  const [color, setColor] = useState(null);
  const [value, setValue] = useState(null);

  const reset = () => {
    setStep(1);
    setColor(null);
    setValue(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  if (!open || !card) return null;

  const allowed = allowedClaimValues();

  const isValueLegal = (v) => {
    if (mode !== 'bluff') return false;
    if (!allowed.includes(v)) return false;
    return isClaimValid({ color, value: v }, activeColor, activeValue, drawStackCount, openingMove);
  };

  const handleColorPick = (c) => {
    sfx.click();
    if (mode === 'wild') {
      onColor(c);
      reset();
      return;
    }
    setColor(c);
    setStep(2);
  };

  const handleValuePick = (v) => {
    if (!isValueLegal(v)) return;
    sfx.slap();
    onSubmit({ color, value: v });
    reset();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            className="modal-card"
            initial={{ y: 40, scale: 0.92, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 40, scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 className="panel-title" style={{ fontSize: 18, margin: 0 }}>
                {mode === 'wild' ? 'Play Wild — choose color' : 'Declare your bluff'}
              </h2>
              <button className="btn-ghost" onClick={close} style={{ padding: '6px 10px', fontSize: 12 }}>✕</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <Card card={card} faceDown size="md" liarBadge />
              <div style={{ color: 'var(--text-mid)', fontSize: 12, lineHeight: 1.5 }}>
                This Liar card will be played <strong style={{ color: '#fff' }}>face-down</strong>.
                Opponents only see your declared claim — they can never see the real card.
              </div>
            </div>

            {mode === 'bluff' && (
              <div className="step-indicator">
                <div className={`step-dot ${step === 1 ? 'step-active' : ''}`} />
                <div className={`step-dot ${step === 2 ? 'step-active' : ''}`} />
              </div>
            )}

            {step === 1 && (
              <>
                <div className="panel-title" style={{ fontSize: 13, marginBottom: 10, color: 'var(--text-mid)' }}>
                  STEP 1 — Declared color
                </div>
                <div className="choice-grid">
                  {Object.entries(COLOR_SWATCH).map(([c, hex]) => (
                    <button
                      key={c}
                      className={`choice-chip ${color === c ? 'choice-selected' : ''}`}
                      style={{ background: hex, color: c === 'yellow' ? '#1a1400' : '#fff' }}
                      onClick={() => handleColorPick(c)}
                    >
                      {COLOR_NAMES[c]}
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="panel-title" style={{ fontSize: 13, marginBottom: 10, color: 'var(--text-mid)' }}>
                  STEP 2 — Claimed value / action
                </div>
                <div className="choice-grid">
                  {VALUE_ORDER.map((v) => {
                    const legal = isValueLegal(v);
                    return (
                      <button
                        key={v}
                        className={`choice-chip ${!legal ? 'choice-disabled' : ''} ${value === v ? 'choice-selected' : ''}`}
                        style={{
                          background: legal ? COLOR_SWATCH[color] : 'rgba(255,255,255,0.08)',
                          color: !legal ? 'var(--text-dim)' : color === 'yellow' ? '#1a1400' : '#fff',
                        }}
                        onClick={() => handleValuePick(v)}
                      >
                        {valueShort(v)}
                      </button>
                    );
                  })}
                </div>
                <button className="btn-ghost" onClick={() => setStep(1)} style={{ marginTop: 12, width: '100%' }}>
                  ← Back to color
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}