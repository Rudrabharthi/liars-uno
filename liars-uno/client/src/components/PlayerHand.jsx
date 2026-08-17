import { motion } from 'framer-motion';
import Card from './Card.jsx';
import { sortHand, isCardPlayable } from '../utils/cardLogic.js';
import sfx from '../utils/soundEffects.js';

const CAN_PLAY = new Set(['PLAYER_TURN_START']);

/**
 * Bottom-docked horizontal scrolling hand.
 * Wire-up is fully derived from the masked public game state + own private hand.
 */
export default function PlayerHand({
  hand,
  game,
  myId,
  onPlayCard,
  onBluff,
  onDraw,
  onAcceptStack,
  onPass,
}) {
  if (!game || !myId) return null;

  const isMyTurn = game.activePlayerId === myId;
  const turnState = game.turnState;
  const inStack = game.drawStackCount > 0;
  const inWildFollowup = turnState === 'AWAITING_WILD_FOLLOWUP';
  const canAct = isMyTurn && (CAN_PLAY.has(turnState) || inWildFollowup);

  const sorted = sortHand(hand);

  const cardActions = (card, index) => {
    let playable = false;
    let bluffable = false;
    let dim = false;
    let chip = null;

    if (canAct) {
      if (game.forcedWildDraw) {
        dim = true;
      } else if (inStack) {
        // normal cards can't be played face-up during a stack → bluff only
        bluffable = true;
        playable = true; // any card can be bluffed
        chip = 'BLUFF';
      } else if (inWildFollowup) {
        if (card.isLiarModifier) {
          bluffable = true;
          playable = true;
          chip = 'BLUFF';
        } else if (card.value === 'WILD') {
          dim = true; // wilds can't be the follow-up
        } else if (isCardPlayable(card, game.activeColor, 'WILD', 0)) {
          playable = true;
        } else {
          // non-matching card → can bluff it face-down
          bluffable = true;
          playable = true;
          chip = 'BLUFF';
        }
      } else if (card.isLiarModifier) {
        bluffable = true;
        playable = true;
        chip = 'BLUFF';
      } else {
        playable = isCardPlayable(card, game.activeColor, game.activeValue, game.drawStackCount, false, game.openingMove);
        dim = !playable;
      }
    } else {
      dim = true;
    }

    const onClick = () => {
      if (!canAct) return;
      if (game.forcedWildDraw) return;
      if (bluffable) {
        sfx.click();
        onBluff(card);
      } else if (playable) {
        if (card.value === 'WILD') {
          // wild requires a color — handled by the wild color picker in parent
          onBluff(card, true);
        } else {
          onPlayCard(card.id);
        }
      }
    };

    const drawnCardId = game.wildDrawnOption?.cardId;

    return { playable, dim, onClick, chip, isDrawn: card.id === drawnCardId };
  };

  const showDrawButton =
    isMyTurn && canAct && !inWildFollowup && turnState === 'PLAYER_TURN_START';

  return (
    <div className="hand-dock">
      <div className="hand-scroll">
        {sorted.map((card, i) => {
          const a = cardActions(card, i);
          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.025, type: 'spring', stiffness: 260, damping: 22 }}
            >
              <div style={{ position: 'relative' }}>
                <Card
                  card={card}
                  faceDown={false}
                  playable={a.playable}
                  dim={a.dim}
                  interactive={a.playable}
                  onClick={a.onClick}
                  size="md"
                />
                {a.chip && (
                  <button
                    className="btn-catch"
                    style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%) scale(0.8)', padding: '4px 8px', fontSize: 9 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      sfx.click();
                      onBluff(card);
                    }}
                  >
                    {a.chip}
                  </button>
                )}
                {a.isDrawn && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -10,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'var(--uno-yellow)',
                      color: '#1a1400',
                      fontWeight: 900,
                      fontSize: 9,
                      borderRadius: 999,
                      padding: '2px 8px',
                      letterSpacing: '0.06em',
                      boxShadow: '0 0 12px rgba(254,228,64,0.6)',
                    }}
                  >
                    DRAWN
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}

        {sorted.length === 0 && isMyTurn && (
          <div style={{ color: 'var(--text-mid)', fontWeight: 700, padding: '40px', fontSize: 14 }}>
            You have no cards left — you're out!
          </div>
        )}
      </div>

      {showDrawButton && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 10,
            marginTop: 4,
            pointerEvents: 'auto',
          }}
        >
          {inStack ? (
            <button className="btn-primary btn-accent" onClick={onAcceptStack}>
              Accept +{game.drawStackCount} draw stack
            </button>
          ) : (
            <>
              {game.wildDrawnOption ? (
                <>
                  <span className="hud-chip">
                    <strong>Play the drawn card combo to win</strong>
                  </span>
                  <button className="btn-ghost" onClick={onPass}>
                    Pass (keep cards)
                  </button>
                </>
              ) : game.hasDrawnThisTurn ? (
                <button className="btn-primary" onClick={onPass}>
                  Pass
                </button>
              ) : (
                <button className="btn-primary" onClick={onDraw}>
                  {game.forcedWildDraw ? 'Draw 1 (forced)' : 'Draw card'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}