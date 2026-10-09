import { describe, expect, it } from 'vitest';
import { newPickerState, placeCard, removeCard } from './ui/SlotPicker';

const none = new Set<string>();

describe('slot picker', () => {
  it('puts a card in a slot and takes it out again', () => {
    const s = newPickerState(1, [null, null]);
    placeCard(s, 'a', 1, none);
    expect(s.slots).toEqual([null, 'a']);
    removeCard(s, 'a', none);
    expect(s.slots).toEqual([null, null]);
  });

  it('moving a card between slots swaps it with the card there', () => {
    const s = newPickerState(1, ['a', 'b']);
    placeCard(s, 'a', 1, none);
    expect(s.slots).toEqual(['b', 'a']);
  });

  it('a card dropped on an occupied slot sends the old card back to the pool', () => {
    const s = newPickerState(1, ['a', null]);
    placeCard(s, 'c', 0, none);
    expect(s.slots).toEqual(['c', null]);
  });

  it('a locked card (a current companion) is pushed out by a new one and returns when the new one leaves', () => {
    const locked = new Set(['x', 'y']);
    const s = newPickerState(1, ['x', 'y', null]);
    placeCard(s, 'new', 0, locked);
    expect(s.slots).toEqual(['new', 'y', null]);
    placeCard(s, 'new', 2, locked); // moved to the open slot: x comes home
    expect(s.slots).toEqual(['x', 'y', 'new']);
    removeCard(s, 'new', locked);
    expect(s.slots).toEqual(['x', 'y', null]);
  });

  it('locked cards cannot be dragged, and fixed cards cannot be replaced', () => {
    const locked = new Set(['x', 'rest']);
    const fixed = new Set(['rest']);
    const s = newPickerState(1, ['x', 'rest']);
    removeCard(s, 'x', locked);
    placeCard(s, 'x', 1, locked);
    placeCard(s, 'new', 1, locked, fixed);
    expect(s.slots).toEqual(['x', 'rest']);
  });
});
