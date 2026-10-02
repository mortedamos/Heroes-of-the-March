// Which cards can act right now: the abilities the engine is offering the viewer in the pending decision.
// The engine only accepts ability.use during an `activate` window or a `bid`, so this is exactly the set.

import type { GameView } from '../engine';

export interface Attention { cardId: string; def: string; ability: string; label: string; decision: number }

export function attentionOf(view: GameView): Attention[] {
  const p = view.pending;
  const d = p?.detail;
  if (!p || p.player !== view.you || !d || (d.kind !== 'bid' && d.kind !== 'activate')) return [];
  return d.abilities.map((a) => ({ cardId: a.source.id, def: a.source.def, ability: a.ability, label: a.label, decision: p.id }));
}
