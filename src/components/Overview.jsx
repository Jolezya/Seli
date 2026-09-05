// Overview: "what happened in the last day, and is that normal?"
//
// Three views of the same events, each answering a different question a
// parent actually has:
//   1. The last 24 hours against the household's usual — is today normal?
//   2. The last 24 hours laid out on a clock — what shape did the day have?
//   3. The last week (or two, or four) day by day — which way is it going?
//
// Every window here ends *now* rather than at midnight. At 3am "today" holds
// three hours of data and answers nothing; the last 24 hours is a full picture
// at any hour, and it compares fairly against whole-day averages because both
// are 24 hours long.

import React, { useMemo, useState } from 'react';
import { Card, CardTitle, Chip, Muted, Button } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import {
  dailyTotals, windowTotals, baseline, timelineData, longestSleep,
  feedGapInWindow, weekOverWeek, formatGap, BASELINE_MIN_DAYS,
  periodRange, usualByElapsed,
} from '../lib/analytics.js';
import {
  HOUR, MINUTE, clockTime, formatDuration, dayLabel, startOfLocalDay, addDays,
  toDateInput, fromDateInput, dayKey,
} from '../lib/time.js';

const WINDOWS = [7, 14, 30];

/** The four things the overview tracks, in a fixed order that never changes. */
const METRICS = [
  { key: 'feeds',    label: 'Feeds', category: 'nurse', unit: 'count' },
  { key: 'sleepMin', label: 'Sleep', category: 'night', unit: 'minutes' },
  { key: 'wet',      label: 'Wet',   category: 'wet',   unit: 'count' },
  { key: 'poop',     label: 'Poop',  category: 'poop',  unit: 'count' },
];

function formatValue(metric, value) {
  if (metric.unit === 'minutes') {
    if (value < 60) return `${Math.round(value)}m`;
    return `${(value / 60).toFixed(1)}h`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A period as the picker holds it. */
const DEFAULT_A = { kind: '24h', date: null };
const DEFAULT_B = { kind: 'yesterday', date: null };

function periodLabel(period, range, now) {
  if (period.kind === '24h') return 'Last 24 hours';
  if (period.kind === 'today') return 'Today so far';
  if (period.kind === 'yesterday') return 'Yesterday';
  return dayLabel(range.from, now) + (range.partial ? ' so far' : '');
}

export default function Overview({ theme, events, store, now }) {
  const days = store.prefs.window;
  const [showTable, setShowTable] = useState(false);
  const [periodA, setPeriodA] = useState(DEFAULT_A);
  const [periodB, setPeriodB] = useState(DEFAULT_B);
  const [compare, setCompare] = useState(false);

  const rows = useMemo(() => dailyTotals(events, Math.max(days, 7), now), [events, days, now]);
  const usual = useMemo(() => baseline(dailyTotals(events, 30, now)), [events, now]);
  const weekly = useMemo(() => weekOverWeek(events, now), [events, now]);

  if (!events.length) {
    return (
      <Card theme={theme}>
        <CardTitle theme={theme}>Overview</CardTitle>
        <Muted theme={theme}>Nothing logged yet. This fills in as you go — the first day gives the timeline, three days give a baseline.</Muted>
      </Card>
    );
  }

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={
          <Chip theme={theme} active={compare} onClick={() => { setCompare((v) => !v); if (!compare && periodA.kind === '24h') setPeriodA({ kind: 'today', date: null }); }}>
            Compare
          </Chip>
        }
      >Overview</CardTitle>

      {compare ? (
        <CompareView
          theme={theme} events={events} now={now} usual={usual} rows={rows}
          periodA={periodA} periodB={periodB} onA={setPeriodA} onB={setPeriodB}
        />
      ) : (
        <PeriodView theme={theme} events={events} now={now} usual={usual} rows={rows} period={periodA} onChange={setPeriodA} />
      )}

      {/* 3. Day by day ------------------------------------------------------- */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginTop: 18, flexWrap: 'wrap',
      }}>
        <SectionLabel theme={theme} style={{ margin: 0 }}>Day by day</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((d) => (
            <Chip key={d} theme={theme} active={days === d} onClick={() => store.setPrefs({ window: d })}>{d}d</Chip>
          ))}
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px 14px', marginTop: 8,
      }}>
        {METRICS.map((m) => (
          <SmallMultiple key={m.key} theme={theme} metric={m} rows={rows.slice(-days)} usual={usual} />
        ))}
      </div>

      <WeekTrend theme={theme} weekly={weekly} />

      <div style={{ marginTop: 12 }}>
        <Button theme={theme} onClick={() => setShowTable((v) => !v)} style={{ padding: '6px 12px' }}>
          {showTable ? 'Hide table' : 'Show as table'}
        </Button>
      </div>
      {showTable && <DayTable theme={theme} rows={rows.slice(-days).filter((r) => r.tracked)} now={now} />}
    </Card>
  );
}

