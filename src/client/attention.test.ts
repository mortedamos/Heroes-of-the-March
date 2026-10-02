import { describe, expect, it } from 'vitest';
import type { GameView } from '../engine';
import { attentionOf } from './attention';

const ability = { source: { id: 'c1', def: 'tova-emberdeep-keeper-of-the-underway-door' }, ability: 'rest', label: 'Rest' };
const view = (pending: unknown, you: string | null = 'p0'): GameView => ({ you, pending } as unknown as GameView);

describe('attentionOf', () => {
  it('lists the abilities offered in an activate window', () => {
    const v = view({ id: 7, player: 'p0', kind: 'activate', detail: { kind: 'activate', window: 'beforeBidding', abilities: [ability] } });
    expect(attentionOf(v)).toEqual([{ cardId: 'c1', def: ability.source.def, ability: 'rest', label: 'Rest', decision: 7 }]);
  });
  it('lists the abilities offered on a bid decision', () => {
    const v = view({ id: 8, player: 'p0', kind: 'bid', detail: { kind: 'bid', faceUp: true, canFaceDown: false, abilities: [ability] } });
    expect(attentionOf(v)).toHaveLength(1);
  });
  it("is empty on someone else's decision, for other decision kinds, or with none on offer", () => {
    expect(attentionOf(view({ id: 1, player: 'p1', kind: 'activate' }))).toEqual([]);
    expect(attentionOf(view({ id: 1, player: 'p0', kind: 'choose', detail: { kind: 'choose' } }))).toEqual([]);
    expect(attentionOf(view({ id: 1, player: 'p0', kind: 'bid', detail: { kind: 'bid', faceUp: true, canFaceDown: false, abilities: [] } }))).toEqual([]);
    expect(attentionOf(view(null))).toEqual([]);
  });
});
