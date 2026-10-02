// Card mechanics: one rigged scenario per ability family.

import { describe, expect, it } from 'vitest';
import { applyCommand, resume } from './commands';
import { Ctx } from './context';
import { abilityRoll } from './effects';
import { difficultyFor, totalFor } from './totals';
import { getDef } from './cards';
import { createGame } from './setup';
import type { HouseRules } from './rules';
import { checkInvariants, seats, seed } from './testUtils';
import type { CardId, Command, Decision, DeckName, GameEvent, GameState, PlayerId } from './types';
import { redactEvents, viewFor } from './view';

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
  give(g.s, g.A, { hero: 'archmage-corvin-varro', companions: ['posy-marchbank-marchguard-clerk', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit'], ...a });
  give(g.s, g.B, { hero: 'queen-maren-ashcroft', companions: ['sergeant-waddle', 'tobin-quill-goose-keeper'], hand: ['feathered-cap'], ...b });
  onTop(g.s, 'location', ['the-silverwood-hunt', 'kingsford', 'clover-hollow', 'the-hollow-between']);
  onTop(g.s, 'encounter', ['iron-beetles', 'wyrmkin-warband', 'frost-golem']);
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

  it('Hesk lets a companion ability be used twice in a turn', () => {
    const g = newGame(3);
    give(g.s, g.C!, { companions: ['cobra-chicken', 'duchess-the-pub-goose'] });
    standard(g, { hero: 'hesk-of-two-homes', companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] });
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
    onTop(g.s, 'location', ['tomb-of-the-first-wardens']); // Guile challenge; Barnaby G10 -> P2
    restart(g);
    until(g, bidFor(g.A));
    const before = total(g, g.A, g.B);
    use(g, 'brisa-blastcap-bombardier', 'force');
    // Only one opponent: a single forced option resolves without asking.
    expect(g.s.pending?.kind).toBe('bid');
    expect(total(g, g.A, g.B)).toBe(before - 6); // Barnaby G10 -> P4
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
    // Maren P6 + Tobin P3 (Waddle silenced)
    expect(total(g, g.A, g.B)).toBe(6 + 3);
  });

  it('Pip claims a face-down bid on someone else\'s turn (empty hand: no swap)', () => {
    const g = newGame();
    // A keeps a spare card so bidding is still open when we check the stolen card stays hidden.
    standard(g, { hand: ['honey-biscuit', 'the-axe-of-doom', 'feathered-cap'] }, { hero: 'pip-wanderfoot', hand: [] });
    onTop(g.s, 'encounter', ['wyrmkin-warband']); // not Ironbound, so Pip's trigger draws nothing
    restart(g);
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.A));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, bidFor(g.B));
    use(g, 'pip-wanderfoot', 'pockets'); // one face-down card: claimed without asking
    expect(player(g, g.B).bids.map((b) => b.card)).toEqual([card(g, 'the-axe-of-doom')]);
    expect(player(g, g.A).bids).toHaveLength(1);
    // Nobody but Pip (the new owner) can see the stolen card.
    expect(JSON.stringify(viewFor(g.s, g.A))).not.toContain(`"${card(g, 'the-axe-of-doom')}"`);
  });

  it('Oskar makes a revealed card count negative', () => {
    const g = newGame();
    standard(g, { companions: ['loremaster-oskar-grimgate', 'pell-quillon-collegium-prodigy'], hand: [] }, { hand: ['honey-biscuit', 'the-axe-of-doom'] });
    restart(g);
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'oskarNegate');
    pick(g, 'negate');
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    const row = outcome?.type === 'outcome' ? outcome.result.rows.find((r) => r.player === g.B) : undefined;
    // Maren P6 + Waddle P4 + Tobin P3 + biscuit 1 - axe 4
    expect(row?.total).toBe(6 + 4 + 3 + 1 - 4);
  });

  it('Oskar works on other players\x27 turns too', () => {
    const g = newGame();
    standard(g, { companions: ['loremaster-oskar-grimgate', 'pell-quillon-collegium-prodigy'], hand: [] }, { hand: ['honey-biscuit', 'the-axe-of-doom'] });
    restart(g);
    finishTurn(g); // A's turn; now B is the active player
    expect(g.s.players[g.s.turn.active]!.id).toBe(g.B);
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'honey-biscuit') });
    until(g, bidFor(g.B));
    act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, 'the-axe-of-doom') });
    const d = until(g, (_s, dd) => dd.kind === 'choose' && dd.purpose === 'oskarNegate');
    expect(d).toBe(true);
    expect(g.s.pending?.player).toBe(g.A); // Oskar's controller is asked, though it is B's turn
  });

  it('Oskar negates only once per turn', () => {
    const g = newGame();
    standard(g, { companions: ['loremaster-oskar-grimgate', 'pell-quillon-collegium-prodigy'], hand: [] },
      { hand: ['honey-biscuit', 'the-axe-of-doom', 'mask-of-many-faces'] });
    restart(g);
    for (const c of ['honey-biscuit', 'the-axe-of-doom', 'mask-of-many-faces']) {
      until(g, bidFor(g.B));
      act(g, { type: 'bid.play', decision: g.s.pending!.id, card: card(g, c) });
    }
    // Two face-down cards get revealed; Oskar is offered (and takes) only the first.
    const n = g.s.turn.number;
    let offers = 0;
    until(g, (s) => s.turn.number !== n, (_s, d) => {
      if (d.kind !== 'choose' || d.purpose !== 'oskarNegate') return undefined;
      offers++;
      return { type: 'choose', decision: d.id, picks: ['negate'] };
    });
    expect(offers).toBe(1);
    expect(g.events.filter((e) => e.type === 'abilityUsed' && e.ability === 'negate')).toHaveLength(1);
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

  it('Wren can bottom the next location', () => {
    const g = newGame();
    standard(g, { companions: ['wren-nightingale-relic-hunter', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    // turn 1's location was already drawn? No: turnStart window comes before the location.
    until(g, activateFor(g.A, 'turnStart'));
    use(g, 'wren-nightingale-relic-hunter', 'readAhead');
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
  it('Mira wins the location outright, at the cost of the hand and the hero', () => {
    const g = newGame();
    standard(g, { companions: ['mira-coldwater-the-stonetouched', 'pell-quillon-collegium-prodigy'], hand: ['honey-biscuit', 'feathered-cap'] }, { companions: ['gnash-the-butcher-of-bloodmire', 'kesh-the-bog-huntress'] });
    const heroBefore = player(g, g.A).hero;
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    use(g, 'mira-coldwater-the-stonetouched', 'stonetouched');
    finishTurn(g);
    const outcome = g.events.find((e) => e.type === 'outcome');
    expect(outcome?.type === 'outcome' && outcome.result.winner).toBe(g.A);
    expect(outcome?.type === 'outcome' && outcome.result.byEffect).toBe('Mira Coldwater, the Stonetouched');
    expect(player(g, g.A).hero).not.toBe(heroBefore);
  });

  it('Mags doubles the hero, then leaves', () => {
    const g = newGame();
    standard(g, { companions: ['mags-tolliver-market-trader', 'pell-quillon-collegium-prodigy'], hand: [] });
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    const before = total(g, g.A, g.A);
    use(g, 'mags-tolliver-market-trader', 'queen');
    expect(total(g, g.A, g.A)).toBe(before + 4); // Corvin P4 doubled
    const mags = card(g, 'mags-tolliver-market-trader');
    finishTurn(g);
    expect(g.s.discards.companion).toContain(mags);
  });

  it('a goose rolls: +3 Physical or sits the turn out', () => {
    const g = newGame();
    standard(g, { companions: ['cobra-chicken', 'pell-quillon-collegium-prodigy'], hand: [] });
    restart(g);
    until(g, activateFor(g.A, 'endOfBidding'));
    use(g, 'cobra-chicken', 'honk');
    const kinds = g.s.turn.effects.map((e) => e.kind);
    expect(kinds.includes('statBonus') || kinds.includes('silenceCompanion')).toBe(true);
  });
});

describe('several forcing abilities in one turn', () => {
  it('Hugo and Clemence can both be used on the same turn', () => {
    const g = newGame(4);
    standard(g, { companions: ['sir-hugo-pellam-marchguard-surgeon', 'clemence-fairbrook-temple-cook'] });
    restart(g);
    until(g, bidFor(g.A));
    const offered = () => { const d = g.s.pending!; return d.kind === 'bid' ? d.abilities.map((a) => a.ability + '@' + a.source) : []; };
    expect(offered()).toHaveLength(2);
    use(g, 'sir-hugo-pellam-marchguard-surgeon', 'force');
    pick(g, g.B);
    expect(g.s.pending?.kind).toBe('bid');
    expect(offered()).toHaveLength(1);
    use(g, 'clemence-fairbrook-temple-cook', 'force');
    pick(g, g.B);
    expect(g.s.turn.effects.filter((e) => e.kind === 'forceHeroStat')).toHaveLength(2);
  });
});

describe('Hesk and Brunna', () => {
  it('Hesk re-uses a companion\x27s once-per-turn ability exactly once more', () => {
    const g = newGame();
    standard(g, { hero: 'hesk-of-two-homes', companions: ['liriel-nightbloom', 'pell-quillon-collegium-prodigy'] });
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
  it('drafted companions enter play, and draw, only when every player has picked', () => {
    const { state } = createGame({ players: seats(2), seed: seed(1), rules: { heroDraft: 1, handModel: 'refill', fallCost: false } });
    const g: Game = { s: state, events: [], A: '', B: '' };
    const sera = card(g, 'seraphine-moonveil-warden-scholar'); // draws 2 when she enters play
    // Rig her onto the top of the companion stack and redo the draft step.
    onTop(g.s, 'companion', ['seraphine-moonveil-warden-scholar']);
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
    const seraOption = first.options.find((o) => o.card?.def === 'seraphine-moonveil-warden-scholar')!;
    expect(seraOption).toBeTruthy();
    act(g, { type: 'choose', decision: first.id, picks: [seraOption.value, first.options.find((o) => o !== seraOption)!.value] });
    // A has picked, but B has not: nothing has entered play yet.
    const second = g.s.pending!;
    expect(second.kind === 'choose' && second.purpose).toBe('companionDraft');
    expect(second.player).not.toBe(a);
    expect(player(g, a).companions).toContain(sera);
    expect(player(g, a).hand.length).toBe(handBefore);
    g.s = finishOpeningDraft(g.s);
    expect(player(g, a).hand.length).toBeGreaterThanOrEqual(handBefore + 2);
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
    expect(g.events.some((e) => e.type === 'dieRolled')).toBe(false);
  });

  it('Ilvena: pay a resource to force an opposing companion onto its weakest stat', () => {
    const g = newGame();
    standard(g, { companions: ['elder-ilvena-of-the-conclave', 'pell-quillon-collegium-prodigy'] }, { companions: ['sergeant-waddle', 'pell-quillon-collegium-prodigy'] });
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const hand = player(g, g.A).hand.length;
    use(g, 'elder-ilvena-of-the-conclave', 'ruling');
    const paid = player(g, g.A).hand[0]!;
    pick(g, paid);
    pick(g, card(g, 'sergeant-waddle'));
    expect(player(g, g.A).hand.length).toBe(hand - 1);
    expect(player(g, g.A).hand.includes(paid)).toBe(false);
    const forced = g.s.turn.effects.find((e) => e.kind === 'forceCompanionStat')!;
    expect(forced.stat).toBe('G'); // Sergeant Waddle: P4 M3 G2
  });

  it("Aelthir draws when a Guile challenge is faced on another player's turn only", () => {
    const g = newGame();
    standard(g, {}, { hero: 'aelthir-moonveil' });
    onTop(g.s, 'location', ['kingsford']);
    onTop(g.s, 'encounter', ['the-deathless-captain']);
    const hand = player(g, g.B).hand.length;
    restart(g);
    until(g, bidFor(g.A));
    expect(player(g, g.B).hand.length).toBeGreaterThan(hand);
  });

  it('Urzha replaces the encounter (no roll), once per turn', () => {
    const g = newGame();
    standard(g, { hero: 'urzha-half-tusk' });
    restart(g);
    until(g, bidFor(g.A));
    const before = g.s.turn.encounter;
    use(g, 'urzha-half-tusk', 'notThisFight');
    expect(g.s.turn.encounter).not.toBe(before);
    expect(viewFor(g.s, g.A).turn.challenge).not.toBeNull();
    expect(g.events.some((e) => e.type === 'encounterReplaced')).toBe(true);
    const d = g.s.pending!;
    expect(d.kind === 'bid' && d.abilities.some((a) => a.ability === 'notThisFight')).toBe(false);
  });

  it('Iron Mites takes a companion as a minion', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'encounter', ['iron-mites']);
    onTop(g.s, 'location', ['kingsford']);
    restart(g);
    until(g, (s) => s.turn.companionMinions.length > 0 || s.turn.step === 'bidding');
    expect(g.s.turn.companionMinions).toHaveLength(1);
    const ctx = new Ctx(g.s);
    const minion = ctx.def(g.s.turn.companionMinions[0]!);
    const diff = difficultyFor(ctx, null)!;
    const stat = ctx.encounter!.stat;
    expect(diff.minions).toBe(minion.kind === 'companion' ? minion.stats[stat] : -1);
  });

  it('Vaelis sets aside an encounter and adds its minion bonus to every stat', () => {
    const g = newGame();
    standard(g, { hero: 'lord-vaelis-nightbloom' });
    onTop(g.s, 'encounter', ['iron-beetles', 'bone-colossus']); // Bone Colossus minion value 4
    restart(g);
    until(g, activateFor(g.A, 'beforeBidding'));
    const before = total(g, g.A, g.A);
    use(g, 'lord-vaelis-nightbloom', 'shadowsteeds');
    expect(g.s.turn.setAside).toHaveLength(1);
    expect(total(g, g.A, g.A)).toBe(before + 4);
  });
});

describe('dice modifiers', () => {
  it('The Hollow Hills invert ability rolls; Mogra keeps the better of two on her turn', () => {
    const g = newGame();
    standard(g, { companions: ['mogra-swiftfoot-goblin-runner', 'pell-quillon-collegium-prodigy'] });
    onTop(g.s, 'location', ['the-hollow-hills']);
    restart(g);
    until(g, bidFor(g.A));
    const ctx = new Ctx(g.s);
    const v = abilityRoll(ctx, g.A, 'high');
    const rolls = ctx.events.filter((e) => e.type === 'dieRolled').map((e) => (e.type === 'dieRolled' ? e.value : 0));
    expect(rolls).toHaveLength(2);
    expect(v).toBe(Math.max(...rolls.map((r) => 7 - r)));
  });
});

describe('Pell Quillon and Tova are shown when they trigger', () => {
  it('Pell adds +1 to each resource card once two are confirmed, and announces it once', () => {
    const g = newGame();
    standard(g, { companions: ['pell-quillon-collegium-prodigy', 'posy-marchbank-marchguard-clerk'], hand: ['honey-biscuit', 'mask-of-many-faces'] });
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
    until(g, (s) => s.turn.step === 'winEndOfBidding' || s.turn.step === 'resolve');
    // Two cards are out: each is worth one more than its printed value.
    const tb = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(tb.bonus).toBe(2);
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

  it('The Waystone Inn lets everyone swap a companion', () => {
    const g = newGame();
    standard(g, {});
    onTop(g.s, 'location', ['the-waystone-inn-rivermeet']);
    restart(g);
    until(g, (_s, d) => d.kind === 'choose' && d.purpose === 'waystoneDraw' && d.player === g.A);
    pick(g, 'draw');
    expect(player(g, g.A).companions).toHaveLength(3);
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'discardCompanion').toBe(true);
    act(g, { type: 'choose', decision: d.id, picks: [(d as Extract<Decision, { kind: 'choose' }>).options[0]!.value] });
    expect(player(g, g.A).companions).toHaveLength(2);
  });

  it('Sigrun may draw from the discard pile', () => {
    const g = newGame();
    standard(g, { companions: ['sigrun-stonefast-metal-singer', 'pell-quillon-collegium-prodigy'], hand: [] });
    const cap = idOf(g.s, 'jesters-cap');
    detach(g.s, cap);
    g.s.discards.resource.push(cap);
    restart(g);
    const d = g.s.pending!;
    expect(d.kind === 'choose' && d.purpose === 'sigrunDraw').toBe(true);
    pick(g, 'discard');
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

describe('the companion phase: draw three, pick one', () => {
  it('shows the three only to the player drawing, and a pick must be exactly one', () => {
    const g = newGame();
    until(g, (_s, d) => d.kind === 'companion.offer');
    const offer = g.s.pending!;
    const deckBefore = g.s.decks.companion.length;
    act(g, { type: 'companion.draw', decision: offer.id });
    const d = g.s.pending!;
    if (d.kind !== 'choose' || d.purpose !== 'companionPick') throw new Error('expected a companion pick');
    expect(d.options).toHaveLength(3);
    expect([d.min, d.max]).toEqual([1, 1]);
    for (const p of g.s.players.filter((x) => x.id !== d.player)) expect(viewFor(g.s, p.id).pending!.detail).toBeUndefined();
    expect(applyCommand(g.s, d.player, { type: 'choose', decision: d.id, picks: [] })).toEqual({ ok: false, error: 'bad_pick_count' });
    act(g, { type: 'choose', decision: d.id, picks: [d.options[1]!.value] });
    // The pick is recruited (the other two went back); at the limit it replaces one.
    const place = g.s.pending!;
    if (place.kind !== 'companion.place') throw new Error('expected placement');
    expect(g.s.cards[place.drawn]).toBe(d.options[1]!.value);
    expect(place.mustReplace).toBe(true);
    expect(g.s.decks.companion).toHaveLength(deckBefore - 1);
    const old = player(g, place.player).companions[0]!;
    act(g, { type: 'companion.keep', decision: place.id, replace: old });
    expect(player(g, place.player).companions).toContain(place.drawn);
    expect(player(g, place.player).companions).not.toContain(old);
  });

  it('under the limit, the pick just joins', () => {
    const g = newGame();
    until(g, (_s, d) => d.kind === 'companion.offer');
    const offer = g.s.pending!;
    const p = player(g, offer.player);
    g.s.decks.companion.push(p.companions.pop()!);
    act(g, { type: 'companion.draw', decision: offer.id });
    const d = g.s.pending!;
    if (d.kind !== 'choose') throw new Error('expected a pick');
    act(g, { type: 'choose', decision: d.id, picks: [d.options[0]!.value] });
    const place = g.s.pending!;
    expect(place.kind === 'companion.place' && place.mustReplace).toBe(false);
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
    standard(g, { hero: 'thorgar-twice-buried', hand: ['honey-biscuit'] }, { hand: ['feathered-cap', 'jesters-cap', 'tin-whistle', 'sprig-of-heather'] });
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
    until(g, bidFor(g.B));
    use(g, 'pip-wanderfoot', 'pockets');
    expect(player(g, g.B).bids.map((b) => b.card)).toContain(card(g, 'the-axe-of-doom'));
    expect(player(g, g.A).bids.map((b) => b.card)).toEqual([card(g, 'honey-biscuit'), card(g, 'jesters-cap')]);
    expect(player(g, g.A).bids[1]!.visible).toBe(false);
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

  it('Thorgar gains 1 to his total', () => {
    const g = newGame();
    standard(g, { hero: 'thorgar-twice-buried', hand: [] });
    restart(g);
    until(g, bidFor(g.A));
    const tb = totalFor(new Ctx(g.s), player(g, g.A), () => true)!;
    expect(tb.bonus).toBe(1);
    expect(tb.total).toBe(tb.hero + tb.companions.reduce((a, c) => a + c.value, 0) + 1);
  });

  it('revised cards say so and carry the new stats; Kazra is unchanged', () => {
    const barnaby = getDef('professor-barnaby-pickwort');
    expect(barnaby.kind === 'hero' && barnaby.stats.P).toBe(4);
    expect(barnaby.revision).toMatch(/Physical 2/);
    expect(getDef('kazra-emberdeep').revision).toBeUndefined();
  });
});