function SectionLabel({ theme, children, style }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 650, color: theme.ink, margin: '0 0 8px', letterSpacing: '-0.005em', ...style,
    }}>{children}</div>
  );
}

/** Coloured mark beside a text label — identity never rides on text colour. */
function Key({ theme, category, shape = 'dot' }) {
  const c = categoryColor(theme, category);
  if (shape === 'bar') return <span style={{ display: 'inline-block', width: 12, height: 5, borderRadius: 2, background: c, verticalAlign: 'middle' }} />;
  if (shape === 'ring') return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, border: `2px solid ${c}`, boxSizing: 'border-box', verticalAlign: 'middle' }} />;
  if (shape === 'tick') return <span style={{ display: 'inline-block', width: 2, height: 10, borderRadius: 1, background: c, verticalAlign: 'middle' }} />;
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: c, verticalAlign: 'middle' }} />;
}

// ---------------------------------------------------------------------------
// Period picker and the two views it drives.
// ---------------------------------------------------------------------------

const PERIODS = [
  { kind: '24h', label: 'Last 24h' },
  { kind: 'today', label: 'Today' },
  { kind: 'yesterday', label: 'Yesterday' },
  { kind: 'date', label: 'Pick a day' },
];

/** One row of chips, with a date field when a specific day is chosen. */
function PeriodPicker({ theme, period, onChange, now, allowRolling = true, accent }) {
  const options = allowRolling ? PERIODS : PERIODS.filter((p) => p.kind !== '24h');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {options.map((p) => (
        <Chip
          key={p.kind}
          theme={theme}
          accent={accent}
          active={period.kind === p.kind}
          onClick={() => onChange({ kind: p.kind, date: p.kind === 'date' ? (period.date ?? toDateInput(addDays(now, -2))) : null })}
        >{p.label}</Chip>
      ))}
      {period.kind === 'date' && (
        <input
          type="date"
          value={period.date ?? ''}
          max={toDateInput(now)}
          onChange={(e) => onChange({ kind: 'date', date: e.target.value })}
          style={{
            border: `1px solid ${theme.line}`, background: theme.bg, color: theme.ink,
            borderRadius: 999, padding: '5px 10px', fontSize: 12, minWidth: 0,
          }}
        />
      )}
    </div>
  );
}

function resolve(period, now) {
  const dateTs = period.kind === 'date' ? (fromDateInput(period.date) ?? now) : null;
  return periodRange(period.kind, now, dateTs);
}

/** The baseline that is fair for this period: full-day, or by-this-time. */
function usualFor(events, range, usual, now) {
  if (!range.partial || range.rolling) return usual;
  return usualByElapsed(events, range.to - range.from, now);
}

function stripProps(range) {
  if (range.rolling) return { leftLabel: '24h ago', rightLabel: 'now', axisTo: range.to };
  return { leftLabel: '00:00', rightLabel: '24:00', axisTo: range.dayEnd };
}

