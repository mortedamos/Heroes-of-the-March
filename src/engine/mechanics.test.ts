// Card mechanics: one rigged scenario per ability family.

import { describe, expect, it } from 'vitest';
import { botDecide } from '../bots/heuristic';
import { applyCommand, resume } from './commands';
import { Ctx } from './context';
import { companionEnters, discardCompanion, fire, maxCompanions, replaceLocation } from './effects';
import { difficultyFor, totalFor } from './totals';
import { abilityOf } from './abilities';
import { getDef } from './cards';
import { createGame } from './setup';
import type { HouseRules } from './rules';
import { checkInvariants, seats, seed } from './testUtils';
import type { CardId, Command, Decision, DeckName, GameEvent, GameState, PlayerId } from './types';
import { redactEvents, viewFor } from './view';

// Two plain stand-ins for the retired Iron Beetles (Ironbound, Mental 10, minion 3) and The Grave-Hunger (Undead, Mental 15, minion 2): same numbers, so these tests keep their arithmetic.
Object.assign(getDef('ironbound-vanguard'), { stat: 'M', difficulty: 10, minionValue: 3 });
Object.assign(getDef('crawling-remnant'), { stat: 'M', difficulty: 15, minionValue: 2 });

// --- rigging helpers -------------------------------------------------------------

function idOf(s: GameState, def: string): CardId {
  const e = Object.entries(s.cards).find(([, d]) => d === def);
  if (!e) throw new Error(`no card ${def}`);
  return e[0];
}

/** Remove a card from wherever it is (not from a hero slot). */
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
    for (const k of ['companions', 'inactiveCompanions', 'resting', 'hand', 'claimed', 'councilHeroes'] as const) {
      p[k] = p[k].filter((c) => c !== id);
    }
    p.bids = p.bids.filter((b) => b.card !== id);
    if (p.hero === id) throw new Error('detaching a hero');
  }
}

