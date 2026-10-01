// Entry point: set up a local game (you vs bots).
//
// Everything goes through the same pieces a networked game will use:
// GameHost (authoritative) <-> JSON transport <-> GameClient. Swapping
// LocalTransport for a WebSocket transport is the multiplayer hook.

import './styles.css';
import { GameClient } from './client/GameClient';
import { rulesFor, showSetup } from './client/ui/SetupScreen';
import { GameHost } from './net/GameHost';
import { BotSeat, LocalTransport } from './net/local';
import { syncBodyClasses } from './client/viewport';
import { music } from './client/audio/Music';
import './client/fonts';

music.autoStart();
syncBodyClasses();
window.addEventListener('resize', () => syncBodyClasses());
// A tablet can gain or lose a mouse mid-game.
window.matchMedia('(hover: none)').addEventListener('change', () => syncBodyClasses());

const stage = document.getElementById('stage')!;
const overlay = document.getElementById('overlay')!;
const BOT_NAMES = ['Rowan', 'Perrin', 'Bram', 'Mirela', 'Tamsin'];
// Starts loading while the setup screen is up; card faces need it before they're drawn.

let teardown: (() => void) | null = null;

async function newGame(): Promise<void> {
  teardown?.();
  teardown = null;
  music.setOpening(true); // the menu and the opening phases share the hero-selection track
  const choice = await showSetup(document.body);
  const seats = [
    { id: 'p0', name: choice.name },
    ...BOT_NAMES.slice(0, choice.bots).map((name, i) => ({ id: `p${i + 1}`, name })),
  ];
  const host = new GameHost({ players: seats, autoPause: true, rules: rulesFor(choice) });
  const bots = seats.slice(1).map((s) => new BotSeat(host, s.id, choice.level));
  const client = new GameClient(stage, overlay, new LocalTransport(host, 'p0'), () => void newGame());
  teardown = () => {
    host.close();
    bots.forEach((b) => b.close());
    client.dispose();
  };
}

void newGame();