function PeriodView({ theme, events, now, usual, rows, period, onChange }) {
  const range = useMemo(() => resolve(period, now), [period, now]);
  const totals = useMemo(() => windowTotals(events, range.from, range.to + 1, now), [events, range, now]);
  const base = useMemo(() => usualFor(events, range, usual, now), [events, range, usual, now]);
  const label = periodLabel(period, range, now);

  return (
    <>
      <PeriodPicker theme={theme} period={period} onChange={onChange} now={now} />

      <SectionLabel theme={theme} style={{ marginTop: 14 }}>{label}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 8 }}>
        {METRICS.map((m) => (
          <StatTile
            key={m.key}
            theme={theme}
            metric={m}
            value={totals[m.key]}
            usual={base.ready ? base[m.key] : null}
            usualWord={base.byTime ? 'usually by now' : 'usually'}
            highlightKey={range.rolling ? null : dayKey(range.from)}
            rows={rows.slice(-7)}
          />
        ))}
      </div>
      <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
        {base.ready
          ? (base.byTime
            ? `“Usually by now” is what the last ${base.days} full days had reached by this time of day.`
            : `“Usually” is the average of the last ${base.days} full ${base.days === 1 ? 'day' : 'days'}.`)
          : `A baseline appears after ${BASELINE_MIN_DAYS} full days — ${base.days} so far.`}
      </Muted>

      <SectionLabel theme={theme} style={{ marginTop: 18 }}>
        {range.rolling ? 'The last 24 hours, hour by hour' : `${label.replace(' so far', '')}, hour by hour`}
      </SectionLabel>
      <Timeline theme={theme} events={events} from={range.from} to={range.to} now={now} {...stripProps(range)} />
    </>
  );
}

