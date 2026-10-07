// HTML overlay: player plates, challenge panel, action prompts, hand,
// inspector, log and modals. All text goes through dom.ts (textContent only).

import {
  getDef, RULE_NOTES, STAT_NAMES,
  type CardRef, type Command, type GameView, type PendingView, type PlayerPublicView, type TurnResult,
} from '../../engine';
import type { AbilityOptionView, EffectView } from '../../engine/view';
import { cardBack, cardFace, cardFaceEmphasis, CARD_H, CARD_W, ruleGlowCanvas, rulesTextSize, STAT_COLORS } from '../render/cardFaces';
import type { Layout } from '../render/layout';
import { nameOf } from '../describe';
import { isTouch, onLongPress } from '../viewport';
import { append, clear, h, replace } from './dom';
import { closeGameMenu, toggleGameMenu, type MenuApi } from './GameMenu';
import type { DebugApi } from './DebugMenu';
import { attentionOf } from '../attention';
import { sfx } from '../audio/Sfx';
import { tiltOnPointer } from './tilt';
import { PALETTE, RUNES, type Theme } from './themes';

/** A button shown under a pinned card, e.g. "Bid this card" after a tap. */
interface InspectAction { label: string; primary?: boolean; run: () => void; /** An ability of the card: its OK button sits on the card, beside the ability text. */ ability?: { name: string } }

/** Thumbnail widths (CSS px) for the current screen. */
function thumbSizes(): { hand: number; option: number; drawn: number } {
  const cl = document.body.classList;
  if (cl.contains('shape-short')) return { hand: 70, option: 62, drawn: 70 };
  if (cl.contains('shape-tall') && window.innerWidth < 600) return { hand: 80, option: 68, drawn: 76 };
  return { hand: 104, option: 78, drawn: 96 };
}

export interface HudDeps {
  send(cmd: Command): void;
  /** The debug panel's controls (dev builds and ?debug only). */
  debug?: DebugApi;
  /** The menu's step-back camera: pulled back to show the whole place until turned off. */
  stepBack: { get(): boolean; set(on: boolean): void };
  /** A table card's rectangle on screen (for flying its picture up to the middle and back), or null. */
  cardRect(key: string): { x: number; y: number; w: number; h: number } | null;
  /** Hide or show a table card while its picture is flown up (each hide needs a matching show). */
  hideCard(key: string, hidden: boolean): void;
  /** Skip a usable ability for now (the Skip button on its card). */
  skipAbility(cardId: string, ability: string): void;
  newGame(): void;
  project(x: number, y: number, z: number): { x: number; y: number };
}

const STEP_LABEL: Record<string, string> = {
  draft: 'Choosing heroes', companionDraft: 'Choosing companions', turnStart: 'Start of turn', winTurnStart: 'Start of turn', companions: 'Companion phase', location: 'Location',
  winAfterLocation: 'Location', encounter: 'Encounter', challenge: 'Encounter',
  winBeforeBidding: 'Before bidding', bidding: 'Bidding', reveal: 'Revealing bids', winEndOfBidding: 'End of bidding',
  resolve: 'Resolving', turnEnd: 'End of turn', gameOver: 'Game over',
};

const WINDOW_LABEL: Record<string, string> = {
  turnStart: 'Start of turn', afterLocation: 'Location revealed',
  beforeBidding: 'Before bidding', bidding: 'Bidding', endOfBidding: 'End of bidding',
};

/** Smallest on-screen rules-text size (CSS px) we treat as readable without a text copy. */
const READABLE_PX = 10;
/** A revealed card takes this long to flip and land; its value then hits the plate's total. */
export const IMPACT_DELAY_MS = 900;

/** How many decisions a how-to hint is shown for before it goes quiet. */
const HINT_SHOWS = 3;
/** Per hint: how many decisions it has been shown for (kept across games this session). */
const hintSeen = new Map<string, { count: number; decision: number }>();

/** First part of a card name ("Lord Vaelis Nightbloom, the Unfading" -> "Lord Vaelis Nightbloom"). */
const shortName = (def: string) => getDef(def).name.split(',')[0]!;

/**
 * An option label, or null when it only repeats what the card shows
 * (its name, perhaps with its stats), e.g. "Kazra Emberdeep (P6 M6 G8)".
 */
function extraLabel(label: string, def: string): string | null {
  const bare = label.replace(/ \(P-?\d+ M-?\d+ G-?\d+\)$/, '');
  return bare === getDef(def).name || bare === shortName(def) ? null : label;
}

/** Short tags for effects on a player (shown on their plate). */
function effectTag(e: EffectView): string {
  const stat = e.stat === 'all' ? 'all' : e.stat ? STAT_NAMES[e.stat] : '';
  const tgt = e.targetCard ? getDef(e.targetCard.def).name.split(',')[0] : '';
  switch (e.kind) {
    case 'silenceCompanion': return `${tgt} silenced`;
    case 'forceCompanionStat': return `${tgt} → ${stat}`;
    case 'forceHeroStat': return `Hero → ${stat}`;
    case 'statBonus': return `${(e.amount ?? 0) >= 0 ? '+' : ''}${e.amount} ${stat}`;
    case 'heroMultiplier': return 'Hero ×2';
    case 'negateBid': return `${tgt} zero`;
    case 'disableAbilities': return `${tgt} disabled`;
    case 'autoWin': return 'Takes the location';
    case 'grudge': return `Grudge -${e.amount ?? 3}`;
  }
}

/**
 * A canvas thumbnail of a card face that redraws when the art arrives.
 * `width` sets the drawing resolution and, unless `cssSized`, the displayed width.
 */
export function cardThumb(def: string, width: number, cls = 'thumb', cssSized = false, bold = false): HTMLCanvasElement {
  const c = h('canvas', { class: cls });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(width * dpr);
  c.height = Math.round((width * CARD_H / CARD_W) * dpr);
  if (!cssSized) c.style.width = `${width}px`;
  const draw = () => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bold ? cardFaceEmphasis(def, draw) : cardFace(def, draw), 0, 0, c.width, c.height);
  };
  draw();
  return c;
}

export class Hud {
  /** The menu button, upper left: it opens the game menu (game, sound, graphics). */
  private readonly menuBtn = h('button', {
    class: 'menu-btn', title: 'Menu', aria: { label: 'Menu', haspopup: 'dialog', expanded: 'false' },
    on: { click: () => { sfx.play('click'); toggleGameMenu(this.menuBtn, this.menuApi()); } },
  }, h('span', { class: 'menu-bars' }));
  /** One line on the game now, shown at the top of the menu. */
  private turnText = '';
  private readonly plates = h('div', { class: 'plates' });
  /** Stat chips on the table's hero and companion cards (what each adds to the challenge now). */
  private readonly chips = h('div', { class: 'card-chips' });
  private readonly chipEls = new Map<string, HTMLElement>();
  private readonly challenge = h('div', { class: 'challenge hidden' });
  private readonly dock = h('section', { class: 'dock', aria: { label: 'Your actions' } });
  private readonly prompt = h('div', { class: 'prompt', role: 'status', aria: { live: 'polite' } });
  private readonly hand = h('div', { class: 'hand' });
  private readonly inspector = h('aside', { class: 'inspector hidden', aria: { label: 'Card details' } });
  private readonly logPanel = h('aside', { class: 'log', aria: { label: 'Game log' } });
  private readonly logList = h('ol', { class: 'log-list' });
  private readonly banners = h('div', { class: 'banners' });
  /** Announcements of opponents' abilities: they stay until clicked. */
  private readonly notices = h('div', { class: 'notices', aria: { label: 'Announcements', live: 'polite' } });
  /** The newest announcement, which later results of the same ability are added to. */
  private lastNotice: { el: HTMLElement; lines: HTMLElement; title: string; def: string | null } | null = null;
  /** Hand cards currently being flown in from the deck (hidden until they land). */
  private readonly flying = new Set<string>();
  /** Players who had the crown at the last render (it only drops in when it arrives). */
  private crowned = new Set<string>();
  /** Resolvers waiting for every announcement to be dismissed. */
  private noticeWaiters: (() => void)[] = [];
  /** Aldric's counter decision, answered with buttons inside the announcement of the ability it is about. */
  private counterHeld = false;
  private counter: { decision: number; prompt: string; source: string; options: { value: string; label: string }[] } | null = null;
  private readonly modal = h('div', { class: 'modal-layer hidden' });
  /** Large companion-phase panel for each player's first turn, before the game really starts. */
  private readonly stage = h('div', { class: 'comp-stage hidden' });
  /** Tooltip for the deck under the mouse. */
  private readonly deckTipEl = h('div', { class: 'deck-tip hidden', role: 'tooltip' });
  private readonly resultPanel = h('div', { class: 'result hidden', on: { click: () => this.hideResult() } });
  private resultTimer = 0;
  private view: GameView | null = null;
  private layout: Layout | null = null;
  private selected = new Set<string>();
  private faceDown = false;
  private pinned: string | null = null;
  private pinnedActions: InspectAction[] = [];
  /** A ready ability's card, flown up to the middle with OK and Skip floating either side of it. */
  private abilityView: {
    layer: HTMLElement; cardEl: HTMLElement; key: string; from: { x: number; y: number; w: number; h: number } | null;
    slot: (r: { x: number; y: number; w: number; h: number } | null) => string;
  } | null = null;
  /** The ability view is closing because OK was pressed (the ability's own showcase flies the card up next). */
  private abilityUsed = false;
  /** The table card (instance) the pinned view was opened from, if any. */
  private pinnedCardId: string | null = null;
  /** Touch: the card tapped once (shown with its action); a second tap confirms. */
  private armed: { decision: number; card: string } | null = null;
  /** The decision a pinned card was opened for by choosing it; it closes when that decision ends. */
  private pinnedFor: number | null = null;
  /** What the inspector shows now, to skip redrawing it on every mouse move. */
  private shownKey = '';
  /** Last pointer position, to place the preview away from it and to re-find the hovered card. */
  private pointer = { x: -1, y: -1, mouse: false };
  private plateEls = new Map<string, HTMLElement>();
  /** The player whose detail card is open (click a name plate), and the card itself. */
  private detailFor: string | null = null;
  private readonly detailEl = h('div', { class: 'plate-detail hidden' });
  /** The total each plate last showed for real, and the (older) one still shown while a revealed card lands. */
  private plateTotal = new Map<string, number>();
  private plateHeld = new Map<string, number>();
  /** Players whose next change of total comes from a card being revealed (it lands with an impact). */
  private impactFor = new Set<string>();

