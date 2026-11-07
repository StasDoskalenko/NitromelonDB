// Each benchmark card sits behind a tile on the app's Home screen (shared/Home.tsx; the keys are
// in each app's App.tsx). The Maestro flows open the card's tile before driving the card.
export const TILE_FOR_CARD = {
  sync: 'sync',
  incr: 'incrementalSync',
  real: 'realisticSync',
  stress: 'main',
  mass: 'massDelete',
}

// Maestro steps that open `card` from the Home screen
export function openCardSteps(card) {
  const tile = TILE_FOR_CARD[card]
  if (!tile) {
    throw new Error(`No Home tile for card "${card}"`)
  }
  return `- scrollUntilVisible:
    element:
      id: "tile-${tile}"
    direction: DOWN
    timeout: 12000
    optional: true
- tapOn:
    id: "tile-${tile}"`
}
