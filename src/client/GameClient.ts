// Client controller: consumes ServerMessages from a transport and presents
// them (board animation, dice, banners, log) one at a time, in order.
// It only ever sees redacted views; it sends intents and lets the host decide.

import { getDef, STAT_NAMES, type ClientEvent, type Command, type DeckName, type GameView, type PlayerId } from '../engine';
import type { ClientTransport, ServerMessage } from '../net/protocol';
import { Board } from './render/Board';
import { TableScene } from './render/TableScene';
import { describe, nameOf } from './describe';
import { attentionOf } from './attention';
import { Hud } from './ui/Hud';
import { Die, DIE_POS } from './render/Dice';
import { music } from './audio/Music';
import { sfx, type SfxName } from './audio/Sfx';
import { THEME_SOUND, themeForAbility, type Theme } from './ui/themes';
import { isTouch, syncBodyClasses } from './viewport';

const ERROR_TEXT: Record<string, string> = {
  stale_decision: 'That choice was already made.',
  not_your_decision: "It isn't your decision.",
  paused: 'One moment…',
  rate_limited: 'Slow down a little.',
};

/**
 * Events that can be part of what an ability just did. Right after an
 * opponent's ability they're added to its announcement; anything else ends it.
 */
function isAbilityResult(e: ClientEvent, by: PlayerId): boolean {
  switch (e.type) {
    case 'effect': case 'effectCancelled': case 'abilityIgnored': case 'abilityZap': case 'ability': case 'bidClaimed': case 'bidsSwapped': case 'cardsTraded':
    case 'cardShown': case 'peeked': case 'bottomed': case 'locationReplaced': case 'encounterReplaced':
    case 'companionFaceDown': case 'companionDiscarded': case 'companionMinion': case 'resourceDiscarded':
    case 'councilHero': case 'extraLocation': case 'fallPrevented':
      return true;
    case 'dieRolled': return e.reason === 'ability' || e.reason === 'effect';
    case 'drew': return e.player === by;
    default: return false;
  }
}

const DECK_INFO: Record<DeckName, { name: string; text: string }> = {
  hero: { name: 'Hero Deck', text: 'Heroes to draft at the start, and to take up when your hero falls.' },
  companion: { name: 'Companion Deck', text: 'Allies you can draw blind to join your party.' },
  location: { name: 'Location Deck', text: 'The places the players compete to claim each turn.' },
  encounter: { name: 'Encounter Deck', text: 'Contains cards that define the monsters and challenges you face.' },
  resource: { name: 'Resource Deck', text: 'The cards you draw and bid to win locations.' },
};

/** What to say about a deck or discard pile the mouse is over. */
function deckInfo(deck: DeckName, discard: boolean, view: GameView): { name: string; text: string; count: number } {
  const d = DECK_INFO[deck];
  return discard
    ? { name: d.name.replace(' Deck', ' Discard Pile'), text: 'Cards that have been used, discarded or set aside.', count: view.discards[deck].count }
    : { ...d, count: view.decks[deck] };
}

/** Hostile effects currently on table cards: card id -> what is happening to it and who did it. */
function afflictionsOf(view: GameView): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (card: string | undefined, line: string) => { if (card) out.set(card, [...(out.get(card) ?? []), line]); };
  for (const e of view.turn.effects) {
    if (!e.active || e.ignored || e.owner === e.targetPlayer) continue; // only things done to someone by someone else
    const by = `by ${nameOf(view, e.owner)}'s ${getDef(e.source.def).name}`;
    const stat = e.stat && e.stat !== 'all' ? STAT_NAMES[e.stat] : '';
    switch (e.kind) {
      case 'silenceCompanion': add(e.targetCard?.id, `Silenced: contributes nothing ${by}`); break;
      case 'forceCompanionStat': add(e.targetCard?.id, `Forced to use ${stat} ${by}`); break;
      case 'forceHeroStat': add(view.players.find((p) => p.id === e.targetPlayer)?.hero?.id, `Forced to use ${stat} ${by}`); break;
      case 'negateBid': add(e.targetCard?.id, `Counts as zero ${by}`); break;
      case 'disableAbilities': add(e.targetCard?.id, `Abilities disabled ${by}`); break;
      default: break;
    }
  }
  return out;
}

