// Card mechanics: one rigged scenario per ability family.

import { describe, expect, it } from 'vitest';
import { botDecide } from '../bots/heuristic';
import { applyCommand, resume } from './commands';
import { Ctx } from './context';
import { discardHero, drawResources, fire, heroEnters, partyLoad, partySize, replaceLocation } from './effects';
import { difficultyFor, totalFor, visibleTo } from './totals';
import { ABILITIES, abilityOf } from './abilities';
import { CARDS, companionsOf, getDef, hasDef, resolveTarget } from './cards';
import setAside from '../../data/set-aside.json';
import { createGame } from './setup';
import type { HouseRules } from './rules';
import { checkInvariants, seats, seed } from './testUtils';
import type { CardId, Command, Decision, DeckName, GameEvent, GameState, PlayerId } from './types';
import { redactEvents, viewFor } from './view';

// Two plain stand-ins for the retired Iron Beetles (Ironbound, minion 3) and The Grave-Hunger (Undead, minion 2): fixed numbers, so these tests keep their arithmetic.
Object.assign(getDef('ironbound-vanguard'), { stat: 'M', difficulty: 8, minionValue: 3 });
Object.assign(getDef('crawling-remnant'), { stat: 'M', difficulty: 12, minionValue: 2 });

// --- rigging helpers -------------------------------------------------------------

function idOf(s: GameState, def: string): CardId {
  const e = Object.entries(s.cards).find(([, d]) => d === def);
  if (!e) throw new Error(`no card ${def}`);
  return e[0];
}

/** Remove a card from wherever it is (a hero in another player's party leaves a gap there). */
function detach(s: GameState, id: CardId): void {
  for (const pile of [...Object.values(s.decks), ...Object.values(s.discards)]) {
    const i = pile.indexOf(id);
    if (i >= 0) pile.splice(i, 1);
  }
  // The rig starts partway through turn 1: a card already out as that turn's encounter or minion is taken from there too.
  if (s.turn.encounter === id) s.turn.encounter = null;
  s.turn.minions = s.turn.minions.filter((c) => c !== id);
  s.turn.setAside = s.turn.setAside.filter((c) => c !== id);
  for (const p of s.players) {
    for (const k of ['party', 'inactive', 'resting', 'hand', 'claimed', 'borrowed'] as const) {
      p[k] = p[k].filter((c) => c !== id);
    }
    p.bids = p.bids.filter((b) => b.card !== id);
  }
}

/**
 * Rig a player's party and hand. The legacy argument names are kept to keep the tests readable: `hero` is the first slot of
 * the party and `companions` are the other slots (a party of three is hero + two); `party` replaces the whole party.
 * A hero taken from another player's party is replaced there by one of the cards this player gives up, so parties stay full.
 */
function give(s: GameState, pid: PlayerId, opts: { hero?: string; companions?: string[]; party?: string[]; hand?: string[] }): void {
  const p = s.players.find((x) => x.id === pid)!;
  if (opts.hero || opts.companions || opts.party) {
    const now = p.party.map((c) => s.cards[c]!);
    const want = opts.party ?? [opts.hero ?? now[0]!, ...(opts.companions ?? now.slice(1).filter((d) => d !== opts.hero))].filter(Boolean);
    const displaced = p.party.filter((c) => !want.includes(s.cards[c]!));
    p.party = p.party.filter((c) => want.includes(s.cards[c]!));
    for (const d of want) {
      if (p.party.some((c) => s.cards[c] === d)) continue;
      const id = idOf(s, d);
      const holder = s.players.find((x) => x !== p && x.party.includes(id));
      if (holder) {
        const back = displaced.shift();
        holder.party = holder.party.map((c) => (c === id ? back ?? '' : c)).filter(Boolean);
      } else detach(s, id);
      p.party.push(id);
    }
    // Keep the requested order.
    p.party.sort((x, y) => want.indexOf(s.cards[x]!) - want.indexOf(s.cards[y]!));
    s.decks.hero.push(...displaced);
  }
  if (opts.hand) {
    s.decks.resource.push(...p.hand);
    p.hand = [];
    for (const d of opts.hand) { const id = idOf(s, d); detach(s, id); p.hand.push(id); }
  }
}

/** Put cards on top of a stack; the first listed is drawn first. */
function onTop(s: GameState, deck: DeckName, defs: string[]): void {
  for (const d of [...defs].reverse()) {
    const id = idOf(s, d);
    detach(s, id);
    s.decks[deck].push(id);
  }
}

interface Game { s: GameState; events: GameEvent[]; A: PlayerId; B: PlayerId; C?: PlayerId }

/** Answer every opening party draft with the first cards on offer. */
function finishOpeningDraft(state: GameState): GameState {
  let st = state;
  while (st.pending?.kind === 'choose' && st.pending.purpose === 'partyDraft') {
    const d = st.pending;
    const r = applyCommand(st, d.player, { type: 'choose', decision: d.id, picks: d.options.slice(0, d.min).map((o) => o.value) });
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  return st;
}

function newGame(n = 2, sd = 1, rules?: Partial<HouseRules>): Game {
  // Card-mechanic tests use the v0.3 hand rule so card counts are predictable; the house rules have their own tests.
  const state = finishOpeningDraft(createGame({
    players: seats(n), seed: seed(sd),
    rules: { handModel: 'refill', ...rules },
  }).state);
  const A = state.players[state.turn.active]!.id;
  const others = state.players.filter((p) => p.id !== A).map((p) => p.id);
  return { s: state, events: [], A, B: others[0]!, ...(others[1] ? { C: others[1] } : {}) };
}

/** Start the current turn over from the top (after rigging). */
function restart(g: Game): void {
  const s = g.s;
  s.pending = null;
  s.tasks = [];
  // newGame stops partway through turn 1 (after the opening draft): put that turn's cards away.
  const t = s.turn;
  if (t.location) s.discards.location.push(t.location);
  s.decks.location.push(...t.extraLocations);
  s.discards.encounter.push(...(t.encounter ? [t.encounter] : []), ...t.minions, ...t.setAside);
  s.discards.hero.push(...t.heroMinions);
  for (const p of s.players) {
    s.discards.resource.push(...p.bids.map((b) => b.card));
    s.decks.hero.push(...p.borrowed);
    p.bids = [];
    p.borrowed = [];
    p.statOverride = null;
  }
  t.location = null; t.extraLocations = []; t.encounter = null; t.minions = []; t.setAside = []; t.heroMinions = [];
  t.failed = []; t.effects = []; t.used = {}; t.wandsDisabled = false; t.noFalls = false;
  s.turn.step = 'turnStart';
  s.turn.number = 0;
  s.hold = 'encounter'; // borrow the resume path
  const r = resume(s);
  if (!r.ok) throw new Error(r.error);
  g.s = r.state;
  g.events.push(...r.events);
}

function defaultAnswer(d: Decision): Command {
  switch (d.kind) {
    case 'recruit.offer': return { type: 'recruit.skip', decision: d.id };
    case 'recruit.place': return { type: 'recruit.discard', decision: d.id };
    case 'activate': return { type: 'ability.done', decision: d.id };
    case 'bid': return { type: 'bid.pass', decision: d.id };
    case 'choose': return { type: 'choose', decision: d.id, picks: d.options.slice(0, d.min).map((o) => o.value) };
  }
}

function act(g: Game, cmd: Command): void {
  const d = g.s.pending!;
  const r = applyCommand(g.s, d.player, cmd);
  if (!r.ok) throw new Error(`${r.error}: ${JSON.stringify(cmd)}`);
  g.s = r.state;
  g.events.push(...r.events);
  checkInvariants(g.s);
}

/** Answer decisions with defaults until `stop` says so (returns true when it stopped). */
function until(g: Game, stop: (s: GameState, d: Decision) => boolean, answer: (s: GameState, d: Decision) => Command | undefined = () => undefined, max = 400): boolean {
  for (let i = 0; i < max; i++) {
    const d = g.s.pending;
    if (!d || g.s.winner) return false;
    if (stop(g.s, d)) return true;
    act(g, answer(g.s, d) ?? defaultAnswer(d));
  }
  throw new Error('until: too many steps');
}

/** Play (with default answers) until the current turn is over. */
function finishTurn(g: Game): void {
  const n = g.s.turn.number;
  until(g, (s) => s.turn.number !== n);
}

const bidFor = (pid: PlayerId) => (_s: GameState, d: Decision) => d.kind === 'bid' && d.player === pid;
const activateFor = (pid: PlayerId, window: string) => (_s: GameState, d: Decision) => d.kind === 'activate' && d.player === pid && d.window === window;
const card = (g: Game, def: string) => idOf(g.s, def);
const use = (g: Game, source: string, ability: string) => act(g, { type: 'ability.use', decision: g.s.pending!.id, source: card(g, source), ability });
const pick = (g: Game, ...picks: string[]) => act(g, { type: 'choose', decision: g.s.pending!.id, picks });
const total = (g: Game, viewer: PlayerId, who: PlayerId) => viewFor(g.s, viewer).players.find((p) => p.id === who)!.projection!.total;
const player = (g: Game, pid: PlayerId) => g.s.players.find((p) => p.id === pid)!;
/** A hero's printed stat (for arithmetic that follows the card data). */
const stat = (def: string, s: 'P' | 'M' | 'G') => (getDef(def) as { stats: Record<'P' | 'M' | 'G', number> }).stats[s];

/** A typical rig: known parties, Physical challenge via The Silverwood Hunt. */
function standard(g: Game, a: { hero?: string; companions?: string[]; party?: string[]; hand?: string[] }, b: { hero?: string; companions?: string[]; party?: string[]; hand?: string[] } = {}): void {
  give(g.s, g.A, { hero: 'archmage-corvin-varro', companions: ['moss-dire-wolf', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit'], ...a });
  give(g.s, g.B, { hero: 'queen-maren-ashcroft', companions: ['sergeant-waddle', 'tobin-quill-goose-keeper'], hand: ['feathered-cap'], ...b });
  onTop(g.s, 'location', ['the-silverwood-hunt', 'kingsford', 'clover-hollow', 'the-hollow-between']);
  onTop(g.s, 'encounter', ['ironbound-vanguard', 'wyrmkin-warband', 'bridge-trolls']);
}

// --- sabotage ----------------------------------------------------------------------

describe('forced stats', () => {
  it('Liriel forces an opposing hero to contribute Guile', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    // Sergeant Waddle: P4 -> G2 on a Physical challenge.
    expect(total(g, g.A, g.B)).toBe(before - 2);
    expect(g.s.pending?.kind).toBe('bid'); // back to A's bidding decision
  });

  it("Aldric's player may counter a forced stat as it lands, once per turn", () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'thessaly-of-the-grove'] }, { hero: 'lord-paladin-aldric-ashcroft' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'counterAbility' && d.player === g.B).toBe(true);
    pick(g, 'counter');
    expect(g.events.some((e) => e.type === 'abilityCountered')).toBe(true);
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceStat')).toHaveLength(0);
    expect(total(g, g.A, g.B)).toBe(before);
    expect(g.s.pending?.kind).toBe('bid');
    // The counter is used up: the next one lands without a question.
    use(g, 'thessaly-of-the-grove', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceStat')).toHaveLength(1);
  });

  it("Aldric's player may let it land; it is forced, and the counter is still unused", () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'lord-paladin-aldric-ashcroft' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    pick(g, 'allow');
    expect(total(g, g.A, g.B)).toBe(before - 2); // Sergeant Waddle: P4 -> G2 on a Physical challenge
    expect(g.s.turn.used[`${card(g, 'lord-paladin-aldric-ashcroft')}:shield`]).toBeUndefined();
  });

  it("Brunna's player may counter a curse placed in front of them", () => {
    const g = newGame();
    standard(g, { hand: ['cursed-locket', 'honey-biscuit'] }, { hero: 'high-thane-brunna-stonefast' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'cursed-locket') });
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'counterAbility' && d.player === g.B).toBe(true);
    pick(g, 'counter');
    expect(player(g, g.B).bids).toHaveLength(0);
    expect(g.s.discards.resource).toContain(card(g, 'cursed-locket'));
    expect(total(g, g.A, g.B)).toBe(before);
    checkInvariants(g.s);
  });

  it('...and if Brunna\'s player lets it land, the curse counts against them', () => {
    const g = newGame();
    standard(g, { hand: ['cursed-locket', 'honey-biscuit'] }, { hero: 'high-thane-brunna-stonefast' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'cursed-locket') });
    pick(g, 'allow');
    expect(player(g, g.B).bids.map((b) => b.card)).toEqual([card(g, 'cursed-locket')]);
    expect(total(g, g.A, g.B)).toBe(before - 5);
  });

  it('Walls First also counters a change of location, and the card that would have replaced it goes back unseen', () => {
    const g = newGame();
    standard(g, { hand: ['wayfinders-die', 'honey-biscuit'] }, { hero: 'high-thane-brunna-stonefast' });
    restart(g);
    until(g, bidFor(g.A));
    const here = g.s.turn.location;
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'wayfinders-die') });
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'counterAbility' && d.player === g.B).toBe(true);
    expect(g.s.turn.pendingLocation).not.toBeNull();
    checkInvariants(g.s);
    pick(g, 'counter');
    expect(g.s.turn.location).toBe(here);
    expect(g.s.turn.pendingLocation).toBeNull();
    expect(g.events.some((e) => e.type === 'abilityCountered')).toBe(true);
    checkInvariants(g.s);
  });

  it('Fennick draws when someone is forced', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { companions: ['fennick-puffcap-mycomancer', 'sergeant-waddle'] });
    restart(g);
    until(g, bidFor(g.A));
    const hand = player(g, g.B).hand.length;
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(player(g, g.B).hand.length).toBe(hand + 1);
  });


  it('Hesk lets another hero ability be used twice in a turn', () => {
    const g = newGame(3);
    give(g.s, g.C!, { companions: ['cobra-chicken', 'duchess-the-pub-goose'] });
    standard(g, { companions: ['hesk-of-two-homes', 'liriel-nightbloom'] });
    restart(g);
    until(g, bidFor(g.A));
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    const d = g.s.pending!;
    expect(d.kind === 'bid' && d.abilities.some((a) => a.ability === 'force')).toBe(true);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'cobra-chicken'));
    const d2 = g.s.pending!;
    expect(d2.kind === 'bid' && d2.abilities.some((a) => a.ability === 'force')).toBe(false);
  });

});

