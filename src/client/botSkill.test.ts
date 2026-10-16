import { describe, expect, it } from 'vitest';
import { BOT_SKILLS, DEFAULT_SKILL, parseSkill } from './ui/botSkill';

describe('bot skill choices', () => {
  it('has Easy, Normal and Hard, in that order, each with a tooltip', () => {
    expect(BOT_SKILLS.map((s) => [s.id, s.label])).toEqual([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]);
    for (const s of BOT_SKILLS) expect(s.tip.length).toBeGreaterThan(5);
  });

  it('is Normal unless chosen otherwise, and an unknown saved value falls back to it', () => {
    expect(DEFAULT_SKILL).toBe('normal');
    expect(parseSkill(undefined)).toBe('normal');
    expect(parseSkill('brutal')).toBe('normal');
    expect(parseSkill('hard')).toBe('hard');
    expect(parseSkill('easy')).toBe('easy');
  });
});