/** The players an ability's result event lands on. */
function targetsOf(e: ClientEvent): PlayerId[] {
  switch (e.type) {
    case 'effect': return e.targetPlayer ? [e.targetPlayer] : [];
    case 'bidClaimed': return [e.from];
    case 'bidsSwapped': return [e.b];
    case 'cardsTraded': return [e.to];
    default: return [];
  }
}

/** The player a table card belongs to (hero, companions or face-up bids). */
function ownerOfCard(view: GameView, cardId: string): PlayerId | null {
  return view.players.find((p) => p.hero?.id === cardId || p.companions.some((c) => c.id === cardId)
    || p.inactiveCompanions.some((c) => c.id === cardId) || p.resting.some((c) => c.id === cardId)
    || p.bids.some((b) => !b.hidden && b.card.id === cardId))?.id ?? null;
}

/** "Perrin's Liriel Nightbloom" / "your Liriel Nightbloom" / "Liriel Nightbloom". */
function whoseCard(view: GameView, card: { id?: string; def: string }): string {
  const owner = card.id ? ownerOfCard(view, card.id) : null;
  const name = getDef(card.def).name;
  return owner === view.you ? `your ${name}` : owner ? `${nameOf(view, owner)}'s ${name}` : name;
}

/** Sabotage aimed at you by someone else, with who did it and the card behind it. */
function againstYou(e: ClientEvent, view: GameView): { by: PlayerId; card: string | null } | null {
  switch (e.type) {
    case 'effect': return e.targetPlayer === view.you && e.effect.owner !== view.you ? { by: e.effect.owner, card: e.source.def } : null;
    case 'bidClaimed': return e.from === view.you ? { by: e.to, card: null } : null;
    case 'bidsSwapped': return e.b === view.you ? { by: e.a, card: e.aCard.def } : null;
    case 'cardsTraded': return e.to === view.you ? { by: e.from, card: null } : null;
    default: return null;
  }
}

export class GameClient {
  private view: GameView | null = null;
  private readonly queue: ServerMessage[] = [];
  private pumping = false;
  private readonly scene: TableScene;
  private readonly board: Board;
  private readonly hud: Hud;
  private readonly die: Die;
  private readonly unhook: (() => void)[] = [];
  private disposed = false;
  /** The opponent whose ability is being announced, while its results are still arriving. */
  private announcing: PlayerId | null = null;
  /** Whether the hero-selection music was last asked for (changes only at phase boundaries, so a manual skip sticks). */
  private openingMusic: boolean | null = null;
  /** What has been done to each table card this turn (card id -> lines), for the outline and its tooltip. */
  private afflictions = new Map<string, string[]>();
  /** Ready abilities already chimed for (turn:card:ability), so repeated bid decisions don't nag. */
  private readySeen = new Set<string>();
  /** Abilities the player skipped (turn:card:ability:window): no glow for that window, but later windows still offer them. */
  private skipped = new Set<string>();
  /** The table card under the pointer, if any. */
  private hoverKey: string | null = null;
  /** Animations still playing; an announcement waits for them so it appears after the zap. */
  private anims: Promise<void>[] = [];
  /** The card whose ability was used most recently (what a later "looked at a stack" zaps from). */
  private lastAbilityCard: string | null = null;
  /** Open until the ability being presented has been shown and dismissed; its zaps wait for it. */
  private caseGate: { promise: Promise<void>; resolve: () => void } | null = null;
  /** An ability being put together: shown large (once its results are in) before it zaps. */
  private pendingCase: {
    key: string; def: string; owner: PlayerId; ownerName: string; label: string; targets: Set<PlayerId>; lines: string[]; you: PlayerId | null;
    title?: string; subtitle?: string;
    /** Your own ability: shown only if it turns out to answer someone else's (`response`). */
    onlyIfResponse?: boolean;
    response?: boolean;
    theme: Theme;
    /** A die rolled by this ability (its result is shown, and the table waits for it to be read). */
    roll?: number;
  } | null = null;
  /** The die that an ability is rolling, until it has landed and been looked at. */
  private dieAnim: Promise<void> | null = null;
  /** Where each hand card was just before the hand was redrawn (for cards that leave it). */
  private handSnap = new Map<string, { x: number; y: number; w: number; def: string }>();