describe('silence, steal, negate, swap', () => {
  it('Aelthir draws when an Elf or Human card enters play, but only once per turn', () => {
    const g = newGame();
    standard(g, { hero: 'aelthir-moonveil' });
    onTop(g.s, 'location', ['the-silverwood-hunt']); // Elf
    onTop(g.s, 'encounter', ['wren-the-covens-knife']); // Human
    restart(g);
    until(g, bidFor(g.A));
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Aelthir Moonveil')).toHaveLength(1);
  });

  it('Pip draws when an ability replaces the location', () => {
    const g = newGame();
    standard(g, { hero: 'pip-wanderfoot', hand: ['wayfinders-die', 'honey-biscuit'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'wayfinders-die') });
    expect(g.events.some((e) => e.type === 'locationReplaced')).toBe(true);
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Pip Wanderfoot')).toHaveLength(1);
  });

  it('face-down cards are turned up one per player, taking turns', () => {
    const g = newGame();
    standard(g, { hand: ['honey-biscuit', 'patchwork-coat', 'sprig-of-heather'] }, { hand: ['feathered-cap', 'jesters-cap', 'bag-of-toffees'] });
    restart(g);
    const n = g.events.length;
    until(g, (s) => s.turn.step === 'winEndOfBidding' || s.turn.step === 'resolve', (_s, d) => {
      if (d.kind !== 'bid') return undefined;
      const mine = player(g, d.player).hand;
      return mine.length ? { type: 'bid.play', decision: d.id, card: mine[0]! } : { type: 'bid.pass', decision: d.id };
    });
    const order = g.events.slice(n).flatMap((e) => (e.type === 'revealed' ? [e.player] : []));
    expect(order.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]); // never the same player twice in a row
  });

  it('a tie discards the location; each tied player draws and claims a new one with no effects', () => {
    const g = newGame();
    // Kazra P4 + Waddle 4 = 8 against Maren P2 + Cobra 4 + a 2-point resource = 8.
    standard(g, { hero: 'kazra-emberdeep', companions: ['sergeant-waddle'], hand: [] }, { hero: 'queen-maren-ashcroft', companions: ['cobra-chicken'], hand: ['sprig-of-heather'] });
    onTop(g.s, 'encounter', ['ironbound-vanguard']);
    restart(g);
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'sprig-of-heather') });
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    const res = outcome?.type === 'outcome' ? outcome.result : undefined;
    expect(res?.winner).toBeNull();
    expect(res?.tied).toHaveLength(2);
    expect(g.s.discards.location).toContain(card(g, 'the-silverwood-hunt'));
    // Each tied player holds one of the next locations (not the discarded one) and its Renown.
    const a = player(g, g.A), b = player(g, g.B);
    expect(a.claimed).toHaveLength(1);
    expect(b.claimed).toHaveLength(1);
    expect(a.claimed[0]).not.toBe(b.claimed[0]);
    expect(a.renown).toBeGreaterThan(0);
    expect(b.renown).toBeGreaterThan(0);
  });

  it('An Apple for the Road swaps with another bid', () => {
    const g = newGame();
    standard(g, { hand: ['honey-biscuit', 'an-apple-for-the-road'] }, { hand: ['the-axe-of-doom'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'an-apple-for-the-road') });
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'appleSwap');
    pick(g, card(g, 'the-axe-of-doom'));
    expect(player(g, g.A).bids.map((b) => b.card)).toContain(card(g, 'the-axe-of-doom'));
    expect(player(g, g.B).bids.map((b) => b.card)).toContain(card(g, 'an-apple-for-the-road'));
  });

  it('Queen Maren trades cards; only the two players see which', () => {
    const g = newGame(3);
    standard(g, { hero: 'queen-maren-ashcroft', hand: ['honey-biscuit'] }, { hero: 'archmage-corvin-varro', hand: ['the-axe-of-doom'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    use(g, 'queen-maren-ashcroft', 'requisition');
    pick(g, g.B);
    pick(g, card(g, 'honey-biscuit'));
    const traded = g.events.filter((e) => e.type === 'cardsTraded');
    expect(traded).toHaveLength(1);
    expect(player(g, g.A).hand).toContain(card(g, 'the-axe-of-doom'));
    const forC = redactEvents(traded, g.C!)[0]!;
    const forB = redactEvents(traded, g.B)[0]!;
    expect(forC.type === 'cardsTraded' && forC.gave).toBeUndefined();
    expect(forB.type === 'cardsTraded' && forB.gave?.def).toBe('honey-biscuit');
  });
});

describe('peeks stay private', () => {
  it('Grukka peeks the next location; others see only that a peek happened', () => {
    const g = newGame();
    standard(g, { hero: 'warchief-grukka-ironjaw' });
    restart(g);
    until(g, activateFor(g.A, 'afterLocation'));
    use(g, 'warchief-grukka-ironjaw', 'mineNow');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'peekReplace').toBe(true);
    const peeked = g.s.decks.location[g.s.decks.location.length - 1]!;
    const mine = JSON.stringify(viewFor(g.s, g.A));
    expect(mine).toContain(g.s.cards[peeked]!); // the chooser sees what it is
    expect(mine).not.toContain(`"${peeked}"`); // ...but never its instance id
    expect(JSON.stringify(viewFor(g.s, g.B))).not.toContain(g.s.cards[peeked]!);
    pick(g, 'replace');
    expect(g.s.turn.location).toBe(peeked);
  });

  it('Barnaby looks at two locations and swaps one in', () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort' });
    restart(g);
    until(g, activateFor(g.A, 'afterLocation'));
    use(g, 'professor-barnaby-pickwort', 'maps');
    const second = g.s.decks.location[g.s.decks.location.length - 2]!;
    pick(g, 'n1');
    expect(g.s.turn.location).toBe(second);
  });

  it('Barnaby can use his maps at any point of his own turn, not only right after the location', () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort' });
    restart(g);
    until(g, bidFor(g.A));
    const d = g.s.pending!;
    expect(d.kind === 'bid' && d.abilities.some((x) => x.ability === 'maps')).toBe(true);
    use(g, 'professor-barnaby-pickwort', 'maps');
    pick(g, 'keep');
    expect(g.s.pending?.kind).toBe('bid'); // back to the bidding decision
  });

  it('Wren can bottom the next location', () => {
    const g = newGame();
    standard(g, { companions: ['elowen-leafwatch-treetop-warden', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    // turn 1's location was already drawn? No: turnStart window comes before the location.
    until(g, activateFor(g.A, 'turnStart'));
    use(g, 'elowen-leafwatch-treetop-warden', 'readAhead');
    pick(g, 'location');
    const top = g.s.decks.location[g.s.decks.location.length - 1]!;
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.options.every((o) => !o.card?.id)).toBe(true);
    pick(g, 'bottom');
    expect(g.s.decks.location[0]).toBe(top);
  });

  it('The Hall of Rest lets a fallen player choose their next hero (by card, not id)', () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort', companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'], hand: ['the-hall-of-rest'] });
    onTop(g.s, 'encounter', ['the-sundered-warden']);
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-hall-of-rest') });
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'hallOfRest');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.options.every((o) => o.card && !o.card.id)).toBe(true);
    pick(g, 'lord-paladin-aldric-ashcroft');
    expect(player(g, g.A).party.map((c) => g.s.cards[c])).toContain('lord-paladin-aldric-ashcroft');
  });
});

describe('end of bidding', () => {
  it('Dagny wins the location outright, at the cost of the hand and a hero', () => {
    const g = newGame();
    standard(g, { companions: ['dagny-coldhearth-the-grudge-bearer', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'feathered-cap'] }, { companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    const partyBefore = player(g, g.A).party.length;
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    use(g, 'dagny-coldhearth-the-grudge-bearer', 'stonetouched');
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    expect(outcome?.type === 'outcome' && outcome.result.winner).toBe(g.A);
    expect(outcome?.type === 'outcome' && outcome.result.byEffect).toBe('Dagny Coldhearth, the Grudge-Bearer');
    expect(player(g, g.A).party).toHaveLength(partyBefore - 1);
    expect(g.events.some((e) => e.type === 'heroLeft' && e.player === g.A && e.reason === 'Fell')).toBe(true);
  });


});

describe('several forcing abilities in one turn', () => {
  it('Liriel and Thessaly can both be used on the same turn', () => {
    const g = newGame(4);
    standard(g, { companions: ['liriel-nightbloom', 'thessaly-of-the-grove'] });
    restart(g);
    until(g, bidFor(g.A));
    const offered = () => { const d = g.s.pending!; return d.kind === 'bid' ? d.abilities.map((a) => a.ability + '@' + a.source) : []; };
    expect(offered()).toHaveLength(2);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(g.s.pending?.kind).toBe('bid');
    expect(offered()).toHaveLength(1);
    use(g, 'thessaly-of-the-grove', 'force');
    pick(g, card(g, 'tobin-quill-goose-keeper'));
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceStat')).toHaveLength(2);
  });
});


describe('Hesk and Brunna', () => {
  it('Hesk re-uses a hero\x27s once-per-turn ability exactly once more', () => {
    const g = newGame();
    standard(g, { companions: ['hesk-of-two-homes', 'liriel-nightbloom'] });
    restart(g);
    until(g, bidFor(g.A));
    const offered = () => { const d = g.s.pending!; return d.kind === 'bid' ? d.abilities.filter((a) => a.ability === 'force').length : -1; };
    expect(offered()).toBe(1);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(offered()).toBe(1); // Hesk: once more
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'tobin-quill-goose-keeper'));
    expect(offered()).toBe(0); // and no further
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceStat')).toHaveLength(2);
  });

});

