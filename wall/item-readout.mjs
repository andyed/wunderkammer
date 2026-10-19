/**
 * wunderkammer — the 3D views' item readout.
 *
 * The aisle's keyboard path to items lives in the scene: Tab to it, [ and ]
 * step through the items in scope, Enter opens the current one. This polite
 * live region names that item and its place for a screen reader. Nobody sees
 * it (wall.css .item-readout), so it takes no room in the toolbar.
 */
import { NEUTRAL_NOUNS, counted } from './nouns.mjs';

export class ItemReadout {
  constructor(className) {
    this.node = document.createElement('p');
    this.node.className = `item-readout ${className}`;
    this.node.setAttribute('aria-live', 'polite');
    this.node.setAttribute('aria-atomic', 'true');
  }

  /** The chosen item at 1-based `position` of `total`, or the stepping hint when none is chosen. */
  set({ title = null, position = 0, total = 0, nouns = NEUTRAL_NOUNS } = {}) {
    const text = !total ? `No ${nouns.items} in this scope`
      : title ? `${title} · ${position} of ${total} · Enter opens`
      : `[ and ] step through ${counted(total, nouns)} · Enter opens`;
    if (this.node.textContent !== text) this.node.textContent = text;
  }
}