/** Two periods side by side: the four metrics with deltas, then both strips. */
function CompareView({ theme, events, now, usual, rows, periodA, periodB, onA, onB }) {
  const a = useMemo(() => resolve(periodA, now), [periodA, now]);
  const b = useMemo(() => resolve(periodB, now), [periodB, now]);
  const ta = useMemo(() => windowTotals(events, a.from, a.to + 1, now), [events, a, now]);
  const tb = useMemo(() => windowTotals(events, b.from, b.to + 1, now), [events, b, now]);
  const la = periodLabel(periodA, a, now);
  const lb = periodLabel(periodB, b, now);
  const accentA = theme.ink;
  const accentB = categoryColor(theme, 'expected');

  const cell = { padding: '7px 6px', fontSize: 13, borderBottom: `1px solid ${theme.line}` };
  const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const head = { ...cell, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.inkFaint, fontWeight: 600, textAlign: 'right' };

  const deltaText = (m, va, vb) => {
    const d = va - vb;
    const tol = m.unit === 'minutes' ? 20 : 0.5;
    if (Math.abs(d) < tol) return 'same';
    const sign = d > 0 ? '+' : '−';
    return `${sign}${formatValue(m, Math.abs(d))}`;
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: accentA, width: 14 }}>A</span>
          <PeriodPicker theme={theme} period={periodA} onChange={onA} now={now} allowRolling={false} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: accentB, width: 14 }}>B</span>
          <PeriodPicker theme={theme} period={periodB} onChange={onB} now={now} allowRolling={false} accent={accentB} />
        </div>
      </div>

      {(a.partial || b.partial) && (
        <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
          A day still in progress is compared as far as it has got — the numbers are not final.
        </Muted>
      )}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', color: theme.ink }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: 'left' }}></th>
              <th style={head}>A · {la}</th>
              <th style={{ ...head, color: accentB }}>B · {lb}</th>
              <th style={head}>A − B</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.key}>
                <td style={cell}><Key theme={theme} category={m.category} /> {m.label}</td>
                <td style={{ ...num, fontWeight: 650 }}>{formatValue(m, ta[m.key])}</td>
                <td style={{ ...num, fontWeight: 650 }}>{formatValue(m, tb[m.key])}</td>
                <td style={{ ...num, color: theme.inkSoft }}>{deltaText(m, ta[m.key], tb[m.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionLabel theme={theme} style={{ marginTop: 18, color: accentA }}>A · {la.replace(' so far', '')}</SectionLabel>
      <Timeline theme={theme} events={events} from={a.from} to={a.to} now={now} {...stripProps(a)} />
      <SectionLabel theme={theme} style={{ marginTop: 18, color: accentB }}>B · {lb.replace(' so far', '')}</SectionLabel>
      <Timeline theme={theme} events={events} from={b.from} to={b.to} now={now} {...stripProps(b)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Stat tile: value, "usually", and the last seven days as a strip.
// ---------------------------------------------------------------------------

function StatTile({ theme, metric, value, usual, rows, usualWord = 'usually', highlightKey = null }) {
  const accent = categoryColor(theme, metric.category);
  const soft = categoryTint(theme, metric.category, theme.name === 'night' ? 0.42 : 0.32);

  // Neither direction is "good" for a baby — more feeds is not a win and fewer
  // is not a loss — so the delta stays in ink, never in status colour.
  let cue = null;
  if (usual != null) {
    const tolerance = metric.unit === 'minutes' ? Math.max(30, usual * 0.1) : Math.max(0.5, usual * 0.1);
    cue = value > usual + tolerance ? '▲' : value < usual - tolerance ? '▼' : '—';
  }

  const max = Math.max(...rows.map((r) => r[metric.key]), 1);
  return (
    <div style={{
      border: `1px solid ${theme.line}`, borderRadius: 14, padding: '10px 11px 9px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.inkSoft, fontWeight: 600 }}>
        <Key theme={theme} category={metric.category} /> {metric.label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', color: theme.ink, lineHeight: 1.1 }}>
        {formatValue(metric, value)}
      </div>
      <div style={{ fontSize: 11, color: theme.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {usual != null
          ? <>{cue !== '—' && <span style={{ fontSize: 9, marginRight: 3 }}>{cue}</span>}{usualWord} {formatValue(metric, usual)}</>
          : <span style={{ color: theme.inkFaint }}>no baseline yet</span>}
      </div>
      {/* Seven thin columns; the past in the soft tint, today in the accent. */}
      <svg viewBox="0 0 70 22" width="100%" height="22" style={{ display: 'block', marginTop: 2 }} aria-hidden="true">
        {rows.map((r, i) => {
          if (!r.tracked) return null;
          const h = Math.max(r[metric.key] > 0 ? 2 : 0, (r[metric.key] / max) * 20);
          return (
            <rect
              key={r.key} x={i * 10 + 1} y={22 - h} width={8} height={h} rx={1.5}
              fill={(highlightKey ? r.key === highlightKey : r.isToday) ? accent : soft}
            />
          );
        })}
        <line x1="0" y1="21.5" x2="70" y2="21.5" stroke={theme.line} strokeWidth="1" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. The 24-hour strip.
// ---------------------------------------------------------------------------

function Timeline({ theme, events, from, to, now, leftLabel = '24h ago', rightLabel = 'now', axisTo = to }) {
  const data = useMemo(() => timelineData(events, from, to, now), [events, from, to, now]);
  const longest = useMemo(() => longestSleep(events, from, to, now), [events, from, to, now]);
  const gap = useMemo(() => feedGapInWindow(events, from, to + 1), [events, from, to]);
  const totals = useMemo(() => windowTotals(events, from, to + 1, now), [events, from, to, now]);

  const W = 520;
  const H = 92;
  const pad = 10;
  // The axis may run past the data (a day still in progress runs to 24:00).
  const x = (ts) => pad + ((ts - from) / (axisTo - from)) * (W - 2 * pad);
  const nowInside = now >= from && now <= axisTo;
  const laneSleep = 18;
  const laneFeed = 46;
  const laneDiaper = 68;
  const surface = theme.surfaceBottom;

  const sleepColor = categoryColor(theme, 'night');
  const feedColor = categoryColor(theme, 'nurse');
  const wetColor = categoryColor(theme, 'wet');
  const poopColor = categoryColor(theme, 'poop');

  // Clean hour labels: every local 06/12/18/00 that falls inside the window.
  const ticks = [];
  for (let t = startOfLocalDay(from); t <= axisTo; t += 6 * HOUR) {
    const px = x(t);
    if (px > pad + 44 && px < W - pad - 30) ticks.push(t);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Sleeps, feeds and diapers over the last 24 hours"
      >
        {/* Hairline lanes and hour ticks, one step off the surface. */}
        {[laneSleep, laneFeed, laneDiaper].map((y) => (
          <line key={y} x1={pad} y1={y} x2={W - pad} y2={y} stroke={theme.line} strokeWidth="1" />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={laneSleep - 10} x2={x(t)} y2={laneDiaper + 8} stroke={theme.line} strokeWidth="1" />
            <text x={x(t)} y={H - 4} fontSize="9" fill={theme.inkFaint} textAnchor="middle">{clockTime(t)}</text>
          </g>
        ))}
        <text x={pad} y={H - 4} fontSize="9" fill={theme.inkFaint}>{leftLabel}</text>
        <text x={W - pad} y={H - 4} fontSize="9" fill={theme.inkFaint} textAnchor="end">{rightLabel}</text>

        {/* Sleep spans, 12px thick, square where a session is still running. */}
        {data.sleeps.map((s) => {
          const x0 = x(s.start);
          const x1 = x(s.end);
          return (
            <rect
              key={s.id} x={x0} y={laneSleep - 6} width={Math.max(2, x1 - x0)} height={12}
              rx={s.open ? 0 : 3} fill={sleepColor}
            >
              <title>{`${s.type === 'night' ? 'Night sleep' : 'Nap'} ${clockTime(s.start)}–${s.open ? 'now' : clockTime(s.end)} · ${formatDuration(s.end - s.start)}`}</title>
            </rect>
          );
        })}

        {/* Feeds: nursing filled, bottle as a ring — shape carries the subtype. */}
        {data.feeds.map((f) => (
          <g key={f.id}>
            <circle cx={x(f.ts)} cy={laneFeed} r={7} fill={surface} />
            {f.type === 'nurse'
              ? <circle cx={x(f.ts)} cy={laneFeed} r={5} fill={feedColor} />
              : <circle cx={x(f.ts)} cy={laneFeed} r={4} fill={surface} stroke={feedColor} strokeWidth={2} />}
            <circle cx={x(f.ts)} cy={laneFeed} r={12} fill="transparent">
              <title>{`${f.type === 'nurse' ? 'Nursing' : `Bottle${f.amount ? ` ${f.amount} ml` : ''}`} · ${clockTime(f.ts)}`}</title>
            </circle>
          </g>
        ))}

        {/* Diapers as ticks: wet above the lane, poop below, so a change with
            both never hides one behind the other. */}
        {data.diapers.map((d) => (
          <g key={d.id}>
            <rect
              x={x(d.ts) - 1} y={d.type === 'wet' ? laneDiaper - 9 : laneDiaper + 1}
              width={2} height={8} rx={1} fill={d.type === 'wet' ? wetColor : poopColor}
            />
            <rect x={x(d.ts) - 6} y={laneDiaper - 12} width={12} height={24} fill="transparent">
              <title>{`${d.type === 'wet' ? 'Wet' : 'Poop'} · ${clockTime(d.ts)}`}</title>
            </rect>
          </g>
        ))}

        {/* Now — only when it falls inside the axis. */}
        {nowInside && (
          <line x1={x(now)} y1={laneSleep - 12} x2={x(now)} y2={laneDiaper + 12} stroke={theme.inkSoft} strokeWidth="1" />
        )}
      </svg>

      {/* Legend: with five marks, identity never rests on colour alone. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4, fontSize: 11, color: theme.inkSoft }}>
        <span><Key theme={theme} category="night" shape="bar" /> Sleep</span>
        <span><Key theme={theme} category="nurse" /> Nursing</span>
        {data.feeds.some((f) => f.type === 'bottle') && (
          <span><Key theme={theme} category="nurse" shape="ring" /> Bottle</span>
        )}
        <span><Key theme={theme} category="wet" shape="tick" /> Wet</span>
        <span><Key theme={theme} category="poop" shape="tick" /> Poop</span>
      </div>

      <Muted theme={theme} size={12} style={{ marginTop: 6, color: theme.ink }}>
        {totals.feeds} {totals.feeds === 1 ? 'feed' : 'feeds'}
        {gap ? ` · every ~${formatGap(gap)}` : ''}
        {longest ? ` · longest sleep ${formatDuration(longest.ms)} (${clockTime(longest.start)}–${longest.open ? 'now' : clockTime(longest.end)})` : ''}
        {` · ${totals.wet} wet · ${totals.poop} poop`}
      </Muted>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Small multiples: one metric per panel, one axis each, never two.
// ---------------------------------------------------------------------------

/** A column with a rounded cap and a square base. */
function columnPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `A${rr},${rr} 0 0 1 ${x + rr},${y}`,
    `H${x + w - rr}`,
    `A${rr},${rr} 0 0 1 ${x + w},${y + rr}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

function SmallMultiple({ theme, metric, rows, usual }) {
  const accent = categoryColor(theme, metric.category);
  const soft = categoryTint(theme, metric.category, theme.name === 'night' ? 0.45 : 0.36);

  // Drawn at roughly its rendered size, so text units are pixels on a phone.
  const W = 160;
  const H = 80;
  const top = 14;
  const bottom = 14;
  const plotH = H - top - bottom;
  const slot = W / rows.length;
  // Thin marks: a column never fills its slot, and never grows past 18px.
  const barW = Math.min(18, Math.max(3, slot * 0.45));

  const tracked = rows.filter((r) => r.tracked);
  const values = tracked.map((r) => r[metric.key]);
  const max = Math.max(...values, metric.unit === 'minutes' ? 60 : 1);
  const avg = usual.ready ? usual[metric.key] : null;
  const y = (v) => top + plotH - (v / max) * plotH;

  const maxRow = tracked.reduce((best, r) => (!best || r[metric.key] > best[metric.key] ? r : best), null);
  const todayRow = rows.find((r) => r.isToday);
  const firstTrackedIndex = rows.findIndex((r) => r.tracked);
  const avgX0 = firstTrackedIndex >= 0 ? firstTrackedIndex * slot : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>
          <Key theme={theme} category={metric.category} /> {metric.label}
          {metric.unit === 'minutes' && <span style={{ color: theme.inkFaint, fontWeight: 400 }}> hours</span>}
        </span>
        {avg != null && (
          <span style={{ fontSize: 10.5, color: theme.inkFaint, fontVariantNumeric: 'tabular-nums' }}>
            avg {formatValue(metric, avg)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} role="img"
        aria-label={`${metric.label} per day over the last ${rows.length} days`}>
        <line x1="0" y1={top + plotH + 0.5} x2={W} y2={top + plotH + 0.5} stroke={theme.line} strokeWidth="1" />
        {avg != null && avg <= max && (
          <line x1={avgX0} y1={y(avg)} x2={W} y2={y(avg)} stroke={theme.inkFaint} strokeWidth="1" opacity="0.6" />
        )}
        {rows.map((r, i) => {
          if (!r.tracked) return null;
          const v = r[metric.key];
          const cx = i * slot + slot / 2;
          const h = v > 0 ? Math.max(2, (v / max) * plotH) : 0;
          const isLabelled = r === todayRow || (r === maxRow && v > 0);
          return (
            <g key={r.key}>
              {h > 0 && (
                <path d={columnPath(cx - barW / 2, top + plotH - h, barW, h, 4)} fill={r.isToday ? accent : soft}>
                  <title>{`${dayLabel(r.dayTs)} · ${formatValue(metric, v)}`}</title>
                </path>
              )}
              {isLabelled && v > 0 && (
                <text x={cx} y={top + plotH - h - 3} fontSize="9" fill={theme.inkSoft} textAnchor="middle"
                  fontVariantNumeric="tabular-nums">{formatValue(metric, v)}</text>
              )}
              <rect x={i * slot} y={top} width={slot} height={plotH} fill="transparent">
                <title>{`${dayLabel(r.dayTs)} · ${formatValue(metric, v)}`}</title>
              </rect>
            </g>
          );
        })}
        <text x={0} y={H - 3} fontSize="8.5" fill={theme.inkFaint}>{rows[0] ? shortDay(rows[0].dayTs) : ''}</text>
        <text x={W} y={H - 3} fontSize="8.5" fill={theme.inkFaint} textAnchor="end">today</text>
      </svg>
    </div>
  );
}

function shortDay(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Week over week, and the table twin.
// ---------------------------------------------------------------------------

function WeekTrend({ theme, weekly }) {
  if (!weekly) {
    return (
      <Muted theme={theme} size={11} style={{ marginTop: 10 }}>
        A week-on-week comparison appears once two full weeks are logged.
      </Muted>
    );
  }
  const line = (label, m, unit) => {
    const now = formatValue({ unit }, m.now);
    const before = formatValue({ unit }, m.before);
    const tolerance = unit === 'minutes' ? 20 : 0.4;
    const word = m.delta > tolerance ? 'up from' : m.delta < -tolerance ? 'down from' : 'about the same as';
    return `${label} ${now}/day, ${word} ${before}`;
  };
  return (
    <Muted theme={theme} size={12} style={{ marginTop: 10, color: theme.ink }}>
      <span style={{ color: theme.inkSoft }}>This week vs last: </span>
      {line('Feeds', weekly.feeds, 'count')} · {line('Sleep', weekly.sleepMin, 'minutes')} · {line('Wet', weekly.wet, 'count')} · {line('Poop', weekly.poop, 'count')}
    </Muted>
  );
}

function DayTable({ theme, rows, now }) {
  // A breastfeeding-only household never has bottle volume; don't show a
  // column of dashes for it.
  const showMl = rows.some((r) => r.bottleMl > 0);
  const cell = { padding: '6px 5px', fontSize: 12, borderBottom: `1px solid ${theme.line}`, whiteSpace: 'nowrap' };
  const num = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const head = { ...cell, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.inkFaint, fontWeight: 600 };
  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', color: theme.ink }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>Day</th>
            <th style={{ ...head, textAlign: 'right' }}>Feeds</th>
            {showMl && <th style={{ ...head, textAlign: 'right' }}>ml</th>}
            <th style={{ ...head, textAlign: 'right' }}>Sleep</th>
            <th style={{ ...head, textAlign: 'right' }}>Wet</th>
            <th style={{ ...head, textAlign: 'right' }}>Poop</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.key}>
              <td style={cell}>{dayLabel(r.dayTs, now)}</td>
              <td style={num}>{r.feeds}</td>
              {showMl && <td style={num}>{r.bottleMl || '—'}</td>}
              <td style={num}>{formatValue({ unit: 'minutes' }, r.sleepMin)}</td>
              <td style={num}>{r.wet}</td>
              <td style={num}>{r.poop}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { addDays };