function give(s: GameState, pid: PlayerId, opts: { hero?: string; companions?: string[]; hand?: string[] }): void {
  const p = s.players.find((x) => x.id === pid)!;
  if (opts.hero) {
    const id = idOf(s, opts.hero);
    const holder = s.players.find((x) => x.hero === id);
    if (holder !== p) {
      if (holder) holder.hero = p.hero;
      else { detach(s, id); s.decks.hero.push(p.hero); }
      p.hero = id;
    }
  }
  if (opts.companions) {
    s.decks.companion.push(...p.companions);
    p.companions = [];
    for (const d of opts.companions) { const id = idOf(s, d); detach(s, id); p.companions.push(id); }
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

/** Answer every opening companion draft with the first cards on offer. */
function finishOpeningDraft(state: GameState): GameState {
  let st = state;
  while (st.pending?.kind === 'choose' && st.pending.purpose === 'companionDraft') {
    const d = st.pending;
    const r = applyCommand(st, d.player, { type: 'choose', decision: d.id, picks: d.options.slice(0, d.min).map((o) => o.value) });
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  return st;
}

function newGame(n = 2, sd = 1, rules?: Partial<HouseRules>): Game {
  // Card-mechanic tests deal heroes blind and use the v0.3 hand rule and printed
  // difficulties (no fall cost) so card counts and survival are predictable; the
  // house rules have their own tests.
  const state = finishOpeningDraft(createGame({
    players: seats(n), seed: seed(sd),
    rules: { heroDraft: 1, handModel: 'refill', fallCost: false, ...rules },
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
  s.discards.companion.push(...t.companionMinions);
  for (const p of s.players) {
    s.discards.resource.push(...p.bids.map((b) => b.card));
    s.decks.hero.push(...p.councilHeroes);
    p.bids = [];
    p.councilHeroes = [];
    p.statOverride = null;
  }
  t.location = null; t.extraLocations = []; t.encounter = null; t.minions = []; t.setAside = []; t.companionMinions = [];
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
    case 'companion.offer': return { type: 'companion.skip', decision: d.id };
    case 'companion.place': return { type: 'companion.discard', decision: d.id };
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

/** A typical rig: known heroes/companions, Physical challenge via The Silverwood Hunt. */
function standard(g: Game, a: { hero?: string; companions?: string[]; hand?: string[] }, b: { hero?: string; companions?: string[]; hand?: string[] } = {}): void {
  give(g.s, g.A, { hero: 'archmage-corvin-varro', companions: ['rosalind-marchwell-marchguard-clerk', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit'], ...a });
  give(g.s, g.B, { hero: 'queen-maren-ashcroft', companions: ['sergeant-waddle', 'tobin-quill-goose-keeper'], hand: ['feathered-cap'], ...b });
  onTop(g.s, 'location', ['the-silverwood-hunt', 'kingsford', 'clover-hollow', 'the-hollow-between']);
  onTop(g.s, 'encounter', ['ironbound-vanguard', 'wyrmkin-warband', 'bridge-trolls']);
}

// --- sabotage ----------------------------------------------------------------------

describe('forced stats', () => {
  it('Liriel forces an opponent companion to contribute Guile', () => {
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

  it("Aldric's Shield of the Dawn cancels it", () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'lord-paladin-aldric-ashcroft' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, 'allow'); // Aldric's player lets it resolve, then cancels it afterwards with the proactive shield
    pick(g, card(g, 'sergeant-waddle'));
    act(g, { type: 'bid.pass', decision: g.s.pending!.id });
    until(g, bidFor(g.B));
    use(g, 'lord-paladin-aldric-ashcroft', 'shield');
    pick(g, card(g, 'liriel-nightbloom'));
    expect(total(g, g.A, g.B)).toBe(before);
    expect(g.events.some((e) => e.type === 'effectCancelled')).toBe(true);
  });

  it('Brunna ignores forcing that would hurt her', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'high-thane-brunna-stonefast' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(total(g, g.A, g.B)).toBe(before);
  });

  it('Mayor Hobby draws when someone is forced', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'mayor-hobby-trickgrin' });
    restart(g);
    until(g, bidFor(g.A));
    const hand = player(g, g.B).hand.length;
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(player(g, g.B).hand.length).toBe(hand + 1);
  });

  it('Hesk (a companion) lets another companion ability be used twice in a turn', () => {
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

  it('forced hero stat (Brisa: Physical)', () => {
    const g = newGame();
    standard(g, { companions: ['brisa-blastcap-bombardier', 'pell-quillon-collegium-prodigy'] }, { hero: 'professor-barnaby-pickwort' });
    onTop(g.s, 'location', ['tomb-of-the-first-wardens']); // Guile challenge; Barnaby G8 -> P4
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'brisa-blastcap-bombardier', 'force');
    // Only one opponent: a single forced option resolves without asking.
    expect(g.s.pending?.kind).toBe('bid');
    expect(total(g, g.A, g.B)).toBe(before - 4); // Barnaby G8 -> P4
  });
});

describe('silence, steal, negate, swap', () => {
  it('Aelthir silences an opponent companion at the start of the turn', () => {
    const g = newGame();
    standard(g, { hero: 'aelthir-moonveil' });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding')); // once the challenge is known
    use(g, 'aelthir-moonveil', 'torch');
    pick(g, card(g, 'sergeant-waddle'));
    until(g, bidFor(g.A));
    // Maren's Physical + Tobin P3 (Waddle silenced)
    expect(total(g, g.A, g.B)).toBe((getDef('queen-maren-ashcroft') as { stats: { P: number } }).stats.P + 3);
  });

  it('Pip claims a face-down bid in the window before the reveal (empty hand: no swap)', () => {
    const g = newGame();
    // A keeps a spare card so bidding is still open when we check the stolen card stays hidden.
    standard(g, { hand: ['honey-biscuit', 'the-axe-of-doom', 'feathered-cap'] }, { hero: 'pip-wanderfoot', hand: [] });
    onTop(g.s, 'encounter', ['wyrmkin-warband']); // not Ironbound, so Pip's trigger draws nothing
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, activateFor(g.B, 'beforeReveal'));
    use(g, 'pip-wanderfoot', 'pockets'); // one face-down card: claimed without asking
    expect(player(g, g.B).bids.map((b) => b.card)).toEqual([card(g, 'the-axe-of-doom')]);
    expect(player(g, g.A).bids).toHaveLength(1);
    // It was claimed while still face down: the reveal step comes after.
    expect(g.events.findIndex((e) => e.type === 'bidClaimed')).toBeLessThan(g.events.findIndex((e) => e.type === 'revealed'));
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
    // Kazra P7 + Waddle 4 = 11 against Maren P4 + Cobra 4 + a 3-point resource = 11.
    standard(g, { hero: 'kazra-emberdeep', companions: ['sergeant-waddle'], hand: [] }, { hero: 'queen-maren-ashcroft', companions: ['cobra-chicken'], hand: ['scrying-lenses'] });
    onTop(g.s, 'encounter', ['ironbound-vanguard']);
    restart(g);
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'scrying-lenses') });
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
    expect(g.s.cards[player(g, g.A).hero]).toBe('lord-paladin-aldric-ashcroft');
  });
});

describe('end of bidding', () => {
  it('Dagny wins the location outright, at the cost of the hand and the hero', () => {
    const g = newGame();
    standard(g, { companions: ['dagny-coldhearth-the-grudge-bearer', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'feathered-cap'] }, { companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    const heroBefore = player(g, g.A).hero;
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    use(g, 'dagny-coldhearth-the-grudge-bearer', 'stonetouched');
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    expect(outcome?.type === 'outcome' && outcome.result.winner).toBe(g.A);
    expect(outcome?.type === 'outcome' && outcome.result.byEffect).toBe('Dagny Coldhearth, the Grudge-Bearer');
    expect(player(g, g.A).hero).not.toBe(heroBefore);
  });

  it('Mags doubles the hero, then leaves', () => {
    const g = newGame();
    standard(g, { companions: ['mags-tolliver-market-trader', 'pell-quillon-collegium-prodigy'], hand: [] });
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    const before = total(g, g.A, g.A);
    use(g, 'mags-tolliver-market-trader', 'queen');
    expect(total(g, g.A, g.A)).toBe(before + (getDef('archmage-corvin-varro') as { stats: { P: number } }).stats.P); // Corvin's Physical doubled
    const mags = card(g, 'mags-tolliver-market-trader');
    finishTurn(g);
    expect(g.s.discards.companion).toContain(mags);
  });
});

describe('several forcing abilities in one turn', () => {
  it('Hugo and Clemence can both be used on the same turn', () => {
    const g = newGame(4);
    standard(g, { companions: ['hobart-thimblewick-moot-surgeon', 'grumma-ladlejaw-camp-cook'] });
    restart(g);
    until(g, bidFor(g.A));
    const offered = () => { const d = g.s.pending!; return d.kind === 'bid' ? d.abilities.map((a) => a.ability + '@' + a.source) : []; };
    expect(offered()).toHaveLength(2);
    use(g, 'hobart-thimblewick-moot-surgeon', 'force');
    pick(g, g.B);
    expect(g.s.pending?.kind).toBe('bid');
    expect(offered()).toHaveLength(1);
    use(g, 'grumma-ladlejaw-camp-cook', 'force');
    pick(g, g.B);
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceHeroStat')).toHaveLength(2);
  });
});

describe('Hesk and Brunna', () => {
  it('Hesk re-uses a companion\x27s once-per-turn ability exactly once more', () => {
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
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceCompanionStat')).toHaveLength(2);
  });

  it('Brunna announces that her hero shrugs off an opponent\x27s effect', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'high-thane-brunna-stonefast' });
    restart(g);
    until(g, bidFor(g.A));
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    const ev = g.events.find((e) => e.type === 'abilityIgnored');
    expect(ev && ev.type === 'abilityIgnored' && ev.player === g.B).toBe(true);
    expect(viewFor(g.s, g.A).turn.effects.find((e) => e.kind === 'forceCompanionStat')?.ignored).toBe(true);
  });
});

describe('Aldric counters abilities as they are used', () => {
  it('offers Aldric\x27s player a counter before the ability resolves; countering stops it', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'lord-paladin-aldric-ashcroft' });
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'liriel-nightbloom', 'force');
    // Aldric\x27s player is asked first, before A even picks a target.
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'counterAbility' && d.player === g.B).toBe(true);
    pick(g, 'counter');
    expect(g.events.some((e) => e.type === 'abilityCountered')).toBe(true);
    // The ability never resolved: no target prompt for A, and totals are unchanged.
    expect(g.s.pending?.kind).toBe('bid');
    expect(total(g, g.A, g.B)).toBe(before);
  });

  it('letting it resolve runs the ability as normal, and Aldric can still counter once per turn only', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] }, { hero: 'lord-paladin-aldric-ashcroft' });
    restart(g);
    until(g, bidFor(g.A));
    use(g, 'liriel-nightbloom', 'force');
    pick(g, 'allow');
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose === 'forceCompanion').toBe(true);
  });
});

