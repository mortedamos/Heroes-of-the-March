// Human-readable text for events (game log, banners).

import { getDef, STAT_NAMES, type ClientEvent, type GameView } from '../engine';

export function nameOf(view: GameView, pid: string | null): string {
  if (!pid) return 'Nobody';
  if (pid === view.you) return 'You';
  return view.players.find((p) => p.id === pid)?.name ?? pid;
}

const card = (def: string) => getDef(def).name;

export function describe(e: ClientEvent, view: GameView): string | null {
  const who = (pid: string | null) => nameOf(view, pid);
  switch (e.type) {
    case 'turnStarted': return `— Turn ${e.turn}: ${who(e.player)}${e.player === view.you ? ' take' : ' takes'} the lead —`;
    case 'drew':
      if (e.deck === 'companion') return null;
      if (e.cards) return `${who(e.player)} drew ${e.cards.map((c) => card(c.def)).join(', ')}${e.reason && e.reason !== 'Start of turn' ? ` (${e.reason})` : ''}.`;
      return `${who(e.player)} drew ${e.count} resource${e.count === 1 ? '' : 's'}${e.reason && e.reason !== 'Start of turn' ? ` (${e.reason})` : ''}.`;
    case 'heroChanged': return e.reason === 'fell'
      ? `${who(e.player)}: ${card(e.to.def)} takes up the banner.`
      : `${who(e.player)} ${e.player === view.you ? 'ride' : 'rides'} out with ${card(e.to.def)}.`;
    case 'companionPlayed': return e.replaced
      ? `${who(e.player)} recruited ${card(e.card.def)}, replacing ${card(e.replaced.def)}.`
      : `${who(e.player)} recruited ${card(e.card.def)}.`;
    case 'companionDiscarded': return `${who(e.player)} discarded ${card(e.card.def)} (${e.reason}).`;
    case 'companionDeclined': return `${who(e.player)} passed on ${card(e.card.def)}.`;
    case 'companionSkipped': return null;
    case 'companionFaceDown': return `${who(e.player)}: ${card(e.card.def)} ${e.faceDown ? 'is turned face down' : 'returns'}.`;
    case 'locationRevealed': return `Location: ${card(e.card.def)} (Renown ${(getDef(e.card.def) as { renown?: number }).renown ?? '?'}).`;
    case 'locationReplaced': return `${e.reason}: ${card(e.from.def)} is replaced by ${card(e.to.def)}.`;
    case 'extraLocation': return 'A second location is placed face down. The winner claims both.';
    case 'encounterRevealed': return `Encounter: ${card(e.card.def)}!`;
    case 'minionDrawn': return `…with ${card(e.card.def)} as a minion.`;
    case 'challengeSelected': return `Challenge: ${STAT_NAMES[e.stat]} ${e.difficulty}.`;
    case 'bid': return e.card ? `${who(e.player)} bid ${card(e.card.def)}${e.faceUp ? '' : ' face down'}.` : `${who(e.player)} bid a card face down.`;
    case 'passed': return e.auto ? null : `${who(e.player)} passed.`;
    case 'revealed': return `${who(e.player)} revealed ${card(e.card.def)}.`;
    case 'resourceDiscarded': return `${who(e.player)} discarded ${card(e.card.def)} (${e.reason}).`;
    case 'councilHero': return `${card(e.card.def)} rides to ${e.player === view.you ? 'your' : `${who(e.player)}'s`} side.`;
    case 'ability': return `${e.source}: ${e.player ? who(e.player) + ' ' : ''}${e.text}.`;
    case 'outcome': {
      const r = e.result;
      const parts = r.rows.map((row) => `${who(row.player)} ${row.total}${row.survived ? '' : ' ✗'}`);
      return `Totals (${STAT_NAMES[r.stat]}): ${parts.join(', ')}. ${r.winner ? `${who(r.winner)} ${r.winner === view.you ? 'win' : 'wins'}!` : r.tied ? `A tie between ${r.tied.map((p) => who(p)).join(' and ')}: the location is discarded and each draws a new one.` : 'Nobody survives.'}`;
    }
    case 'renownGained': return `${who(e.player)} ${e.player === view.you ? 'claim' : 'claims'} ${e.locations.map((l) => card(l.def)).join(' and ')} (+${e.amount} Renown, ${e.total} total).`;
    case 'fallPrevented': return `${e.source} saves ${e.player === view.you ? 'your' : `${who(e.player)}'s`} hero from falling.`;
    case 'heroFalls': return `${who(e.player)} failed. The hero falls.`;
    case 'gameOver': return `Game over. ${who(e.winner)} ${e.winner === view.you ? 'hold' : 'holds'} the Marches!`;
    case 'gameStarted': return 'The Marchstone has split. The heroes ride out.';
    case 'shuffled': case 'turnEnded': case 'effectCancelled': return null;
    case 'companionMinion': return `${who(e.player)} ${e.player === view.you ? 'lose' : 'loses'} ${card(e.card.def)} to the Infectious Zombie: it joins the encounter as a minion.`;
    case 'encounterReplaced': return `${e.reason}: ${card(e.from.def)} is driven off.`;
    case 'abilityZap': return null;
    case 'abilityIgnored': return `${who(e.player)}: ${short(e.by.def)} shrugs off ${short(e.source.def)}.`;
    case 'abilityCountered': return `${who(e.player)} ${e.player === view.you ? 'counter' : 'counters'} ${short(e.source.def)} with ${short(e.by.def)}.`;
    case 'abilityUsed': return `${who(e.player)}: ${short(e.source.def)}. ${e.label}.`;
    case 'effect': return describeEffect(e, view);
    case 'cardShown': return `${who(e.player)} ${e.player === view.you ? 'turn' : 'turns'} up ${card(e.card.def)} (${e.reason}).`;
    case 'peeked': return `${who(e.player)} ${e.player === view.you ? 'look' : 'looks'} at the top ${e.count === 1 ? 'card' : `${e.count} cards`} of the ${e.deck} stack.`;
    case 'bottomed': return `${who(e.player)} ${e.player === view.you ? 'put' : 'puts'} the top ${e.deck} card on the bottom.`;
    case 'bidClaimed': return `${who(e.to)} ${e.to === view.you ? 'pocket' : 'pockets'} one of ${e.from === view.you ? 'your' : `${who(e.from)}'s`} face-down cards!`;
    case 'bidsSwapped': return `An Apple for the Road: ${who(e.a)} ${e.a === view.you ? 'take' : 'takes'} ${card(e.aCard.def)} from ${who(e.b)}, leaving the Apple.`;
    case 'cardsTraded': return e.gave && e.got
      ? `Royal Requisition: ${who(e.from)} gave ${card(e.gave.def)} to ${who(e.to)} and took ${card(e.got.def)}.`
      : `Royal Requisition: ${who(e.from)} traded a card with ${who(e.to)}.`;
  }
}