  constructor(private readonly root: HTMLElement, private readonly deps: HudDeps) {
    append(this.logPanel, h('h2', {}, 'Chronicle'), this.logList);
    this.setLogOpen(false); // the log starts hidden; the Log item in the menu opens it
    append(this.dock, this.prompt, this.hand);
    append(root, this.menuBtn, this.plates, this.chips, this.challenge, this.banners, this.notices, this.resultPanel, this.stage, this.deckTipEl, this.inspector, this.logPanel, this.dock, this.modal, this.detailEl);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.unpin(); this.closeModal(); this.closeDetail(); }
    });
    window.addEventListener('resize', () => this.fitHand());
    // Clicking anywhere outside the detail card closes it (a click on a name plate is handled by the plate).
    window.addEventListener('pointerdown', (e) => {
      if (!this.detailFor) return;
      const t = e.target as Node;
      if (this.detailEl.contains(t) || this.plateEls.get(this.detailFor)?.contains(t)) return;
      this.closeDetail();
    }, true);
    // Every button click gets a small click.
    root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button.btn, .modal-close')) sfx.play('click'); });
    const track = (e: PointerEvent) => { this.pointer = { x: e.clientX, y: e.clientY, mouse: e.pointerType !== 'touch' }; };
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerdown', track, { passive: true });
  }

  /** The card currently pinned in the inspector, if any. */
  get pinnedCard(): string | null {
    return this.pinned;
  }

  /**
   * A click on a table card: pin it (click again to close). If the card has an ability the engine is offering
   * now, the card flies up to the middle of the screen with OK and Skip floating either side of it.
   */
  openCard(def: string | null, cardId: string | null): void {
    if (!def || (def === this.pinned && cardId === this.pinnedCardId)) { this.pinnedCardId = null; this.inspect(def && def === this.pinned ? null : def, true); return; }
    const v = this.view;
    const ready = v && cardId ? attentionOf(v).filter((a) => a.cardId === cardId) : [];
    const name = (getDef(def) as { abilityName?: string }).abilityName ?? '';
    // Each ability gets an OK and a Skip button.
    const actions: InspectAction[] = ready.flatMap((a) => {
      const ability = { name: ready.length > 1 || !name ? a.label : name };
      return [
        { label: 'OK', primary: true, ability, run: () => { this.abilityUsed = true; this.unpin(); this.deps.send({ type: 'ability.use', decision: a.decision, source: a.cardId, ability: a.ability }); } },
        { label: 'Skip', ability, run: () => { this.unpin(); this.deps.skipAbility(a.cardId, a.ability); } },
      ];
    });
    this.pinnedCardId = cardId;
    if (ready.length && cardId) {
      this.pinned = def;
      this.pinnedActions = actions;
      this.pinnedFor = ready[0]!.decision;
      this.showAbility(def, cardId, actions);
      return;
    }
    this.inspect(def, true, actions);
  }

  // --- top-level render -----------------------------------------------------------

  render(view: GameView, layout: Layout): void {
    this.view = view;
    this.layout = layout;
    this.renderTop(view);
    this.renderPlates(view);
    this.renderChips(view);
    this.renderChallenge(view);
    this.renderDock(view);
    if (view.winner && !this.modal.dataset['gameover']) this.showGameOver(view);
  }

  /** A number in the upper right of every hero and companion on the table: what it adds in the challenge's stat right now. */
  private renderChips(v: GameView): void {
    const keep = new Set<string>();
    for (const p of v.players) {
      if (!p.projection) continue;
      for (const { card, value } of p.projection.contributions) {
        keep.add(card);
        let el = this.chipEls.get(card);
        if (!el) {
          el = h('span', {});
          this.chips.appendChild(el);
          this.chipEls.set(card, el);
        }
        el.className = `value-chip table-chip${value < 0 ? ' neg' : value === 0 ? ' zero' : ''}`;
        el.title = `${STAT_NAMES[p.projection.stat]} ${value}`;
        el.textContent = String(value);
      }
    }
    for (const [id, el] of this.chipEls) if (!keep.has(id)) { el.remove(); this.chipEls.delete(id); }
  }

  /** Called every frame: keep plates glued to their 3D anchors, and on screen. */
  reposition(): void {
    if (!this.layout) return;
    const vw = window.innerWidth;
    if (this.chipEls.size) {
      for (const c of this.layout.cards) {
        const el = this.chipEls.get(c.key);
        if (!el) continue;
        // The card's upper right corner (cards are 1 x 1.4 units, the top edge toward -z).
        const p = this.deps.project(c.x + 0.5 * c.scale, 0, c.z - 0.7 * c.scale);
        el.style.transform = `translate(${Math.round(p.x - 14)}px, ${Math.round(p.y - 14)}px)`;
      }
    }
    for (const seat of this.layout.seats) {
      const el = this.plateEls.get(seat.player);
      if (!el) continue;
      // Your plate sits beside your cards; opponents' plates sit above theirs.
      const beside = seat.isYou;
      const p = beside
        ? this.deps.project(seat.x + seat.rowWidth / 2 + 0.3, 0, seat.z)
        : this.deps.project(seat.x, 0, seat.z - 0.72 * seat.scale * 1.4 - 0.1);
      // The value circles sit on the cards' upper corners; keep opponents' plates clear above them.
      const w = el.offsetWidth;
      const ht = el.offsetHeight;
      const left = Math.max(4, Math.min(vw - w - 4, beside ? p.x : p.x - w / 2));
      const top = Math.max(46, beside ? p.y - ht / 2 : p.y - ht - 18);
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }
    this.placeDetail();
    // The challenge sits below the location and encounter; in portrait, above them
    // (the strip under the opponents is free, and below would cover your plate).
    const enc = this.layout.center.encounter;
    const above = this.layout.shape === 'tall';
    const cp = this.deps.project(enc.x - 0.7, 0, above ? enc.z - 0.95 : enc.z + 0.95);
    const cw = this.challenge.offsetWidth;
    const cx = Math.max(4 + cw / 2, Math.min(vw - cw / 2 - 4, cp.x));
    this.challenge.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cp.y)}px) translate(-50%, ${above ? '-100%' : '0'})`;
  }

  /** What the menu shows and does. */
  private menuApi(): MenuApi {
    return {
      status: () => this.turnText,
      rules: () => this.showRules(),
      log: () => this.setLogOpen(this.logPanel.classList.contains('collapsed')),
      newGame: () => this.confirmNewGame(),
      stepBack: this.deps.stepBack,
      ...(this.deps.debug ? { debug: this.deps.debug } : {}),
    };
  }

  private renderTop(v: GameView): void {
    const active = nameOf(v, v.turn.active);
    this.turnText = v.turn.number
      ? `Turn ${v.turn.number} · ${active}${v.turn.active === v.you ? '' : "'s turn"} · ${STEP_LABEL[v.turn.step] ?? v.turn.step}`
      : 'Setting up…';
  }

  /**
   * Who is ahead in the bidding: the highest total counting only confirmed (face-up) bids.
   * Shown from the first bid until the turn resolves; everyone tied at the top gets the crown.
   */
  private leaders(v: GameView): Set<string> {
    const out = new Set<string>();
    const step = v.turn.step;
    if (step !== 'bidding' && step !== 'reveal' && step !== 'winEndOfBidding') return out;
    if (!v.players.some((p) => p.bids.some((b) => !b.hidden && b.faceUp))) return out;
    let best = -Infinity;
    for (const p of v.players) if (p.projection && p.projection.total > best) best = p.projection.total;
    const falling = this.fallers(v);
    for (const p of v.players) if (p.projection && p.projection.total === best && !falling.has(p.id)) out.add(p.id);
    return out;
  }

  /** Players who would fall from the encounter as things stand (confirmed total below the difficulty, no hidden bids left to save them). */
  private fallers(v: GameView): Set<string> {
    const out = new Set<string>();
    const step = v.turn.step;
    if (step !== 'bidding' && step !== 'reveal' && step !== 'winEndOfBidding') return out;
    for (const p of v.players) if (p.projection && p.projection.hiddenBids === 0 && p.projection.total < p.projection.difficulty) out.add(p.id);
    return out;
  }

  /** The next change of these players' totals is a revealed card: it lands with an impact after the flip. */
  expectImpact(players: Iterable<string>): void {
    for (const p of players) this.impactFor.add(p);
  }

  /** The number on a plate gets hit: it swells with the size of the change and tilts a few degrees either way. */
  private hitTotal(id: string, delta: number): void {
    const num = this.plateEls.get(id)?.querySelector<HTMLElement>('.tot-num');
    if (!num) return;
    const size = 1.3 + Math.min(1.6, Math.abs(delta) * 0.14);
    const tilt = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3);
    num.style.setProperty('--hit-s', size.toFixed(2));
    num.style.setProperty('--hit-r', `${tilt.toFixed(1)}deg`);
    num.classList.remove('hit', 'hit-up', 'hit-down');
    void num.offsetWidth; // restart the animation
    num.classList.add('hit', delta >= 0 ? 'hit-up' : 'hit-down');
    this.plateEls.get(id)?.classList.add('jolt');
    setTimeout(() => this.plateEls.get(id)?.classList.remove('jolt'), 500);
    setTimeout(() => num.classList.remove('hit', 'hit-up', 'hit-down'), 1100);
  }

  /** A short number floating up from a card on the table ("+4", "-1"). */
  floatNumber(x: number, y: number, text: string, kind: string, delay = 0): void {
    const el = h('div', { class: `float-num ${kind}`, style: { left: `${x}px`, top: `${y}px`, animationDelay: `${delay}ms` } }, text);
    this.root.appendChild(el);
    setTimeout(() => el.remove(), delay + 1700);
  }

  private renderPlates(v: GameView): void {
    const keep = new Set<string>();
    for (const p of v.players) {
      keep.add(p.id);
      const now = p.projection?.total;
      const before = this.plateTotal.get(p.id);
      if (now !== undefined) {
        if (before !== undefined && before !== now && this.impactFor.has(p.id)) {
          // Keep the old number up until the card has landed, then hit it with the new one.
          this.plateHeld.set(p.id, before);
          const delta = now - before;
          setTimeout(() => { this.plateHeld.delete(p.id); if (this.view) this.renderPlates(this.view); this.hitTotal(p.id, delta); }, IMPACT_DELAY_MS);
        }
        this.plateTotal.set(p.id, now);
      } else this.plateTotal.delete(p.id);
      this.impactFor.delete(p.id);
      let el = this.plateEls.get(p.id);
      if (!el) {
        el = h('div', { class: 'plate', role: 'button', tabindex: 0, title: 'Click for details' });
        const id = p.id;
        el.addEventListener('click', () => this.toggleDetail(id));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleDetail(id); } });
        this.plates.appendChild(el);
        this.plateEls.set(p.id, el);
      }
      el.className = `plate${p.id === v.turn.active ? ' active' : ''}${v.pending?.player === p.id ? ' deciding' : ''}${p.id === v.you ? ' you' : ''}`;
      replace(el, ...this.plateContent(v, p));
    }
    for (const [id, el] of this.plateEls) if (!keep.has(id)) { el.remove(); this.plateEls.delete(id); }
    this.crowned = new Set([...this.leaders(v), ...this.fallers(v)]);
    this.renderDetail();
  }

  /**
   * A player's plate: just the name, Renown and current power. Whose decision it is shows as the plate's glow,
   * and everything else (hand, bids, penalties, effects) is in the detail card a click opens.
   */
  private plateContent(v: GameView, p: PlayerPublicView): (HTMLElement | string)[] {
    const proj = p.projection;
    const power = proj ? h('span', { class: `plate-total ${proj.total >= proj.difficulty ? 'ok' : 'low'}`, title: 'Current power against this encounter (hidden bids not counted)' },
      h('span', { class: 'stat-chip', style: { '--accent': STAT_COLORS[proj.stat] } }, proj.stat),
      ' ', h('span', { class: 'tot-num' }, String(this.plateHeld.get(p.id) ?? proj.total)), proj.hiddenBids ? `+${proj.hiddenBids}?` : '') : null;
    const you = p.id === v.you;
    return [
      this.fallers(v).has(p.id)
        ? h('span', { class: `plate-crown skull${this.crowned.has(p.id) ? ' still' : ''}`, title: 'Would fall from this encounter as things stand' }, '💀')
        : this.leaders(v).has(p.id) ? h('span', { class: `plate-crown${this.crowned.has(p.id) ? ' still' : ''}`, title: 'Highest total so far' }, '👑') : '',
      h('div', { class: 'plate-head' },
        h('strong', { class: 'plate-name', title: p.hero ? getDef(p.hero.def).name : '' }, p.name, you ? h('span', { class: 'plate-you' }, ' (you)') : ''),
        h('span', { class: 'plate-renown', title: `Renown (${v.rules.renownToWin} wins)` }, `★ ${p.renown}`, h('span', { class: 'plate-goal' }, `/${v.rules.renownToWin}`)),
        power ?? ''),
    ];
  }

  // --- plate detail ------------------------------------------------------------------

  private toggleDetail(id: string): void {
    if (this.detailFor === id) { this.closeDetail(); return; }
    this.detailFor = id;
    this.renderDetail();
    this.placeDetail();
  }

  closeDetail(): void {
    this.detailFor = null;
    this.detailEl.classList.add('hidden');
  }

  /** The detail card: hero, Renown, power against the encounter, hand, bids, and what is affecting the player. */
  private renderDetail(): void {
    const v = this.view;
    const p = v?.players.find((x) => x.id === this.detailFor);
    if (!v || !p) { this.closeDetail(); return; }
    const proj = p.projection;
    const row = (label: string, ...value: (HTMLElement | string)[]) => h('div', { class: 'pd-row' }, h('span', { class: 'pd-label' }, label), h('span', { class: 'pd-value' }, ...value));

    const known = p.bids.flatMap((b) => (b.hidden ? [] : [b]));
    const unknown = p.bids.length - known.length;
    const bidLine: (HTMLElement | string)[] = [];
    if (!p.bids.length) bidLine.push('None yet');
    else {
      const names = known.map((b) => {
        const d = getDef(b.card.def) as { name: string; value?: number };
        return `${d.name}${d.value !== undefined ? ` (+${d.value})` : ''}${b.faceUp ? '' : ', face down'}`;
      });
      bidLine.push(`${p.bids.length} card${p.bids.length === 1 ? '' : 's'}`);
      if (names.length) bidLine.push(h('div', { class: 'pd-sub' }, names.join(' · ')));
      if (unknown) bidLine.push(h('div', { class: 'pd-sub' }, `${unknown} unknown value`));
    }

    const conds: HTMLElement[] = [];
    if (p.penalty > 0) conds.push(h('div', { class: 'pd-cond hex' }, `−${p.penalty} to their total this encounter`));
    if (p.penaltyNext > 0) conds.push(h('div', { class: 'pd-cond hex' }, `−${p.penaltyNext} to their total next encounter`));
    if (p.statOverride) conds.push(h('div', { class: 'pd-cond hex' }, `Their hero is forced to ${STAT_NAMES[p.statOverride]}`));
    for (const e of v.turn.effects.filter((x) => x.active && x.targetPlayer === p.id)) {
      conds.push(h('div', { class: `pd-cond ${e.owner === p.id ? 'boon' : 'hex'}` }, effectTag(e), h('span', { class: 'pd-from' }, ` (${getDef(e.source.def).name})`)));
    }

    replace(this.detailEl,
      h('div', { class: 'pd-head' },
        h('strong', {}, p.name, p.id === v.you ? ' (you)' : ''),
        p.hero ? h('span', { class: 'pd-hero' }, getDef(p.hero.def).name) : ''),
      row('Renown', `★ ${p.renown} / ${v.rules.renownToWin}`),
      row('Power', proj
        ? h('span', { class: proj.total >= proj.difficulty ? 'pd-ok' : 'pd-low' }, `${STAT_NAMES[proj.stat]} ${proj.total}${proj.hiddenBids ? ` + ${proj.hiddenBids} unknown` : ''} vs ${proj.difficulty}`)
        : '—'),
      row('Hand', `${p.handCount} resource card${p.handCount === 1 ? '' : 's'}`),
      row('Bid', ...bidLine),
      row('Conditions', ...(conds.length ? conds : ['None'])),
    );
    this.detailEl.classList.remove('hidden');
  }

  /** Keep the detail card beside its plate: below it (above if there is no room), on screen. */
  private placeDetail(): void {
    if (!this.detailFor || this.detailEl.classList.contains('hidden')) return;
    const plate = this.plateEls.get(this.detailFor);
    if (!plate) return;
    const r = plate.getBoundingClientRect();
    const w = this.detailEl.offsetWidth;
    const ht = this.detailEl.offsetHeight;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8;
    const top = below + ht > window.innerHeight - 6 ? Math.max(48, r.top - ht - 8) : below;
    this.detailEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private renderChallenge(v: GameView): void {
    const ch = v.turn.challenge;
    if (!ch || !v.turn.encounter) { this.challenge.classList.add('hidden'); return; }
    this.challenge.classList.remove('hidden');
    const d = ch.difficulty;
    const parts: string[] = [`base ${d.base}`];
    if (d.boost) parts.push(`location +${d.boost}`);
    if (d.minions) parts.push(`minions ${d.minions >= 0 ? '+' : ''}${d.minions}`);
    replace(this.challenge,
      h('div', { class: 'ch-stat', style: { '--accent': STAT_COLORS[ch.stat] } }, `${STAT_NAMES[ch.stat]} ${d.total}`),
      h('div', { class: 'ch-detail' }, `${parts.join(' · ')}${v.turn.wandsDisabled ? ' · Wands disabled' : ''}`),
    );
  }

  // --- dock: prompt + hand -------------------------------------------------------

  private renderDock(v: GameView): void {
    this.renderDockContent(v);
    this.refreshHoverPreview();
  }

  /**
   * Re-rendering the dock swaps the buttons under a still mouse without any
   * pointer events, so re-check what's under it: the same card keeps its
   * preview (no flicker when other players act), anything else clears it.
   */
  private refreshHoverPreview(): void {
    if (!this.pointer.mouse) return;
    const el = document.elementFromPoint(this.pointer.x, this.pointer.y);
    if (!el || !this.dock.contains(el)) return;
    this.inspect(el.closest<HTMLElement>('.card-btn')?.dataset['def'] ?? null);
  }

  private renderDockContent(v: GameView): void {
    const d = v.pending;
    const mine = d && d.player === v.you && d.detail ? d.detail : null;
    // A card opened by choosing it (and its action) belongs to that decision only.
    const decisionId = mine ? d!.id : null;
    if (this.armed && this.armed.decision !== decisionId) this.armed = null;
    if (this.pinnedFor !== null && this.pinnedFor !== decisionId) this.unpin();
    clear(this.prompt);
    if (!mine) this.selected.clear();
    if (mine?.kind === 'choose' && mine.purpose === 'counterAbility') {
      this.counter = { decision: d!.id, prompt: mine.prompt, source: mine.source, options: mine.options.map((o) => ({ value: o.value, label: o.label })) };
      append(this.prompt, h('span', { class: 'waiting' }, 'Decide whether to counter the ability above.'));
      this.renderHand(v, null);
      this.stage.classList.add('hidden');
      this.showCounter();
      return;
    }
    this.counter = null;
    const companionDraft = mine?.kind === 'choose' && mine.purpose === 'companionDraft';
    if (companionDraft) {
      this.stage.classList.remove('hidden');
      this.renderCompanionDraft(v, d!.id, mine);
      append(this.prompt, h('span', { class: 'waiting' }, 'Choose your companions.'));
      return;
    }
    const draft = mine?.kind === 'choose' && (mine.purpose === 'heroDraft' || mine.purpose === 'heroKeep' || mine.purpose === 'hallOfRest') && mine.options.length > 0;
    if (draft) {
      this.stage.classList.remove('hidden');
      this.renderDraftStage(v, d!.id, mine);
      append(this.prompt, h('span', { class: 'waiting' }, 'Choose your hero.'));
      return;
    }
    const big = mine !== null && (mine.kind === 'companion.offer' || mine.kind === 'companion.place');
    this.stage.classList.toggle('hidden', !big);
    if (big) {
      this.renderStage(v, d!.id, mine);
      append(this.prompt, h('span', { class: 'waiting' }, 'Build your party.'));
      return;
    }
    const size = thumbSizes();
    const touch = isTouch();

    if (v.winner) {
      append(this.prompt, h('span', {}, `${nameOf(v, v.winner)} ${v.winner === v.you ? 'win' : 'wins'} the Marches.`),
        h('button', { class: 'btn primary', on: { click: () => this.deps.newGame() } }, 'Play again'));
    } else if (!mine) {
      const who = d ? nameOf(v, d.player) : null;
      const what = d?.kind === 'bid' ? 'bidding' : d?.kind === 'choose' ? 'choosing' : d?.kind === 'activate' ? 'considering an ability' : d ? 'recruiting a companion' : '';
      append(this.prompt, h('span', { class: 'waiting' }, d ? `Waiting for ${who}… (${what})` : v.hold ? '…' : ''));
    } else if (mine.kind === 'companion.place') {
      const me = v.players.find((p) => p.id === v.you)!;
      const drawn = mine.drawn;
      const buttons = h('div', { class: 'decision-buttons' });
      if (!mine.mustReplace) {
        append(buttons, h('button', { class: 'btn primary', on: { click: () => this.deps.send({ type: 'companion.keep', decision: d!.id, replace: null }) } }, 'Recruit'));
      }
      for (const c of [...me.companions, ...me.inactiveCompanions]) {
        const b = h('button', { class: `btn${mine.mustReplace ? ' primary' : ''}`, on: { click: () => this.deps.send({ type: 'companion.keep', decision: d!.id, replace: c.id }) } }, `Replace ${shortName(c.def)}`);
        this.previewOn(b, c.def);
        append(buttons, b);
      }
      append(buttons, h('button', { class: 'btn', on: { click: () => this.deps.send({ type: 'companion.discard', decision: d!.id }) } }, 'Let them go'));
      append(this.prompt, h('div', { class: 'decision' },
        this.thumbButton(drawn, size.drawn, 'drawn'),
        h('div', { class: 'decision-body' },
          h('div', { class: 'decision-title' }, `You drew ${getDef(drawn.def).name}.`),
          mine.mustReplace ? h('div', { class: 'decision-text' }, "You're at your companion limit.") : '',
          buttons)));
    } else if (mine.kind === 'activate') {
      // The glowing card is the prompt; this button passes at once instead of waiting for the chance to time out (GameClient).
      append(this.prompt,
        h('span', { class: 'waiting' }, 'Click the glowing card to use its ability.'),
        h('button', { class: 'btn', on: { click: () => this.deps.send({ type: 'ability.done', decision: d!.id }) } }, 'Not now'));
    } else if (mine.kind === 'bid') {
      if (!mine.canFaceDown) this.faceDown = false;
      const faceDownToggle = mine.canFaceDown
        ? h('button', { class: `btn toggle${this.faceDown ? ' on' : ''}`, title: 'A Little Plan: Hobby may bid face down even first', on: { click: () => { this.faceDown = !this.faceDown; this.disarm(); this.renderDock(v); } } },
          this.faceDown ? '☑ Face down' : '☐ Face down')
        : null;
      append(this.prompt,
        h('span', {}, mine.faceUp && !this.faceDown ? 'Your bid: this first card is played face up.' : 'Your bid: this card is played face down.'),
        faceDownToggle,
        v.hand.length ? this.hint('bid', d!.id, touch ? 'Tap a card to read it; tap again to bid it.' : 'Click a card to bid it.') : '',
        h('button', { class: 'btn', on: { click: () => this.deps.send({ type: 'bid.pass', decision: d!.id }) } }, 'Pass'));
    } else if (mine.kind === 'choose') {
      this.renderChoice(v, d!.id, mine);
      return;
    }
    this.renderHand(v, mine?.kind === 'bid' ? d!.id : null);
  }

  /** A how-to hint, shown for the first few decisions of its kind and then left out. */
  /**
   * The opening companion draft: two empty slots (as many as you may take) and the pool below.
   * Clicking a pool card fills the next empty slot; clicking a filled slot puts that companion back.
   */
  private renderCompanionDraft(v: GameView, decision: number, c: Extract<NonNullable<PendingView['detail']>, { kind: 'choose' }>): void {
    const me = v.players.find((p) => p.id === v.you)!;
    const w = Math.round(Math.max(84, Math.min(150, (window.innerWidth - 330) / Math.max(3.4, c.options.length * 0.7 + 0.4), (window.innerHeight - 250) / 2.9)));
    const byValue = new Map(c.options.map((o) => [o.value, o]));
    // Anything picked earlier that is no longer on offer (a stale selection) is dropped.
    for (const s of [...this.selected]) if (!byValue.has(s)) this.selected.delete(s);
    const picks = [...this.selected];
    const refOf = (value: string): CardRef => ({ id: value, def: byValue.get(value)!.card?.def ?? value });
    const rerender = (): void => this.renderDock(v);
    const slots: HTMLElement[] = [];
    for (let i = 0; i < c.max; i++) {
      const value = picks[i];
      if (value === undefined) {
        const empty = h('div', { class: 'draft-slot empty' }, h('span', {}, 'Empty slot'));
        empty.style.width = `${w}px`;
        empty.style.height = `${Math.round(w * CARD_H / CARD_W)}px`;
        slots.push(empty);
      } else {
        const b = this.thumbButton(refOf(value), w, 'selected', () => { this.selected.delete(value); rerender(); });
        slots.push(b);
      }
    }
    const pool = c.options.filter((o) => !this.selected.has(o.value)).map((o) =>
      this.thumbButton(refOf(o.value), w, this.selected.size < c.max ? 'playable' : '', () => {
        if (this.selected.size >= c.max) return;
        this.selected.add(o.value);
        rerender();
      }));
    const confirm = h('button', { class: 'btn primary', on: { click: () => { const p = [...this.selected]; this.selected.clear(); this.deps.send({ type: 'choose', decision, picks: p }); } } }, 'Confirm companions');
    confirm.disabled = this.selected.size !== c.max;
    const hero = me.hero ? h('aside', { class: 'stage-hero' }, h('h3', {}, 'Your hero'), this.thumbButton(me.hero, Math.min(w + 40, 200))) : '';
    replace(this.stage, h('div', { class: 'stage-panel' }, hero, h('div', { class: 'stage-main' },
      h('h2', {}, 'Choose your companions'),
      h('section', { class: 'stage-section' }, h('h3', {}, `Your companions (${this.selected.size}/${c.max})`),
        h('p', { class: 'stage-hint' }, 'Click a companion below to fill a slot. Click one in a slot to put it back.'),
        h('div', { class: 'stage-row' }, ...slots)),
      h('section', { class: 'stage-section' }, h('h3', {}, 'Available'), h('div', { class: 'stage-row' }, ...pool)),
      h('div', { class: 'decision-buttons' }, confirm))));
  }

  /** The hero draft: the offered heroes as big cards, so the art and powers are easy to read. */
  private renderDraftStage(v: GameView, decision: number, c: Extract<NonNullable<PendingView['detail']>, { kind: 'choose' }>): void {
    // Any number of cards (The Hall of Rest offers the whole hero stack): pick the largest size that fits in rows.
    const n = Math.max(1, c.options.length);
    const availW = window.innerWidth - 80, availH = window.innerHeight - 200;
    let w = 80;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const fit = Math.min(260, (availW - (cols - 1) * 14) / cols, (availH - (rows - 1) * 14) / (rows * (CARD_H / CARD_W)));
      if (fit > w) w = fit;
    }
    w = Math.round(Math.max(80, w));
    const touch = isTouch();
    const cardOptions = c.options.filter((o) => o.card);
    const others = c.options.filter((o) => !o.card);
    const cards = cardOptions.map((o) => {
      const ref: CardRef = { id: o.card?.id ?? o.value, def: o.card?.def ?? o.value };
      return this.thumbButton(ref, w, this.armed?.card === ref.id ? 'selected' : 'playable',
        this.confirmTap(v, decision, ref, 'Choose ' + shortName(ref.def), () => this.deps.send({ type: 'choose', decision, picks: [o.value] })));
    });
    const keepOrSend = c.purpose === 'heroKeep';
    const hall = c.purpose === 'hallOfRest';
    replace(this.stage, h('div', { class: 'stage-panel draft' }, h('div', { class: 'stage-main' },
      h('h2', {}, keepOrSend ? 'A new hero takes up your banner' : hall ? 'The Hall of Rest: choose who takes up your banner' : 'Choose your hero'),
      h('p', { class: 'stage-hint' }, hall ? 'Any hero in the stack may be chosen.' : keepOrSend
        ? 'Keep this hero, or send them back and draw another. You must keep the next one.'
        : touch ? 'Tap a hero to read it; tap again to choose.' : 'Click a hero to choose them. The others go back in the stack, unseen.'),
      h('div', { class: 'stage-row' }, ...cards),
      others.length ? h('div', { class: 'decision-buttons' }, ...others.map((o) => h('button', { class: 'btn', on: { click: () => this.deps.send({ type: 'choose', decision, picks: [o.value] }) } }, o.label))) : '')));
  }

  /** Card width for the big panel: four across, or whatever two rows of the viewport allow. */
  private stageCardWidth(): number {
    const byWidth = (window.innerWidth - 300) / 3.6;
    const byHeight = (window.innerHeight - 250) / 2.9;
    return Math.round(Math.max(84, Math.min(160, byWidth, byHeight)));
  }

  /**
   * The companion phase (every turn, and before anything can be used at the start): a large
   * panel with your hero and your current companions (or the picked
   * card and whom it could replace), so you can look for abilities that combine.
   */
  private renderStage(v: GameView, decision: number, mine: NonNullable<PendingView['detail']>): void {
    const me = v.players.find((p) => p.id === v.you)!;
    const w = this.stageCardWidth();
    const mineCards = [...me.companions, ...me.inactiveCompanions];
    const row = (cards: CardRef[], make: (c: CardRef) => HTMLElement, empty: string): HTMLElement =>
      h('div', { class: 'stage-row' }, ...(cards.length ? cards.map(make) : [h('div', { class: 'stage-empty' }, empty)]));
    const section = (title: string, hint: string, body: HTMLElement): HTMLElement =>
      h('section', { class: 'stage-section' }, h('h3', {}, title), hint ? h('p', { class: 'stage-hint' }, hint) : '', body);
    const touch = isTouch();
    const children: HTMLElement[] = [h('h2', {}, 'Choose your companions')];
    const limit = `(${me.companions.length + me.inactiveCompanions.length + me.resting.length}/${me.maxCompanions})`;

    if (mine.kind === 'companion.offer') {
      const buttons = h('div', { class: 'decision-buttons' },
        h('button', { class: 'btn primary', on: { click: () => this.deps.send({ type: 'companion.draw', decision }) } }, 'Draw a companion'),
        h('button', { class: 'btn', on: { click: () => this.deps.send({ type: 'companion.skip', decision }) } }, 'Skip'));
      children.push(
        section('Your companions ' + limit, 'Draw one companion at random, then decide whether to keep it. If you are at your companion limit, you will need to replace one.',
          row(mineCards, (c) => this.thumbButton(c, w), 'None yet.')),
        buttons);
    } else if (mine.kind === 'companion.place') {
      const buttons = h('div', { class: 'decision-buttons' });
      if (!mine.mustReplace) append(buttons, h('button', { class: 'btn primary', on: { click: () => this.deps.send({ type: 'companion.keep', decision, replace: null }) } }, 'Recruit'));
      append(buttons, h('button', { class: 'btn', on: { click: () => this.deps.send({ type: 'companion.discard', decision }) } }, 'Let them go'));
      children.push(
        section('You drew ' + getDef(mine.drawn.def).name, mine.mustReplace ? "You're at your companion limit: choose one to replace." : '',
          row([mine.drawn], (c) => this.thumbButton(c, w, 'drawn'), '')),
        section((mine.mustReplace ? 'Replace one of your companions ' : 'Or replace one of your companions ') + limit, touch ? 'Tap a companion to read it; tap again to replace it.' : 'Click a companion to replace it.',
          row(mineCards, (c) => this.thumbButton(c, w, mine.mustReplace ? 'playable' : '',
            this.confirmTap(v, decision, c, 'Replace ' + shortName(c.def), () => this.deps.send({ type: 'companion.keep', decision, replace: c.id }))), 'None yet.')),
        buttons);
    }
    const hero = me.hero
      ? h('aside', { class: 'stage-hero' }, h('h3', {}, 'Your hero'), this.thumbButton(me.hero, Math.min(w + 20, 210)))
      : '';
    replace(this.stage, h('div', { class: 'stage-panel' }, hero, h('div', { class: 'stage-main' }, ...children)));
  }

  private hint(key: string, decision: number, text: string): HTMLElement | '' {
    const seen = hintSeen.get(key) ?? { count: 0, decision: -1 };
    if (seen.decision !== decision) {
      seen.count++;
      seen.decision = decision;
      hintSeen.set(key, seen);
    }
    return seen.count <= HINT_SHOWS ? h('span', { class: 'hint' }, text) : '';
  }

  /**
   * Mouse or pen hover and keyboard focus preview a card. On touch, holding
   * the element pins the card instead (and doesn't trigger the button).
   */
  private previewOn(el: HTMLElement, def: string): void {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') this.inspect(def); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.inspect(null); });
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) this.inspect(def); });
    el.addEventListener('blur', () => this.inspect(null));
    onLongPress(el, () => this.inspect(def, true));
  }

  /**
   * The click handler for a card that does something when chosen.
   * Mouse: act at once (hovering already showed the card).
   * Touch: the first tap shows the card with the action button; a second tap on
   * the same card, or the button, confirms.
   */
  private confirmTap(v: GameView, decision: number, card: CardRef, label: string, act: () => void): () => void {
    return () => {
      if (!isTouch()) { act(); return; }
      if (this.armed?.card === card.id) { this.disarm(); act(); return; }
      this.armed = { decision, card: card.id };
      this.inspect(card.def, true, [{ label, primary: true, run: () => { this.disarm(); act(); } }]);
      this.pinnedFor = decision;
      this.renderDock(v);
    };
  }

  private disarm(): void {
    this.armed = null;
    if (this.pinnedActions.length) this.unpin();
  }

  private unpin(): void {
    this.pinned = null;
    this.pinnedCardId = null;
    this.pinnedActions = [];
    this.pinnedFor = null;
    this.inspect(null);
  }

  /** Toggle one pick of a multi-pick choice (read a card first with hover or a long press). */
  private selectTap(v: GameView, id: string, max: number): () => void {
    return () => { this.toggleSelect(id, max); this.renderDock(v); };
  }

  /**
   * Choices. Picking one thing works like bidding: a card is chosen by clicking it
   * (touch: tap to read, tap again), a plain option by its button. Picking several
   * toggles each, then Confirm.
   */
  private renderChoice(v: GameView, decision: number, c: Extract<NonNullable<PendingView['detail']>, { kind: 'choose' }>): void {
    const send = (picks: string[]) => this.deps.send({ type: 'choose', decision, picks });
    const single = c.max === 1;
    const pick = (value: string, card: CardRef, label: string) => single
      ? this.confirmTap(v, decision, card, `Choose ${label}`, () => send([value]))
      : this.selectTap(v, value, c.max);
    const confirm = h('button', { class: 'btn primary', on: { click: () => send([...this.selected]) } }, c.min === 0 && this.selected.size === 0 ? 'Skip' : 'Confirm');
    confirm.disabled = this.selected.size < c.min || this.selected.size > c.max;
    const finish = single
      ? c.min === 0 ? h('button', { class: 'btn', on: { click: () => send([]) } }, 'Skip') : ''
      : confirm;
    const touch = isTouch();
    const inHand = new Set(v.hand.map((x) => x.card.id));
    if (c.options.length && c.options.every((o) => inHand.has(o.value))) {
      // Pick straight from the hand below.
      append(this.prompt, h('span', {}, c.prompt),
        this.hint(single ? 'handPick' : 'handSelect', decision, single
          ? touch ? 'Tap a card to read it; tap again to choose it.' : 'Click a card in your hand to choose it.'
          : touch ? 'Tap cards to select them; hold one to read it.' : 'Click cards in your hand to select them.'),
        finish);
      this.renderHand(v, null, { options: new Set(c.options.map((o) => o.value)), tap: (card) => pick(card.id, card, shortName(card.def)) });
      return;
    }
    const cards = h('div', { class: 'options' });
    const texts = h('div', { class: 'decision-buttons' });
    const size = thumbSizes();
    for (const o of c.options) {
      if (o.card) {
        const ref: CardRef = { id: o.card.id ?? o.value, def: o.card.def };
        // Only label a card when the label says something the card doesn't (e.g. whose it is).
        const label = extraLabel(o.label, o.card.def);
        const picked = this.selected.has(o.value) || this.armed?.card === ref.id;
        const b = this.thumbButton(ref, size.option, `${picked ? 'selected' : 'playable'}${o.highlight ? ' hint-orange' : ''}`, pick(o.value, ref, label ?? shortName(ref.def)));
        cards.appendChild(label ? h('div', { class: 'option-card' }, b, h('div', { class: 'option-label' }, label)) : b);
      } else if (single) {
        // Plain choices (yes/no, a player, a stack): answer in one click.
        texts.appendChild(h('button', { class: 'btn', on: { click: () => send([o.value]) } }, o.label));
      } else {
        texts.appendChild(h('button', { class: `btn${this.selected.has(o.value) ? ' on' : ''}`, on: { click: () => { this.toggleSelect(o.value, c.max); this.renderDock(v); } } }, o.label));
      }
    }
    append(this.prompt, h('div', { class: 'decision' },
      cards.childElementCount ? cards : '',
      h('div', { class: 'decision-body' },
        h('div', { class: 'decision-title' }, c.source),
        h('div', { class: 'decision-text' }, c.prompt),
        cards.childElementCount && single ? this.hint('pickCard', decision, touch ? 'Tap a card to read it; tap again to choose it.' : 'Click a card to choose it.') : '',
        texts,
        finish ? h('div', { class: 'decision-buttons' }, finish) : '')));
    this.renderHand(v, null);
  }

  private toggleSelect(id: string, max: number): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else {
      if (this.selected.size >= max) this.selected.clear();
      this.selected.add(id);
    }
  }

  private renderHand(v: GameView, bidDecision: number | null, choice?: { options: Set<string>; tap: (card: CardRef) => () => void }): void {
    clear(this.hand);
    if (!v.you) return;
    if (v.hand.length === 0) {
      this.hand.appendChild(h('div', { class: 'hand-empty' }, 'No resource cards in hand.'));
      return;
    }
    const size = thumbSizes();
    const n = v.hand.length;
    // Fan: tilt grows from the centre out, to at most 20° at the ends.
    const maxTilt = Math.min(20, 2.5 * (n - 1));
    let i = -1;
    for (const { card, value } of v.hand) {
      i++;
      const def = getDef(card.def);
      const selectable = choice?.options.has(card.id) ?? false;
      const cls = this.selected.has(card.id) || this.armed?.card === card.id ? 'selected' : bidDecision || selectable ? 'playable' : '';
      const short = shortName(card.def);
      let onTap: (() => void) | undefined;
      if (selectable) onTap = choice!.tap(card);
      else if (bidDecision) {
        const faceDown = this.faceDown;
        onTap = this.confirmTap(v, bidDecision, card, faceDown ? `Bid ${short} face down` : `Bid ${short} (+${value})`, () => this.deps.send(faceDown
          ? { type: 'bid.play', decision: bidDecision, card: card.id, faceDown: true }
          : { type: 'bid.play', decision: bidDecision, card: card.id }));
      }
      const b = this.thumbButton(card, size.hand, cls, onTap);
      if (this.flying.has(card.id)) b.style.visibility = 'hidden';
      // What the card would contribute if bid right now: follows wands being disabled, locations and so on.
      if (def.kind === 'resource') {
        const council = def.council && value === 0;
        b.appendChild(h('span', { class: `value-chip${council ? ' council' : value < 0 ? ' neg' : value === 0 ? ' zero' : ''}`, title: council ? 'Council card' : 'Value if bid now' },
          council ? '★' : value > 0 ? `+${value}` : `${value}`));
      }
      const t = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      b.style.setProperty('--z', String(n - i));
      b.classList.add('fan');
      b.style.setProperty('--fan', `${(t * maxTilt).toFixed(2)}deg`);
      b.style.setProperty('--fan-y', `${(t * t * maxTilt * 0.5).toFixed(1)}px`);
      this.hand.appendChild(b);
    }
    this.fitHand();
  }

  /**
   * Keep the hand on one row: once another card would push it past the edge of the
   * screen, the cards overlap a little from left to right instead (hover shows a card in full).
   */
  private fitHand(): void {
    const cards = [...this.hand.children].filter((c): c is HTMLElement => c.classList.contains('card-btn'));
    const thumbs = cards.map((c) => c.querySelector<HTMLCanvasElement>('canvas.thumb'));
    for (const c of cards) c.style.marginLeft = '';
    const size0 = thumbSizes().hand;
    thumbs.forEach((t) => { if (t) t.style.width = `${size0}px`; });
    if (cards.length < 2 || document.body.classList.contains('shape-short')) return;
    const gap = 8;
    const cs = getComputedStyle(this.hand);
    const avail = this.hand.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16; // room for the fan tilt
    const n = cards.length;
    const MIN_STEP = 26; // how much of each card stays visible under its neighbour
    let w = size0;
    if ((n * w + (n - 1) * gap) <= avail) return; // fits as it is
    // Overlap first; if even that is not enough, make the cards smaller so the hand never scrolls.
    if ((avail - w) / (n - 1) < MIN_STEP) w = Math.max(44, Math.floor(avail - MIN_STEP * (n - 1)));
    thumbs.forEach((t) => { if (t) t.style.width = `${w}px`; });
    const step = Math.max(12, (avail - w) / (n - 1));
    cards.forEach((c, i) => { if (i > 0) c.style.marginLeft = `${Math.round(step - w - gap)}px`; });
  }

  /**
   * A card thumbnail button. `onTap` is what choosing it does; without one,
   * clicking or tapping just pins the card in the inspector (again to close).
   */
  private thumbButton(card: CardRef, width: number, extra = '', onTap?: () => void): HTMLButtonElement {
    const b = h('button', { class: `card-btn ${extra}`, aria: { label: getDef(card.def).name }, data: { def: card.def, id: card.id } }, cardThumb(card.def, width));
    this.previewOn(b, card.def);
    // Choosing a card (to bid it, recruit it, ...) sounds like picking it up.
    if (onTap) b.addEventListener('click', () => sfx.play('card-pickup'));
    b.addEventListener('click', onTap ?? (() => {
      if (this.pinned === card.def) this.unpin();
      else this.inspect(card.def, true);
    }));
    return b;
  }

  // --- inspector ------------------------------------------------------------------

  /**
   * Show a card. Without `pin` this is a hover preview that falls back to the
   * pinned card. `actions` (touch) add buttons such as "Bid this card".
   *
   * The card is shown as large as the space allows. Its rules text is repeated
   * as plain text only when the card ends up too small for its printed text to
   * be read (long abilities are printed smaller, so this depends on the card).
   */
  inspect(def: string | null, pin = false, actions: InspectAction[] = []): void {
    // A card open with an ability waiting (its OK and Skip buttons) stays put: passing the mouse over other cards
    // doesn't replace it. Close it with the × button, Esc or a click outside the card.
    if (!pin && this.pinned && this.pinnedActions.some((a) => a.ability)) return;
    if (pin) {
      this.pinned = def;
      this.pinnedActions = def ? actions : [];
      this.pinnedFor = null;
    }
    const show = def ?? this.pinned;
    if (!show) {
      this.closeAbility();
      this.inspector.classList.add('hidden');
      this.inspector.classList.remove('pinned');
      this.shownKey = '';
      return;
    }
    const isPinned = show === this.pinned;
    const acts = isPinned ? this.pinnedActions : [];
    const key = `${show}|${isPinned}|${acts.map((a) => a.label).join('/')}`;
    if (key === this.shownKey) return;
    this.shownKey = key;

    const d = getDef(show);
    const img = cardThumb(show, 400, 'inspect-img', true);
    tiltOnPointer(img); // leans a few degrees toward the mouse
    replace(this.inspector,
      img,
      h('div', { class: 'inspect-body' },
        h('div', { class: 'inspect-text' }, ...this.cardText(d)),
        // Not printed on the card: why the web edition changed it.
        d.revision ? h('p', { class: 'revised' }, `Revised for the web edition: ${d.revision}`) : '',
        acts.length ? h('div', { class: 'inspect-actions' },
          ...acts.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, on: { click: a.run } }, a.label)),
          h('button', { class: 'btn', on: { click: () => this.disarmAndRender() } }, 'Cancel')) : ''),
      isPinned ? h('button', { class: 'inspector-close', aria: { label: 'Close card' }, on: { click: () => this.disarmAndRender() } }, '×') : '');
    this.inspector.classList.toggle('pinned', isPinned);
    // Open on the side away from the mouse, so the card being pointed at stays visible.
    this.inspector.classList.toggle('on-right', this.pointer.x >= 0 && this.pointer.x < window.innerWidth / 2);
    this.inspector.classList.remove('hidden');
    // Lay out the card alone first; if its printed text comes out too small, add the text copy.
    this.inspector.classList.add('card-only');
    const r = img.getBoundingClientRect();
    const shownWidth = Math.min(r.width, (r.height * CARD_W) / CARD_H);
    if ((rulesTextSize(show) * shownWidth) / CARD_W < READABLE_PX) this.inspector.classList.remove('card-only');
  }

  /** A card's name and rules as plain text (the copy shown when the printed text would be too small to read). */
  private cardText(d: ReturnType<typeof getDef>): HTMLElement[] {
    const text: HTMLElement[] = [h('h3', { class: 'inspect-name' }, d.name)];
    if (d.kind === 'hero' || d.kind === 'companion') {
      if (d.abilityName) text.push(h('p', {}, h('strong', {}, d.abilityName), d.abilityText ? ` ${d.abilityText}` : ''));
      if (d.kind === 'hero' && d.triggerText) text.push(h('p', { class: 'trigger' }, `⚡ ${d.triggerText}`));
      if (d.kind === 'hero' && d.kinText) text.push(h('p', { class: 'trigger' }, `◆ ${d.kinText}`));
    } else if (d.conditionText) text.push(h('p', {}, d.conditionText));
    return text;
  }

  /**
   * A card with a usable ability: its picture flies up from the table to the middle of the screen and leans toward
   * the pointer. A green OK button floats to its left and a red Skip to its right, solid rounded shapes that lean
   * toward the pointer too. Clicking outside, Esc or × sends the card back.
   */
  private showAbility(def: string, cardId: string, actions: InspectAction[]): void {
    this.closeAbility(true);
    // The hover preview (and any pinned sheet) gives way to this view.
    this.inspector.classList.add('hidden');
    this.inspector.classList.remove('pinned');
    this.shownKey = '';

    const vw = window.innerWidth, vh = window.innerHeight;
    const btnW = vw < 600 ? 64 : 120;
    const gap = vw < 600 ? 10 : 26;
    const W = Math.round(Math.max(150, Math.min(420, vw - 2 * (btnW + gap) - 24, (vh - 120) / (CARD_H / CARD_W))));
    const H = (W * CARD_H) / CARD_W;
    const oks = actions.filter((a) => a.label === 'OK');
    const skips = actions.filter((a) => a.label === 'Skip');
    const many = oks.length > 1;

    const thumb = cardThumb(def, W, 'thumb', false, true); // the ability sentence in bold
    const face = h('div', { class: 'case-face' }, thumb);
    tiltOnPointer(face);
    const cardEl = h('div', { class: 'case-card' }, face,
      h('button', { class: 'ability-close', aria: { label: 'Close card' }, title: 'Close', on: { click: () => this.unpin() } }, '×'));
    cardEl.style.width = `${W}px`;
    cardEl.style.height = `${H}px`;

    const side = (cls: 'left' | 'right', acts: InspectAction[]): HTMLElement =>
      h('div', { class: `ability-side ${cls}` }, ...acts.map((a) => this.floatButton(a, many)));
    const row = h('div', { class: 'ability-row' }, side('left', oks), cardEl, side('right', skips));
    const layer = h('div', { class: 'ability-layer' }, row);
    layer.style.setProperty('--ab-w', `${btnW}px`);
    layer.style.setProperty('--ab-gap', `${gap}px`);
    layer.style.setProperty('--fb-h', `${vw < 600 ? 44 : 54}px`);
    // Small cards cannot be read: repeat the card's text under them.
    if ((rulesTextSize(def) * W) / CARD_W < READABLE_PX) layer.appendChild(h('div', { class: 'ability-text' }, ...this.cardText(getDef(def))));
    layer.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.fb-btn, .case-card, .ability-text')) this.unpin();
    });
    this.root.appendChild(layer);

    // Fly up from the card's place on the table (FLIP): start over it, end at the middle.
    const from = this.deps.cardRect(cardId);
    this.deps.hideCard(cardId, true);
    const target = cardEl.getBoundingClientRect();
    const slot = (r: { x: number; y: number; w: number; h: number } | null): string => r
      ? `translate(${r.x - (target.left + target.width / 2)}px, ${r.y - (target.top + target.height / 2)}px) scale(${r.w / W})`
      : 'translateY(120px) scale(0.4)';
    this.abilityView = { layer, cardEl, key: cardId, from, slot };
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'both' });
    cardEl.animate([{ transform: slot(from), opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    // The buttons float out from behind the card as it settles.
    layer.querySelectorAll<HTMLElement>('.fb-wrap').forEach((wrap, i) => {
      const dir = wrap.classList.contains('ok') ? -1 : 1;
      wrap.animate(
        [{ opacity: 0, transform: `translateX(${-dir * 60}px) scale(0.5)` }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay: 340 + i * 60, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'both' });
    });
  }

  /**
   * One floating button: a solid capsule (a face over a stack of darker slices, so it has thickness) that leans toward
   * the pointer, with a highlight that follows it. OK is green, Skip red.
   */
  private floatButton(a: InspectAction, caption: boolean): HTMLElement {
    const skip = a.label === 'Skip';
    const slices = Array.from({ length: 8 }, (_, i) => {
      const slice = h('span', { class: 'fb-slab' });
      slice.style.setProperty('--i', String(i + 1));
      return slice;
    });
    const body = h('span', { class: 'fb-body' }, ...slices, h('span', { class: 'fb-face' }, a.label));
    tiltOnPointer(body, 18);
    const name = a.ability?.name ?? '';
    const btn = h('button', { class: 'fb-btn', title: name, aria: { label: name ? `${a.label}: ${name}` : a.label }, on: { click: () => { sfx.play('click'); a.run(); } } }, body);
    return h('div', { class: `fb-wrap ${skip ? 'skip' : 'ok'}` }, h('span', { class: 'fb-shadow' }), btn, caption && name ? h('span', { class: 'fb-caption' }, name) : null);
  }

  /** Send the ability view away: back to the table, or (OK pressed) straight out, as the ability's own showcase flies the card up next. */
  private closeAbility(instant = false): void {
    const v = this.abilityView;
    if (!v) return;
    this.abilityView = null;
    const used = this.abilityUsed;
    this.abilityUsed = false;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      v.layer.remove();
      this.deps.hideCard(v.key, false);
    };
    if (instant) { release(); return; }
    if (used) {
      // Keep the table card hidden a little longer, so it does not blink back before the showcase takes it.
      const fade = v.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'both' });
      fade.finished.then(() => v.layer.remove(), () => v.layer.remove());
      window.setTimeout(release, 650);
      return;
    }
    const back = v.cardEl.animate([{ transform: 'none', opacity: 1 }, { transform: v.slot(v.from), opacity: 0.85 }], { duration: 420, easing: 'ease-in', fill: 'both' });
    v.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: 'both' });
    back.finished.then(release, release);
    window.setTimeout(release, 900); // in case frames stop
  }

  /** Close the pinned card and, if it was armed, un-highlight it in the dock. */
  private disarmAndRender(): void {
    const wasArmed = this.armed !== null;
    this.armed = null;
    this.unpin();
    if (wasArmed && this.view) this.renderDock(this.view);
  }

  // --- log, banners, results --------------------------------------------------------

  /** On wide screens an open log gets its own column (the table canvas shrinks). */
  private setLogOpen(open: boolean): void {
    this.logPanel.classList.toggle('collapsed', !open);
    document.body.classList.toggle('log-open', open);
  }

  log(text: string, cls = ''): void {
    const li = h('li', { class: cls }, text);
    this.logList.appendChild(li);
    while (this.logList.children.length > 300) this.logList.firstElementChild?.remove();
    this.logList.scrollTop = this.logList.scrollHeight;
  }

  /**
   * Announce an opponent's ability. It stays until clicked (or "Dismiss all").
   * `hitsYou` marks it as aimed at you.
   */
  announce(title: string, detail: string, def: string | null, hitsYou = false): void {
    const lines = h('div', { class: 'notice-lines' }, detail ? h('p', {}, detail) : '');
    const el = h('div', { class: `notice${hitsYou ? ' hits-you' : ''}`, role: 'button', tabindex: 0, title: 'Dismiss' });
    if (def) {
      const thumb = cardThumb(def, 44, 'notice-card');
      this.previewOn(thumb, def);
      el.appendChild(thumb);
    }
    append(el, h('div', { class: 'notice-body' },
      h('strong', { class: 'notice-title' }, title),
      lines,
      h('div', { class: 'notice-dismiss' }, isTouch() ? 'Tap to dismiss' : 'Click to dismiss')));
    const dismiss = () => {
      // A counter question has to be answered (Counter / Let it resolve), not dismissed.
      if (el.querySelector('.notice-counter')) return;
      el.remove();
      this.inspect(null);
      this.updateNotices();
    };
    el.addEventListener('click', dismiss);
    el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dismiss(); } });
    this.notices.insertBefore(el, this.notices.querySelector('.notice-all'));
    this.lastNotice = { el, lines, title, def };
    this.updateNotices();
    this.showCounter();
  }

  /** While the client is still presenting a message's events, the counter buttons wait for the announcement they belong in. */
  holdCounter(on: boolean): void {
    this.counterHeld = on;
    if (!on) this.showCounter();
  }

  /** Show (or with null, hide) the tooltip for a deck or discard pile next to the mouse. */
  deckTip(tip: { name: string; text?: string; lines?: string[]; count?: number } | null, x = 0, y = 0): void {
    if (!tip) { this.deckTipEl.classList.add('hidden'); return; }
    replace(this.deckTipEl,
      h('strong', {}, tip.name),
      tip.text ? h('p', {}, tip.text) : '',
      ...(tip.lines ?? []).map((l) => h('p', { class: 'deck-tip-line' }, l)),
      tip.count === undefined ? '' : h('div', { class: 'deck-tip-count' }, tip.count === 1 ? '1 card left' : `${tip.count} cards left`));
    this.deckTipEl.classList.remove('hidden');
    const w = this.deckTipEl.offsetWidth;
    const hgt = this.deckTipEl.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 16));
    const top = y + 18 + hgt > window.innerHeight ? Math.max(8, y - hgt - 14) : y + 18;
    this.deckTipEl.style.left = `${Math.round(left)}px`;
    this.deckTipEl.style.top = `${Math.round(top)}px`;
  }

  // --- flying cards and bolts over the page ------------------------------------------

  /** Centre of the hand card with this definition (for a card flying out of it), or null. */
  handCardCenter(def: string | null): { x: number; y: number } | null {
    const el = def ? this.hand.querySelector<HTMLElement>(`.card-btn[data-def="${def}"]`) : this.hand.querySelector<HTMLElement>('.card-btn');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /**
   * Cards drawn into your hand fly up from the resource deck and land in it.
   * The hand already shows them, so each is hidden until its flight ends.
   */
  flyDraw(cardIds: string[]): void {
    const deck = this.layout?.decks.resource;
    if (!deck || !cardIds.length) return;
    const from = this.deps.project(deck.x, 0.3, deck.z);
    cardIds.forEach((id, i) => {
      const target = this.hand.querySelector<HTMLElement>(`.card-btn[data-id="${id}"]`);
      if (!target) return;
      this.flying.add(id);
      target.style.visibility = 'hidden';
      const r = target.getBoundingClientRect();
      const w = Math.max(50, r.width);
      const { wrap, inner } = this.flipper(target.dataset['def'] ?? '', w);
      wrap.style.opacity = '0';
      this.root.appendChild(wrap);
      const dx0 = from.x - w / 2, dy0 = from.y - (w * CARD_H / CARD_W) / 2;
      const dx1 = r.left, dy1 = r.top;
      const DUR = 700, DELAY = i * 130;
      // Travel face down, then turn over as it settles into the hand.
      const move = wrap.animate([
        { transform: `translate(${dx0}px, ${dy0}px) scale(0.45) rotate(-12deg)`, opacity: 1 },
        { transform: `translate(${(dx0 + dx1) / 2}px, ${Math.min(dy0, dy1) - 50}px) scale(0.85) rotate(6deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx1}px, ${dy1}px) scale(1) rotate(0deg)`, opacity: 1 },
      ], { duration: DUR, delay: DELAY, easing: 'ease-out', fill: 'both' });
      inner.animate([
        { transform: 'rotateY(0deg)', offset: 0 },
        { transform: 'rotateY(0deg)', offset: 0.45 },
        { transform: 'rotateY(180deg)', offset: 0.85 },
        { transform: 'rotateY(180deg)', offset: 1 },
      ], { duration: DUR, delay: DELAY, easing: 'ease-in-out', fill: 'both' });
      const done = (): void => {
        wrap.remove();
        this.flying.delete(id);
        const now = this.hand.querySelector<HTMLElement>(`.card-btn[data-id="${id}"]`);
        if (now) now.style.visibility = '';
      };
      move.finished.then(done, done);
    });
  }

  private flier(source: HTMLCanvasElement, width: number): HTMLCanvasElement {
    const c = h('canvas', { class: 'fly-card' });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round((width * CARD_H / CARD_W) * dpr);
    c.style.width = `${width}px`;
    c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  /** A card that can flip: its back on one side, its face (`def`) on the other. `inner` is what turns. */
  private flipper(def: string, width: number): { wrap: HTMLElement; inner: HTMLElement } {
    const hgt = width * CARD_H / CARD_W;
    const back = h('canvas', { class: 'flip-face flip-back' });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    back.width = Math.round(width * dpr);
    back.height = Math.round(hgt * dpr);
    back.style.width = `${width}px`;
    back.getContext('2d')!.drawImage(cardBack('resource'), 0, 0, back.width, back.height);
    const front = cardThumb(def, width, 'thumb');
    front.classList.add('flip-face', 'flip-front');
    const inner = h('div', { class: 'flip-inner' }, back, front);
    const wrap = h('div', { class: 'fly-card flip-wrap' }, inner);
    wrap.style.width = `${width}px`;
    wrap.style.height = `${hgt}px`;
    return { wrap, inner };
  }

  /** What each hand card looked like and where it was, taken just before the hand is redrawn. */
  snapshotHand(): Map<string, { x: number; y: number; w: number; def: string }> {
    const out = new Map<string, { x: number; y: number; w: number; def: string }>();
    for (const el of this.hand.querySelectorAll<HTMLElement>('.card-btn[data-id]')) {
      const r = el.getBoundingClientRect();
      out.set(el.dataset['id']!, { x: r.left, y: r.top, w: r.width, def: el.dataset['def']! });
    }
    return out;
  }

  /** A card you discarded leaves your hand at once and flies to the resource discard pile. */
  flyDiscard(from: { x: number; y: number; w: number; def: string } | undefined): void {
    const pile = this.layout?.discards.resource;
    if (!from || !pile) return;
    const to = this.deps.project(pile.x, 0.3, pile.z);
    const face = cardThumb(from.def, from.w, 'thumb');
    const wrap = h('div', { class: 'fly-card' }, face);
    this.root.appendChild(wrap);
    const x1 = to.x - from.w * 0.3, y1 = to.y - (from.w * CARD_H / CARD_W) * 0.3;
    const a = wrap.animate([
      { transform: `translate(${from.x}px, ${from.y}px) scale(1) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${(from.x + x1) / 2}px, ${Math.min(from.y, y1) - 40}px) scale(0.75) rotate(8deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.42) rotate(-6deg)`, opacity: 0.9 },
    ], { duration: 480, easing: 'ease-in', fill: 'both' });
    a.finished.then(() => wrap.remove(), () => wrap.remove());
  }

  /** The hand card with this id: its centre on screen, for something landing on it. */
  handCardById(id: string): { x: number; y: number } | null {
    const el = this.hand.querySelector<HTMLElement>(`.card-btn[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** A crackling bolt drawn over the page between two screen points (used when an end is a card in your hand). */
  screenBolt(a: { x: number; y: number }, b: { x: number; y: number }, theme: Theme): Promise<void> {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bolt-layer');
    const pal = PALETTE[theme];
    const { glow, core } = pal;
    const mk = (color: string, width: number, opacity: number): SVGPathElement => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', String(width));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('opacity', String(opacity));
      svg.appendChild(p);
      return p;
    };
    const outer = mk(glow, 9, 0.35), mid = mk(pal.accent, 4, 0.7), inner = mk(core, 1.8, 1);
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', glow);
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('cx', String(b.x));
    ring.setAttribute('cy', String(b.y));
    ring.setAttribute('r', '0');
    svg.appendChild(ring);
    this.root.appendChild(svg);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const path = (reach: number, wobble: number): string => {
      const n = 14;
      let d = `M${a.x},${a.y}`;
      for (let i = 1; i <= n; i++) {
        const t = (i / n) * reach;
        const env = Math.sin(Math.PI * (i / n));
        const j = (Math.random() - 0.5) * wobble * env;
        d += ` L${a.x + (b.x - a.x) * t + nx * j},${a.y + (b.y - a.y) * t + ny * j}`;
      }
      return d;
    };
    const start = performance.now();
    const TOTAL = 520, DRAW = 0.42;
    let finish: () => void = () => undefined;
    const done = new Promise<void>((r) => { finish = r; });
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / TOTAL);
      const reach = Math.min(1, k / DRAW);
      outer.setAttribute('d', path(reach, 46 * pal.wobble));
      mid.setAttribute('d', path(reach, 30 * pal.wobble));
      inner.setAttribute('d', path(reach, 22 * pal.wobble));
      const fade = k < DRAW ? 1 : 1 - (k - DRAW) / (1 - DRAW);
      svg.style.opacity = String(Math.max(0, fade));
      if (k >= DRAW) { ring.setAttribute('r', String((8 + ((k - DRAW) / (1 - DRAW)) * 46) * pal.ring)); ring.setAttribute('opacity', String(fade)); }
      if (k < 1) requestAnimationFrame(step);
      else { svg.remove(); finish(); }
    };
    requestAnimationFrame(step);
    window.setTimeout(() => { svg.remove(); finish(); }, TOTAL + 600); // in case frames stop
    return done;
  }

  /**
   * An ability being used: its card flies up to the middle and is shown large, with who used it
   * (and against whom) above it and its text highlighted. A click sends it back; Aldric's
   * counter question, when there is one, is answered here instead of with a click.
   */
  showcase(o: {
    def: string; title: string; subtitle: string; name: string; text: string; results: string[]; theme: Theme;
    from: { x: number; y: number; w: number; h: number } | null;
  }): Promise<void> {
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = Math.round(Math.max(160, Math.min(340, vw - 40, (vh - 330) / (CARD_H / CARD_W))));
    const H = W * CARD_H / CARD_W;
    const counter = this.counter;
    this.counter = null; // answered here, not in an announcement
    return new Promise<void>((resolve) => {
      const thumb = cardThumb(o.def, W, 'thumb', false, true); // ability sentence in bold
      // The face is what leans toward the pointer; the card element itself flies in and out.
      const face = h('div', { class: 'case-face' }, thumb);
      tiltOnPointer(face);
      const cardEl = h('div', { class: 'case-card' }, face);
      cardEl.style.width = `${W}px`;
      cardEl.style.height = `${H}px`;
      // The letters of the ability text on the card glow and pulse (the letters only, not the box they sit in).
      const lit = ruleGlowCanvas(o.def);
      if (lit) {
        lit.classList.add('case-glow');
        face.appendChild(lit);
      }
      const lines = o.results.slice(0, 4).map((t) => h('p', { class: 'case-result' }, t));
      const foot = h('div', { class: 'case-foot' });
      // Who used it, against whom and what happened, in a box so it stands out from the table behind.
      const layer = h('div', { class: 'case-layer' },
        h('div', { class: 'case-title' }, h('strong', {}, o.title), o.subtitle ? h('div', {}, o.subtitle) : '', ...lines),
        cardEl, foot);
      this.root.appendChild(layer);

      // Fly in from the card's place on the table (FLIP): start over it, end at the middle.
      const target = cardEl.getBoundingClientRect();
      layer.insertBefore(this.themedLight(o.theme, target), layer.firstChild);
      const slot = (r: { x: number; y: number; w: number; h: number } | null) => r
        ? `translate(${r.x - (target.left + target.width / 2)}px, ${r.y - (target.top + target.height / 2)}px) scale(${r.w / W})`
        : 'translateY(120px) scale(0.4)';
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'both' });
      cardEl.animate([{ transform: slot(o.from), opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });

      let closing = false;
      const close = (): void => {
        if (closing) return;
        closing = true;
        const back = cardEl.animate([{ transform: 'none', opacity: 1 }, { transform: slot(o.from), opacity: 0.85 }], { duration: 420, easing: 'ease-in', fill: 'both' });
        layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, fill: 'both' });
        const end = (): void => { layer.remove(); resolve(); };
        back.finished.then(end, end);
        window.setTimeout(end, 900); // in case frames stop
      };
      if (counter) {
        // The ability has not happened yet: answer here.
        foot.append(...counter.options.map((opt) => h('button', {
          class: `btn${opt.value === 'counter' ? ' primary' : ''}`,
          on: { click: (ev) => { ev.stopPropagation(); this.deps.send({ type: 'choose', decision: counter.decision, picks: [opt.value] }); close(); } },
        }, opt.label)));
      } else {
        foot.append(h('div', { class: 'case-hint' }, isTouch() ? 'Tap to continue' : 'Click to continue'));
        layer.addEventListener('click', close);
        window.addEventListener('keydown', function onKey(ev) {
          if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape') { window.removeEventListener('keydown', onKey); close(); }
        });
      }
    });
  }

  /**
   * The light behind a shown ability card, in the ability's theme: hex is a green and purple spell
   * circle of runes; a boon rises in gold; insight is thin cool rays; a draw streams toward the deck;
   * a shield is still, with a ring; a trade orbits.
   */
  private themedLight(theme: Theme, card: DOMRect): HTMLElement {
    const light = h('div', { class: `case-light theme-${theme}`, aria: { hidden: 'true' } }, h('div', { class: 'case-rays' }), h('div', { class: 'case-halo' }));
    const big = Math.max(card.width, card.height);
    const cx = card.left + card.width / 2, cy = card.top + card.height / 2;
    light.style.left = `${Math.round(cx)}px`;
    light.style.top = `${Math.round(cy)}px`;
    const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
    const px = (n: number): string => `${Math.round(n)}px`;

    if (theme === 'hex') {
      // A spell circle: two rings and a ring of runes turning slowly the other way.
      const ring = h('div', { class: 'case-circle' });
      const R = big * 0.72;
      ring.style.width = px(R * 2);
      ring.style.height = px(R * 2);
      const inner = h('div', { class: 'case-circle inner' });
      inner.style.width = px(R * 1.7);
      inner.style.height = px(R * 1.7);
      for (let i = 0; i < RUNES.length; i++) {
        const rune = h('span', { class: 'case-rune' }, RUNES[i]!);
        rune.style.transform = `rotate(${(i * 360) / RUNES.length}deg) translateY(${px(-R * 0.86)})`;
        ring.appendChild(rune);
      }
      light.append(ring, inner);
    }
    if (theme === 'shield') light.appendChild(h('div', { class: 'case-shield-ring' }));

    // Where the sparkles go depends on the theme.
    const deck = this.layout?.decks.resource;
    const aim = theme === 'draw' && deck ? this.deps.project(deck.x, 0.3, deck.z) : null;
    const dir = aim ? { x: aim.x - cx, y: aim.y - cy } : null;
    const dlen = dir ? Math.hypot(dir.x, dir.y) || 1 : 1;
    for (let i = 0; i < 22; i++) {
      const spark = h('i', { class: 'case-spark' });
      const ang = Math.random() * Math.PI * 2;
      const r0 = big * rnd(0.42, 0.56);
      let x0 = Math.cos(ang) * r0, y0 = Math.sin(ang) * r0, x1 = x0, y1 = y0;
      if (theme === 'boon') { x1 = x0 + rnd(-20, 20); y1 = y0 - rnd(90, 190); } // rises
      else if (theme === 'draw' && dir) {
        // Sparkles gather around the card and stream the way the cards will go (toward the deck).
        x0 = rnd(-card.width / 2, card.width / 2); y0 = rnd(-card.height / 2, card.height / 2);
        const reach = rnd(0.35, 0.7) * Math.min(dlen, 520);
        x1 = x0 + (dir.x / dlen) * reach + rnd(-16, 16); y1 = y0 + (dir.y / dlen) * reach + rnd(-16, 16);
      } else if (theme === 'insight' || theme === 'shield') { x1 = x0 + rnd(-6, 6); y1 = y0 + rnd(-6, 6); } // twinkle in place
      else if (theme === 'trade') { spark.classList.add('orbit'); spark.style.setProperty('--a', `${Math.round(ang * 57.3)}deg`); spark.style.setProperty('--r0', px(r0)); }
      else { x1 = Math.cos(ang) * big * rnd(0.75, 1.2); y1 = Math.sin(ang) * big * rnd(0.75, 1.2); } // hex: drift outward
      spark.style.setProperty('--x0', px(x0)); spark.style.setProperty('--y0', px(y0));
      spark.style.setProperty('--x1', px(x1)); spark.style.setProperty('--y1', px(y1));
      spark.style.setProperty('--s', `${rnd(3, 8).toFixed(1)}px`);
      spark.style.animationDuration = `${rnd(1.6, 3.4).toFixed(2)}s`;
      spark.style.animationDelay = `${rnd(0, 2.4).toFixed(2)}s`;
      light.appendChild(spark);
    }
    return light;
  }

  /** Resolves once no announcement is open (immediately if none is). */
  /**
   * A new location: its name fades in, then its ability under it, then a hint. Resolves when the player clicks
   * (or presses Enter or Space), after the card has faded out.
   */
  showPlace(name: string, renown: number, ability: string | null, quote: string | null): Promise<void> {
    return new Promise((resolve) => {
      const hint = h('div', { class: 'place-hint' }, 'Click to continue');
      const el = h('div', { class: 'place' },
        h('div', { class: 'place-title' }, name),
        h('div', { class: 'place-renown' }, `Renown ${renown}`),
        ability ? h('div', { class: 'place-ability' }, ability) : quote ? h('div', { class: 'place-ability place-quote' }, quote) : null,
        hint);
      el.style.setProperty('--ability-delay', '1.3s');
      el.style.setProperty('--hint-delay', ability || quote ? '2.4s' : '1.5s');
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', key, true);
        el.classList.add('out');
        setTimeout(() => { el.remove(); resolve(); }, 600);
      };
      const key = (e: KeyboardEvent): void => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } };
      // Ignore the click that may still be in flight from the last action.
      setTimeout(() => el.addEventListener('pointerdown', finish), 500);
      window.addEventListener('keydown', key, true);
      append(this.root, el);
    });
  }

  noticesClosed(): Promise<void> {
    if (!this.notices.querySelector('.notice')) return Promise.resolve();
    return new Promise((resolve) => this.noticeWaiters.push(resolve));
  }

  /** Put Aldric's Counter / Let it resolve buttons into the announcement of the ability in question. */
  private showCounter(): void {
    const c = this.counter;
    if (!c || this.counterHeld) return;
    const n = this.lastNotice;
    if (!n || !n.el.isConnected) {
      this.announce(c.prompt, '', null);
      return; // announce() calls back in
    }
    if (n.el.querySelector('.notice-counter')) return;
    const answer = (value: string) => {
      n!.el.remove();
      this.counter = null;
      this.updateNotices();
      this.deps.send({ type: 'choose', decision: c.decision, picks: [value] });
    };
    const row = h('div', { class: 'notice-counter' },
      ...c.options.map((o) => h('button', { class: `btn${o.value === 'counter' ? ' primary' : ''}`, on: { click: (e) => { e.stopPropagation(); answer(o.value); } } }, o.label)));
    n.el.querySelector('.notice-dismiss')?.replaceWith(row);
    n.el.classList.add('hits-you');
  }

  /** Add what an ability did to its announcement (a new one if that was already dismissed). */
  addToAnnouncement(text: string, hitsYou: boolean): void {
    const n = this.lastNotice;
    if (!n || !n.el.isConnected) {
      this.announce(n?.title ?? 'Ability', text, n?.def ?? null, hitsYou);
      return;
    }
    // The title already names the card: drop a leading "Card name: " from the log text.
    const names = n.def ? [getDef(n.def).name, shortName(n.def)] : [];
    const prefix = names.map((x) => `${x}: `).find((p) => text.startsWith(p));
    const line = prefix ? text.slice(prefix.length) : text;
    n.lines.appendChild(h('p', {}, line.charAt(0).toUpperCase() + line.slice(1)));
    if (hitsYou) n.el.classList.add('hits-you');
  }

  /** With two or more announcements up, offer to dismiss them all at once. */
  private updateNotices(): void {
    const count = this.notices.querySelectorAll('.notice').length;
    let all = this.notices.querySelector<HTMLElement>('.notice-all');
    if (count >= 2 && !all) {
      all = h('button', { class: 'btn notice-all', on: { click: () => {
        for (const el of this.notices.querySelectorAll('.notice')) if (!el.querySelector('.notice-counter')) el.remove();
        this.inspect(null);
        this.updateNotices();
      } } }, 'Dismiss all');
      this.notices.appendChild(all);
    } else if (count < 2) all?.remove();
    // While an announcement is open, nothing else can be acted on (and the client waits before showing more).
    document.body.classList.toggle('notice-open', count > 0);
    if (count === 0) { const w = this.noticeWaiters; this.noticeWaiters = []; for (const r of w) r(); }
  }

  banner(text: string, kind = '', ms = 1600): void {
    const el = h('div', { class: kind ? `banner banner-${kind}` : 'banner' }, text);
    this.banners.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 600);
  }

  /** After the encounter: who won, and what every card added to every total (stays up until clicked, or a while). */
  showResult(r: TurnResult, v: GameView): void {
    const rows = [...r.rows].sort((a, b) => b.total - a.total);
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const part = (p: TurnResult['rows'][number]['parts'][number]) => h('span', { class: `rp rp-${p.kind}`, title: p.kind }, p.kind === 'kin' ? '◆ Kin ' : `${p.label} `, h('b', {}, sign(p.value)));
    replace(this.resultPanel,
      h('h3', {}, r.winner ? `${nameOf(v, r.winner)} ${r.winner === v.you ? 'win' : 'wins'} the location!` : r.tied ? `A tie: the location is lost, and ${r.tied.map((p) => nameOf(v, p)).join(' and ')} each draw a new one.` : 'Nobody survived: the location is lost.'),
      h('div', { class: 'result-rows' }, ...rows.map((row) => h('div', { class: `result-row ${row.player === r.winner || r.tied?.includes(row.player) ? 'win' : row.survived ? '' : 'fail'}` },
        h('div', { class: 'result-head' },
          h('strong', {}, nameOf(v, row.player)),
          h('span', { class: 'result-sum' }, `${row.total}`, h('small', {}, ` vs ${row.difficulty} (${STAT_NAMES[r.stat]})`)),
          h('span', { class: 'result-badge' }, row.player === r.winner ? '👑 wins' : r.tied?.includes(row.player) ? 'tied' : row.survived ? 'survived' : '💀 falls')),
        h('div', { class: 'result-parts' }, ...row.parts.filter((p) => p.value !== 0 || p.kind === 'hero').map(part))))),
      h('p', { class: 'result-hint' }, 'Tap to close'),
    );
    this.resultPanel.classList.remove('hidden');
    clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => this.resultPanel.classList.add('hidden'), 16000);
  }

  hideResult(): void { clearTimeout(this.resultTimer); this.resultPanel.classList.add('hidden'); }

  // --- modals -----------------------------------------------------------------

  private openModal(...children: (HTMLElement | string)[]): void {
    replace(this.modal, h('div', { class: 'modal', role: 'dialog', aria: { modal: 'true' } },
      h('button', { class: 'modal-close', aria: { label: 'Close' }, on: { click: () => this.closeModal() } }, '×'),
      ...children));
    this.modal.classList.remove('hidden');
  }

  closeModal(): void {
    if (this.modal.dataset['gameover']) return;
    this.modal.classList.add('hidden');
    clear(this.modal);
  }

  private showRules(): void {
    this.openModal(
      h('h2', {}, 'House rules'),
      h('p', { class: 'muted' }, 'Where the v0.3 rules leave a gap, this is how the game currently plays it.'),
      h('dl', { class: 'rules' }, ...RULE_NOTES.flatMap((n) => [h('dt', {}, n.topic), h('dd', {}, n.ruling)])),
    );
  }

  private confirmNewGame(): void {
    this.openModal(
      h('h2', {}, 'Start a new game?'),
      h('p', {}, 'The current game will be abandoned.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', on: { click: () => { this.closeModal(); this.deps.newGame(); } } }, 'New game'),
        h('button', { class: 'btn', on: { click: () => this.closeModal() } }, 'Keep playing')),
    );
  }

  private showGameOver(v: GameView): void {
    const standings = [...v.players].sort((a, b) => b.renown - a.renown);
    this.openModal(
      h('h2', {}, v.winner === v.you ? 'Victory! The Marches are yours.' : `${nameOf(v, v.winner)} holds the Marches.`),
      h('ol', { class: 'standings' }, ...standings.map((p) => h('li', {}, `${p.id === v.you ? `${p.name} (you)` : p.name}: ${p.renown} Renown, ${p.claimed.length} location${p.claimed.length === 1 ? '' : 's'}`))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', on: { click: () => { delete this.modal.dataset['gameover']; this.closeModal(); this.deps.newGame(); } } }, 'Play again')),
    );
    this.modal.dataset['gameover'] = '1';
  }

  dispose(): void {
    closeGameMenu();
    this.closeAbility(true);
    document.body.classList.remove('log-open', 'notice-open');
    const w = this.noticeWaiters;
    this.noticeWaiters = [];
    for (const r of w) r();
    clear(this.root);
  }
}
