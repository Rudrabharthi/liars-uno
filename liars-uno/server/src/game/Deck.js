import crypto from 'node:crypto';

export const COLORS = ['red', 'blue', 'green', 'yellow'];

const NORMAL_NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const LIAR_NUMBERS = ['1', '2', '3', '4', '5', '6', '7'];

/**
 * Create a single card object.
 * @param {string} color
 * @param {string} value
 * @param {boolean} isLiarModifier
 */
export function createCard(color, value, isLiarModifier) {
  return {
    id: crypto.randomUUID(),
    color,
    value,
    isLiarModifier,
  };
}

/**
 * Build the exact 112-card deck (56 Normal / 56 Liar split).
 *
 * 56 Normal:
 *   - 4 Wilds (colorless)
 *   - per color: 0, 1-9, duplicate 0, 8, 9  (13 cards x 4 colors = 52)
 *
 * 56 Liar Modifier:
 *   - 4 Wild Draw 4 (colorless)
 *   - per color: 1-7, 2x SKIP, 2x REVERSE, 2x DRAW_2 (13 cards x 4 colors = 52)
 */
export function buildDeck() {
  const cards = [];

  // ---- 56 Normal Cards ----
  for (let i = 0; i < 4; i++) {
    cards.push(createCard('wild', 'WILD', false));
  }
  for (const color of COLORS) {
    cards.push(createCard(color, '0', false));
    for (let i = 1; i <= 9; i++) {
      cards.push(createCard(color, String(i), false));
    }
    // duplicates: 0, 8, 9
    cards.push(createCard(color, '0', false));
    cards.push(createCard(color, '8', false));
    cards.push(createCard(color, '9', false));
  }

  // ---- 56 Liar Modifier Cards ----
  for (let i = 0; i < 4; i++) {
    cards.push(createCard('wild', 'WILD_DRAW_4', true));
  }
  for (const color of COLORS) {
    for (const v of LIAR_NUMBERS) {
      cards.push(createCard(color, v, true));
    }
    cards.push(createCard(color, 'SKIP', true));
    cards.push(createCard(color, 'SKIP', true));
    cards.push(createCard(color, 'REVERSE', true));
    cards.push(createCard(color, 'REVERSE', true));
    cards.push(createCard(color, 'DRAW_2', true));
    cards.push(createCard(color, 'DRAW_2', true));
  }

  return cards;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