  constructor(stage: HTMLElement, overlay: HTMLElement, private readonly transport: ClientTransport, onNewGame: () => void) {
    // Set the shape classes first: CSS sizes the stage from them before the scene measures it.
    const shape = syncBodyClasses();
    this.scene = new TableScene(stage);
    this.board = new Board(this.scene);
    this.board.shape = shape;
    window.addEventListener('resize', this.onResize);
    this.unhook.push(() => window.removeEventListener('resize', this.onResize));
    this.hud = new Hud(overlay, {
      send: (cmd) => this.send(cmd),
      skipAbility: (cardId, ability) => this.skipAbility(cardId, ability),
      newGame: onNewGame,
      project: (x, y, z) => this.scene.project(x, y, z),
    });
    this.unhook.push(this.scene.onFrame(() => this.hud.reposition()));
    this.die = new Die(this.scene, DIE_POS);
    // A card you bid flies down from where it sits in your hand.
    this.board.handOrigin = (def) => this.hud.handCardCenter(def);
    this.bindPointer(stage);
    transport.onMessage((m) => {
      this.queue.push(m);
      void this.pump();
    });
  }

  private lastSentDecision = 0;

  private send(cmd: Command): void {
    // One answer per decision: ignore double-clicks while the host responds.
    if (cmd.decision <= this.lastSentDecision) return;
    this.lastSentDecision = cmd.decision;
    this.transport.send({ t: 'cmd', cmd });
  }

  /** Rotating a phone or resizing a window can change the table's shape. */
  private readonly onResize = (): void => {
    const shape = syncBodyClasses();
    if (shape === this.board.shape) return;
    this.board.shape = shape;
    if (!this.view) return;
    void this.board.update(this.view, this.view);
    this.scene.setView(shape, this.board.layout!.frame);
    this.hud.render(this.view, this.board.layout!);
  };

