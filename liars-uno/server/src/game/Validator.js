/**
 * Anti-cheat move & stacking validation.
 * Every mutation on the server re-validates through these pure helpers.
 */

export const PLAYABLE_COLORS = ['red', 'blue', 'green', 'yellow'];

/** Every value a declared (bluff) claim may take. */
export const CLAIMABLE_VALUES = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'SKIP', 'REVERSE', 'DRAW_2', 'WILD_DRAW_4',
];

export function isWildValue(value) {
  return value === 'WILD' || value === 'WILD_DRAW_4';
}

/**
 * §4.1 — server-authoritative match validation.
 * Face-down (bluff) cards are always playable — legality comes from the declared claim.
 */
export function isCardPlayable(card, activeColor, activeValue, drawStackCount, isFaceDown = false) {
  if (isFaceDown) return true;
  if (drawStackCount > 0) return canStackCard(activeValue, activeColor, card);
  if (card.color === 'wild') return true; // Wild / Wild Draw 4 always playable
  return card.color === activeColor || card.value === activeValue;
}

/**
 * §6.1 — draw stacking rules.
 *   +4 stacks on anything.
 *   +2 on +2: any color.
 *   +2 on +4: must match the +4's declared color.
 */
export function canStackCard(activeTopValue, activeDeclaredColor, incomingCard) {
  if (incomingCard.value === 'WILD_DRAW_4') return true; // +4 stacks on anything
  if (incomingCard.value !== 'DRAW_2') return false;      // only +2/+4 can stack
  if (activeTopValue === 'WILD_DRAW_4') {
    return incomingCard.color === activeDeclaredColor;    // +2 on +4 must match declared color
  }
  if (activeTopValue === 'DRAW_2') return true;           // +2 on +2: any color
  return false;
}

/**
 * §5.2 — validates a face-down declared claim (full-freedom variant).
 * Any color + claimable value is legal, regardless of the active table state.
 * A non-stack claim made while a draw stack is pending nullifies that stack
 * (handled in GameRoom._applyDeclaredEffects).
 */
export function isClaimValid(declaredClaim) {
  if (!declaredClaim || typeof declaredClaim !== 'object') return false;
  const { color, value } = declaredClaim;
  if (!PLAYABLE_COLORS.includes(color)) return false;
  return CLAIMABLE_VALUES.includes(value);
}

/**
 * §5.5 — truth check. A WILD_DRAW_4 claim is truthful only if the physical card
 * is a WILD_DRAW_4; any other claim is truthful only if both color and value match.
 */
export function isCardDifferentFromClaim(card, declaredClaim) {
  const { color, value } = declaredClaim || {};
  if (value === 'WILD_DRAW_4') {
    return !(card.color === 'wild' && card.value === 'WILD_DRAW_4');
  }
  return !(card.color === color && card.value === value);
}

/**
 * §5.5 / §6.4 — challenge resolution.
 * @returns {{ wasLying, penalizedPlayer, cardsToDrawByPenalized }}
 */
export function resolveChallenge(actualCard, declaredClaim, drawStackCount) {
  const wasLying = isCardDifferentFromClaim(actualCard, declaredClaim);
  if (wasLying) {
    return {
      wasLying: true,
      penalizedPlayer: 'bluffer',
      cardsToDrawByPenalized: drawStackCount + 1,
    };
  }
  return {
    wasLying: false,
    penalizedPlayer: 'challenger',
    cardsToDrawByPenalized: drawStackCount + 1,
  };
}