describe('the opening turn', () => {
  it('drafted heroes enter play, and trigger, only when every player has picked', () => {
    // No card with an enter-play trigger is left in the hero set, so rig one: Pell draws when a hero joins her player's party.
    const pell = ABILITIES['pell-quillon-collegium-prodigy']!;
    const saved = pell.on;
    pell.on = { heroEntered: (ctx, self, e) => { if (e.player === self.owner) drawResources(ctx, self.owner!, 1, 'test'); } };
    try {
      const { state } = createGame({ players: seats(2), seed: seed(1), rules: { handModel: 'refill' } });
      const g: Game = { s: state, events: [], A: '', B: '' };
      // Put her on top of the hero stack and redo the draft step.
      onTop(g.s, 'hero', ['pell-quillon-collegium-prodigy']);
      g.s.pending = null;
      g.s.tasks = [];
      for (const p of g.s.players) { delete p.used['partyDraft']; p.party = []; }
      g.s.turn.step = 'partyDraft';
      g.s.hold = 'encounter';
      const r = resume(g.s);
      if (!r.ok) throw new Error(r.error);
      g.s = r.state;
      const first = g.s.pending!;
      if (first.kind !== 'choose') throw new Error('expected a party draft');
      const a = first.player;
      const handBefore = player(g, a).hand.length;
      const pellOption = first.options.find((o) => o.card?.def === 'pell-quillon-collegium-prodigy')!;
      expect(pellOption).toBeTruthy();
      const others = first.options.filter((o) => o !== pellOption).slice(0, 2).map((o) => o.value);
      act(g, { type: 'choose', decision: first.id, picks: [pellOption.value, ...others] });
      // A has picked, but B has not: nothing has entered play yet.
      const second = g.s.pending!;
      expect(second.kind === 'choose' && second.purpose).toBe('partyDraft');
      expect(second.player).not.toBe(a);
      expect(player(g, a).party).toContain(card(g, 'pell-quillon-collegium-prodigy'));
      expect(player(g, a).hand.length).toBe(handBefore);
      g.s = finishOpeningDraft(g.s);
      expect(player(g, a).hand.length).toBeGreaterThanOrEqual(handBefore + 1);
    } finally {
      if (saved) pell.on = saved; else delete pell.on;
    }
  });
});


describe('challenge and encounter control', () => {
  it('every encounter is faced on its single stat, with no roll', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'location', ['kingsford']);
    onTop(g.s, 'encounter', ['the-deathless-captain']);
    restart(g);
    until(g, bidFor(g.A));
    const ch = viewFor(g.s, g.B).turn.challenge!;
    expect(ch.stat).toBe('G');
    expect(ch.difficulty.base).toBe((getDef('the-deathless-captain') as { difficulty: number }).difficulty);
  });

  it('Ilvena: force an opposing hero onto its weakest stat (no cost)', () => {
    const g = newGame();
    standard(g, { companions: ['elder-ilvena-of-the-conclave', 'pell-quillon-collegium-prodigy'] }, { companions: ['honk-the-goose-rout-veteran', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const hand = player(g, g.A).hand.length;
    use(g, 'elder-ilvena-of-the-conclave', 'ruling');
    pick(g, card(g, 'honk-the-goose-rout-veteran'));
    expect(player(g, g.A).hand.length).toBe(hand);
    const forced = g.s.turn.effects.find((e) => e.kind === 'forceStat')!;
    expect(forced.stat).toBe('G'); // Honk: P4 M2 G1
  });


  it('Urzha (Pick Your Fight) looks at the next encounter and may swap it in, once per turn', () => {
    const g = newGame();
    standard(g, { hero: 'urzha-half-tusk' });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const before = g.s.turn.encounter;
    use(g, 'urzha-half-tusk', 'pickFight');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose).toBe('pickFight');
    pick(g, 'replace');
    expect(g.s.turn.encounter).not.toBe(before);
    expect(viewFor(g.s, g.A).turn.challenge).not.toBeNull();
    expect(g.events.some((e) => e.type === 'encounterReplaced')).toBe(true);
    // Not usable again this turn.
    const next = g.s.pending!;
    expect(next.kind === 'activate' && next.abilities.some((a) => a.ability === 'pickFight')).toBe(false);
  });


  it('Infectious Zombie takes a hero as a minion', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'encounter', ['iron-mites']);
    onTop(g.s, 'location', ['kingsford']);
    restart(g);
    until(g, (s) => s.turn.heroMinions.length > 0 || s.turn.step === 'bidding');
    expect(g.s.turn.heroMinions).toHaveLength(1);
    // No dice: each player with a companion turned up a resource card, and those cards were discarded.
    const shown = g.events.filter((e) => e.type === 'cardShown' && e.reason === 'Infectious Zombie');
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const e of shown) if (e.type === 'cardShown') expect(g.s.discards.resource).toContain(e.card.id);
    const ctx = new Ctx(g.s);
    const minion = ctx.def(g.s.turn.heroMinions[0]!);
    const diff = difficultyFor(ctx, null)!;
    const stat = ctx.encounter!.stat;
    expect(diff.minions).toBe(minion.kind === 'hero' ? minion.stats[stat] : -1);
  });

  it('Vaelis sets aside an encounter and adds its minion bonus to every stat', () => {
    const g = newGame();
    standard(g, { hero: 'lord-vaelis-nightbloom' });
    onTop(g.s, 'encounter', ['ironbound-vanguard', 'bone-colossus']); // Bone Colossus minion value 4
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const before = total(g, g.A, g.A);
    use(g, 'lord-vaelis-nightbloom', 'shadowsteeds');
    pick(g, 'self');
    expect(g.s.turn.setAside).toHaveLength(1);
    expect(total(g, g.A, g.A)).toBe(before + 4);
  });

  it('Vaelis may give the minion bonus to another player instead', () => {
    const g = newGame();
    standard(g, { hero: 'lord-vaelis-nightbloom' });
    onTop(g.s, 'encounter', ['ironbound-vanguard', 'bone-colossus']);
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const mine = total(g, g.A, g.A);
    const theirs = total(g, g.A, g.B);
    use(g, 'lord-vaelis-nightbloom', 'shadowsteeds');
    pick(g, g.B);
    expect(total(g, g.A, g.A)).toBe(mine);
    expect(total(g, g.A, g.B)).toBe(theirs + 4);
  });
});

describe('Tova is shown when she triggers', () => {
  it('Pell, Nettle and Gnash each draw when their stat is the challenge', () => {
    for (const [hero, enemy] of [['pell-quillon-collegium-prodigy', 'ironbound-vanguard'], ['nettle-burrows-trouble-maker', 'abbess-hollis-of-the-unremembered'], ['gnash-the-butcher-of-bloodmire', 'wyrmkin-warband']] as const) {
      const g = newGame();
      standard(g, { companions: [hero, 'moss-dire-wolf'] });
      onTop(g.s, 'location', ['clover-hollow']); // no challenge-changing place
      onTop(g.s, 'encounter', [enemy]);
      restart(g);
      until(g, bidFor(g.A));
      expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === getDef(hero).name), hero).toHaveLength(1);
    }
    // And not when it is a different stat.
    const g = newGame();
    standard(g, { companions: ['gnash-the-butcher-of-bloodmire', 'moss-dire-wolf'] });
    onTop(g.s, 'location', ['clover-hollow']);
    onTop(g.s, 'encounter', ['abbess-hollis-of-the-unremembered']); // Guile
    restart(g);
    until(g, bidFor(g.A));
    expect(g.events.some((e) => e.type === 'drew' && e.player === g.A && e.reason === getDef('gnash-the-butcher-of-bloodmire').name)).toBe(false);
  });

  it('Tova announces her return at the start of her controller turn', () => {
    const g = newGame();
    standard(g, { companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    use(g, 'tova-emberdeep-keeper-of-the-underway-door', 'rest');
    until(g, (s) => s.turn.number === 3 && s.players[s.turn.active]!.id === g.A);
    expect(g.events.some((e) => e.type === 'abilityUsed' && e.ability === 'return')).toBe(true);
  });
});

describe('companion movement', () => {
  it('Tova rests, then returns with an extra card on her next turn', () => {
    const g = newGame();
    standard(g, { companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    use(g, 'tova-emberdeep-keeper-of-the-underway-door', 'rest');
    const tova = card(g, 'tova-emberdeep-keeper-of-the-underway-door');
    expect(player(g, g.A).resting).toContain(tova);
    until(g, (s) => s.turn.number === 3 && s.players[s.turn.active]!.id === g.A);
    expect(player(g, g.A).party).toContain(tova);
    const tovaDraw = g.events.find((e) => e.type === 'drew' && e.player === g.A && e.reason.startsWith('Tova'));
    expect(tovaDraw && tovaDraw.type === 'drew' && tovaDraw.cards.length).toBe(2);
  });

  it('Tova also returns when rested on another player\x27s turn, in a three-player game', () => {
    for (const onOwnTurn of [true, false]) {
      const g = newGame(3, 1, { allPlayersFaceEncounter: false }); // nobody bids, so nobody loses a hero while she rests
      standard(g, { companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'] });
      restart(g);
      const tova = card(g, 'tova-emberdeep-keeper-of-the-underway-door');
      if (onOwnTurn) {
        until(g, activateFor(g.A, 'beforeBidding'));
        use(g, 'tova-emberdeep-keeper-of-the-underway-door', 'rest');
      } else {
        until(g, (s, d) => s.turn.number === 2 && d.kind === 'activate' && d.player === g.A && d.window === 'beforeBidding');
        use(g, 'tova-emberdeep-keeper-of-the-underway-door', 'rest');
      }
      expect(player(g, g.A).resting).toContain(tova);
      const startTurn = g.s.turn.number;
      until(g, (s) => s.turn.number > startTurn && s.players[s.turn.active]!.id === g.A);
      expect(player(g, g.A).resting).not.toContain(tova);
      expect(player(g, g.A).party).toContain(tova);
      expect(g.events.some((e) => e.type === 'drew' && e.player === g.A && e.reason.startsWith('Tova'))).toBe(true);
    }
  });

  it('Gauntlet of Returning brings back a hero from the discard', () => {
    const g = newGame();
    standard(g, { hand: ['gauntlet-of-returning'] });
    const gnash = idOf(g.s, 'gnash-the-butcher-of-bloodmire');
    detach(g.s, gnash);
    g.s.discards.hero.push(gnash);
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'gauntlet-of-returning') });
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'gauntlet');
    pick(g, gnash);
    expect(player(g, g.A).party).toContain(gnash);
  });

  it('The Goose & Kettle: everyone may draw a hero into play, the party limit is one higher while it lasts', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'location', ['the-goose-and-kettle']);
    restart(g);
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'waystoneDraw' && d.player === g.A);
    pick(g, 'draw');
    expect(player(g, g.A).party).toHaveLength(4);
    expect(partySize(new Ctx(g.s), player(g, g.A))).toBe(4);
    // No discard follows. When the place is left behind the extra hero has to go (their choice).
    expect(until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'discardHero' && d.player === g.A)).toBe(true);
    pick(g, card(g, 'moss-dire-wolf'));
    expect(player(g, g.A).party).toHaveLength(3);
    expect(partySize(new Ctx(g.s), player(g, g.A))).toBe(3);
  });


  it('Sigrun may take one of the discarded cards instead of drawing', () => {
    const g = newGame();
    standard(g, { companions: ['sigrun-stonefast-metal-singer', 'pell-quillon-collegium-prodigy'], hand: [] });
    const cap = idOf(g.s, 'jesters-cap');
    detach(g.s, cap);
    g.s.discards.resource.push(cap);
    restart(g);
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'sigrunPick').toBe(true);
    pick(g, cap);
    expect(player(g, g.A).hand).toContain(cap);
  });
});

describe('bidding options', () => {
  it('Mayor Hobby may bid his first card face down', () => {
    const g = newGame();
    standard(g, { hero: 'mayor-hobby-trickgrin' });
    restart(g);
    until(g, bidFor(g.A));
    const d = g.s.pending!;
    expect(d.kind === 'bid' && d.canFaceDown).toBe(true);
    act(g, { type: 'bid.play', decision: d.id, card: card(g, 'honey-biscuit'), faceDown: true });
    expect(player(g, g.A).bids[0]!.visible).toBe(false);
    expect(viewFor(g.s, g.B).players.find((p) => p.id === g.A)!.bids[0]).toEqual({ hidden: true });
  });

  it('others cannot bid their first card face down', () => {
    const g = newGame();
    standard(g, {});
    restart(g);
    until(g, bidFor(g.A));
    const r = applyCommand(g.s, g.A, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit'), faceDown: true });
    expect(r).toEqual({ ok: false, error: 'must_bid_face_up' });
  });

  it('abilities cannot be used outside their window or twice', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, bidFor(g.A));
    const bad = applyCommand(g.s, g.A, { type: 'ability.use', decision: g.s.pending!.id, source: card(g, 'pell-quillon-collegium-prodigy'), ability: 'force' });
    expect(bad).toEqual({ ok: false, error: 'ability_unavailable' });
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    const again = applyCommand(g.s, g.A, { type: 'ability.use', decision: g.s.pending!.id, source: card(g, 'liriel-nightbloom'), ability: 'force' });
    expect(again).toEqual({ ok: false, error: 'ability_unavailable' });
    const notMine = applyCommand(g.s, g.A, { type: 'ability.use', decision: g.s.pending!.id, source: player(g, g.B).party[0]!, ability: 'requisition' });
    expect(notMine.ok).toBe(false);
  });
});