function short(def: string): string {
  return getDef(def).name.split(',')[0]!;
}

function describeEffect(e: Extract<ClientEvent, { type: 'effect' }>, view: GameView): string {
  const who = (pid: string | null) => nameOf(view, pid);
  const src = short(e.source.def);
  const target = e.targetCard ? short(e.targetCard.def) : '';
  const stat = (s: string | undefined) => (s === 'all' ? 'all stats' : s ? STAT_NAMES[s as 'P' | 'M' | 'G'] : '');
  const ef = e.effect;
  switch (ef.kind) {
    case 'silenceCompanion': return `${src}: ${target} contributes nothing this turn.`;
    case 'forceCompanionStat': return `${src}: ${target} must contribute ${stat(ef.stat)}.`;
    case 'forceHeroStat': return `${src}: ${e.targetPlayer === view.you ? 'your' : `${who(e.targetPlayer)}'s`} hero must contribute ${stat(ef.stat)}.`;
    case 'statBonus': return `${src}: ${who(e.targetPlayer)} ${(ef.amount ?? 0) >= 0 ? 'gain' : 'lose'}${e.targetPlayer === view.you ? '' : 's'} ${Math.abs(ef.amount ?? 0)} to ${stat(ef.stat)}.`;
    case 'heroMultiplier': return `${src}: ${e.targetPlayer === view.you ? 'your' : `${who(e.targetPlayer)}'s`} hero's stats are doubled.`;
    case 'negateBid': return `${src}: ${target} now counts as zero!`;
    case 'disableAbilities': return `${src}: ${target}'s ability is disabled for the rest of the turn.`;
    case 'autoWin': return `${src}: ${who(e.targetPlayer)} will take the location, whatever the totals!`;
    case 'grudgeWatch': return `${src}: ${who(e.targetPlayer)} ${e.targetPlayer === view.you ? 'are' : 'is'} watched. An ability used against the grudge-holder's hero or companions draws them a resource.`;
    case 'grudge': return `${src}: if ${who(e.targetPlayer)} win${e.targetPlayer === view.you ? '' : 's'} this encounter, ${e.targetPlayer === view.you ? 'you have' : 'they have'} -${ef.amount ?? 3} in the next.`;
  }
}
