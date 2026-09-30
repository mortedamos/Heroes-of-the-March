// The music popover: play/pause, previous/next track, volume and mute.
// One instance lives on the page for the whole session; the top bar button
// just opens it under itself.

import { music } from '../audio/Music';
import { sfx } from '../audio/Sfx';
import { h, replace } from './dom';

const panel = h('div', { class: 'music-menu hidden', role: 'dialog', aria: { label: 'Music' } });
let anchor: HTMLElement | null = null;
let mounted = false;

function render(): void {
  const pos = music.trackNumber;
  const vol = h('input', { type: 'range', aria: { label: 'Music volume' } });
  vol.min = '0'; vol.max = '100'; vol.step = '1';
  vol.value = String(Math.round((music.muted ? 0 : music.volume) * 100));
  vol.addEventListener('input', () => music.setVolume(Number(vol.value) / 100));
  const fx = h('input', { type: 'range', aria: { label: 'Sound effects volume' } });
  fx.min = '0'; fx.max = '100'; fx.step = '1';
  fx.value = String(Math.round((sfx.muted ? 0 : sfx.volume) * 100));
  fx.addEventListener('input', () => sfx.setVolume(Number(fx.value) / 100));
  fx.addEventListener('change', () => sfx.play('effect-negative')); // a sample at the new level
  replace(panel,
    h('div', { class: 'music-title' }, 'Music'),
    h('div', { class: 'music-track' }, music.track + (pos ? ` (${pos[0]}/${pos[1]})` : '')),
    h('div', { class: 'music-buttons' },
      h('button', { class: 'btn', title: 'Previous track', on: { click: () => music.next(-1) } }, '⏮'),
      h('button', { class: 'btn', title: music.playing ? 'Pause' : 'Play', on: { click: () => music.toggle() } }, music.playing ? '⏸' : '▶'),
      h('button', { class: 'btn', title: 'Next track', on: { click: () => music.next() } }, '⏭'),
      h('button', { class: 'btn', title: music.muted ? 'Unmute' : 'Mute', on: { click: () => music.setMuted(!music.muted) } }, music.muted ? '🔇' : '🔊')),
    h('label', { class: 'music-vol' }, h('span', {}, 'Music'), vol, h('span', { class: 'music-pct' }, `${vol.value}%`)),
    h('label', { class: 'music-vol' }, h('span', {}, 'Effects'), fx, h('span', { class: 'music-pct' }, `${fx.value}%`)),
  );
}

function place(): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 6)}px`;
  panel.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
}

function mount(): void {
  if (mounted) return;
  mounted = true;
  document.body.appendChild(panel);
  music.onChange(() => {
    // Don't rebuild the slider while it is being dragged.
    if (!panel.classList.contains('hidden') && !panel.contains(document.activeElement)) render();
    else if (!panel.classList.contains('hidden')) {
      const pos = music.trackNumber;
      const t = panel.querySelector('.music-track');
      if (t) t.textContent = music.track + (pos ? ` (${pos[0]}/${pos[1]})` : '');
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('hidden') && !panel.contains(e.target as Node) && !anchor?.contains(e.target as Node)) panel.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.add('hidden'); });
  window.addEventListener('resize', place);
}

export function toggleMusicMenu(button: HTMLElement): void {
  mount();
  anchor = button;
  if (panel.classList.contains('hidden')) {
    render();
    place();
    panel.classList.remove('hidden');
  } else panel.classList.add('hidden');
}
