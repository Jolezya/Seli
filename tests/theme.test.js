import { describe, it, expect } from 'vitest';
import { themeForHour, resolveTheme, nextThemeBoundary, categoryColor, categoryTint, THEMES } from '../src/theme.js';

describe('automatic day/night theme', () => {
  it('is night from 20:00 to 08:00 local', () => {
    expect(themeForHour(21)).toBe('night');
    expect(themeForHour(3)).toBe('night');
    expect(themeForHour(7)).toBe('night');
    expect(themeForHour(8)).toBe('day');
    expect(themeForHour(19)).toBe('day');
    expect(themeForHour(20)).toBe('night');
  });

  it('ends the manual override at the next boundary, then resumes automation', () => {
    const noon = new Date(2026, 7, 30, 12, 0).getTime();
    const boundary = nextThemeBoundary(noon);
    expect(new Date(boundary).getHours()).toBe(20);

    const override = { name: 'night', until: boundary };
    expect(resolveTheme(override, noon).name).toBe('night');          // override holds
    expect(resolveTheme(override, boundary + 1000).name).toBe('night'); // auto agrees by then
    expect(resolveTheme(override, new Date(2026, 7, 31, 9, 0).getTime()).name).toBe('day'); // expired
  });

  it('rolls the boundary to tomorrow morning late at night', () => {
    const lateNight = new Date(2026, 7, 30, 23, 0).getTime();
    const b = new Date(nextThemeBoundary(lateNight));
    expect(b.getHours()).toBe(8);
    expect(b.getDate()).toBe(31);
  });

  it('gives every category a colour and a tint in both themes', () => {
    for (const theme of Object.values(THEMES)) {
      expect(categoryColor(theme, 'nurse')).toMatch(/^#/);
      expect(categoryTint(theme, 'nurse')).toMatch(/^rgba\(/);
      expect(categoryColor(theme, 'unknown-category')).toBe(theme.ink);
    }
  });
});
