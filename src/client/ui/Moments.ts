// The turn timeline: six dots at the top of the screen showing where the turn is, with the moments at which one of
// your cards can act marked by a small diamond. Tap it for what happens at each moment and which of your cards act there.

import { abilityOf } from '../../engine/abilities';
import { getDef, type GameView } from '../../engine';
import { attentionOf } from '../attention';
import { h, replace } from './dom';

interface Moment { short: string; name: string; text: string; windows: string[] }

export const MOMENTS: readonly Moment[] = [
  { short: 'Start', name: 'Start of turn', text: 'Hands refill and resting companions return.', windows: ['turnStart'] },
  { short: 'Location', name: 'After the location is revealed', text: 'The location and the encounter come into play.', windows: ['afterLocation'] },
  { short: 'Before', name: 'Before bidding', text: 'Your last chance to act before any card is played. Every player gets a turn.', windows: ['beforeBidding'] },
  { short: 'Bidding', name: 'During bidding', text: 'In turn, play a resource or pass. Some abilities are offered on your turn to bid.', windows: ['bidding'] },
  { short: 'Reveal', name: 'Before the reveal', text: 'Bidding is over; face-down cards are still hidden.', windows: ['beforeReveal'] },
  { short: 'End', name: 'End of bidding', text: 'Every card is turned over. Then comes the result.', windows: ['endOfBidding'] },
];

/** Which moment a turn step belongs to (-1: no timeline, 6: the turn is over). */
export function momentIndex(step: string): number {
  switch (step) {
    case 'turnStart': case 'winTurnStart': case 'companions': return 0;
    case 'location': case 'winAfterLocation': case 'encounter': case 'challenge': return 1;
    case 'winBeforeBidding': return 2;
    case 'bidding': return 3;
    case 'winBeforeReveal': case 'reveal': return 4;
    case 'winEndOfBidding': return 5;
    case 'resolve': case 'turnEnd': return 6;
    default: return -1;
  }
}

/** For each moment, the short names of your cards that can act there (this turn: "own turn" abilities only on yours). */
export function myCardsByMoment(view: GameView): string[][] {
  const out: string[][] = MOMENTS.map(() => []);
  const me = view.players.find((p) => p.id === view.you);
  if (!me?.hero) return out;
  const mine = view.turn.active === view.you;
  for (const ref of [me.hero, ...me.companions]) {
    const acts = abilityOf(ref.def)?.activations;
    if (!acts) continue;
    const name = getDef(ref.def).name.split(',')[0]!;
    MOMENTS.forEach((m, i) => {
      if (acts.some((a) => a.windows.some((w) => m.windows.includes(w)) && (a.turn !== 'own' || mine)) && !out[i]!.includes(name)) out[i]!.push(name);
    });
  }
  return out;
}

export class MomentStrip {
  readonly el = h('div', { class: 'moments hidden' });
  private readonly bar = h('button', { class: 'moments-bar', type: 'button', aria: { label: 'Turn timeline', expanded: 'false' } });
  private readonly panel = h('div', { class: 'moments-panel hidden', role: 'dialog', aria: { label: 'Moments of a turn' } });
  private open = false;
  private lastView: GameView | null = null;

  constructor() {
    this.el.append(this.bar, this.panel);
    this.bar.addEventListener('click', () => this.setOpen(!this.open));
    document.addEventListener('pointerdown', (e) => { if (this.open && !this.el.contains(e.target as Node)) this.setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.setOpen(false); });
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.panel.classList.toggle('hidden', !open);
    this.el.classList.toggle('open', open);
    this.bar.setAttribute('aria-expanded', String(open));
    if (open && this.lastView) this.renderPanel(this.lastView);
  }

  update(view: GameView): void {
    this.lastView = view;
    const cur = view.turn.number ? momentIndex(view.turn.step) : -1;
    this.el.classList.toggle('hidden', cur < 0);
    if (cur < 0) { this.setOpen(false); return; }
    const mine = myCardsByMoment(view);
    const ready = attentionOf(view).length > 0;
    const dots = MOMENTS.map((m, i) => h('span', {
      class: `moment-dot${i < cur ? ' done' : ''}${i === cur ? ' now' : ''}${mine[i]!.length ? ' has' : ''}${i === cur && ready ? ' ready' : ''}`,
      title: m.name,
    }));
    const name = cur >= MOMENTS.length ? 'Result' : MOMENTS[cur]!.short;
    replace(this.bar, ...dots, h('span', { class: 'moment-name' }, name));
    this.bar.title = cur >= MOMENTS.length ? 'The turn is over' : MOMENTS[cur]!.name;
    if (this.open) this.renderPanel(view);
  }

  private renderPanel(view: GameView): void {
    const cur = view.turn.number ? momentIndex(view.turn.step) : -1;
    const mine = myCardsByMoment(view);
    replace(this.panel,
      h('div', { class: 'moments-title' }, 'A turn'),
      ...MOMENTS.map((m, i) => h('div', { class: `moments-row${i === cur ? ' now' : ''}` },
        h('div', { class: 'moments-row-name' }, `${i + 1}. ${m.name}`),
        h('div', { class: 'moments-row-text' }, m.text),
        mine[i]!.length ? h('div', { class: 'moments-row-mine' }, `Yours: ${mine[i]!.join(', ')}`) : null)),
      h('div', { class: 'moments-foot' }, 'Then the result is worked out and the next turn begins. ◆ marks a moment when one of your cards can act.'));
  }
}
