// Client-side playability helpers — used ONLY for UI glow hints.
// The server re-validates every action (zero-trust anti-cheat).

export const COLORS = ['red', 'blue', 'green', 'yellow'];

export const COLOR_CLASS = {
  red: 'card--red',
  blue: 'card--blue',
  green: 'card--green',
  yellow: 'card--yellow',
  wild: 'card--wild',
};

export const COLOR_SWATCH = {
  red: '#FF0000',
  yellow: '#FFFF00',
  green: '#008000',
  blue: '#0000FF',
};

export const VALUE_LABEL = {
  SKIP: '⊘',
  REVERSE: '⟲',
  DRAW_2: '+2',
  WILD: '★',
  WILD_DRAW_4: '+4',
};

export const VALUE_TEXT = {
  SKIP: 'SKIP',
  REVERSE: 'REVERSE',
  DRAW_2: 'DRAW 2',
  WILD: 'WILD',
  WILD_DRAW_4: 'DRAW 4',
};

const isWildValue = (v) => v === 'WILD' || v === 'WILD_DRAW_4';

export function canStackCard(activeTopValue, activeDeclaredColor, incomingCard) {
  if (incomingCard.value === 'WILD_DRAW_4') return true;
  if (incomingCard.value !== 'DRAW_2') return false;
  if (activeTopValue === 'WILD_DRAW_4') {
    return incomingCard.color === activeDeclaredColor;
  }
  if (activeTopValue === 'DRAW_2') return true;
  return false;
}

export function isCardPlayable(card, activeColor, activeValue, drawStackCount, isFaceDown = false, openingOnly = false) {
  if (isFaceDown) return true;
  if (openingOnly) return card.color === 'wild' || card.color === activeColor;
  if (drawStackCount > 0) return canStackCard(activeValue, activeColor, card);
  if (card.color === 'wild') return true;
  return card.color === activeColor || card.value === activeValue;
}

export function isClaimValid(declaredClaim, activeColor, activeValue, drawStackCount = 0, openingOnly = false) {
  if (!declaredClaim || typeof declaredClaim !== 'object') return false;
  const { color, value } = declaredClaim;
  if (!COLORS.includes(color) || !value) return false;
  if (value === 'WILD_DRAW_4') return true; // +4 claim always legal
  if (openingOnly) return color === activeColor;
  if (drawStackCount > 0) return canStackCard(activeValue, activeColor, { color, value });
  return color === activeColor || value === activeValue;
}

/** Sort: color groups then number/action ordering. */
export function sortHand(hand) {
  const order = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
  const numOf = (v) => (isWildValue(v) ? 99 : v === 'SKIP' ? 90 : v === 'REVERSE' ? 91 : v === 'DRAW_2' ? 92 : Number(v));
  return [...hand].sort(
    (a, b) =>
      (order[a.color] ?? 9) - (order[b.color] ?? 9) ||
      numOf(a.value) - numOf(b.value)
  );
}

export function cardDisplay(card) {
  if (card.isFaceDownPlayed) {
    return { color: card.declaredColor, value: card.declaredValue, isLiarModifier: true };
  }
  return { color: card.color, value: card.value, isLiarModifier: !!card.isLiarModifier };
}

/** Allowed claim values for a liar declaration (UI hint only — server re-validates). */
export function allowedClaimValues() {
  return [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'SKIP', 'REVERSE', 'DRAW_2', 'WILD_DRAW_4',
  ];
}