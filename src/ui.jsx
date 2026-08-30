// Shared visual primitives. Styles are inline objects driven by the theme
// tokens — no CSS framework, because the look is custom and a component library
// would only get in the way (spec §2, §11).

import React, { useState, useCallback } from 'react';
import { categoryTint } from './theme.js';

export const MAX_WIDTH = 560;

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** A short haptic tick where the device supports it. */
export function haptic(ms = 15) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate && !prefersReducedMotion()) {
      navigator.vibrate(ms);
    }
  } catch { /* vibration is a nicety, never a failure */ }
}

/** The layered-depth surface used by every card and tile. */
export function surfaceStyle(theme, { radius = 20, active = false, accent = null } = {}) {
  const shadows = [theme.ring, theme.highlight, theme.shadowContact, theme.shadowAmbient];
  if (active && accent) shadows.push(`0 0 0 1.5px ${accent}`, `0 0 20px ${categoryTint(theme, 'nurse', 0)}`);
  return {
    borderRadius: radius,
    background: `linear-gradient(180deg, ${theme.surfaceTop} 0%, ${theme.surfaceBottom} 100%)`,
    boxShadow: shadows.join(', '),
  };
}

export function Card({ theme, children, style, ...rest }) {
  return (
    <section
      style={{ ...surfaceStyle(theme, { radius: 22 }), padding: 16, marginBottom: 14, ...style }}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardTitle({ theme, children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
      <h2 style={{
        margin: 0, fontSize: 11, letterSpacing: '0.09em', textTransform: 'uppercase',
        color: theme.inkSoft, fontWeight: 700,
      }}>{children}</h2>
      {right}
    </div>
  );
}

/** A pill-shaped selector. `active` gets the accent fill. */
export function Chip({ theme, active, onClick, children, accent, style, title }) {
  const color = accent || theme.ink;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        appearance: 'none',
        border: `1px solid ${active ? color : theme.line}`,
        background: active ? color : 'transparent',
        color: active ? (theme.name === 'night' ? '#0C0C11' : '#FFFFFF') : theme.inkSoft,
        borderRadius: 999,
        padding: '6px 11px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Button({ theme, onClick, children, tone = 'plain', style, disabled, title, type = 'button' }) {
  const tones = {
    plain: { bg: 'transparent', fg: theme.ink, border: theme.line },
    accent: { bg: theme.ink, fg: theme.bg, border: 'transparent' },
    danger: { bg: 'transparent', fg: theme.bad, border: theme.bad },
  };
  const t = tones[tone] || tones.plain;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.fg,
        borderRadius: 12,
        padding: '9px 13px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/**
 * A pressable surface with the tactile press animation: transform-only so it
 * stays on the compositor at 60fps, and skipped entirely under
 * prefers-reduced-motion (spec §11).
 */
export function Pressable({ children, onClick, style, scale = 0.965, ariaLabel, ...rest }) {
  const [pressed, setPressed] = useState(false);
  const release = useCallback(() => setPressed(false), []);
  const reduced = prefersReducedMotion();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onPointerDown={() => setPressed(true)}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e); }
      }}
      onClick={(e) => { haptic(); onClick?.(e); }}
      style={{
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        touchAction: 'manipulation',
        transform: pressed && !reduced ? `scale(${scale})` : 'scale(1)',
        transition: reduced ? 'none' : 'transform 170ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * An emoji icon. Renders the colour emoji image where it loads, and falls back
 * to the text emoji — which is what happens offline, and is perfectly fine.
 */
export function Emoji({ char, size = 26, style }) {
  const [failed, setFailed] = useState(false);
  const url = emojiImageUrl(char);

  if (failed || !url) {
    return (
      <span style={{ fontSize: size * 0.92, lineHeight: 1, ...style }} role="img" aria-hidden="true">
        {char}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ display: 'block', width: size, height: size, ...style }}
    />
  );
}

/** Codepoint-derived URL, so any emoji resolves without a lookup table. */
export function emojiImageUrl(char) {
  if (!char) return null;
  const points = [...char]
    .map((c) => c.codePointAt(0))
    .filter((cp) => cp !== 0xfe0f && cp !== 0x200d);
  if (!points.length) return null;
  const name = points.map((cp) => cp.toString(16)).join('_');
  return `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/128/emoji_u${name}.png`;
}

/** The tinted rounded "well" an icon sits in. */
export function IconWell({ theme, category, char, size = 44 }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: size * 0.32,
      background: categoryTint(theme, category, theme.name === 'night' ? 0.20 : 0.13),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto',
      boxShadow: theme.ring,
    }}>
      <Emoji char={char} size={size * 0.58} />
    </div>
  );
}

export function Eyebrow({ theme, children, color }) {
  return (
    <div style={{
      fontSize: 10.5,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      fontWeight: 700,
      color: color || theme.inkSoft,
    }}>{children}</div>
  );
}

/** Small muted line used for subtitles and captions. */
export function Muted({ theme, children, size = 12, style }) {
  return <div style={{ fontSize: size, color: theme.inkSoft, ...style }}>{children}</div>;
}

export function Divider({ theme, style }) {
  return <div style={{ height: 1, background: theme.line, margin: '12px 0', ...style }} />;
}
