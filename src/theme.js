// Design tokens. Two palettes — day and night — plus per-category colour and
// the depth tokens (inset ring, top highlight, contact + ambient shadow) that
// make a tile read as a physical object rather than a rectangle (spec §11).

const CATEGORY = {
  nurse:    { day: '#C8811E', night: '#F0B45E' },
  bottle:   { day: '#2F8F4E', night: '#5FD189' },
  night:    { day: '#4A55C7', night: '#8E97F5' },
  nap:      { day: '#5B6ACD', night: '#9AA4F7' },
  tummy:    { day: '#C0398A', night: '#F27BC0' },
  wet:      { day: '#1D8FA8', night: '#54D0E8' },
  poop:     { day: '#94522A', night: '#D08E58' },
  vitd:     { day: '#2C6FD1', night: '#77AEF9' },
  weight:   { day: '#7A46C4', night: '#B58BF0' },
  expected: { day: '#0E8C8C', night: '#4FD4D4' },
  massage:  { day: '#B0543C', night: '#EF9277' },
  exercise: { day: '#3E7F6A', night: '#6FC5A6' },
};

const day = {
  name: 'day',
  // Warm linen, deep enough that the white cards lift off it without relying
  // on their shadows. The card gradient's bottom step is warmed to match, so a
  // cool-tinted card does not sit on a warm ground.
  bg: '#EEE9E1',
  bgTint: '#E4DED4',
  surface: '#FFFFFF',
  surfaceTop: '#FFFFFF',
  surfaceBottom: '#F8F6F2',
  ink: '#14131A',
  inkSoft: '#6E6B7B',
  inkFaint: '#9C99A8',
  line: 'rgba(20,19,26,0.09)',
  ring: 'inset 0 0 0 0.5px rgba(20,19,26,0.08)',
  highlight: 'inset 0 1px 0 rgba(255,255,255,0.9)',
  shadowContact: '0 1px 2px rgba(20,19,26,0.10)',
  shadowAmbient: '0 8px 24px rgba(20,19,26,0.07)',
  good: '#1E8A4C',
  warn: '#B26A00',
  bad: '#C0362C',
};

const night = {
  name: 'night',
  bg: '#0C0C11',
  bgTint: '#131320',
  surface: '#17161F',
  surfaceTop: '#1C1B26',
  surfaceBottom: '#141320',
  ink: '#F4F3F8',
  inkSoft: '#A5A2B4',
  inkFaint: '#6F6C7E',
  line: 'rgba(255,255,255,0.10)',
  ring: 'inset 0 0 0 0.5px rgba(255,255,255,0.10)',
  highlight: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  shadowContact: '0 1px 2px rgba(0,0,0,0.55)',
  shadowAmbient: '0 10px 28px rgba(0,0,0,0.45)',
  good: '#4FD98A',
  warn: '#F0B45E',
  bad: '#FF7A6E',
};

/** Colour for a category in the active theme. */
export function categoryColor(theme, key) {
  const entry = CATEGORY[key];
  if (!entry) return theme.ink;
  return entry[theme.name];
}

/** A soft wash of a category colour, for icon wells and active tiles. */
export function categoryTint(theme, key, alpha = 0.14) {
  const hex = categoryColor(theme, key);
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export const THEMES = { day, night };

/** Night runs 20:00–08:00 local; day otherwise (spec §11). */
export function themeForHour(hour) {
  return hour >= 20 || hour < 8 ? 'night' : 'day';
}

export function autoThemeName(now = Date.now()) {
  return themeForHour(new Date(now).getHours());
}

/**
 * The next 08:00/20:00 boundary after `now`. A manual override lasts until this
 * moment and then automation resumes, so the toggle never fights the clock.
 */
export function nextThemeBoundary(now = Date.now()) {
  const d = new Date(now);
  const h = d.getHours();
  const boundary = new Date(now);
  boundary.setMinutes(0, 0, 0);
  if (h < 8) boundary.setHours(8);
  else if (h < 20) boundary.setHours(20);
  else {
    boundary.setDate(boundary.getDate() + 1);
    boundary.setHours(8);
  }
  return boundary.getTime();
}

/**
 * Resolve the theme to render: the automatic one, unless a manual override is
 * still inside its window.
 */
export function resolveTheme(override, now = Date.now()) {
  const auto = autoThemeName(now);
  if (override && override.name && override.until > now && override.name !== auto) {
    return THEMES[override.name] || THEMES[auto];
  }
  return THEMES[auto];
}