describe('the opening party draft', () => {
  it('each player in turn privately picks three of six heroes; the rest go back unseen', () => {
    const { state } = createGame({ players: seats(3), seed: seed(4) });
    const g: Game = { s: state, events: [], A: '', B: '' };
    const picked: Record<string, string[]> = {};
    for (let i = 0; i < 3; i++) {
      const d = g.s.pending!;
      if (d.kind !== 'choose' || d.purpose !== 'partyDraft') throw new Error('expected a party draft');
      expect(d.options).toHaveLength(6);
      expect([d.min, d.max]).toEqual([3, 3]);
      expect(d.options.every((o) => o.card && !o.card.id)).toBe(true); // by card, never by instance id
      for (const other of g.s.players.filter((p) => p.id !== d.player)) {
        expect(viewFor(g.s, other.id).pending!.detail).toBeUndefined();
      }
      expect(viewFor(g.s, d.player).players.find((p) => p.id === d.player)!.party).toHaveLength(0);
      picked[d.player] = [d.options[0]!.value, d.options[2]!.value, d.options[5]!.value];
      act(g, { type: 'choose', decision: d.id, picks: picked[d.player]! });
    }
    for (const p of g.s.players) expect(p.party.map((c) => g.s.cards[c]).sort()).toEqual([...picked[p.id]!].sort());
    // Nobody is dealt heroes and there is no first-turn recruit phase: the first decision is something else.
    expect(g.s.pending?.kind).not.toBe('recruit.offer');
    expect(g.s.turn.number).toBe(1);
    expect(g.s.decks.hero).toHaveLength(CARDS.heroes.length - 9); // the passed-over heroes went back
    checkInvariants(g.s);
  });

  it('hands are dealt before the draft, so nothing else waits on it', () => {
    const { state } = createGame({ players: seats(3), seed: seed(4) });
    for (const p of state.players) expect(p.hand).toHaveLength(3);
  });
});

describe('falling', () => {
  /** Physical 12 (the Basilisk) against parties that cannot reach it, with nothing to spend. */
  const fall = (a: string[], rules?: Partial<HouseRules>) => {
    const g = newGame(2, 1, rules);
    standard(g, { party: a, hand: ['honey-biscuit', 'mask-of-many-faces'] }, { party: ['fennick-puffcap-mycomancer', 'nettle-burrows-trouble-maker', 'sister-aurelie-dane-physician'] });
    onTop(g.s, 'encounter', ['basilisk']);
    restart(g);
    return g;
  };

  it('a player who fails chooses which hero falls; it goes to the discard pile and costs nothing else', () => {
    const g = fall(['archmage-corvin-varro', 'moss-dire-wolf', 'pell-quillon-collegium-prodigy']);
    const n = g.s.turn.number;
    const asked: string[] = [];
    until(g, (s) => s.turn.number !== n, (_s, d) => {
      if (d.kind === 'bid') return { type: 'bid.pass', decision: d.id };
      if (d.kind === 'choose' && d.player === g.A && d.purpose === 'fallHero') {
        asked.push(d.purpose);
        return { type: 'choose', decision: d.id, picks: [card(g, 'moss-dire-wolf')] };
      }
      return undefined;
    });
    expect(asked).toEqual(['fallHero']);
    const a = player(g, g.A);
    expect(a.party.map((c) => g.s.cards[c])).toEqual(['archmage-corvin-varro', 'pell-quillon-collegium-prodigy']);
    expect(g.s.discards.hero).toContain(card(g, 'moss-dire-wolf'));
    expect(a.hand).toHaveLength(2); // the hand is not touched
    expect(g.events.some((e) => e.type === 'heroFalls' && e.player === g.A)).toBe(true);
    expect(g.events.some((e) => e.type === 'heroLeft' && e.player === g.A && e.reason === 'Fell')).toBe(true);
    checkInvariants(g.s);
  });

  it('with one hero left there is nothing to choose: that hero falls', () => {
    const g = fall(['pell-quillon-collegium-prodigy']);
    const n = g.s.turn.number;
    let asked = false;
    until(g, (s) => s.turn.number !== n, (_s, d) => {
      if (d.kind === 'bid') return { type: 'bid.pass', decision: d.id };
      if (d.kind === 'choose' && d.player === g.A && d.purpose === 'fallHero') asked = true;
      return undefined;
    });
    expect(asked).toBe(false);
    expect(player(g, g.A).party).toHaveLength(0);
    expect(g.s.discards.hero).toContain(card(g, 'pell-quillon-collegium-prodigy'));
  });

  it('everyone who fails falls at the end of that same turn, each choosing in turn', () => {
    const g = fall(['archmage-corvin-varro', 'moss-dire-wolf', 'pell-quillon-collegium-prodigy']);
    const answered = new Set<string>();
    until(g, (s) => s.turn.number === 2, (_s, d) => {
      if (d.kind === 'choose' && d.purpose === 'fallHero') { answered.add(d.player); return { type: 'choose', decision: d.id, picks: [d.options[0]!.value] }; }
      return undefined;
    });
    expect([...answered].sort()).toEqual([g.A, g.B].sort());
    expect(player(g, g.A).party).toHaveLength(2);
    expect(player(g, g.B).party).toHaveLength(2);
    expect(g.events.filter((e) => e.type === 'heroFalls')).toHaveLength(2);
    checkInvariants(g.s);
  });

  it('the party refills in the recruit phase', () => {
    const g = fall(['archmage-corvin-varro', 'moss-dire-wolf', 'pell-quillon-collegium-prodigy']);
    until(g, (_s, d) => d.kind === 'recruit.offer' && d.player === g.A);
    expect(player(g, g.A).party).toHaveLength(2);
    const offer = g.s.pending!;
    act(g, { type: 'recruit.draw', decision: offer.id });
    const place = g.s.pending!;
    expect(place.kind === 'recruit.place' && place.mustReplace).toBe(false);
    act(g, { type: 'recruit.keep', decision: place.id, replace: null });
    expect(player(g, g.A).party).toHaveLength(3);
  });

  it('Shield of Xorthalos and the Amulet of Aesia prevent a fall', () => {
    for (const [def, source] of [['shield-of-xorthalos', 'Shield of Xorthalos'], ['the-amulet-of-aesia', 'The Amulet of Aesia']] as const) {
      const g = newGame();
      standard(g, { party: ['pell-quillon-collegium-prodigy'], hand: [def] });
      onTop(g.s, 'encounter', ['basilisk']);
      restart(g);
      until(g, bidFor(g.A));
      act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, def) });
      finishTurn(g);
      expect(g.events.some((e) => e.type === 'fallPrevented' && e.player === g.A && e.source === source)).toBe(true);
      expect(player(g, g.A).party).toHaveLength(1);
    }
  });
});



describe('abilities that reach into a deck', () => {
  it('Corvin extra draw zaps the resource deck', () => {
    const g = newGame();
    standard(g, { hero: 'archmage-corvin-varro' });
    restart(g);
    until(g, bidFor(g.A));
    const zap = g.events.find((e) => e.type === 'abilityZap');
    expect(zap && zap.type === 'abilityZap' && zap.deck === 'resource' && zap.pile === 'deck').toBe(true);
  });
});


describe('the recruit phase: one random hero, keep it or not', () => {
  it('draws one at random, privately, and at the party size keeping it means replacing one', () => {
    const g = newGame();
    until(g, (_s, d) => d.kind === 'recruit.offer');
    const offer = g.s.pending!;
    const p = player(g, offer.player);
    while (p.party.length < 3) p.party.push(g.s.decks.hero.shift()!); // a fall on turn 1 left a gap: top the party back up
    const top = g.s.decks.hero[g.s.decks.hero.length - 1]!;
    act(g, { type: 'recruit.draw', decision: offer.id });
    const place = g.s.pending!;
    if (place.kind !== 'recruit.place') throw new Error('expected placement');
    expect(place.drawn).toBe(top);
    expect(place.mustReplace).toBe(true);
    expect(applyCommand(g.s, place.player, { type: 'recruit.keep', decision: place.id, replace: null })).toEqual({ ok: false, error: 'must_replace' });
    const old = player(g, place.player).party[0]!;
    act(g, { type: 'recruit.keep', decision: place.id, replace: old });
    expect(player(g, place.player).party).toContain(place.drawn);
    expect(player(g, place.player).party).not.toContain(old);
    expect(g.s.discards.hero).toContain(old);
  });

  it('can be let go, and under the size it just joins', () => {
    const g = newGame();
    until(g, (_s, d) => d.kind === 'recruit.offer');
    const offer = g.s.pending!;
    const p = player(g, offer.player);
    g.s.decks.hero.push(p.party.pop()!);
    act(g, { type: 'recruit.draw', decision: offer.id });
    const place = g.s.pending!;
    expect(place.kind === 'recruit.place' && place.mustReplace).toBe(false);
    act(g, { type: 'recruit.discard', decision: place.id });
    expect(g.s.discards.hero).toContain((place as { drawn: string }).drawn);
  });
});



describe('hand model', () => {
  it('steady: the current player draws 2 and everyone else 1, never past the hand limit', () => {
    const g = newGame(3, 1, { handModel: 'steady', activeDraw: 2, othersDraw: 1, handLimit: 4 });
    standard(g, { hero: 'thorgar-twice-buried', hand: ['honey-biscuit'] }, { hand: ['feathered-cap', 'jesters-cap', 'patchwork-coat', 'sprig-of-heather'] });
    give(g.s, g.C!, { party: ['gnash-the-butcher-of-bloodmire', 'nettle-burrows-trouble-maker', 'sister-aurelie-dane-physician'], hand: ['bag-of-toffees'] });
    const before = g.events.length;
    restart(g);
    // Count what each player drew at the start of the turn (later location effects may draw more).
    const drawn = (pid: string) => g.events.slice(before).flatMap((e) => (e.type === 'drew' && e.player === pid && e.reason === 'Start of turn' ? [e.cards.length] : [])).reduce((a, b) => a + b, 0);
    expect(drawn(g.A)).toBe(2);
    expect(drawn(g.B)).toBe(0); // already at the limit
    expect(drawn(g.C!)).toBe(1);
  });

  it('refill (v0.3): only the current player refills, to the draw size', () => {
    const g = newGame(3, 1, { handModel: 'refill' });
    standard(g, { hero: 'thorgar-twice-buried', hand: [] }, { hand: ['feathered-cap'] });
    restart(g);
    expect(player(g, g.A).hand).toHaveLength(3);
    expect(player(g, g.B).hand).toHaveLength(1);
  });
});