describe('the opening turn', () => {
  it('drafted companions enter play, and trigger draws, only when every player has picked', () => {
    const { state } = createGame({ players: seats(2), seed: seed(1), rules: { heroDraft: 1, handModel: 'refill', fallCost: false } });
    const g: Game = { s: state, events: [], A: '', B: '' };
    const sera = card(g, 'pell-quillon-collegium-prodigy'); // a Human: Maren draws when one enters play
    give(g.s, g.s.players[g.s.turn.active]!.id, { hero: 'queen-maren-ashcroft' });
    // Rig her onto the top of the companion stack and redo the draft step.
    onTop(g.s, 'companion', ['pell-quillon-collegium-prodigy']);
    g.s.pending = null;
    g.s.tasks = [];
    for (const p of g.s.players) { delete p.used['companionDraft']; p.companions = []; }
    g.s.turn.step = 'companionDraft';
    g.s.hold = 'encounter';
    const r = resume(g.s);
    if (!r.ok) throw new Error(r.error);
    g.s = r.state;
    const first = g.s.pending!;
    if (first.kind !== 'choose') throw new Error('expected a companion draft');
    const a = first.player;
    const handBefore = player(g, a).hand.length;
    const seraOption = first.options.find((o) => o.card?.def === 'pell-quillon-collegium-prodigy')!;
    expect(seraOption).toBeTruthy();
    act(g, { type: 'choose', decision: first.id, picks: [seraOption.value, first.options.find((o) => o !== seraOption)!.value] });
    // A has picked, but B has not: nothing has entered play yet.
    const second = g.s.pending!;
    expect(second.kind === 'choose' && second.purpose).toBe('companionDraft');
    expect(second.player).not.toBe(a);
    expect(player(g, a).companions).toContain(sera);
    expect(player(g, a).hand.length).toBe(handBefore);
    g.s = finishOpeningDraft(g.s);
    expect(player(g, a).hand.length).toBeGreaterThanOrEqual(handBefore + 1);
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
    expect(ch.difficulty.base).toBe(15); // printed 13, +2 in this edition
  });

  it('Ilvena: force an opposing companion onto its weakest stat (no cost)', () => {
    const g = newGame();
    standard(g, { companions: ['elder-ilvena-of-the-conclave', 'pell-quillon-collegium-prodigy'] }, { companions: ['sergeant-waddle', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const hand = player(g, g.A).hand.length;
    use(g, 'elder-ilvena-of-the-conclave', 'ruling');
    pick(g, card(g, 'sergeant-waddle'));
    expect(player(g, g.A).hand.length).toBe(hand);
    const forced = g.s.turn.effects.find((e) => e.kind === 'forceCompanionStat')!;
    expect(forced.stat).toBe('G'); // Sergeant Waddle: P4 M3 G2
  });

  it("Aelthir draws when a Guile challenge is faced, on any turn", () => {
    const g = newGame();
    standard(g, {}, { hero: 'aelthir-moonveil' });
    onTop(g.s, 'location', ['kingsford']);
    onTop(g.s, 'encounter', ['the-deathless-captain']);
    const hand = player(g, g.B).hand.length;
    restart(g);
    until(g, bidFor(g.A));
    expect(player(g, g.B).hand.length).toBeGreaterThan(hand);
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

  it('Urzha draws whenever a minion is drawn, but not when he swaps encounters', () => {
    const g = newGame();
    standard(g, { hero: 'urzha-half-tusk' });
    onTop(g.s, 'encounter', ['the-iron-colossus', 'bone-colossus']); // draws an Ironbound minion
    onTop(g.s, 'location', ['kingsford']);
    const hand = player(g, g.A).hand.length;
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    expect(g.s.turn.minions.length).toBeGreaterThan(0);
    expect(player(g, g.A).hand.length).toBeGreaterThan(hand);
  });

  it('Iron Mites takes a companion as a minion', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'encounter', ['iron-mites']);
    onTop(g.s, 'location', ['kingsford']);
    restart(g);
    until(g, (s) => s.turn.companionMinions.length > 0 || s.turn.step === 'bidding');
    expect(g.s.turn.companionMinions).toHaveLength(1);
    // No dice: each player with a companion turned up a resource card, and those cards were discarded.
    const shown = g.events.filter((e) => e.type === 'cardShown' && e.reason === 'Iron Mites');
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const e of shown) if (e.type === 'cardShown') expect(g.s.discards.resource).toContain(e.card.id);
    const ctx = new Ctx(g.s);
    const minion = ctx.def(g.s.turn.companionMinions[0]!);
    const diff = difficultyFor(ctx, null)!;
    const stat = ctx.encounter!.stat;
    expect(diff.minions).toBe(minion.kind === 'companion' ? minion.stats[stat] : -1);
  });

  it('Vaelis sets aside an encounter and adds its minion bonus to every stat', () => {
    const g = newGame();
    standard(g, { hero: 'lord-vaelis-nightbloom' });
    onTop(g.s, 'encounter', ['ironbound-vanguard', 'bone-colossus']); // Bone Colossus minion value 4
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const before = total(g, g.A, g.A);
    use(g, 'lord-vaelis-nightbloom', 'shadowsteeds');
    expect(g.s.turn.setAside).toHaveLength(1);
    expect(total(g, g.A, g.A)).toBe(before + 4);
  });
});

describe('Pell Quillon and Tova are shown when they trigger', () => {
  it('Pell adds +2 to each resource card once two are revealed, and announces it once', () => {
    const g = newGame();
    standard(g, { companions: ['pell-quillon-collegium-prodigy', 'rosalind-marchwell-marchguard-clerk'], hand: ['honey-biscuit', 'mask-of-many-faces'] });
    restart(g);
    until(g, bidFor(g.A));
    const base = (n: number) => total(g, g.A, g.A) - n;
    const without = base(0);
    const playFirst = g.s.players.find((p) => p.id === g.A)!.hand[0]!;
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: playFirst });
    expect(g.events.filter((e) => e.type === 'abilityUsed' && e.ability === 'multiBid')).toHaveLength(0);
    until(g, bidFor(g.A));
    const second = g.s.players.find((p) => p.id === g.A)!.hand[0]!;
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: second });
    // Still bidding: the bonus waits for the reveal at the end of bidding.
    expect(totalFor(new Ctx(g.s), player(g, g.A), () => true)!.bonus).toBe(0);
    until(g, (s) => s.turn.step === 'winEndOfBidding' || s.turn.step === 'resolve');
    // Two cards are out: each is worth two more than its printed value.
    const tb = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(tb.bonus).toBe(4);
    expect(without).toBeGreaterThan(-1);
    expect(g.events.filter((e) => e.type === 'abilityUsed' && e.ability === 'multiBid')).toHaveLength(1);
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
    expect(player(g, g.A).companions).toContain(tova);
    const tovaDraw = g.events.find((e) => e.type === 'drew' && e.player === g.A && e.reason.startsWith('Tova'));
    expect(tovaDraw && tovaDraw.type === 'drew' && tovaDraw.cards.length).toBe(2);
  });

  it('Tova also returns when rested on another player\x27s turn, in a three-player game', () => {
    for (const onOwnTurn of [true, false]) {
      const g = newGame(3);
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
      expect(player(g, g.A).companions).toContain(tova);
      expect(g.events.some((e) => e.type === 'drew' && e.player === g.A && e.reason.startsWith('Tova'))).toBe(true);
    }
  });

  it('Gauntlet of Returning brings back a companion from the discard', () => {
    const g = newGame();
    standard(g, { hand: ['gauntlet-of-returning'] });
    const gnash = idOf(g.s, 'gnash-the-butcher-of-bloodmire');
    detach(g.s, gnash);
    g.s.discards.companion.push(gnash);
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'gauntlet-of-returning') });
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'gauntlet');
    pick(g, gnash);
    expect(player(g, g.A).companions).toContain(gnash);
  });

  it('The Goose & Kettle lets everyone swap a companion', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'location', ['the-goose-and-kettle']);
    restart(g);
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'waystoneDraw' && d.player === g.A);
    pick(g, 'draw');
    expect(player(g, g.A).companions).toHaveLength(3);
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'discardCompanion').toBe(true);
    act(g, { type: 'choose', decision: d.id, picks: [(d as Extract<Decision, { kind: 'choose' }>).options[0]!.value] });
    expect(player(g, g.A).companions).toHaveLength(2);
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
    const notMine = applyCommand(g.s, g.A, { type: 'ability.use', decision: g.s.pending!.id, source: player(g, g.B).hero, ability: 'requisition' });
    expect(notMine.ok).toBe(false);
  });
});