  private bindPointer(stage: HTMLElement): void {
    const canvas = this.scene.renderer.domElement;
    // Mouse and pen: hovering previews a card, clicking pins it (click again to unpin).
    // Touch: tapping pins it, tapping it again or tapping empty table closes it.
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const hit = this.scene.pick(e.clientX, e.clientY, [...this.board.meshes(), ...this.board.stackMeshes()]);
      const stack = hit?.object.userData['stack'] as { deck: DeckName; discard: boolean } | undefined;
      const card = this.board.setHovered(stack ? null : hit?.object ?? null);
      this.hoverKey = card?.key ?? null;
      this.hud.inspect(card?.def ?? null);
      const afflicted = card ? this.afflictions.get(card.key) : undefined;
      const tip = stack && this.view ? deckInfo(stack.deck, stack.discard, this.view)
        : card && afflicted ? { name: card.def ? getDef(card.def).name : 'Card', lines: afflicted } : null;
      this.hud.deckTip(tip, e.clientX, e.clientY);
      canvas.style.cursor = card?.def ? 'zoom-in' : 'default';
    };
    const click = (e: PointerEvent) => {
      const hit = this.scene.pick(e.clientX, e.clientY, this.board.meshes());
      const card = this.board.setHovered(hit?.object ?? null);
      this.hud.openCard(card?.def ?? null, card?.key ?? null);
    };
    const leave = () => { this.board.setHovered(null); this.hoverKey = null; this.hud.inspect(null); this.hud.deckTip(null); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', click);
    canvas.addEventListener('pointerleave', leave);
    void stage;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.disposed) {
        const m = this.queue.shift()!;
        // Don't move on while an opponent's ability message is still open.
        await this.hud.noticesClosed();
        if (m.t === 'state') {
          // Drop out-of-order snapshots.
          if (this.view && m.view.version < this.view.version) continue;
          await this.present(m.view, m.events);
        } else if (m.t === 'error') {
          this.hud.banner(ERROR_TEXT[m.code] ?? `Rejected: ${m.code}`, 'warn', 1400);
          // Allow answering the current decision again after a resync.
          this.lastSentDecision = 0;
          this.transport.send({ t: 'sync' });
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Cards that can act now glow, wiggle and chime (once per ability per turn).
   *
   * Nothing times out: the window waits until the player uses the ability (OK on the card) or skips it
   * (Skip on the card, or "Not now" in the dock). When every ability on offer has been skipped, the window
   * is answered for the player.
   */
  private signalReadyAbilities(view: GameView): void {
    const all = attentionOf(view);
    const pending = view.pending;
    const ready = all.filter((a) => !this.skipped.has(this.skipKey(view, a)));
    if (pending?.detail?.kind === 'activate' && ready.length === 0 && all.length > 0) {
      const decision = pending.id;
      queueMicrotask(() => { if (!this.disposed) this.send({ type: 'ability.done', decision }); });
    }
    this.board.setAttention(new Set(ready.map((a) => a.cardId)));
    this.board.setAttentionDeadline(null);
    document.body.dataset['abilityReady'] = ready.length ? ready.map((a) => a.cardId).join(',') : ''; // for tests and styling
    let fresh = false;
    for (const a of ready) {
      const k = `${view.turn.number}:${a.cardId}:${a.ability}`;
      if (!this.readySeen.has(k)) { this.readySeen.add(k); fresh = true; }
    }
    if (fresh) sfx.play('ability-ready');
  }

  /** The skip is per window (or per bid decision), so an ability skipped now is still offered at its next window. */
  private skipKey(view: GameView, a: { cardId: string; ability: string }): string {
    const d = view.pending?.detail;
    const scope = d?.kind === 'activate' ? d.window : `bid${view.pending?.id ?? 0}`;
    return `${view.turn.number}:${a.cardId}:${a.ability}:${scope}`;
  }

  /** The Skip button on a card: stop offering this ability in this window. */
  private skipAbility(cardId: string, ability: string): void {
    const view = this.view;
    if (!view) return;
    const a = attentionOf(view).find((x) => x.cardId === cardId && x.ability === ability);
    if (!a) return;
    this.skipped.add(this.skipKey(view, a));
    this.signalReadyAbilities(view);
  }

  private async present(view: GameView, events: ClientEvent[]): Promise<void> {
    const prev = this.view;
    this.view = view;
    this.handSnap = this.hud.snapshotHand();
    // Board first, so newly revealed cards are on the table before we talk about them.
    const boardDone = this.board.update(view, prev);
    this.afflictions = afflictionsOf(view);
    this.board.setAfflicted(new Set(this.afflictions.keys()));
    this.scene.setView(this.board.layout!.shape, this.board.layout!.frame);
    const opening = view.turn.number === 0 || (view.turn.number === 1 && (view.turn.step === 'turnStart' || view.turn.step === 'companions' || view.turn.step === 'draft'));
    if (opening !== this.openingMusic) {
      this.openingMusic = opening;
      music.setOpening(opening);
    }
    this.hud.holdCounter(true);
    this.hud.render(view, this.board.layout!);
    this.signalReadyAbilities(view);
    for (const e of events) {
      const text = describe(e, view);
      const flashed = this.flashAbility(e);
      const cls = e.type === 'turnStarted' ? 'turn' : e.type === 'outcome' || e.type === 'renownGained' ? 'big' : '';
      if (text) this.hud.log(text, flashed ? `${cls} flash`.trim() : cls);
      // The announcement first: it may open a case whose zaps must wait until it has been shown.
      const announced = await this.announce(e, text, view);
      this.attackFor(e, view);
      this.motionFor(e, view);
      this.soundFor(e, view);
      if (announced) continue;
      switch (e.type) {
        case 'turnStarted':
          this.die.hide();
          // Other players' turns show in the top bar and on their plate; yours gets a banner.
          if (e.player === view.you) this.hud.banner('Your turn', 'turn');
          break;
        case 'encounterRevealed':
          break;
        case 'dieRolled':
          this.hud.banner(`${nameOf(view, e.player)} rolls ${e.value}`, '', 900);
          break;
        case 'challengeSelected':
          this.hud.banner(`${STAT_NAMES[e.stat]} ${e.difficulty}`, 'challenge');
          break;
        case 'outcome':
          this.hud.showResult(e.result, view);
          break;
        case 'abilityCountered':
          this.hud.banner(`${getDef(e.source.def).name} countered by ${getDef(e.by.def).name}!`, 'warn', 2200);
          break;
        case 'heroChanged':
          if (e.reason === 'fell') this.hud.banner(`${nameOf(view, e.player)}: a new hero takes up the banner`, 'warn');
          break;
        case 'gameOver':
          this.hud.banner(`${nameOf(view, e.winner)} ${e.winner === view.you ? 'win' : 'wins'}!`, 'big', 3000);
          break;
      }
    }
    // A finished ability is shown large, then zaps. One still waiting on its target choice stays open until that is made.
    const det = view.pending?.detail;
    const waiting = view.pending?.kind === 'choose' && !(det?.kind === 'choose' && det.purpose === 'counterAbility');
    if (!waiting) await this.flushCase();
    this.hud.holdCounter(false);
    await boardDone;
  }

  /**
   * An ability landing on another player's card: a bolt from the source card into the
   * target, both cards shake, the phone buzzes and a sound plays (one set for things
   * done to someone, one for boons).
   */
  private attackFor(e: ClientEvent, view: GameView): void {
    const heroOf = (pid: PlayerId | null): string | null => view.players.find((p) => p.id === pid)?.hero?.id ?? null;
    let from: string | null = null;
    let to: string | null = null;
    let theme: Theme = 'hex';
    let at: PlayerId | null = null; // who it lands on
    switch (e.type) {
      case 'effect': {
        at = e.targetPlayer;
        from = this.board.hasCard(e.source.id) ? e.source.id : heroOf(e.effect.owner);
        to = e.targetCard && this.board.hasCard(e.targetCard.id) ? e.targetCard.id : heroOf(e.targetPlayer);
        const boon = e.effect.kind === 'statBonus' || e.effect.kind === 'autoWin' || e.effect.kind === 'heroMultiplier' || e.effect.owner === e.targetPlayer;
        const k = e.effect.kind;
        theme = k === 'statBonus' || k === 'heroMultiplier' ? 'boon' : k === 'disableAbilities' ? 'shield' : boon ? 'boon' : 'hex';
        break;
      }
      case 'abilityCountered': from = e.by.id; to = e.source.id; theme = 'shield'; at = null; break;
      case 'abilityIgnored': {
        from = e.by.id;
        to = e.targetCard && this.board.hasCard(e.targetCard.id) ? e.targetCard.id : e.by.id;
        theme = 'shield';
        if (to === from) { to = null; }
        break;
      }
      case 'abilityZap': {
        // Corvin's extra draw, Sigrun's choice: the card zaps the stack it is drawing from.
        const pt = e.pile === 'discard' ? this.board.discardPoint(e.deck) : this.board.deckPoint(e.deck);
        if (pt && this.board.hasCard(e.source.id)) { this.zap(e.source.id, pt, 'draw'); this.playTheme('draw'); }
        return;
      }
      case 'peeked': {
        // Looking at a stack (Wren, Grukka, Barnaby): the card behind it zaps that stack.
        const src = this.lastAbilityCard;
        const pt = this.board.deckPoint(e.deck);
        if (src && pt && this.board.hasCard(src)) { this.zap(src, pt, 'insight'); this.playTheme('insight'); }
        return;
      }
      case 'abilityUsed': {
        this.lastAbilityCard = e.source.id;
        // Abilities aimed at a deck zap it: Vaelis and Urzha the encounter deck (looking at a stack is handled by the peek).
        const deck: DeckName | null = e.ability === 'shadowsteeds' || e.ability === 'notThisFight' ? 'encounter' : null;
        const at3 = deck ? this.board.deckPoint(deck) : null;
        if (deck && at3 && this.board.hasCard(e.source.id)) {
          const th = themeForAbility(e.ability);
          this.zap(e.source.id, at3, th);
          this.playTheme(th);
        }
        return;
      }
      case 'bidClaimed': from = heroOf(e.to); to = heroOf(e.from); at = e.from; theme = 'trade'; break;
      case 'bidsSwapped': from = heroOf(e.a); to = heroOf(e.b); at = e.b; theme = 'trade'; break;
      case 'cardsTraded': {
        from = heroOf(e.from); to = heroOf(e.to); at = e.to; theme = 'trade';
        // You can see your own hand: the bolt lands on the card that was swapped in, not on your hero.
        const mine = e.to === view.you ? e.gave : null;
        const end = mine ? this.hud.handCardById(mine.id) : null;
        const start = from ? this.board.screenPoint(from) : null;
        if (end && start) {
          this.anims.push(this.hud.screenBolt(start, end, 'trade'));
          this.playTheme('trade');
          if (isTouch() && 'vibrate' in navigator) navigator.vibrate([60, 40, 90]);
          return;
        }
        break;
      }
      default: return;
    }
    if (!from || !to || from === to || !this.board.hasCard(from) || !this.board.hasCard(to)) return;
    this.zap(from, to, theme);
    // Something changing hands sends a bolt each way.
    if (theme === 'trade') this.zap(to, from, theme);
    this.playTheme(theme);
    // Haptics where the device has them: a firm buzz when it lands on you, a tick otherwise.
    if (isTouch() && 'vibrate' in navigator) navigator.vibrate(at === view.you && theme === 'hex' ? [60, 40, 90] : [18]);
  }

  /** The card sounds: shuffling, dealing, placing, flipping, discarding, dice and renown. */
  private soundFor(e: ClientEvent, view: GameView): void {
    switch (e.type) {
      case 'shuffled': sfx.play('shuffle'); break;
      case 'drew':
        // One deal sound per card that flies into your hand (staggered like the cards); others' draws are quiet.
        if (e.player === view.you && e.deck === 'resource') {
          const n = Math.min(5, e.cards?.length ?? e.count);
          for (let i = 0; i < n; i++) sfx.playLater('deal', i * 130);
        }
        break;
      case 'bid': case 'companionPlayed': sfx.play('card-place'); break;
      case 'revealed': case 'encounterRevealed': case 'locationRevealed': sfx.play('card-flip'); break;
      case 'resourceDiscarded': case 'companionDiscarded': sfx.play('card-discard'); break;
      case 'dieRolled': sfx.play('die-roll'); break;
      case 'renownGained': sfx.play('renown'); break;
      default: break;
    }
  }

  /** Dice rolling on the table, and cards flying from the deck into your hand. */
  private motionFor(e: ClientEvent, view: GameView): void {
    if (e.type === 'dieRolled') {
      // An ability's roll stays on the table (landed, then a few seconds to read) until its result has been dismissed.
      const ability = e.reason === 'ability' || e.reason === 'effect';
      this.dieAnim = this.die.roll(e.value, ability ? { hold: 2600, keep: true } : {});
    }
    else if (e.type === 'resourceDiscarded' && e.player === view.you) this.hud.flyDiscard(this.handSnap.get(e.card.id));
    else if (e.type === 'drew' && e.player === view.you && e.deck === 'resource' && e.reason !== 'Setup' && e.cards) {
      this.hud.flyDraw(e.cards.map((c) => c.id).filter((id): id is string => Boolean(id)));
    }
  }

  /**
   * A card's ability at work (used, its effect landing, or a triggered draw or
   * roll): flash the card on the table. Returns true if it did, so the log line
   * flashes with it.
   */
  private flashAbility(e: ClientEvent): boolean {
    switch (e.type) {
      case 'abilityUsed': return this.board.flash(e.source.id);
      case 'effect': return this.board.flash(e.source.id);
      // These only name their source; flash it if it's a card on the table.
      case 'ability': return this.board.flashByName(e.source);
      case 'drew': return this.board.flashByName(e.reason);
      default: return false;
    }
  }

  /**
   * Opponents' abilities get an announcement that stays until it's clicked,
   * so there's time to read it. What the ability did (the events right after
   * it) is added to the same announcement. Sabotage aimed at you from anything
   * else gets one too. Returns true when the event went into an announcement.
   */
  private async announce(e: ClientEvent, text: string | null, view: GameView): Promise<boolean> {
    if (e.type === 'abilityUsed') {
      // One ability at a time: show the previous one first.
      await this.flushCase();
      await this.hud.noticesClosed();
      const mine = e.player === view.you;
      // Abilities you start need no showing (you know what you did); one that turns out to
      // answer someone else's (it cancels an effect) is shown like theirs.
      this.openCase(view, { key: e.source.id, def: e.source.def, owner: e.player, label: e.label, onlyIfResponse: mine, theme: themeForAbility(e.ability) });
      return !mine;
    }
    // A counter (Aldric) or a shrug-off (Brunna) answers another ability: show the answering card, whoever's.
    if (e.type === 'abilityCountered' || e.type === 'abilityIgnored') {
      await this.flushCase();
      await this.hud.noticesClosed();
      const who = e.player === view.you ? 'You' : nameOf(view, e.player);
      const title = e.type === 'abilityCountered'
        ? `${who} countered ${whoseCard(view, e.source)}`
        : `${who} ${e.player === view.you ? 'ignore' : 'ignores'} ${whoseCard(view, e.source)}`;
      this.openCase(view, { key: e.by.id, def: e.by.def, owner: e.player, label: '', title, subtitle: `with ${getDef(e.by.def).name}`, response: true, theme: 'shield' });
      return true;
    }
    if (this.announcing && this.pendingCase && isAbilityResult(e, this.announcing)) {
      const c = this.pendingCase;
      if (e.type === 'dieRolled') c.roll = e.value;
      if (text) c.lines.push(text);
      for (const p of targetsOf(e)) if (p !== c.owner) c.targets.add(p);
      // Cancelling an effect someone else put on the table makes this ability a response.
      if (e.type === 'effectCancelled') {
        const undone = view.turn.effects.find((x) => x.id === e.effectId);
        if (undone && undone.owner !== c.owner) {
          c.response = true;
          c.subtitle ??= `in response to ${whoseCard(view, undone.source)}`;
        }
      }
      return true;
    }
    // The ability is over: show it, and nothing else proceeds until it has been dismissed.
    if (this.announcing) await this.flushCase();
    this.announcing = null;
    const hit = againstYou(e, view);
    if (!hit || !text) return false;
    await this.settleAnims();
    await this.hud.noticesClosed();
    const title = hit.card ? `${nameOf(view, hit.by)} used ${getDef(hit.card).name}` : nameOf(view, hit.by);
    this.hud.announce(title, text, hit.card, true);
    return true;
  }

  /** Start collecting an ability (and what it does) to show large; its zaps wait for that. */
  private openCase(view: GameView, c: {
    key: string; def: string; owner: PlayerId; label: string;
    title?: string; subtitle?: string; onlyIfResponse?: boolean; response?: boolean; theme: Theme;
  }): void {
    this.announcing = c.owner;
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.caseGate = { promise, resolve };
    this.pendingCase = { ...c, ownerName: nameOf(view, c.owner), targets: new Set(), lines: [], you: view.you };
  }

  /** A bolt from `from`; it waits until the ability it belongs to has been shown and dismissed. */
  /** The theme's sound, or the boon sound if that theme has no sound file yet. */
  private playTheme(theme: Theme): void {
    const name = THEME_SOUND[theme] as SfxName;
    sfx.play(sfx.has(name) ? name : 'effect-positive');
  }

  private zap(from: string, to: string | { x: number; z: number }, theme: Theme): void {
    const gate = this.caseGate;
    this.anims.push((gate ? gate.promise : Promise.resolve()).then(() => this.board.attack(from, to, theme)));
  }

  /**
   * Show the ability that just happened: its card flies up, large enough to read, with who used it
   * and against whom above it. A click sends it back, and only then does it zap its target.
   */
  private async flushCase(): Promise<void> {
    const c = this.pendingCase;
    const gate = this.caseGate;
    this.pendingCase = null;
    const show = c !== null && (!c.onlyIfResponse || c.response === true);
    const rolled = c !== null && c.roll !== undefined;
    // A die roll comes first: let it land and sit on the table so the number can be read.
    if (rolled) await this.dieAnim;
    // Your own ability that rolled a die gets no big card, but its result is told and must be dismissed
    // before the round's result is shown.
    if (c && rolled && !show) {
      await this.settleAnims();
      await this.hud.noticesClosed();
      this.hud.announce(`${c.owner === c.you ? 'You rolled' : `${c.ownerName} rolled`} a ${c.roll}`, c.lines[0] ?? '', c.def, false);
      for (const line of c.lines.slice(1)) this.hud.addToAnnouncement(line, false);
      gate?.resolve();
      if (this.caseGate === gate) this.caseGate = null;
      await this.hud.noticesClosed();
      this.die.hide();
      return;
    }
    // Off the table (e.g. already discarded): say it at least.
    if (c && show && c.title && !this.board.hasCard(c.key)) this.hud.banner(c.title, 'warn', 2400);
    if (c && show && this.board.hasCard(c.key)) {
      const def = getDef(c.def);
      const you = c.owner === c.you;
      const names = [...c.targets].map((p) => (p === c.you ? 'you' : this.view ? nameOf(this.view, p) : p));
      const from = this.board.screenRect(c.key);
      this.board.setCardHidden(c.key, true);
      try {
        await this.hud.showcase({
          def: c.def,
          title: c.title ?? (you ? 'You used a card ability' : `${c.ownerName} used a card ability`),
          subtitle: c.subtitle ?? (names.length ? `against a target owned by ${names.join(' and ')}` : ''),
          name: def.kind === 'hero' || def.kind === 'companion' ? def.abilityName : def.name,
          text: def.kind === 'hero' || def.kind === 'companion' ? def.abilityText : c.label,
          results: c.lines,
          theme: c.theme,
          from,
        });
      } finally {
        this.board.setCardHidden(c.key, false);
      }
    }
    gate?.resolve();
    if (this.caseGate === gate) this.caseGate = null;
    await this.settleAnims();
    if (rolled) this.die.hide();
  }

  private async settleAnims(): Promise<void> {
    const list = this.anims.splice(0);
    await Promise.allSettled(list);
  }

  dispose(): void {
    this.disposed = true;
    this.caseGate?.resolve();
    this.die.hide();
    for (const u of this.unhook) u();
    this.transport.close();
    this.scene.dispose();
    this.hud.dispose();
  }
}