describe('former heroes', () => {

  it('Queen Maren can requisition only on her own turn', () => {
    const g = newGame();
    standard(g, {}, { hero: 'queen-maren-ashcroft', hand: ['feathered-cap'] });
    restart(g);
    // On A's turn, B (Maren) is never offered the before-bidding requisition.
    until(g, bidFor(g.A));
    expect(g.events.some((e) => e.type === 'abilityUsed' && e.ability === 'requisition')).toBe(false);
    expect(g.s.pending?.kind).toBe('bid');
  });


  it('Thorgar is Unburied once per game: a fall is prevented and he draws 3', () => {
    const g = newGame();
    standard(g, { hero: 'thorgar-twice-buried', companions: ['pell-quillon-collegium-prodigy'], hand: [] });
    restart(g);
    until(g, bidFor(g.A));
    finishTurn(g); // Thorgar P7 + Pell 1 = 8 against 10
    expect(g.events.some((e) => e.type === 'heroFalls' && e.player === g.A)).toBe(false);
    expect(g.events.some((e) => e.type === 'fallPrevented' && e.player === g.A)).toBe(true);
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Thorgar Twice-Buried').reduce((n, e) => n + (e.type === 'drew' ? e.cards.length : 0), 0)).toBe(3);
    expect(player(g, g.A).used['unburied']).toBe(1);
    expect(abilityOf('thorgar-twice-buried')?.unburied).toBe(true);
  });

  it('Kazra draws when an Ironbound card enters play', () => {
    const g = newGame();
    standard(g, { hero: 'kazra-emberdeep' });
    onTop(g.s, 'location', ['clover-hollow']);
    onTop(g.s, 'encounter', ['ironbound-vanguard']);
    restart(g);
    until(g, bidFor(g.A));
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Kazra Emberdeep')).toHaveLength(1);
  });

  it('Corvin draws one extra resource, once per turn, on any turn', () => {
    const g = newGame();
    standard(g, { hero: 'archmage-corvin-varro' });
    const ctx = atBidding(g);
    delete g.s.turn.used[`corvin:${g.A}`]; // the turn's own refill already used the extra draw
    const before = player(g, g.A).hand.length;
    drawResources(ctx, g.A, 1, 'test');
    expect(player(g, g.A).hand.length).toBe(before + 2);
    drawResources(ctx, g.A, 1, 'test');
    expect(player(g, g.A).hand.length).toBe(before + 3); // only the first draw of the turn is doubled
  });
  it('the former heroes carry their halved stats and say so; their triggers and Kin bonuses are set aside', () => {
    const barnaby = getDef('professor-barnaby-pickwort');
    expect(barnaby.kind === 'hero' && barnaby.stats).toEqual({ P: 2, M: 5, G: 4 });
    expect(barnaby.revision).toMatch(/halved/);
    expect(getDef('kazra-emberdeep').revision).toMatch(/halved/);
  });

  it('every former hero is halved (rounded up) from the set-aside register and has no trigger or Kin text', () => {
    expect(setAside.oldHeroes).toHaveLength(15);
    for (const h of setAside.oldHeroes) {
      const d = getDef(h.id);
      expect(d.kind, h.name).toBe('hero');
      if (d.kind !== 'hero') continue;
      expect(d.stats, h.name).toEqual({ P: Math.ceil(h.originalStats.P / 2), M: Math.ceil(h.originalStats.M / 2), G: Math.ceil(h.originalStats.G / 2) });
      expect('triggerText' in d, h.name).toBe(false);
      expect('kinText' in d, h.name).toBe(false);
      expect(h.triggerText, h.name).toBeTruthy(); // stored for later
    }
  });

  it('the set-aside cards stay out of the game; Brisa and Grumma are back on the Heroes tab with new abilities', () => {
    expect(setAside.setAsideCards).toHaveLength(7);
    for (const c of setAside.setAsideCards) {
      const back = c.id === 'brisa-blastcap-bombardier' || c.id === 'grumma-ladlejaw-camp-cook';
      expect(hasDef(c.id), c.name).toBe(back);
    }
    expect(CARDS.heroes).toHaveLength(49);
    expect(CARDS.locations.length + CARDS.encounters.length + CARDS.resources.length + CARDS.heroes.length).toBe(202);
  });

  it('no rules text anywhere still talks about companions', () => {
    const re = /companion/i;
    for (const kind of ['heroes', 'locations', 'encounters', 'resources'] as const) {
      for (const c of CARDS[kind]) {
        const text = 'abilityText' in c ? c.abilityText : 'conditionText' in c ? c.conditionText : '';
        expect(re.test(text ?? ''), c.name).toBe(false);
      }
    }
  });

});

