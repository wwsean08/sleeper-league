import { describe, expect, it } from 'vitest';
import { applyTheme } from '../../src/web/theme';

describe('applyTheme', () => {
  it('sets CSS variables on :root', () => {
    applyTheme({
      colors: { bg: '#000', surface: '#111', text: '#fff', accent: '#f0f', good: '#0f0', alert: '#f00' },
      fontFamily: 'Comic Sans MS',
    });
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--color-accent')).toBe('#f0f');
    expect(s.getPropertyValue('--color-bg')).toBe('#000');
    expect(s.getPropertyValue('--font-main')).toBe('Comic Sans MS');
  });
});