describe('hero draft: look at three, keep one', () => {
  it('opens the game: each player in turn picks from three heroes nobody else sees', () => {
    const { state } = createGame({ players: seats(3), seed: seed(4) });
    const g: Game = { s: state, events: [], A: '', B: '' };
    const picked: Record<string, string> = {};
    for (let i = 0; i < 3; i++) {
      const d = g.s.pending!;
      expect(d.kind === 'choose' && d.purpose).toBe('heroDraft');
      if (d.kind !== 'choose') return;
      expect(d.options).toHaveLength(3);
      expect(d.options.every((o) => o.card && !o.card.id)).toBe(true); // by card, never by instance id
      for (const other of g.s.players.filter((p) => p.id !== d.player)) {
        expect(viewFor(g.s, other.id).pending!.detail).toBeUndefined();
      }
      expect(viewFor(g.s, d.player).players.find((p) => p.id === d.player)!.hero).toBeNull();
      // Heroes come first: no companions or hands until everyone has chosen.
      for (const p of g.s.players) expect([p.companions.length, p.hand.length]).toEqual([0, 0]);
      picked[d.player] = d.options[1]!.value;
      act(g, { type: 'choose', decision: d.id, picks: [d.options[1]!.value] });
    }
    for (const p of g.s.players) expect(g.s.cards[p.hero]).toBe(picked[p.id]);
    // Then the companion draft: nobody is dealt companions, they pick them.
    for (const p of g.s.players) expect(p.companions).toHaveLength(0);
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose).toBe('companionDraft');
    expect(g.s.decks.hero).toHaveLength(15 - 3); // the passed-over heroes went back
    checkInvariants(g.s);
  });

  it('with the draftOnReplace rule, a fallen hero is replaced by a draft of three (never offering the fallen one)', () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort', companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'] });
    onTop(g.s, 'encounter', ['the-sundered-warden']);
    g.s.rules.heroDraft = 3;
    g.s.rules.draftOnReplace = true;
    const fallen = player(g, g.A).hero;
    restart(g);
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'heroDraft' && d.player === g.A);
    const d = g.s.pending!;
    if (d.kind !== 'choose') throw new Error('expected a draft');
    expect(d.options).toHaveLength(3);
    expect(d.options.map((o) => o.value)).not.toContain('professor-barnaby-pickwort');
    pick(g, d.options[2]!.value);
    expect(g.s.cards[player(g, g.A).hero]).toBe(d.options[2]!.value);
    expect(g.s.decks.hero).toContain(fallen);
  });

  it('by default a fallen hero is replaced by drawing one: keep it, or send it back and take the next', () => {
    for (const choice of ['keep', 'redraw'] as const) {
      const g = newGame();
      standard(g, { hero: 'professor-barnaby-pickwort', companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'] });
      onTop(g.s, 'encounter', ['the-sundered-warden']);
      g.s.rules.heroDraft = 3;
      restart(g);
      until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'heroKeep' && d.player === g.A);
      const d = g.s.pending!;
      if (d.kind !== 'choose') throw new Error('expected a choice');
      expect(d.options).toHaveLength(2);
      const offered = d.options[0]!.value;
      pick(g, choice === 'keep' ? offered : 'redraw');
      const now = g.s.cards[player(g, g.A).hero];
      if (choice === 'keep') expect(now).toBe(offered);
      else expect(now).not.toBe('professor-barnaby-pickwort');
      checkInvariants(g.s);
    }
  });

  it('everyone who fails falls at the end of that same turn, each drawing a different new hero', () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort', companions: ['tova-emberdeep-keeper-of-the-underway-door', 'pell-quillon-collegium-prodigy'] },
      { hero: 'lord-vaelis-nightbloom', companions: ['tobin-quill-goose-keeper', 'varg-ironjaw'] });
    onTop(g.s, 'encounter', ['the-sundered-warden']);
    g.s.rules.heroDraft = 3;
    const before = { A: player(g, g.A).hero, B: player(g, g.B).hero };
    restart(g);
    const answered = new Set<string>();
    until(g, (s) => s.turn.number === 2, (_s, d) => {
      if (d.kind === 'choose' && d.purpose === 'heroKeep') { answered.add(d.player); return { type: 'choose', decision: d.id, picks: [d.options[0]!.value] }; }
      return undefined;
    });
    expect([...answered].sort()).toEqual([g.A, g.B].sort());
    expect(player(g, g.A).hero).not.toBe(before.A);
    expect(player(g, g.B).hero).not.toBe(before.B);
    expect(player(g, g.A).hero).not.toBe(player(g, g.B).hero);
    expect(g.events.filter((e) => e.type === 'heroFalls')).toHaveLength(2);
    checkInvariants(g.s);
  });

  it('heroDraft 1 deals blind (v0.3)', () => {
    const { state } = createGame({ players: seats(3), seed: seed(4), rules: { heroDraft: 1 } });
    expect(state.players.every((p) => p.hero)).toBe(true);
    expect(state.pending?.kind === 'choose' && state.pending.purpose === 'heroDraft').toBe(false);
  });
});