describe('geese, Tobin, Tansy, Sigrun and Mogra', () => {
  // The window closes (and the turn resolves) once the ability is used, so read the effect from the event log.
  const effectsOf = (g: Game) => g.events.flatMap((e) => (e.type === 'effect' && e.effect.kind === 'statBonus' ? [e.effect] : []));

  it('Honk: a card worth 3+ gives +2 to all stats; either way it is discarded and Honk keeps her stats', () => {
    for (const [top, bonus] of [['hundred-year-journal', 2], ['feathered-cap', 0]] as const) {
      const g = newGame();
      standard(g, { companions: ['honk-the-goose-rout-veteran', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', [top]);
      const flipped = card(g, top);
      use(g, 'honk-the-goose-rout-veteran', 'honk');
      const bonuses = effectsOf(g);
      expect(bonuses.length).toBe(bonus ? 1 : 0);
      if (bonus) expect(bonuses[0]).toMatchObject({ stat: 'all', amount: bonus });
      expect(g.s.discards.resource).toContain(flipped);
      expect(g.events.some((e) => e.type === 'cardShown' && e.card.id === flipped)).toBe(true);
      expect(player(g, g.A).party).toContain(card(g, 'honk-the-goose-rout-veteran'));
    }
  });

  it('Waddle needs an odd value and Duchess an even one for +2 to all stats; Cobra Chicken needs a Wand to switch wands off', () => {
    const cases: [string, string, string][] = [
      ['sergeant-waddle', 'honk', 'honey-biscuit'],
      ['duchess-the-pub-goose', 'hiss', 'feathered-cap'],
    ];
    for (const [goose, ability, top] of cases) {
      const g = newGame();
      standard(g, { companions: [goose, 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', [top]);
      use(g, goose, ability);
      expect(effectsOf(g)[0]).toMatchObject({ stat: 'all', amount: 2 });
    }
    // And a miss: the wrong parity does nothing.
    for (const [goose, ability, top] of [['sergeant-waddle', 'honk', 'feathered-cap'], ['duchess-the-pub-goose', 'hiss', 'honey-biscuit']] as const) {
      const g = newGame();
      standard(g, { companions: [goose, 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', [top]);
      use(g, goose, ability);
      expect(effectsOf(g)).toHaveLength(0);
    }
    // Cobra Chicken: a Wand turns every wand off for the turn; anything else does nothing.
    for (const [top, off] of [['willow-wand', true], ['feathered-cap', false]] as const) {
      const g = newGame();
      standard(g, { companions: ['cobra-chicken', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', [top]);
      use(g, 'cobra-chicken', 'wark');
      expect(g.events.some((e) => e.type === 'ability' && /wands give no bonuses/.test(e.text))).toBe(off);
    }
  });

  it('Tobin reveals three heroes; a Goose may join and the rest are discarded', () => {
    const g = newGame();
    standard(g, { companions: ['tobin-quill-goose-keeper', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    onTop(g.s, 'hero', ['gnash-the-butcher-of-bloodmire', 'honk-the-goose-rout-veteran', 'varg-ironjaw']);
    use(g, 'tobin-quill-goose-keeper', 'flock');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'tobinPick').toBe(true);
    // Only the Goose is on offer (plus "none").
    expect((d as Extract<Decision, { kind: 'choose' }>).options.map((o) => o.value)).toEqual([card(g, 'honk-the-goose-rout-veteran'), 'none']);
    pick(g, card(g, 'honk-the-goose-rout-veteran'));
    // Honk is a companion to Tobin: she rides for free, so the party of three just grows to four.
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose === 'discardHero').toBe(false);
    expect(player(g, g.A).party).toEqual([card(g, 'archmage-corvin-varro'), card(g, 'tobin-quill-goose-keeper'), card(g, 'pell-quillon-collegium-prodigy'), card(g, 'honk-the-goose-rout-veteran')]);
    expect(g.s.discards.hero).toEqual(expect.arrayContaining([card(g, 'gnash-the-butcher-of-bloodmire'), card(g, 'varg-ironjaw')]));
    expect(g.s.turn.setAside).not.toContain(card(g, 'gnash-the-butcher-of-bloodmire'));
  });

  it('Tobin with no Goose among the three discards them all', () => {
    const g = newGame();
    standard(g, { companions: ['tobin-quill-goose-keeper', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    onTop(g.s, 'hero', ['gnash-the-butcher-of-bloodmire', 'varg-ironjaw', 'kesh-the-bog-huntress']);
    use(g, 'tobin-quill-goose-keeper', 'flock');
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose === 'tobinPick').toBe(false);
    expect(g.s.discards.hero).toEqual(expect.arrayContaining([card(g, 'gnash-the-butcher-of-bloodmire'), card(g, 'varg-ironjaw'), card(g, 'kesh-the-bog-huntress')]));
  });

  it("Farmer Hobart draws a resource at the start of his controller's turn for every Goose in play, anyone's", () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort', companions: ['farmer-hobart-thimblewick', 'honk-the-goose-rout-veteran'], hand: [] }, { companions: ['duchess-the-pub-goose', 'varg-ironjaw'] });
    restart(g);
    finishTurn(g); // A's turn 1 (triggers don't fire in the opening turn)
    finishTurn(g); // B's turn 2
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && /Hobart/.test(e.reason) && e.cards.length === 2)).toHaveLength(1);
  });

  it('Sigrun: look at three discarded cards and take one, once per turn', () => {
    const g = newGame();
    standard(g, { companions: ['sigrun-stonefast-metal-singer', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
    const cards = ['the-axe-of-doom', 'honey-biscuit', 'feathered-cap', 'scrying-lenses', 'mask-of-many-faces'].map((d) => idOf(g.s, d));
    for (const c of cards) { detach(g.s, c); g.s.discards.resource.push(c); }
    const before = g.s.discards.resource.length;
    restart(g);
    const d = g.s.pending as Extract<Decision, { kind: 'choose' }>;
    expect(d.purpose).toBe('sigrunPick');
    expect(d.options.map((o) => o.value).filter((v) => v !== 'deck')).toHaveLength(3);
    const taken = d.options[0]!.value;
    pick(g, taken);
    expect(player(g, g.A).hand).toContain(taken);
    expect(g.s.discards.resource).not.toContain(taken);
    expect(g.s.discards.resource.length).toBeGreaterThanOrEqual(before - 1);
    expect(g.s.turn.used[`sigrun:${g.A}`]).toBe(1);
  });

});

describe('bots and Tova', () => {
  /** What a normal bot answers at A's before-bidding window with this team and hand. */
  function tovaAnswer(hero: string, others: string[], hand: string[], strongRival = false) {
    const g = newGame();
    // A weak rival (Physical 4 + 3) by default; a strong one (Maren 6 + two 5s) when asked.
    standard(g, { hero, companions: ['tova-emberdeep-keeper-of-the-underway-door', ...others] },
      strongRival ? { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] } : { hero: 'queen-maren-ashcroft', companions: ['tobin-quill-goose-keeper'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    give(g.s, g.A, { hand }); // the turn-start refill dealt a hand; swap in the one under test
    const cmd = botDecide(viewFor(g.s, g.A), 'normal', () => 0.5);
    return cmd?.type === 'ability.use' ? cmd.ability : cmd?.type;
  }

  it('rests when her Physical (1) is not needed to survive', () => {
    expect(tovaAnswer('lord-paladin-aldric-ashcroft', ['gnash-the-butcher-of-bloodmire'], ['honey-biscuit'])).toBe('rest');
  });

  it('rests when one card makes up for her; keeps her when only weak cards are held', () => {
    // Corvin P2 + Tova 3 + Waddle 4 = 9 against 10: without Tova 6, a gap of 4.
    expect(tovaAnswer('archmage-corvin-varro', ['sergeant-waddle'], ['the-axe-of-doom', 'feathered-cap', 'honey-biscuit'])).toBe('rest');
    expect(tovaAnswer('archmage-corvin-varro', ['sergeant-waddle'], ['feathered-cap', 'honey-biscuit', 'sprig-of-heather'])).toBe('ability.done');
  });

  it('keeps her when sitting out would hand a valuable location to a stronger rival', () => {
    expect(tovaAnswer('archmage-corvin-varro', ['mogra-swiftfoot-goblin-runner'], ['the-axe-of-doom', 'feathered-cap', 'honey-biscuit'], true)).toBe('ability.done');
  });

  it('rests when the turn is lost anyway', () => {
    expect(tovaAnswer('archmage-corvin-varro', ['mogra-swiftfoot-goblin-runner'], [])).toBe('rest');
  });
});

describe('The Golden Egg', () => {
  it('The Golden Egg is worth 1, plus 2 for every Goose in play, anyone\'s', () => {
    const value = (mine: string[], theirs: string[]) => {
      const g = newGame();
      standard(g, { companions: mine, hand: ['the-golden-egg'] }, { companions: theirs });
      restart(g);
      until(g, bidFor(g.A));
      return viewFor(g.s, g.A).hand.find((h) => h.card.def === 'the-golden-egg')?.value;
    };
    expect(value(['honk-the-goose-rout-veteran', 'duchess-the-pub-goose'], ['varg-ironjaw', 'kesh-the-bog-huntress'])).toBe(1 + 2 * 2);
    expect(value(['varg-ironjaw', 'kesh-the-bog-huntress'], ['honk-the-goose-rout-veteran', 'sergeant-waddle'])).toBe(1 + 2 * 2);
    expect(value(['honk-the-goose-rout-veteran', 'varg-ironjaw'], ['sergeant-waddle', 'kesh-the-bog-huntress'])).toBe(1 + 2 * 2);
    expect(value(['varg-ironjaw', 'kesh-the-bog-huntress'], ['gnash-the-butcher-of-bloodmire', 'liriel-nightbloom'])).toBe(1);
  });
});

// --- the kingdom redesign --------------------------------------------------------------

/** A game paused in the bidding step of the first turn (so triggers are live), after rigging. */
function atBidding(g: Game): Ctx {
  restart(g);
  until(g, bidFor(g.A));
  return new Ctx(g.s);
}


describe('Companion To: heroes that ride for free', () => {
  const load = (g: Game, who = g.A) => partyLoad(new Ctx(g.s), player(g, who));
  const limit = (g: Game, who = g.A) => partySize(new Ctx(g.s), player(g, who));

  it('a companion does not count against the party size while the hero it is a companion to is in the party', () => {
    const g = newGame();
    standard(g, { party: ['archmage-corvin-varro', 'moss-dire-wolf', 'pell-quillon-collegium-prodigy'] });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    expect(load(g)).toBe(3); // Moss is an ordinary member on her own
    p.party.push(card(g, 'varg-ironjaw'));
    expect(p.party).toHaveLength(4);
    expect(load(g)).toBe(3); // Varg is in the party now: Moss rides
    expect(limit(g)).toBe(3);
    expect(partyLoad(ctx, p, card(g, 'tova-emberdeep-keeper-of-the-underway-door'))).toBe(4);
  });

  it('either one may arrive last: a recruit that completes the pair needs no place to be made', () => {
    for (const [have, drawn] of [['varg-ironjaw', 'moss-dire-wolf'], ['moss-dire-wolf', 'varg-ironjaw']] as const) {
      const g = newGame();
      standard(g, { party: ['archmage-corvin-varro', have, 'pell-quillon-collegium-prodigy'] });
      const ctx = atBidding(g);
      expect(partyLoad(ctx, player(g, g.A), card(g, drawn)) > partySize(ctx, player(g, g.A), card(g, drawn))).toBe(false);
    }
  });

  it('companions chain: Moss rides on Varg, who rides on Sigrun', () => {
    const g = newGame();
    standard(g, { party: ['sigrun-stonefast-metal-singer', 'archmage-corvin-varro', 'pell-quillon-collegium-prodigy'] });
    atBidding(g);
    const p = player(g, g.A);
    p.party.push(card(g, 'varg-ironjaw'), card(g, 'moss-dire-wolf'));
    expect(p.party).toHaveLength(5);
    expect(load(g)).toBe(3);
  });

  it('a companion can be named by more than one hero (any one of them will do)', () => {
    const g = newGame();
    standard(g, { party: ['tobin-quill-goose-keeper', 'archmage-corvin-varro', 'pell-quillon-collegium-prodigy'] }, { party: ['queen-maren-ashcroft', 'fennick-puffcap-mycomancer', 'nettle-burrows-trouble-maker'] });
    atBidding(g);
    const p = player(g, g.A);
    p.party.push(card(g, 'honk-the-goose-rout-veteran'), card(g, 'duchess-the-pub-goose'), card(g, 'sergeant-waddle'));
    expect(load(g)).toBe(3); // Honk, Duchess and Waddle all ride on Tobin
    p.party.push(card(g, 'cobra-chicken'));
    expect(load(g)).toBe(3); // Cobra Chicken rides on Tobin or Tansy
  });

  it('a face-down or resting partner still counts as in the party', () => {
    const g = newGame();
    standard(g, { party: ['archmage-corvin-varro', 'moss-dire-wolf', 'pell-quillon-collegium-prodigy'] });
    atBidding(g);
    const p = player(g, g.A);
    p.inactive.push(card(g, 'varg-ironjaw')); // turned face down by The Storybook Glade
    expect(load(g)).toBe(3);
    expect(p.party.length + p.inactive.length).toBe(4);
  });

  it('when the partner leaves, the companion stays if there is room for it', () => {
    const g = newGame();
    standard(g, { party: ['archmage-corvin-varro', 'varg-ironjaw', 'moss-dire-wolf'] });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    p.party.push(card(g, 'pell-quillon-collegium-prodigy'));
    expect(load(g)).toBe(3);
    discardHero(ctx, p, card(g, 'varg-ironjaw'), 'test');
    expect(p.party.map((c) => g.s.cards[c])).toEqual(['archmage-corvin-varro', 'moss-dire-wolf', 'pell-quillon-collegium-prodigy']);
    expect(g.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardHero')).toHaveLength(0);
  });

  it('when the partner leaves and the party is over its size, the companion leaves on its own (no choice)', () => {
    const g = newGame();
    standard(g, { party: ['sigrun-stonefast-metal-singer', 'archmage-corvin-varro', 'pell-quillon-collegium-prodigy'] });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    p.party.push(card(g, 'varg-ironjaw'), card(g, 'moss-dire-wolf'));
    expect(load(g)).toBe(3); // Varg rides on Sigrun, Moss on Varg
    // Varg goes: Sigrun, Corvin, Pell and Moss would be four, so Moss (now with nobody to ride with) has to go too.
    discardHero(ctx, p, card(g, 'varg-ironjaw'), 'test');
    expect(g.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardHero')).toHaveLength(0);
    expect(p.party.map((c) => g.s.cards[c]).sort()).toEqual(['archmage-corvin-varro', 'pell-quillon-collegium-prodigy', 'sigrun-stonefast-metal-singer']);
    expect(ctx.events.filter((e) => e.type === 'heroLeft' && e.reason === 'Companion left')).toHaveLength(1);
  });

  it('a face-down Ysolde still counts: the Storybook Glade does not shrink the party', () => {
    const g = newGame();
    standard(g, { hero: 'ysolde-of-the-wellspring' });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    const ysolde = card(g, 'ysolde-of-the-wellspring');
    p.party = p.party.filter((c) => c !== ysolde);
    p.inactive.push(ysolde);
    expect(partySize(ctx, p)).toBe(4);
  });

  it('Ysolde adds a place; riders are on top of that', () => {
    const g = newGame();
    standard(g, { party: ['ysolde-of-the-wellspring', 'varg-ironjaw', 'pell-quillon-collegium-prodigy'] });
    atBidding(g);
    const p = player(g, g.A);
    p.party.push(card(g, 'moss-dire-wolf'), card(g, 'archmage-corvin-varro'));
    expect(limit(g)).toBe(4);
    expect(load(g)).toBe(4); // Ysolde, Varg, Pell, Corvin (Moss rides)
    expect(p.party).toHaveLength(5);
  });

  it('every Companion To names a real hero, and never itself or a hero that names it back', () => {
    for (const h of CARDS.heroes) for (const d of companionsOf(h.id)) {
      expect(getDef(d).kind, h.name).toBe('hero');
      expect(d, h.name).not.toBe(h.id);
      expect(companionsOf(d), h.name).not.toContain(h.id);
    }
  });
});

describe('Allied: +1 to all stats for each other matching card on your board', () => {
  const part = (g: Game, who: PlayerId, def: string, viewer: PlayerId | null = null) => {
    const vis = viewer === null ? () => true : visibleTo(viewer);
    return totalFor(new Ctx(g.s), player(g, who), vis)!.party.find((c) => c.source === card(g, def))!.value;
  };

  it('counts other heroes in the party and face-up resources, not the hero itself', () => {
    const g = newGame();
    standard(g, { party: ['kazra-emberdeep', 'high-thane-brunna-stonefast', 'pell-quillon-collegium-prodigy'], hand: ['the-axe-of-doom', 'gold-filings'] });
    atBidding(g); // Physical
    expect(part(g, g.A, 'kazra-emberdeep')).toBe(stat('kazra-emberdeep', 'P') + 1); // Brunna is a Dwarf
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') }); // Dwarf, played face up
    expect(part(g, g.A, 'kazra-emberdeep')).toBe(stat('kazra-emberdeep', 'P') + 2);
  });

  it('a face-down resource only counts once it is revealed, and never for someone who cannot see it', () => {
    const g = newGame();
    standard(g, { party: ['kazra-emberdeep', 'pell-quillon-collegium-prodigy', 'moss-dire-wolf'], hand: ['honey-biscuit', 'gold-filings'] });
    atBidding(g);
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'gold-filings') }); // Dwarf, second bid: face down
    const base = stat('kazra-emberdeep', 'P');
    expect(part(g, g.A, 'kazra-emberdeep', g.B)).toBe(base); // B cannot see it
    expect(part(g, g.A, 'kazra-emberdeep', g.A)).toBe(base + 1); // A knows their own card
    expect(part(g, g.A, 'kazra-emberdeep')).toBe(base + 1); // revealed at the end
  });

  it('a card that matches several of the hero\'s targets counts once', () => {
    const g = newGame();
    standard(g, { party: ['aelthir-moonveil', 'caelan-halfelven', 'pell-quillon-collegium-prodigy'] });
    atBidding(g);
    // Aelthir is allied to Human and Elf: Caelan is both, Pell is Human.
    expect(part(g, g.A, 'aelthir-moonveil')).toBe(stat('aelthir-moonveil', 'P') + 2);
  });

  it('a curse placed in front of a player is their card, so its tag counts for their Allied heroes', () => {
    const g = newGame();
    standard(g, { hand: ['rotten-apple'] }, { party: ['mayor-hobby-trickgrin', 'sergeant-waddle', 'tobin-quill-goose-keeper'] });
    atBidding(g); // the Apple is Halfellow, and so is Hobby's Allied target
    const before = part(g, g.B, 'mayor-hobby-trickgrin');
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'rotten-apple') });
    expect(part(g, g.B, 'mayor-hobby-trickgrin')).toBe(before + 1);
  });

  it('can name one particular card: Varg is allied to Sigrun', () => {
    const g = newGame();
    standard(g, { party: ['varg-ironjaw', 'sigrun-stonefast-metal-singer', 'pell-quillon-collegium-prodigy'] });
    atBidding(g);
    expect(part(g, g.A, 'varg-ironjaw')).toBe(stat('varg-ironjaw', 'P') + 1);
    expect(part(g, g.A, 'sigrun-stonefast-metal-singer')).toBe(stat('sigrun-stonefast-metal-singer', 'P') + 1);
  });
});

describe('Nemesis: +1 to all stats for each matching location, encounter or minion', () => {
  const thorgar = (g: Game) => totalFor(new Ctx(g.s), player(g, g.A), () => true)!.party.find((c) => c.source === card(g, 'thorgar-twice-buried'))!.value;
  const rig = (loc: string, enc: string[]) => {
    const g = newGame();
    standard(g, { party: ['thorgar-twice-buried', 'pell-quillon-collegium-prodigy', 'moss-dire-wolf'] });
    onTop(g.s, 'location', [loc]);
    onTop(g.s, 'encounter', enc);
    atBidding(g);
    return g;
  };

  it('counts the location, the encounter and its minions', () => {
    const g = rig('the-barrowlands', ['the-barrow-king']); // Undead place, Undead encounter, and it draws an Undead minion
    expect(g.s.turn.minions).toHaveLength(1);
    expect(thorgar(g)).toBe(stat('thorgar-twice-buried', 'M') + 3);
  });

  it('a card that does not match adds nothing', () => {
    const g = rig('clover-hollow', ['wyrmkin-warband']);
    expect(thorgar(g)).toBe(stat('thorgar-twice-buried', 'P'));
  });

  it('Barrowdeep makes every encounter and minion Undead, and draws one extra minion', () => {
    const g = rig('barrowdeep', ['wyrmkin-warband']); // an Orc Beast, no minions of its own
    expect(g.s.turn.minions).toHaveLength(1);
    expect(thorgar(g)).toBe(stat('thorgar-twice-buried', 'P') + 3); // the place, the encounter and the minion
  });

  it('can name one particular card: Gimlet is a nemesis to Destiny the Frog', () => {
    const g = newGame();
    standard(g, { party: ['gimlet-a-very-good-dog', 'pell-quillon-collegium-prodigy', 'moss-dire-wolf'] });
    onTop(g.s, 'encounter', ['destiny-the-frog']);
    atBidding(g);
    expect(totalFor(new Ctx(g.s), player(g, g.A), () => true)!.party.find((c) => c.source === card(g, 'gimlet-a-very-good-dog'))!.value).toBe(3 + 1);
  });

  it('every Allied and Nemesis entry in the card data is a tag or exactly one card', () => {
    for (const h of CARDS.heroes) {
      for (const e of [...(h.allied ?? []), ...(h.nemesis ?? [])]) expect(() => resolveTarget(e, h.name), `${h.name}: ${e}`).not.toThrow();
    }
    expect(resolveTarget('Skarra', 'test')).toEqual({ tag: 'Skarra' });
    expect(resolveTarget('Hobart Thimblewick', 'test')).toEqual({ def: 'farmer-hobart-thimblewick' });
    expect(() => resolveTarget('Nobody Atall', 'test')).toThrow();
  });
});

describe('New triggers', () => {
  it('Seraphine draws when one of her controller\'s heroes is replaced or discarded', () => {
    const g = newGame();
    standard(g, { hero: 'thorgar-twice-buried', companions: ['seraphine-moonveil-warden-scholar', 'pell-quillon-collegium-prodigy'] });
    const ctx = atBidding(g);
    const hand = player(g, g.A).hand.length;
    discardHero(ctx, player(g, g.A), card(g, 'pell-quillon-collegium-prodigy'), 'test');
    expect(player(g, g.A).hand.length).toBe(hand + 1);
    // Another player's companion leaving does nothing.
    discardHero(ctx, player(g, g.B), card(g, 'sergeant-waddle'), 'test');
    expect(player(g, g.A).hand.length).toBe(hand + 1);
  });

  it('Mogra takes a random resource from an opponent when her controller does not win the encounter', () => {
    const g = newGame();
    standard(g, { party: ['archmage-corvin-varro', 'mogra-swiftfoot-goblin-runner', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit'] }, { hand: ['feathered-cap'] });
    restart(g);
    finishTurn(g); // nobody bids: B survives and takes the location, A falls short
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Mogra Swiftfoot, Goblin Runner')).toHaveLength(1);
    expect(player(g, g.A).hand).toContain(card(g, 'feathered-cap')); // B's only card
    checkInvariants(g.s);
  });


  it('Kesh draws when a Beast encounter enters play', () => {
    const g = newGame();
    standard(g, { companions: ['kesh-the-bog-huntress', 'pell-quillon-collegium-prodigy'] });
    onTop(g.s, 'encounter', ['dire-spider-brood']);
    restart(g);
    until(g, bidFor(g.A));
    // Corvin's own extra draw is not involved (it only adds to a draw by Corvin): Kesh drew one.
    expect(g.events.some((e) => e.type === 'drew' && e.player === g.A && e.reason.startsWith('Kesh'))).toBe(true);
  });


  it('Varg draws when an Orc card enters play, once per turn', () => {
    const g = newGame();
    standard(g, { hero: 'varg-ironjaw' });
    onTop(g.s, 'location', ['gorewatch']); // Capital, Orc
    onTop(g.s, 'encounter', ['fen-wyrmkin']); // Orc Beast
    restart(g);
    until(g, bidFor(g.A));
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Varg Ironjaw')).toHaveLength(1);
  });
});

describe('Activated abilities of the redesign', () => {
  it('Rook: discard a resource card and draw one', () => {
    const g = newGame();
    standard(g, { hero: 'thorgar-twice-buried', companions: ['captain-rook-halloran-skyship-captain', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'feathered-cap'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const discards = g.s.discards.resource.length;
    const handBefore = player(g, g.A).hand.length;
    use(g, 'captain-rook-halloran-skyship-captain', 'manifest');
    pick(g, card(g, 'honey-biscuit'));
    expect(player(g, g.A).hand).toHaveLength(handBefore);
    expect(player(g, g.A).hand).not.toContain(card(g, 'honey-biscuit'));
    expect(g.s.discards.resource.length).toBeGreaterThan(discards);
  });

  it('Gimlet swaps a card in hand for the top of the resource discard stack', () => {
    const g = newGame();
    standard(g, { companions: ['gimlet-a-very-good-dog', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit'] });
    g.s.discards.resource.push(card(g, 'the-axe-of-doom'));
    detach(g.s, card(g, 'the-axe-of-doom'));
    g.s.discards.resource.push(card(g, 'the-axe-of-doom'));
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    use(g, 'gimlet-a-very-good-dog', 'fetch');
    pick(g, card(g, 'honey-biscuit'));
    expect(player(g, g.A).hand).toContain(card(g, 'the-axe-of-doom'));
    expect(player(g, g.A).hand).not.toContain(card(g, 'honey-biscuit'));
    expect(g.s.discards.resource.at(-1)).toBe(card(g, 'honey-biscuit'));
  });

  it('Tansy looks at a random face-down card another player has bid (shown to her player only)', () => {
    const g = newGame();
    standard(g, { companions: ['tansy-brambleby-barmaid-and-volunteer', 'pell-quillon-collegium-prodigy'], hand: [] }, { hand: ['the-axe-of-doom', 'feathered-cap'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.pass', decision: g.s.pending!.id });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.B)); // B again after A passes
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'feathered-cap') });
    until(g, bidFor(g.A));
    use(g, 'tansy-brambleby-barmaid-and-volunteer', 'rumour');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose).toBe('rumourMill');
    const view = viewFor(g.s, g.A);
    const detail = view.pending!.detail as { options: { card?: { def: string; id?: string } }[] };
    expect(detail.options[0]!.card?.def).toBeTruthy();
    expect(detail.options[0]!.card?.id).toBeUndefined();
    expect(viewFor(g.s, g.B).pending?.detail).toBeUndefined();
  });

  it('Fog of the Fey (The Hollow Hills): Tansy cannot look at face-down cards', () => {
    const g = newGame();
    standard(g, { companions: ['tansy-brambleby-barmaid-and-volunteer', 'pell-quillon-collegium-prodigy'], hand: [] }, { hand: ['the-axe-of-doom', 'feathered-cap'] });
    onTop(g.s, 'location', ['the-hollow-hills']);
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.pass', decision: g.s.pending!.id });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'feathered-cap') });
    until(g, bidFor(g.A));
    const d = g.s.pending!;
    expect(d.kind === 'bid' && d.abilities.some((a) => a.ability === 'rumour')).toBe(false);
  });

  it("Hedda may take a forced stat meant for another hero, once per turn, and her player draws a resource", () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'thessaly-of-the-grove'] }, { companions: ['marshal-hedda-ironvow', 'sergeant-waddle'] });
    restart(g);
    until(g, bidFor(g.A));
    const hand = player(g, g.B).hand.length;
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'redirectHero' && d.player === g.B).toBe(true);
    pick(g, 'redirect');
    expect(player(g, g.B).hand.length).toBe(hand + 1);
    const forced = g.s.turn.effects.filter((e) => e.kind === 'forceStat');
    expect(forced).toHaveLength(1);
    expect(forced[0]!.target).toBe(card(g, 'marshal-hedda-ironvow'));
    // Once per turn: the next one lands where it was aimed, without a question.
    use(g, 'thessaly-of-the-grove', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceStat').map((e) => e.target)).toEqual([card(g, 'marshal-hedda-ironvow'), card(g, 'sergeant-waddle')]);
  });

  it('Torvi: Uncontrolled Explosion discards a resource and him, and takes 6 off every opponent', () => {
    const g = newGame();
    standard(g, { companions: ['torvi-cinderkeg-master-gunner', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'feathered-cap'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, activateFor(g.A, 'endOfBidding'));
    const before = total(g, g.A, g.B);
    const spare = player(g, g.A).hand[0]!;
    use(g, 'torvi-cinderkeg-master-gunner', 'fire');
    pick(g, spare); // the resource that pays for it
    expect(g.s.discards.hero).toContain(card(g, 'torvi-cinderkeg-master-gunner'));
    expect(g.s.discards.resource).toContain(spare);
    expect(total(g, g.A, g.B)).toBe(before - 6);
  });

  it('Oskar watches an opponent: when they use an ability against his heroes, he draws', () => {
    const g = newGame();
    standard(g, { hero: 'loremaster-oskar-grimgate', companions: ['pell-quillon-collegium-prodigy'], hand: [] },
      { hero: 'warchief-grukka-ironjaw', companions: ['liriel-nightbloom', 'gnash-the-butcher-of-bloodmire'] });
    onTop(g.s, 'encounter', ['crawling-remnant']);
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    use(g, 'loremaster-oskar-grimgate', 'grudge'); // the only opponent is named without asking
    const drawn = () => g.events.filter((e) => e.type === 'drew' && e.player === g.A && e.reason === 'Loremaster Oskar Grimgate').length;
    expect(drawn()).toBe(0);
    until(g, bidFor(g.B));
    use(g, 'liriel-nightbloom', 'force'); // B forces one of A's heroes onto Guile
    pick(g, card(g, 'pell-quillon-collegium-prodigy'));
    expect(drawn()).toBe(1);
  });

  it('The Book of Grudges: +3 (+4 for Oskar), and if its owner falls the winner has -3 next encounter', () => {
    const g = newGame();
    standard(g, { hero: 'loremaster-oskar-grimgate', companions: ['pell-quillon-collegium-prodigy'], hand: ['the-book-of-grudges'] },
      { hero: 'warchief-grukka-ironjaw', companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    onTop(g.s, 'encounter', ['crawling-remnant']);
    restart(g);
    until(g, bidFor(g.A));
    expect(viewFor(g.s, g.A).hand.find((h) => h.card.def === 'the-book-of-grudges')?.value).toBe(4);
    give(g.s, g.A, { hero: 'archmage-corvin-varro' });
    expect(viewFor(g.s, g.A).hand.find((h) => h.card.def === 'the-book-of-grudges')?.value).toBe(3);
    // Played face up, then A falls short while B wins.
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-book-of-grudges') });
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    expect(outcome?.type === 'outcome' && outcome.result.winner).toBe(g.B);
    expect(player(g, g.B).penalty).toBe(3);
  });
});

describe("Tansy's Rumour Mill", () => {
  it('shows every face-down card of one opponent and the viewer keeps seeing them this turn', () => {
    const g = newGame();
    standard(g, { companions: ['tansy-brambleby-barmaid-and-volunteer', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit'] }, { hand: ['the-axe-of-doom', 'feathered-cap', 'jesters-cap'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'feathered-cap') }); // face down
    until(g, bidFor(g.A));
    use(g, 'tansy-brambleby-barmaid-and-volunteer', 'rumour'); // one opponent: no question
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose === 'rumourMill').toBe(true);
    expect(player(g, g.A).seen).toEqual([card(g, 'feathered-cap')]);
    pick(g, 'done');
    const b = viewFor(g.s, g.A).players.find((p) => p.id === g.B)!;
    expect(b.bids.filter((x) => x.hidden)).toHaveLength(0);
    expect(JSON.stringify(viewFor(g.s, g.B))).toContain('feathered-cap'); // their own card
    // The third player (if any) and spectators still do not see it.
    expect(JSON.stringify(viewFor(g.s, null))).not.toContain(card(g, 'feathered-cap'));
  });

  it('a normal bot waits until a few cards are down; an easy bot may look at once', () => {
    const g = newGame();
    standard(g, { companions: ['tansy-brambleby-barmaid-and-volunteer', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'bag-of-toffees'] }, { hand: ['the-axe-of-doom', 'feathered-cap'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'feathered-cap') });
    until(g, bidFor(g.A));
    // Three cards are down: a normal bot looks.
    const cmd = botDecide(viewFor(g.s, g.A), 'normal', () => 0.9);
    expect(cmd?.type === 'ability.use' && cmd.ability).toBe('rumour');
  });
});

describe('Curses', () => {
  it('a curse played face up goes in front of the chosen opponent, where its negative value counts against them', () => {
    const g = newGame(3);
    standard(g, { hand: ['cursed-locket', 'honey-biscuit'] });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.C!);
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'cursed-locket') });
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'curseTarget' && d.player === g.A).toBe(true);
    expect(d.kind === 'choose' && d.options.map((o) => o.value).sort()).toEqual([g.B, g.C].sort());
    pick(g, g.C!);
    expect(player(g, g.A).bids).toHaveLength(0);
    expect(player(g, g.C!).bids.map((b) => b.card)).toEqual([card(g, 'cursed-locket')]);
    expect(total(g, g.A, g.C!)).toBe(before - 5);
  });

  it('with a single opponent the curse lands on them without asking', () => {
    const g = newGame();
    standard(g, { hand: ['rotten-apple'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'rotten-apple') });
    expect(player(g, g.B).bids.map((b) => b.card)).toEqual([card(g, 'rotten-apple')]);
    expect(g.s.pending?.kind).not.toBe('choose');
  });

  it('a face-down curse lands when it is revealed', () => {
    const g = newGame();
    standard(g, { hand: ['honey-biscuit', 'marked-for-the-hunt'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'marked-for-the-hunt') });
    expect(player(g, g.A).bids).toHaveLength(2); // still hidden, still A's
    finishTurn(g);
    expect(g.events.some((e) => e.type === 'cursePlaced' && e.from === g.A && e.to === g.B)).toBe(true);
    expect(g.s.discards.resource).toContain(card(g, 'marked-for-the-hunt')); // discarded with the rest
  });
});

describe('Curses and the Golden Egg: later rulings', () => {
  it('the bot plays a curse at a rival who is ahead of it', () => {
    const g = newGame();
    standard(g, { hero: 'archmage-corvin-varro', hand: ['marked-for-the-hunt'] }, { hero: 'warchief-grukka-ironjaw', companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    restart(g);
    until(g, bidFor(g.A));
    const cmd = botDecide(viewFor(g.s, g.A), 'normal', () => 0.9);
    expect(cmd?.type === 'bid.play' && cmd.card).toBe(card(g, 'marked-for-the-hunt'));
  });

  it('the Golden Egg counts goose encounters as well as goose heroes', () => {
    const g = newGame();
    standard(g, { hand: ['the-golden-egg'] });
    onTop(g.s, 'encounter', ['the-barrow-legion']); // Gorathaxus, Goose of the Void
    restart(g);
    until(g, bidFor(g.A));
    const egg = () => viewFor(g.s, g.A).hand.find((h) => h.card.def === 'the-golden-egg')!.value;
    const geeseInPlay = [...player(g, g.A).party, ...player(g, g.B).party].filter((c) => getDef(g.s.cards[c]!).groups.includes('Goose')).length;
    expect(egg()).toBe(1 + 2 * (geeseInPlay + 1));
  });
});

describe('Encounters and locations of the redesign', () => {
  it('Skarra draws a minion that is never another Skarra', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'encounter', ['skarra-ironjaw-the-bog-mother', 'skarra-crowned-she-says', 'skarra-mistress-of-wisps', 'basilisk']);
    restart(g);
    until(g, bidFor(g.A));
    expect(g.s.turn.encounter).toBe(card(g, 'skarra-ironjaw-the-bog-mother'));
    expect(g.s.turn.minions).toEqual([card(g, 'basilisk')]);
    expect(g.s.decks.encounter).toContain(card(g, 'skarra-crowned-she-says')); // the other Skarras stay where they were
  });

  it('Destiny drawn as the encounter fetches a Skarra: the Skarra is the encounter, Destiny its minion', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'encounter', ['destiny-the-frog', 'basilisk', 'skarra-ironjaw-the-bog-mother']);
    restart(g);
    until(g, bidFor(g.A));
    expect(g.s.turn.encounter).toBe(card(g, 'skarra-ironjaw-the-bog-mother'));
    expect(g.s.turn.minions).toEqual([card(g, 'destiny-the-frog')]); // she stands in for Skarra's minion draw
    expect(difficultyFor(new Ctx(g.s), null)!.minions).toBe(1);
    expect(g.s.decks.encounter).toContain(card(g, 'basilisk'));
    finishTurn(g);
    expect(g.s.discards.encounter).toContain(card(g, 'destiny-the-frog'));
    expect(g.s.discards.encounter).toContain(card(g, 'skarra-ironjaw-the-bog-mother'));
  });

  it('The Runeforged Titan is hard on Physical, but only 5 if the challenge is changed to Mental or Guile', () => {
    const base = (loc: string) => {
      const g = newGame();
      standard(g, {});
      onTop(g.s, 'location', [loc]);
      onTop(g.s, 'encounter', ['runeforged-titan']);
      restart(g);
      until(g, bidFor(g.A));
      return viewFor(g.s, g.A).turn.challenge!.difficulty.base;
    };
    expect(base('the-silverwood-hunt')).toBe((getDef('runeforged-titan') as { difficulty: number }).difficulty); // Physical
    expect(base('the-sealed-archive')).toBe(5); // Mental
    expect(base('tomb-of-the-first-wardens')).toBe(5); // Guile
  });

  it('The Treasure Trow: everyone draws when it enters, and each survivor draws when it is defeated', () => {
    const g = newGame();
    standard(g, {}, { hero: 'warchief-grukka-ironjaw', companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    onTop(g.s, 'encounter', ['the-treasure-trow']);
    const handA = player(g, g.A).hand.length;
    const handB = player(g, g.B).hand.length;
    restart(g);
    until(g, bidFor(g.A));
    expect(player(g, g.A).hand.length).toBeGreaterThan(handA);
    expect(player(g, g.B).hand.length).toBeGreaterThan(handB);
    const afterEnter = player(g, g.B).hand.length;
    until(g, (s) => s.turn.step === 'turnEnd' || s.turn.step === 'resolve' || s.turn.number > 1);
    finishTurn(g);
    expect(g.events.filter((e) => e.type === 'drew' && e.reason === 'Treasure Trow').length).toBeGreaterThanOrEqual(3);
    expect(afterEnter).toBeGreaterThan(handB);
  });

  it('Barrowdeep gives an Undead encounter an extra Undead minion; the capitals draw per kin hero', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'location', ['barrowdeep']);
    onTop(g.s, 'encounter', ['the-barrow-legion']);
    restart(g);
    until(g, bidFor(g.A));
    expect(g.s.turn.minions).toHaveLength(1);

    const k = newGame();
    standard(k, { companions: ['liriel-nightbloom', 'thessaly-of-the-grove'] });
    onTop(k.s, 'location', ['sylvaneth']);
    const hand = player(k, k.A).hand.length;
    restart(k);
    until(k, bidFor(k.A));
    expect(player(k, k.A).hand.length).toBeGreaterThanOrEqual(hand + 2); // two Elves
  });
});

describe('Goldie, Brisa, Aelder, Grumma and the new places', () => {
  /** A player's line in the turn's result (the turn is over once the end-of-bidding ability has been used). */
  const rowOf = (g: Game, pid: PlayerId) => {
    const e = g.events.find((x) => x.type === 'outcome');
    if (!e || e.type !== 'outcome') throw new Error('no outcome');
    return e.result.rows.find((r) => r.player === pid)!;
  };

  it('Tavern Keeper: Goldie draws three heroes in the recruit phase, keeps one to consider and discards the rest', () => {
    const g = newGame();
    standard(g, { companions: ['tansy-brambleby-barmaid-and-volunteer', 'pell-quillon-collegium-prodigy'] });
    give(g.s, g.A, { party: ['moss-dire-wolf', 'pell-quillon-collegium-prodigy', 'goldie-trickgrin-keeper-of-the-goose-and-kettle'] });
    restart(g);
    until(g, (_s, d) => d.kind === 'recruit.offer' && d.player === g.A); // (the first hero in a party is the one that falls by default)
    const discardedBefore = g.s.discards.hero.length;
    act(g, { type: 'recruit.draw', decision: g.s.pending!.id });
    const d = g.s.pending as Extract<Decision, { kind: 'choose' }>;
    expect(d.kind === 'choose' && d.purpose).toBe('goldiePick');
    expect(d.options).toHaveLength(3);
    // The cards on offer are shown by definition only: no instance ids to track.
    const view = viewFor(g.s, g.A).pending!.detail as { options: { card?: { id?: string } }[] };
    expect(view.options.every((o) => o.card && o.card.id === undefined)).toBe(true);
    checkInvariants(g.s);
    const chosen = d.options[1]!.value;
    pick(g, chosen);
    const place = g.s.pending!;
    expect(place.kind).toBe('recruit.place');
    expect(place.kind === 'recruit.place' && g.s.cards[place.drawn]).toBe(chosen);
    expect(g.s.discards.hero.length).toBe(discardedBefore + 2);
    checkInvariants(g.s);
  });

  it('Brisa turns a revealed resource face down: it contributes 3 and stops counting as a face-up card', () => {
    const g = newGame();
    standard(g, { party: ['brisa-blastcap-bombardier', 'kazra-emberdeep', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'gold-filings'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') }); // worth 1
    until(g, activateFor(g.A, 'endOfBidding'));
    use(g, 'brisa-blastcap-bombardier', 'flip'); // one revealed resource: no question
    finishTurn(g);
    expect(rowOf(g, g.A).parts.filter((p) => p.kind === 'resource').map((p) => p.value)).toEqual([3]); // the Biscuit's 1 became 3
    expect(g.events.some((e) => e.type === 'effect' && e.effect.kind === 'bidValue')).toBe(true);
  });

  it('Brisa could even turn a curse placed in front of her player into a 3', () => {
    const g = newGame();
    standard(g, { hand: ['marked-for-the-hunt'] }, { party: ['brisa-blastcap-bombardier', 'kazra-emberdeep', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'marked-for-the-hunt') });
    until(g, activateFor(g.B, 'endOfBidding'));
    use(g, 'brisa-blastcap-bombardier', 'flip');
    expect(rowOf(g, g.B).parts.filter((p) => p.kind === 'resource').map((p) => p.value)).toEqual([3]); // the curse's -6 became 3
  });

  it('The Mirror Mire: every resource is played face up, and nothing can be turned face down', () => {
    const g = newGame();
    standard(g, { party: ['brisa-blastcap-bombardier', 'mayor-hobby-trickgrin', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'jesters-cap', 'sprig-of-heather'] });
    onTop(g.s, 'location', ['the-mirror-marches']);
    restart(g);
    until(g, bidFor(g.A));
    const first = g.s.pending!;
    expect(first.kind === 'bid' && first.canFaceDown).toBe(false); // not even Hobby's A Little Plan
    act(g, { type: 'bid.play', decision: first.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.A));
    const second = g.s.pending!;
    expect(second.kind === 'bid' && second.faceUp).toBe(true);
    act(g, { type: 'bid.play', decision: second.id, card: card(g, 'jesters-cap') });
    expect(player(g, g.A).bids.every((b) => b.visible && b.playedFaceUp)).toBe(true);
    const d = g.s.pending!;
    expect(d.kind === 'bid' && d.abilities.some((a) => a.ability === 'flip')).toBe(false);
  });

  it('Aelder discards a resource for +3 until the end of the encounter', () => {
    const g = newGame();
    standard(g, { party: ['aelder-mossleaf-awakened-oak', 'aelthir-moonveil', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'feathered-cap'] });
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    const spare = player(g, g.A).hand[0]!;
    use(g, 'aelder-mossleaf-awakened-oak', 'roots');
    pick(g, spare);
    expect(g.s.discards.resource).toContain(spare);
    finishTurn(g);
    expect(rowOf(g, g.A).parts.some((p) => p.kind === 'bonus' && p.value === 3)).toBe(true);
  });

  it('Grumma draws at the end of bidding if her player bid at least three resources of their own (curses placed on them do not count)', () => {
    const run = (curses: boolean) => {
      const g = newGame();
      standard(g, { party: ['grumma-ladlejaw-camp-cook', 'pell-quillon-collegium-prodigy', 'moss-dire-wolf'], hand: ['honey-biscuit', 'feathered-cap', 'sprig-of-heather'] }, { hand: [] });
      restart(g);
      until(g, bidFor(g.A));
      const bids = curses ? ['honey-biscuit'] : ['honey-biscuit', 'feathered-cap', 'sprig-of-heather'];
      for (const c of bids) {
        act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, c) });
        until(g, bidFor(g.A));
      }
      if (curses) {
        // Two curses from B land in front of A.
        for (const c of ['rotten-apple', 'misdirecting-missive']) {
          const id = card(g, c);
          detach(g.s, id);
          g.s.players.find((p) => p.id === g.A)!.bids.push({ card: id, visible: true, resolved: true, playedFaceUp: true, placedBy: g.B });
        }
      }
      finishTurn(g);
      return g.events.filter((e) => e.type === 'drew' && e.player === g.A && /Grumma/.test(e.reason)).length;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0); // one resource of her own and two curses placed on her player
  });

  it('Kingsford: everyone draws a resource for every Human hero in their party', () => {
    const g = newGame();
    standard(g, { party: ['archmage-corvin-varro', 'queen-maren-ashcroft', 'moss-dire-wolf'], hand: [] }, { party: ['fennick-puffcap-mycomancer', 'nettle-burrows-trouble-maker', 'sister-aurelie-dane-physician'], hand: [] });
    onTop(g.s, 'location', ['kingsford']);
    restart(g);
    until(g, bidFor(g.A));
    const drew = (pid: PlayerId) => g.events.filter((e) => e.type === 'drew' && e.player === pid && e.reason === 'Kingsford').reduce((n, e) => n + (e.type === 'drew' ? e.cards.length : 0), 0);
    expect(drew(g.A)).toBeGreaterThanOrEqual(2); // Corvin and Maren (Corvin may add one more of his own)
  });

  it("Hedda's redirect still goes past Aldric's counter", () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'thessaly-of-the-grove'] }, { party: ['lord-paladin-aldric-ashcroft', 'marshal-hedda-ironvow', 'sergeant-waddle'] });
    restart(g);
    until(g, bidFor(g.A));
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose).toBe('redirectHero');
    pick(g, 'redirect');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'counterAbility').toBe(true);
    pick(g, 'counter');
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceStat')).toHaveLength(0);
    checkInvariants(g.s);
  });
});
