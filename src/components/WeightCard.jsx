// Weight tracker: current weight, how it is trending, and where the chosen
// growth trajectory says it should be (spec §7).

import React, { useMemo, useState } from 'react';
import { Card, CardTitle, Chip, Button, Muted } from '../ui.jsx';
import { categoryColor } from '../theme.js';
import {
  weightSummary, inRange, RANGES, expectedAt, formatGrams, clampGain,
  MIN_GAIN, MAX_GAIN,
} from '../lib/weight.js';
import { shortDate, toDateInput, fromDateInput, localNoon, DAY } from '../lib/time.js';

export default function WeightCard({ theme, events, store, now }) {
  const [adding, setAdding] = useState(false);
  const [showToday, setShowToday] = useState(true);
  const [draft, setDraft] = useState({ date: toDateInput(now), grams: '' });

  const gain = store.prefs.gain;
  const range = store.prefs.weightRange;
  const accent = categoryColor(theme, 'weight');
  const expectedColor = categoryColor(theme, 'expected');

  const summary = useMemo(() => weightSummary(events, gain, now), [events, gain, now]);
  const visible = useMemo(() => inRange(summary.list, range, now), [summary.list, range, now]);

  const submit = (e) => {
    e.preventDefault();
    const ts = fromDateInput(draft.date) ?? now;
    if (store.setWeight(ts, draft.grams)) {
      setAdding(false);
      setDraft({ date: toDateInput(now), grams: '' });
    }
  };

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <Chip theme={theme} accent={expectedColor} active={showToday} onClick={() => setShowToday((v) => !v)}>Today</Chip>
            <Chip theme={theme} accent={accent} active={adding} onClick={() => setAdding((v) => !v)}>Add</Chip>
          </div>
        }
      >Weight</CardTitle>

      {adding && (
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            style={inputStyle(theme, { flex: '1 1 130px' })}
          />
          <input
            type="number"
            inputMode="numeric"
            placeholder="grams"
            value={draft.grams}
            onChange={(e) => setDraft((d) => ({ ...d, grams: e.target.value }))}
            style={inputStyle(theme, { flex: '1 1 90px' })}
          />
          <Button theme={theme} tone="accent" type="submit">Save</Button>
        </form>
      )}

      {summary.latest ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em',
              color: theme.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
            }}>{formatGrams(summary.latest.amount)}</div>
            {summary.change != null && (
              <div style={{ fontSize: 13, fontWeight: 600, color: summary.change >= 0 ? theme.good : theme.bad }}>
                {summary.change >= 0 ? '+' : ''}{summary.change} g
              </div>
            )}
            <Muted theme={theme}>{shortDate(summary.latest.start_ts)}</Muted>
          </div>

          {summary.projection && (
            <Muted theme={theme} style={{ marginTop: 4 }}>
              ≈ {summary.projection.perDay >= 0 ? '+' : ''}{Math.round(summary.projection.perDay)} g/day ·
              {' '}next weigh-in {shortDate(summary.projection.nextTs)} ≈ {formatGrams(summary.projection.nextWeight)}
            </Muted>
          )}

          {summary.expected && (
            <Muted theme={theme} style={{ marginTop: 2, color: expectedColor }}>
              Expected by {shortDate(summary.expected.at)}: {formatGrams(summary.expected.weight)}
              {' · '}
              <span style={{ color: summary.expected.diff >= 0 ? theme.good : theme.warn }}>
                {summary.expected.diff >= 0 ? '+' : ''}{summary.expected.diff} g vs expected
              </span>
            </Muted>
          )}

          {showToday && summary.expected?.today != null && (
            <Muted theme={theme} style={{ marginTop: 2 }}>
              Today she should weigh ≈ {formatGrams(summary.expected.today)}
              {summary.expected.weighedToday != null && ` · weighed ${formatGrams(summary.expected.weighedToday)}`}
            </Muted>
          )}

          <WeightChart
            theme={theme}
            points={visible}
            nadirPoint={summary.nadirPoint}
            gain={gain}
            now={now}
            showToday={showToday}
            accent={accent}
            expectedColor={expectedColor}
          />
        </>
      ) : (
        <Muted theme={theme} style={{ padding: '8px 0 4px' }}>
          No weigh-ins yet — tap <strong>Add</strong> to record the first one.
        </Muted>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginTop: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <Chip
              key={r.key}
              theme={theme}
              accent={accent}
              active={range === r.key}
              onClick={() => store.setPrefs({ weightRange: r.key })}
            >{r.label}</Chip>
          ))}
        </div>

        {/* Expected-gain stepper: one number, adjusted +/-1, clamped to sane. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Stepper theme={theme} onClick={() => store.setPrefs({ gain: gain - 1 })} disabled={gain <= MIN_GAIN}>−</Stepper>
          <span style={{ fontSize: 12, color: theme.inkSoft, fontVariantNumeric: 'tabular-nums', minWidth: 62, textAlign: 'center' }}>
            {clampGain(gain)} g/day
          </span>
          <Stepper theme={theme} onClick={() => store.setPrefs({ gain: gain + 1 })} disabled={gain >= MAX_GAIN}>+</Stepper>
        </div>
      </div>

      <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
        solid = actual · <span style={{ color: expectedColor }}>dashed</span> = expected {clampGain(gain)} g/day from lowest weigh-in
      </Muted>
    </Card>
  );
}

function Stepper({ theme, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none', border: `1px solid ${theme.line}`, background: 'transparent',
        color: theme.ink, width: 28, height: 28, borderRadius: 9, fontSize: 15,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, padding: 0,
      }}
    >{children}</button>
  );
}

function inputStyle(theme, extra) {
  return {
    border: `1px solid ${theme.line}`,
    background: theme.bg,
    color: theme.ink,
    borderRadius: 10,
    padding: '9px 10px',
    fontSize: 13,
    minWidth: 0,
    ...extra,
  };
}

/**
 * The chart. Responsive by construction: an SVG viewBox at 100% width, so it
 * can never blow the layout out horizontally (spec §11).
 */
function WeightChart({ theme, points, nadirPoint, gain, now, showToday, accent, expectedColor }) {
  const W = 320;
  const H = 150;
  const pad = { top: 14, right: 12, bottom: 20, left: 8 };

  if (!points.length) return null;

  const todayTs = localNoon(now);
  const xs = points.map((p) => p.start_ts);
  const rawMin = Math.min(...xs);
  const rawMax = Math.max(...xs, showToday ? todayTs : -Infinity);

  // With a single weigh-in — which is what every new user has — the domain
  // would be zero-wide and the point would pin to the left edge. Pad it out so
  // the first weigh-in sits centred and legible.
  let minX = rawMin;
  let maxX = rawMax;
  if (maxX - minX < DAY) {
    const mid = (minX + maxX) / 2;
    minX = mid - DAY / 2;
    maxX = mid + DAY / 2;
  }
  const spanX = maxX - minX;

  // The expected line runs from the nadir to the right edge of the chart.
  const expectedStart = nadirPoint ? Math.max(minX, nadirPoint.start_ts) : null;
  const expectedPoints = nadirPoint
    ? [
        { ts: expectedStart, amount: expectedAt(nadirPoint, gain, expectedStart) },
        { ts: maxX, amount: expectedAt(nadirPoint, gain, maxX) },
      ]
    : [];

  const ys = [...points.map((p) => p.amount), ...expectedPoints.map((p) => p.amount)];
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(maxY - minY, 100);

  const x = (ts) => pad.left + ((ts - minX) / spanX) * (W - pad.left - pad.right);
  const y = (g) => pad.top + (1 - (g - minY) / spanY) * (H - pad.top - pad.bottom);
  // Keep value labels inside the box instead of letting them run off an edge.
  const labelX = (ts) => Math.max(pad.left + 12, Math.min(W - pad.right - 12, x(ts)));

  const actualPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.start_ts).toFixed(1)},${y(p.amount).toFixed(1)}`).join(' ');
  const expectedPath = expectedPoints.length
    ? expectedPoints.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.amount).toFixed(1)}`).join(' ')
    : null;

  const todayExpected = showToday && nadirPoint ? expectedAt(nadirPoint, gain, todayTs) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 150, display: 'block', marginTop: 12, overflow: 'visible' }}
      role="img"
      aria-label="Weight over time with expected trajectory"
    >
      {expectedPath && (
        <path d={expectedPath} fill="none" stroke={expectedColor} strokeWidth="1.5" strokeDasharray="5 4" />
      )}
      {expectedPoints.length > 0 && (
        <text
          x={Math.min(x(expectedPoints[1].ts), W - 26)}
          y={y(expectedPoints[1].amount) - 6}
          fontSize="9"
          fill={expectedColor}
          textAnchor="end"
        >{expectedPoints[1].amount}</text>
      )}

      <path d={actualPath} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <g key={p.id}>
          <circle cx={x(p.start_ts)} cy={y(p.amount)} r="3" fill={accent} />
          <text
            x={labelX(p.start_ts)}
            y={y(p.amount) - 7}
            fontSize="9"
            fill={theme.inkSoft}
            textAnchor="middle"
          >{p.amount}</text>
        </g>
      ))}

      {todayExpected != null && (
        <g>
          <circle cx={x(todayTs)} cy={y(todayExpected)} r="4" fill="none" stroke={expectedColor} strokeWidth="1.5" />
          <line
            x1={x(todayTs)} y1={pad.top} x2={x(todayTs)} y2={H - pad.bottom}
            stroke={expectedColor} strokeWidth="0.75" strokeDasharray="2 3" opacity="0.5"
          />
        </g>
      )}

      {/* Axis labels name the real weigh-in dates, not the padded domain. */}
      <text x={pad.left} y={H - 6} fontSize="9" fill={theme.inkFaint}>{shortDate(rawMin)}</text>
      {shortDate(rawMax) !== shortDate(rawMin) && (
        <text x={W - pad.right} y={H - 6} fontSize="9" fill={theme.inkFaint} textAnchor="end">{shortDate(rawMax)}</text>
      )}
    </svg>
  );
}