describe('the opening companion draft', () => {
  it('starts everyone with no companions, lets them pick two of five, and skips the first-turn companion phase', () => {
    const { state } = createGame({ players: seats(3), seed: seed(7), rules: { heroDraft: 1 } });
    const g: Game = { s: state, events: [], A: '', B: '' };
    for (const p of g.s.players) expect(p.companions).toHaveLength(0);
    const picked: Record<string, string[]> = {};
    for (let i = 0; i < 3; i++) {
      const d = g.s.pending!;
      if (d.kind !== 'choose' || d.purpose !== 'companionDraft') throw new Error('expected a companion draft');
      expect(d.options).toHaveLength(5);
      expect(d.min).toBe(2);
      expect(d.max).toBe(2);
      picked[d.player] = [d.options[0]!.value, d.options[3]!.value];
      act(g, { type: 'choose', decision: d.id, picks: picked[d.player]! });
    }
    for (const p of g.s.players) expect(p.companions.map((c) => g.s.cards[c]).sort()).toEqual([...picked[p.id]!].sort());
    // No blind draw, no offer: the first decision is something else than a companion offer.
    expect(g.s.pending?.kind).not.toBe('companion.offer');
    expect(g.s.turn.number).toBe(1);
    checkInvariants(g.s);
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

describe('the opening companion draft and Ysolde', () => {
  it('gives a hero with a limit of three three slots from the same pool of five', () => {
    const { state } = createGame({ players: seats(2), seed: seed(11), rules: { heroDraft: 1 } });
    const g: Game = { s: state, events: [], A: '', B: '' };
    // Hand the first player to draft Ysolde (limit 3); the other keeps a normal hero.
    const first = g.s.players[g.s.turn.active]!;
    const ysolde = idOf(g.s, 'ysolde-of-the-wellspring');
    const swap = first.hero;
    const holder = g.s.players.find((p) => p.hero === ysolde);
    if (holder) holder.hero = swap; else for (const pile of Object.values(g.s.decks)) { const i = pile.indexOf(ysolde); if (i >= 0) pile.splice(i, 1, swap); }
    first.hero = ysolde;
    // Redo the draft step now that the hero is in place.
    g.s.pending = null;
    g.s.tasks = [];
    for (const p of g.s.players) delete p.used['companionDraft'];
    g.s.turn.step = 'companionDraft';
    g.s.hold = 'encounter';
    const r = resume(g.s);
    if (!r.ok) throw new Error(r.error);
    g.s = r.state;
    const d = g.s.pending!;
    if (d.kind !== 'choose' || d.purpose !== 'companionDraft') throw new Error('expected a companion draft');
    expect(d.player).toBe(first.id);
    expect(d.min).toBe(3);
    expect(d.max).toBe(3);
    expect(d.options).toHaveLength(5);
  });
});

describe('the companion phase: one random companion, keep it or not', () => {
  it('draws one at random, privately, and at the limit keeping it means replacing one', () => {
    const g = newGame();
    until(g, (_s, d) => d.kind === 'companion.offer');
    const offer = g.s.pending!;
    const top = g.s.decks.companion[g.s.decks.companion.length - 1]!;
    act(g, { type: 'companion.draw', decision: offer.id });
    const place = g.s.pending!;
    if (place.kind !== 'companion.place') throw new Error('expected placement');
    expect(place.drawn).toBe(top);
    expect(place.mustReplace).toBe(true);
    expect(applyCommand(g.s, place.player, { type: 'companion.keep', decision: place.id, replace: null })).toEqual({ ok: false, error: 'must_replace' });
    const old = player(g, place.player).companions[0]!;
    act(g, { type: 'companion.keep', decision: place.id, replace: old });
    expect(player(g, place.player).companions).toContain(place.drawn);
    expect(player(g, place.player).companions).not.toContain(old);
  });

  it('can be let go, and under the limit it just joins', () => {
    const g = newGame();
    until(g, (_s, d) => d.kind === 'companion.offer');
    const offer = g.s.pending!;
    const p = player(g, offer.player);
    g.s.decks.companion.push(p.companions.pop()!);
    act(g, { type: 'companion.draw', decision: offer.id });
    const place = g.s.pending!;
    expect(place.kind === 'companion.place' && place.mustReplace).toBe(false);
    act(g, { type: 'companion.discard', decision: place.id });
    expect(g.s.discards.companion).toContain((place as { drawn: string }).drawn);
  });
});

describe('house rules: falling costs', () => {
  it('a fall costs a companion chosen by the player, and no resource card', () => {
    const g = newGame(2, 1, { fallCost: true });
    // Physical 4 + 2 + 2 against the Basilisk (Physical 15): A fails and falls.
    standard(g, { companions: ['nettle-burrows-trouble-maker', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'mask-of-many-faces'] });
    onTop(g.s, 'encounter', ['basilisk']);
    restart(g);
    const n = g.s.turn.number;
    const asked: string[] = [];
    until(g, (s) => s.turn.number !== n, (_s, d) => {
      if (d.kind === 'bid') return { type: 'bid.pass', decision: d.id };
      if (d.kind !== 'choose' || d.player !== g.A) return undefined;
      if (d.purpose !== 'discardCompanion' && d.purpose !== 'discardResource') return undefined;
      asked.push(d.purpose);
      return { type: 'choose', decision: d.id, picks: [d.options[0]!.value] };
    });
    expect(asked).toEqual(['discardCompanion']);
    const a = player(g, g.A);
    expect(a.companions.length + a.inactiveCompanions.length + a.resting.length).toBe(1);
    expect(a.hand).toHaveLength(2);
    const paid = g.events.filter((e) => (e.type === 'companionDiscarded' || e.type === 'resourceDiscarded') && e.player === g.A && e.reason === 'Fallen hero');
    expect(paid.map((e) => e.type)).toEqual(['companionDiscarded']);
  });

  it('without the rule a fall only replaces the hero', () => {
    const g = newGame(2, 1, { fallCost: false });
    // Physical 4 + 2 + 2 against the Basilisk (Physical 15): A fails and falls.
    standard(g, { companions: ['nettle-burrows-trouble-maker', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'mask-of-many-faces'] });
    onTop(g.s, 'encounter', ['basilisk']);
    restart(g);
    const n = g.s.turn.number;
    until(g, (s) => s.turn.number !== n, (_s, d) => (d.kind === 'bid' ? { type: 'bid.pass', decision: d.id } : undefined));
    expect(g.events.some((e) => e.type === 'heroFalls' && e.player === g.A)).toBe(true);
    expect(player(g, g.A).companions).toHaveLength(2);
    expect(player(g, g.A).hand).toHaveLength(2);
  });
});

describe('hand model', () => {
  it('steady: the current player draws 2 and everyone else 1, never past the hand limit', () => {
    const g = newGame(3, 1, { handModel: 'steady', activeDraw: 2, othersDraw: 1, handLimit: 4 });
    standard(g, { hero: 'thorgar-twice-buried', hand: ['honey-biscuit'] }, { hand: ['feathered-cap', 'jesters-cap', 'patchwork-coat', 'sprig-of-heather'] });
    give(g.s, g.C!, { hand: ['bag-of-toffees'] });
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

describe('revised heroes (data/balance.json)', () => {
  it('Pip swaps in a random card from his hand when he has one', () => {
    const g = newGame();
    standard(g, { hand: ['honey-biscuit', 'the-axe-of-doom', 'feathered-cap'] }, { hero: 'pip-wanderfoot', hand: ['jesters-cap'] });
    onTop(g.s, 'encounter', ['wyrmkin-warband']);
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, activateFor(g.B, 'beforeReveal'));
    use(g, 'pip-wanderfoot', 'pockets');
    expect(player(g, g.B).bids.map((b) => b.card)).toContain(card(g, 'the-axe-of-doom'));
    expect(player(g, g.A).bids.map((b) => b.card)).toEqual([card(g, 'honey-biscuit'), card(g, 'jesters-cap')]);
    expect(player(g, g.B).hand).toHaveLength(0);
  });

  it('Queen Maren can requisition only on her own turn', () => {
    const g = newGame();
    standard(g, {}, { hero: 'queen-maren-ashcroft', hand: ['feathered-cap'] });
    restart(g);
    // On A's turn, B (Maren) is never offered the before-bidding requisition.
    until(g, bidFor(g.A));
    expect(g.events.some((e) => e.type === 'abilityUsed' && e.ability === 'requisition')).toBe(false);
    expect(g.s.pending?.kind).toBe('bid');
  });

  it('Brunna ignores opponents\' silences', () => {
    const g = newGame();
    standard(g, { hero: 'aelthir-moonveil' }, { hero: 'high-thane-brunna-stonefast' });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const before = total(g, g.A, g.B);
    use(g, 'aelthir-moonveil', 'torch');
    pick(g, card(g, 'sergeant-waddle'));
    expect(total(g, g.A, g.B)).toBe(before);
  });

  it('Thorgar has no flat bonus; he saves himself with a 5 instead', () => {
    const g = newGame();
    standard(g, { hero: 'thorgar-twice-buried', hand: [] });
    restart(g);
    until(g, bidFor(g.A));
    const tb = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(tb.bonus).toBe(0);
    expect(abilityOf('thorgar-twice-buried')?.failSave).toBe(5);
  });

  it('revised cards say so and carry the new stats; Kazra is unchanged', () => {
    const barnaby = getDef('professor-barnaby-pickwort');
    expect(barnaby.kind === 'hero' && barnaby.stats.P).toBe(4);
    expect(barnaby.revision).toMatch(/Physical 2/);
    expect(getDef('kazra-emberdeep').revision).toMatch(/Ironbound/);
  });
});

describe('geese, Tobin, Tansy, Sigrun and Mogra', () => {
  // The window closes (and the turn resolves) once the ability is used, so read the effect from the event log.
  const effectsOf = (g: Game) => g.events.flatMap((e) => (e.type === 'effect' && e.effect.kind === 'statBonus' ? [e.effect] : []));

  it('Honk: a card worth 3+ gives +3 Physical; either way it is discarded and Honk keeps her stats', () => {
    for (const [top, bonus] of [['hundred-year-journal', 3], ['feathered-cap', 0]] as const) {
      const g = newGame();
      standard(g, { companions: ['honk-the-goose-rout-veteran', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', [top]);
      const flipped = card(g, top);
      use(g, 'honk-the-goose-rout-veteran', 'honk');
      const bonuses = effectsOf(g);
      expect(bonuses.length).toBe(bonus ? 1 : 0);
      if (bonus) expect(bonuses[0]).toMatchObject({ stat: 'P', amount: bonus });
      expect(g.s.discards.resource).toContain(flipped);
      expect(g.events.some((e) => e.type === 'cardShown' && e.card.id === flipped)).toBe(true);
      expect(player(g, g.A).companions).toContain(card(g, 'honk-the-goose-rout-veteran'));
    }
  });

  it('Waddle needs an odd value, Duchess 4+ for +5 Guile, Cobra Chicken a Wand for +3 Guile', () => {
    const cases: [string, string, string, number, string][] = [
      ['sergeant-waddle', 'honk', 'honey-biscuit', 2, 'P'],
      ['duchess-the-pub-goose', 'hiss', 'mask-of-many-faces', 5, 'G'],
      ['cobra-chicken', 'hiss', 'willow-wand', 3, 'G'],
    ];
    for (const [goose, ability, top, amount, stat] of cases) {
      const g = newGame();
      standard(g, { companions: [goose, 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', [top]);
      use(g, goose, ability);
      expect(effectsOf(g)[0]).toMatchObject({ stat, amount });
    }
    // And a miss: an even, non-Wand card does nothing for Waddle and Cobra Chicken.
    for (const [goose, ability] of [['sergeant-waddle', 'honk'], ['cobra-chicken', 'hiss']] as const) {
      const g = newGame();
      standard(g, { companions: [goose, 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
      restart(g);
      until(g, activateFor(g.A, 'endOfBidding'));
      onTop(g.s, 'resource', ['feathered-cap']);
      use(g, goose, ability);
      expect(effectsOf(g)).toHaveLength(0);
    }
  });

  it('Tobin reveals three companions; a Goose may join and the rest are discarded', () => {
    const g = newGame();
    standard(g, { companions: ['tobin-quill-goose-keeper', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    onTop(g.s, 'companion', ['gnash-the-butcher-of-bloodmire', 'honk-the-goose-rout-veteran', 'varg-ironjaw']);
    use(g, 'tobin-quill-goose-keeper', 'flock');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'tobinPick').toBe(true);
    // Only the Goose is on offer (plus "none").
    expect((d as Extract<Decision, { kind: 'choose' }>).options.map((o) => o.value)).toEqual([card(g, 'honk-the-goose-rout-veteran'), 'none']);
    pick(g, card(g, 'honk-the-goose-rout-veteran'));
    // A is at the companion limit, so the usual discard follows: let Pell go.
    const next = g.s.pending!;
    expect(next.kind === 'choose' && next.purpose === 'discardCompanion').toBe(true);
    pick(g, card(g, 'pell-quillon-collegium-prodigy'));
    expect(player(g, g.A).companions).toEqual([card(g, 'tobin-quill-goose-keeper'), card(g, 'honk-the-goose-rout-veteran')]);
    expect(g.s.discards.companion).toEqual(expect.arrayContaining([card(g, 'gnash-the-butcher-of-bloodmire'), card(g, 'varg-ironjaw'), card(g, 'pell-quillon-collegium-prodigy')]));
    expect(g.s.turn.setAside).not.toContain(card(g, 'gnash-the-butcher-of-bloodmire'));
  });

  it('Tobin with no Goose among the three discards them all', () => {
    const g = newGame();
    standard(g, { companions: ['tobin-quill-goose-keeper', 'pell-quillon-collegium-prodigy'], hand: [] }, { companions: ['varg-ironjaw', 'kesh-the-bog-huntress'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    onTop(g.s, 'companion', ['gnash-the-butcher-of-bloodmire', 'varg-ironjaw', 'kesh-the-bog-huntress']);
    use(g, 'tobin-quill-goose-keeper', 'flock');
    expect(g.s.pending?.kind === 'choose' && g.s.pending.purpose === 'tobinPick').toBe(false);
    expect(g.s.discards.companion).toEqual(expect.arrayContaining([card(g, 'gnash-the-butcher-of-bloodmire'), card(g, 'varg-ironjaw'), card(g, 'kesh-the-bog-huntress')]));
  });

  it("Tansy draws a resource at the start of her controller's turn for every Goose in play, anyone's", () => {
    const g = newGame();
    standard(g, { companions: ['tansy-brambleby-barmaid-and-volunteer', 'honk-the-goose-rout-veteran'], hand: [] }, { companions: ['duchess-the-pub-goose', 'varg-ironjaw'] });
    restart(g);
    finishTurn(g); // A's turn 1 (triggers don't fire in the opening turn)
    finishTurn(g); // B's turn 2
    expect(g.events.filter((e) => e.type === 'drew' && e.player === g.A && /Tansy/.test(e.reason) && e.cards.length === 2)).toHaveLength(1);
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

  it('Posy and Osric gain +1 when the hero swap is used, and only then', () => {
    // Barnaby: P5 M10 G11. A Physical challenge: Mental 10 beats Physical 5, so Rosalind's swap is used and she gains +1.
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort', companions: ['rosalind-marchwell-marchguard-clerk', 'pell-quillon-collegium-prodigy'], hand: [] });
    restart(g);
    until(g, bidFor(g.A));
    const used = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(used.companions.find((c) => c.source === card(g, 'rosalind-marchwell-marchguard-clerk'))?.value).toBe(3 + 1);
    // Osric swaps Guile 5 for Physical 4: also used (+1). Guile 5 does not beat a Guile challenge, so no swap there.
    const h = newGame();
    standard(h, { hero: 'professor-barnaby-pickwort', companions: ['sir-osric-vane-marshal-of-the-old-guard', 'pell-quillon-collegium-prodigy'], hand: [] });
    restart(h);
    until(h, bidFor(h.A));
    const osric = totalFor(new Ctx(h.s), player(h, h.A), () => true)!;
    expect(osric.companions.find((c) => c.source === card(h, 'sir-osric-vane-marshal-of-the-old-guard'))?.value).toBe(4 + 1);
    const onGuile = totalFor(new Ctx(h.s), player(h, h.A), () => true, 'G')!;
    expect(onGuile.companions.find((c) => c.source === card(h, 'sir-osric-vane-marshal-of-the-old-guard'))?.value).toBe(4);
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

describe('Kin bonuses', () => {
  const heroTotal = (g: Game, who: PlayerId) => totalFor(new Ctx(g.s), player(g, who), () => true)!.hero;

  it('A: +1 to every hero stat for each companion of the hero\'s kingdom (Aldric, Human)', () => {
    const g = newGame();
    standard(g, { hero: 'lord-paladin-aldric-ashcroft', companions: ['rosalind-marchwell-marchguard-clerk', 'pell-quillon-collegium-prodigy'] });
    atBidding(g);
    const p = (getDef('lord-paladin-aldric-ashcroft') as { stats: { P: number } }).stats.P;
    expect(heroTotal(g, g.A)).toBe(p + 2); // two Humans
    g.s.players.find((x) => x.id === g.A)!.companions = [card(g, 'rosalind-marchwell-marchguard-clerk'), card(g, 'liriel-nightbloom')];
    expect(heroTotal(g, g.A)).toBe(p + 1); // an Elf does not count
  });

  it('A counts a half-breed for both of his kingdoms (Hesk is an Orc and a Human)', () => {
    for (const hero of ['lord-paladin-aldric-ashcroft', 'warchief-grukka-ironjaw']) {
      const g = newGame();
      standard(g, { hero, companions: ['hesk-of-two-homes', 'liriel-nightbloom'] });
      atBidding(g);
      const base = (getDef(hero) as { stats: { P: number } }).stats.P;
      expect(heroTotal(g, g.A)).toBe(base + 1);
    }
  });

  it('B: draw when a companion of the hero\'s kingdom enters play under any player (Maren, Human)', () => {
    const g = newGame();
    standard(g, { hero: 'queen-maren-ashcroft' }, { hero: 'thorgar-twice-buried' });
    const ctx = atBidding(g);
    const hand = player(g, g.A).hand.length;
    companionEnters(ctx, player(g, g.B), card(g, 'mags-tolliver-market-trader'), null); // a Human, entering for B
    expect(player(g, g.A).hand.length).toBe(hand + 1);
    companionEnters(ctx, player(g, g.B), card(g, 'thessaly-of-the-grove'), null); // an Elf: nothing
    expect(player(g, g.A).hand.length).toBe(hand + 1);
  });

  it('C: while an opponent controls a companion of the hero\'s kingdom it gets -1 (Vaelis, Elf)', () => {
    const g = newGame();
    standard(g, { hero: 'lord-vaelis-nightbloom' }, { companions: ['liriel-nightbloom', 'sergeant-waddle'] });
    atBidding(g); // the Silverwood Hunt: Physical
    const tb = totalFor(new Ctx(g.s), player(g, g.B), () => true)!;
    expect(tb.companions.find((c) => c.source === card(g, 'liriel-nightbloom'))?.value).toBe((getDef('liriel-nightbloom') as { stats: { P: number } }).stats.P - 1);
    expect(tb.companions.find((c) => c.source === card(g, 'sergeant-waddle'))?.value).toBe(4);
    // Her own companions are not affected.
    give(g.s, g.A, { companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] });
    expect(totalFor(new Ctx(g.s), player(g, g.A), () => true)!.companions[0]!.value).toBe((getDef('liriel-nightbloom') as { stats: { P: number } }).stats.P);
  });

  it('every hero has a Kin bonus on its card that matches the rules', async () => {
    const { KIN } = await import('./abilities');
    const { CARDS } = await import('./cards');
    for (const h of CARDS.heroes) {
      expect(KIN[h.id], h.name).toBeTruthy();
      expect(h.kinText, h.name).toContain(KIN[h.id] === 'A' ? '+1 to all stats' : KIN[h.id] === 'B' ? 'enters play, draw' : '-1 to all stats');
    }
  });
});

describe('Bonus companions (Varg and Moss, Goldie and Gimlet)', () => {
  it('a complete pair raises the companion limit by one, and the second card may be played above the limit', () => {
    const g = newGame();
    standard(g, { companions: ['varg-ironjaw', 'pell-quillon-collegium-prodigy'] });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    expect(maxCompanions(ctx, p)).toBe(2);
    expect(maxCompanions(ctx, p, card(g, 'moss-dire-wolf'))).toBe(3); // Moss would complete the pair
    expect(maxCompanions(ctx, p, card(g, 'gimlet-a-very-good-dog'))).toBe(2); // Gimlet's partner is not in play
  });

  it('under Ysolde both pairs stack: five companions', () => {
    const g = newGame();
    standard(g, { hero: 'ysolde-of-the-wellspring', companions: ['varg-ironjaw', 'moss-dire-wolf'] });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    p.companions.push(card(g, 'goldie-trickgrin-keeper-of-the-goose-and-kettle'), card(g, 'gimlet-a-very-good-dog'), card(g, 'pell-quillon-collegium-prodigy'));
    expect(maxCompanions(ctx, p)).toBe(5);
    expect(p.companions).toHaveLength(5);
  });

  it('losing half of a pair drops the party to its limit at once (the player chooses who goes)', () => {
    const g = newGame();
    standard(g, { companions: ['varg-ironjaw', 'goldie-trickgrin-keeper-of-the-goose-and-kettle'] });
    const ctx = atBidding(g);
    const p = player(g, g.A);
    p.companions.push(card(g, 'moss-dire-wolf')); // the bonus companion
    expect(p.companions).toHaveLength(3);
    // Another companion replaces Varg: the pair is broken, so three is one too many.
    companionEnters(ctx, p, card(g, 'pell-quillon-collegium-prodigy'), card(g, 'varg-ironjaw'));
    const forced = g.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardCompanion');
    expect(forced).toHaveLength(1);
    // Discarding down to the limit does not queue a second one.
    discardCompanion(ctx, p, card(g, 'moss-dire-wolf'), 'test');
    expect(g.s.tasks.filter((t) => t.t === 'choose' && t.purpose === 'discardCompanion')).toHaveLength(1);
  });

  it('Varg and Sigrun each gain +1 while the other is in the party', () => {
    const g = newGame();
    standard(g, { companions: ['varg-ironjaw', 'sigrun-stonefast-metal-singer'] });
    atBidding(g); // Physical
    const tb = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(tb.companions.find((c) => c.source === card(g, 'varg-ironjaw'))?.value).toBe(5 + 1);
    expect(tb.companions.find((c) => c.source === card(g, 'sigrun-stonefast-metal-singer'))?.value).toBe(2 + 1);
  });

  it('Gimlet gains +1 while Destiny the Frog is part of the encounter', () => {
    const g = newGame();
    standard(g, { companions: ['gimlet-a-very-good-dog', 'pell-quillon-collegium-prodigy'] });
    onTop(g.s, 'encounter', ['destiny-the-frog']);
    atBidding(g);
    const tb = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(tb.companions.find((c) => c.source === card(g, 'gimlet-a-very-good-dog'))?.value).toBe(3 + 1);
  });
});

describe('New triggers', () => {
  it('Seraphine draws when one of her controller\'s companions is replaced or discarded', () => {
    const g = newGame();
    standard(g, { hero: 'thorgar-twice-buried', companions: ['seraphine-moonveil-warden-scholar', 'pell-quillon-collegium-prodigy'] });
    const ctx = atBidding(g);
    const hand = player(g, g.A).hand.length;
    discardCompanion(ctx, player(g, g.A), card(g, 'pell-quillon-collegium-prodigy'), 'test');
    expect(player(g, g.A).hand.length).toBe(hand + 1);
    // Another player's companion leaving does nothing.
    discardCompanion(ctx, player(g, g.B), card(g, 'sergeant-waddle'), 'test');
    expect(player(g, g.A).hand.length).toBe(hand + 1);
  });

  it('Mogra draws when her controller wins a location', () => {
    const g = newGame();
    standard(g, { hero: 'professor-barnaby-pickwort', companions: ['mogra-swiftfoot-goblin-runner', 'pell-quillon-collegium-prodigy'] });
    const ctx = atBidding(g);
    const hand = player(g, g.A).hand.length;
    fire(ctx, 'locationWon', { player: g.B, margin: 3 });
    expect(player(g, g.A).hand.length).toBe(hand);
    fire(ctx, 'locationWon', { player: g.A, margin: 3 });
    expect(player(g, g.A).hand.length).toBe(hand + 1);
  });

  it('Pip draws when a location is replaced', () => {
    const g = newGame();
    standard(g, { hero: 'pip-wanderfoot' });
    const ctx = atBidding(g);
    const hand = player(g, g.A).hand.length;
    replaceLocation(ctx, ctx.s.decks.location.pop()!, 'shuffleBack', 'test');
    expect(player(g, g.A).hand.length).toBe(hand + 1);
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

  it('Aelthir draws again when a later location changes the challenge to Guile', () => {
    const g = newGame();
    standard(g, {}, { hero: 'aelthir-moonveil' });
    const ctx = atBidding(g); // Physical (The Silverwood Hunt)
    const hand = player(g, g.B).hand.length;
    replaceLocation(ctx, idOf(g.s, 'tomb-of-the-first-wardens'), 'shuffleBack', 'test');
    expect(ctx.events.some((e) => e.type === 'challengeSelected' && e.stat === 'G')).toBe(true);
    expect(player(g, g.B).hand.length).toBe(hand + 1);
  });

  it('Varg draws at the start of his controller\'s turn for each other Orc in the party', () => {
    const handAtTurnThree = (companions: string[]) => {
      const g = newGame();
      standard(g, { hero: 'professor-barnaby-pickwort', companions, hand: [] }, { hand: [] });
      restart(g);
      finishTurn(g);
      finishTurn(g); // A's second turn has begun
      return { n: player(g, g.A).hand.length, size: g.s.rules.drawSize === 'playerCount' ? 2 : g.s.rules.drawSize };
    };
    const withOrc = handAtTurnThree(['varg-ironjaw', 'gnash-the-butcher-of-bloodmire']);
    const alone = handAtTurnThree(['varg-ironjaw', 'pell-quillon-collegium-prodigy']);
    expect(withOrc.n).toBe(alone.n + 1);
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

  it('Goldie looks at a random face-down card another player has bid (shown to her player only)', () => {
    const g = newGame();
    standard(g, { companions: ['goldie-trickgrin-keeper-of-the-goose-and-kettle', 'pell-quillon-collegium-prodigy'], hand: [] }, { hand: ['the-axe-of-doom', 'feathered-cap'] });
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.pass', decision: g.s.pending!.id });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.B)); // B again after A passes
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'feathered-cap') });
    until(g, bidFor(g.A));
    use(g, 'goldie-trickgrin-keeper-of-the-goose-and-kettle', 'rumour');
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose).toBe('rumourMill');
    const view = viewFor(g.s, g.A);
    const detail = view.pending!.detail as { options: { card?: { def: string; id?: string } }[] };
    expect(detail.options[0]!.card?.def).toBeTruthy();
    expect(detail.options[0]!.card?.id).toBeUndefined();
    expect(viewFor(g.s, g.B).pending?.detail).toBeUndefined();
  });

  it('Fog of the Fey (The Hollow Hills): Goldie cannot look at face-down cards', () => {
    const g = newGame();
    standard(g, { companions: ['goldie-trickgrin-keeper-of-the-goose-and-kettle', 'pell-quillon-collegium-prodigy'], hand: [] }, { hand: ['the-axe-of-doom', 'feathered-cap'] });
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

  it('Hedda cancels the first opposing ability that would affect one of her controller\'s companions each turn', () => {
    const g = newGame();
    standard(g, { companions: ['liriel-nightbloom', 'kesh-the-bog-huntress'] }, { companions: ['marshal-hedda-ironvow', 'sergeant-waddle'] });
    restart(g);
    until(g, bidFor(g.A));
    use(g, 'liriel-nightbloom', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceCompanionStat')).toHaveLength(0);
    expect(g.events.some((e) => e.type === 'abilityIgnored')).toBe(true);
    use(g, 'kesh-the-bog-huntress', 'force');
    pick(g, card(g, 'sergeant-waddle'));
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceCompanionStat')).toHaveLength(1); // her once per turn is spent
  });

  it('Torvi: Fire in the Hole discards him and takes 4 off every opponent (5 with Mhorgrim\'s Hunt)', () => {
    for (const [hand, amount] of [[['honey-biscuit'], 4], [['mhorgrims-hunt'], 5]] as const) {
      const g = newGame();
      standard(g, { companions: ['torvi-cinderkeg-master-gunner', 'pell-quillon-collegium-prodigy'], hand: [...hand] });
      restart(g);
      until(g, bidFor(g.A));
      act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, hand[0]!) });
      until(g, activateFor(g.A, 'endOfBidding'));
      const before = total(g, g.A, g.B);
      use(g, 'torvi-cinderkeg-master-gunner', 'fire');
      expect(g.s.discards.companion).toContain(card(g, 'torvi-cinderkeg-master-gunner'));
      expect(total(g, g.A, g.B)).toBe(before - amount);
    }
  });

  it('Oskar names an opponent: if they win, they have -3 in the next encounter only', () => {
    const g = newGame();
    standard(g, { hero: 'loremaster-oskar-grimgate', companions: ['pell-quillon-collegium-prodigy'], hand: [] },
      { hero: 'warchief-grukka-ironjaw', companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    onTop(g.s, 'encounter', ['crawling-remnant']);
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    use(g, 'loremaster-oskar-grimgate', 'grudge'); // the only opponent is named without asking
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    expect(outcome?.type === 'outcome' && outcome.result.winner).toBe(g.B);
    expect(player(g, g.B).penalty).toBe(3); // B's turn: the penalty is in force
    expect(viewFor(g.s, g.A).players.find((p) => p.id === g.B)!.penalty).toBe(3);
    finishTurn(g);
    expect(player(g, g.B).penalty).toBe(0);
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
    expect(g.events.some((e) => e.type === 'bidClaimed' && e.from === g.A && e.to === g.B)).toBe(true);
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

  it('the Golden Egg counts goose encounters as well as goose companions', () => {
    const g = newGame();
    standard(g, { hand: ['the-golden-egg'] });
    onTop(g.s, 'encounter', ['the-barrow-legion']); // Gorathaxus, Goose of the Void
    restart(g);
    until(g, bidFor(g.A));
    const egg = () => viewFor(g.s, g.A).hand.find((h) => h.card.def === 'the-golden-egg')!.value;
    const geeseInPlay = [...player(g, g.A).companions, ...player(g, g.B).companions].filter((c) => getDef(g.s.cards[c]!).groups.includes('Goose')).length;
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

  it('The Runeforged Titan is Physical 18, but only 10 if the challenge is changed to Mental or Guile', () => {
    const base = (loc: string) => {
      const g = newGame();
      standard(g, {});
      onTop(g.s, 'location', [loc]);
      onTop(g.s, 'encounter', ['runeforged-titan']);
      restart(g);
      until(g, bidFor(g.A));
      return viewFor(g.s, g.A).turn.challenge!.difficulty.base;
    };
    expect(base('the-silverwood-hunt')).toBe(18); // Physical
    expect(base('the-sealed-archive')).toBe(10); // Mental
    expect(base('tomb-of-the-first-wardens')).toBe(10); // Guile
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

  it('Barrowdeep gives an Undead encounter an extra Undead minion; the capitals draw per kin companion', () => {
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
