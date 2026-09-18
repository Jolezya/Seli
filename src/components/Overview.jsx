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
  dailyTotals, windowTotals, baseline, BASELINE_MIN_DAYS,
  periodRange, usualByElapsed, suspectSleeps,
} from '../lib/analytics.js';
import {
  HOUR, MINUTE, clockTime, formatDuration, dayLabel, startOfLocalDay, addDays,
  toDateInput, fromDateInput, dayKey, shortDate, timeAgo,
} from '../lib/time.js';
import { readings as tempReadings, isFever, FEVER_C, formatTemp, toTenths } from '../lib/temp.js';


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
const DEFAULT_A = { kind: 'today', date: null };
const DEFAULT_B = { kind: 'yesterday', date: null };

function periodLabel(period, range, now) {
  if (period.kind === '24h') return 'Last 24 hours';
  if (period.kind === 'today') return 'Today so far';
  if (period.kind === 'yesterday') return 'Yesterday';
  return dayLabel(range.from, now) + (range.partial ? ' so far' : '');
}

export default function Overview({ theme, events, store, now }) {
  const days = store.prefs.window;
  const [periodA, setPeriodA] = useState(DEFAULT_A);
  const [periodB, setPeriodB] = useState(DEFAULT_B);
  const [compare, setCompare] = useState(false);

  const rows = useMemo(() => dailyTotals(events, Math.max(days, 7), now), [events, days, now]);
  const usual = useMemo(() => baseline(dailyTotals(events, 30, now)), [events, now]);
  const suspects = useMemo(() => suspectSleeps(events, now), [events, now]);

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

      {suspects.length > 0 && <SuspectSleeps theme={theme} suspects={suspects} now={now} store={store} />}

      {/* 3. Temperature ----------------------------------------------------- */}
      <TemperatureSection theme={theme} events={events} now={now} store={store} />
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
  return usualByElapsed(events, range.elapsedTo - range.from, now);
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

/**
 * Sleeps the analytics refused: longer than 16 hours, or ending before
 * they start. Each one would add a full day of sleep to every day it spans.
 * Named here with a way to fix or delete, never dropped quietly.
 */
function SuspectSleeps({ theme, suspects, now, store }) {
  return (
    <div style={{
      marginTop: 16, padding: '10px 12px', borderRadius: 12,
      background: categoryTint(theme, 'night', 0.10), border: `1px solid ${theme.warn}`,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, color: theme.warn }}>
        {suspects.length === 1 ? 'One sleep entry looks wrong' : `${suspects.length} sleep entries look wrong`} and is left out of the totals
      </div>
      {suspects.map((e) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: theme.ink, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 160 }}>
            {e.type === 'night' ? 'Night sleep' : 'Nap'} {shortDate(e.start_ts)} {clockTime(e.start_ts)}
            {' → '}{e.end_ts == null ? 'still open' : `${shortDate(e.end_ts)} ${clockTime(e.end_ts)}`}
            {' · '}{formatDuration(Math.abs((e.end_ts ?? now) - e.start_ts))}
          </span>
          <Button theme={theme} onClick={() => store.update(e.id, { end_ts: e.start_ts + 2 * HOUR })} style={{ padding: '4px 9px', fontSize: 12 }} title="Set the end to two hours after the start; adjust in the day log">
            End after 2h
          </Button>
          <Button theme={theme} onClick={() => store.remove(e.id, 'Sleep')} style={{ padding: '4px 9px', fontSize: 12, color: theme.bad }}>Delete</Button>
        </div>
      ))}
      <Muted theme={theme} size={11} style={{ marginTop: 6 }}>Open the day log on that date to set the exact times.</Muted>
    </div>
  );
}

const TEMP_RANGES = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '3d', label: '3 days', hours: 72 },
  { key: '7d', label: '7 days', hours: 168 },
];

/**
 * Temperature in detail: every reading at its exact time, the fever zone
 * shaded, and the readings listed newest first with the change from the one
 * before. For an illness, not for every day — with nothing in the last week
 * it is one quiet line.
 */
function TemperatureSection({ theme, events, now, store }) {
  const [rangeKey, setRangeKey] = useState('24h');
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const range = TEMP_RANGES.find((r) => r.key === rangeKey) || TEMP_RANGES[0];
  const all = useMemo(() => tempReadings(events), [events]);
  const inWeek = all.filter((r) => r.start_ts >= now - 168 * HOUR);
  const accent = categoryColor(theme, 'temp');
  const latest = inWeek.length ? inWeek[inWeek.length - 1] : null;
  const fever = latest && isFever(latest.amount) && now - latest.start_ts < 12 * HOUR;

  const save = (e) => {
    e.preventDefault();
    const tenths = toTenths(value);
    if (tenths == null) { store.showToast('Enter a temperature between 34 and 43 °C.'); return; }
    store.logPoint('temp', { amount: tenths });
    setAdding(false);
    setValue('');
  };

  const measure = (
    <Chip theme={theme} accent={accent} active={adding} onClick={() => setAdding((v) => !v)}>Measure</Chip>
  );

  const form = adding && (
    <form onSubmit={save} style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
      {/* A text field, not type="number": iOS rejects the comma a Norwegian
          keyboard offers as its decimal mark, and the parser takes either. */}
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="37.2"
        aria-label="Temperature in °C"
        style={{
          flex: '1 1 100px', minWidth: 0, border: `1px solid ${theme.line}`, background: theme.bg,
          color: theme.ink, borderRadius: 10, padding: '8px 10px', fontSize: 15, fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      <span style={{ fontSize: 12, color: theme.inkSoft }}>°C</span>
      <Button theme={theme} tone="accent" type="submit" style={{ padding: '6px 12px' }}>Save</Button>
    </form>
  );

  if (!inWeek.length) {
    return (
      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <SectionLabel theme={theme} style={{ margin: 0 }}>Temperature</SectionLabel>
          {measure}
        </div>
        {form}
        <Muted theme={theme} style={{ marginTop: 6 }}>No readings in the last week. Tap Measure when she feels warm; the chart and the list appear here.</Muted>
      </div>
    );
  }

  const from = now - range.hours * HOUR;
  const shown = all.filter((r) => r.start_ts >= from);
  const listed = [...inWeek].reverse();

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <SectionLabel theme={theme} style={{ margin: 0 }}>Temperature</SectionLabel>
        {measure}
      </div>

      {form}

      {fever && (
        <div style={{ fontSize: 11.5, color: theme.warn, marginTop: 8, fontWeight: 600 }}>
          {formatTemp(latest.amount)} at {clockTime(latest.start_ts)} · {FEVER_C.toFixed(1)} °C or more in a baby this young is a reason to call the doctor or the health line.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {TEMP_RANGES.map((r) => (
          <Chip key={r.key} theme={theme} accent={accent} active={rangeKey === r.key} onClick={() => setRangeKey(r.key)}>{r.label}</Chip>
        ))}
      </div>

      {shown.length ? (
        <TempChart theme={theme} readings={shown} from={from} now={now} accent={accent} />
      ) : (
        <Muted theme={theme} style={{ marginTop: 8 }}>No readings in the last {range.label}.</Muted>
      )}

      <div style={{ marginTop: 8 }}>
        {listed.map((r, i) => {
          const prev = listed[i + 1] || null;
          const delta = prev ? r.c - prev.c : null;
          const hot = isFever(r.amount);
          return (
            <div key={r.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(84px, auto) 56px 1fr auto', alignItems: 'baseline', columnGap: 8, padding: '6px 0',
              borderTop: i ? `1px solid ${theme.line}` : 'none', fontSize: 12, color: theme.ink,
            }}>
              <span style={{ color: theme.inkSoft, whiteSpace: 'nowrap' }}>{dayLabel(r.start_ts, now)} {clockTime(r.start_ts)}</span>
              <span style={{ fontWeight: 650, color: hot ? theme.warn : theme.ink, fontVariantNumeric: 'tabular-nums' }}>{formatTemp(r.amount)}</span>
              <span style={{ color: theme.inkFaint, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>
                {delta == null ? 'first reading' : delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} since ${clockTime(prev.start_ts)}`}
              </span>
              <span style={{ color: theme.inkFaint, fontSize: 11, whiteSpace: 'nowrap', textAlign: 'right' }}>{timeAgo(r.start_ts, now)}</span>
            </div>
          );
        })}
      </div>
      <Muted theme={theme} size={11} style={{ marginTop: 6 }}>
        <span style={{ color: theme.warn }}>shaded</span> = {FEVER_C.toFixed(1)} °C and above · tap an entry in the day log to correct it
      </Muted>
    </div>
  );
}

/**
 * Temperature against time: degrees up the left with its own axis line,
 * ticks and unit; clock time along the bottom with ticks sized to the range.
 * The fever zone is shaded behind. Fixed aspect, so nothing stretches.
 */
/** Rough width of a label at the chart's 8.5–9px type, good enough to pack by. */
function textWidth(text) {
  return text.length * 5.1;
}

function TempChart({ theme, readings, from, now, accent }) {
  const W = 340;
  const H = 170;
  const pad = { top: 18, right: 12, bottom: 34, left: 36 };
  const to = now;
  const axisY = H - pad.bottom;
  const temps = readings.map((r) => r.c);
  // Always show a normal-to-fever span, extended to whole degrees around the
  // readings, so the same reading sits at the same height day to day.
  const minY = Math.floor(Math.min(36, ...temps));
  const maxY = Math.ceil(Math.max(39, ...temps));
  const x = (ts) => pad.left + ((ts - from) / (to - from)) * (W - pad.left - pad.right);
  const y = (c) => pad.top + (1 - (c - minY) / (maxY - minY)) * (axisY - pad.top);
  const path = readings.map((r, i) => `${i ? 'L' : 'M'}${x(r.start_ts).toFixed(1)},${y(r.c).toFixed(1)}`).join(' ');

  const degrees = [];
  for (let g = minY; g <= maxY; g += 1) degrees.push(g);
  const halves = [];
  for (let g = minY + 0.5; g < maxY; g += 1) halves.push(g);

  // Time ticks on the local wall clock: every 6h within a day, 12h over three
  // days, daily over a week. Anything that would collide with "now" is dropped.
  const hours = (to - from) / HOUR;
  const stepH = hours <= 24 ? 6 : hours <= 72 ? 12 : 24;
  const ticks = [];
  const walk = new Date(from);
  walk.setMinutes(0, 0, 0);
  while (walk.getTime() <= to) {
    const ts = walk.getTime();
    if (ts >= from && walk.getHours() % stepH === 0) {
      const text = new Date(ts).getHours() === 0 ? shortDate(ts) : clockTime(ts);
      // "now" owns the right end; a tick label may not reach into it.
      if (x(ts) + textWidth(text) / 2 < W - pad.right - 18) ticks.push(ts);
    }
    walk.setHours(walk.getHours() + 1);
  }

  // Every reading carries its value. Each label takes the first slot around
  // its point — above, below, right, left, then further out — that no label
  // already occupies, so readings minutes apart stay readable. The latest and
  // the highest choose first, since those are the two anyone looks for.
  const latest = readings[readings.length - 1];
  const highest = readings.reduce((m, r) => (r.c > m.c ? r : m), readings[0]);
  const order = [latest, ...(highest.id === latest.id ? [] : [highest]), ...readings.filter((r) => r.id !== latest.id && r.id !== highest.id)];
  // The markers are obstacles too: a value printed across a dot is unreadable.
  const placed = readings.map((r) => ({ x1: x(r.start_ts) - 5, y1: y(r.c) - 5, x2: x(r.start_ts) + 5, y2: y(r.c) + 5 }));
  const labels = {};
  const free = (box) => placed.every((b) => b.x2 <= box.x1 || b.x1 >= box.x2 || b.y2 <= box.y1 || b.y1 >= box.y2);
  for (const r of order) {
    const text = r.c.toFixed(1);
    const w = textWidth(text) + 3;
    const px = x(r.start_ts);
    const py = y(r.c);
    // Candidate slots on a small grid around the point, nearest first and
    // above preferred, so a label lands as close to its dot as it can.
    const stepX = w / 2 + 6;
    const spots = [];
    for (let ix = -3; ix <= 3; ix++) {
      for (let iy = -5; iy <= 5; iy++) {
        if (ix === 0 && iy === 0) continue;
        const dy = iy < 0 ? -8 + (iy + 1) * 11 : iy > 0 ? 15 + (iy - 1) * 11 : 3.5;
        spots.push({ x: px + ix * stepX, y: py + dy, cost: Math.abs(iy) + Math.abs(ix) * 1.2 + (iy < 0 ? 0 : 0.3) });
      }
    }
    spots.sort((m, n) => m.cost - n.cost);
    let chosen = null;
    for (const spot of spots) {
      const cx = Math.max(pad.left + w / 2, Math.min(W - pad.right - w / 2, spot.x));
      const cy = Math.max(pad.top + 8, Math.min(axisY - 2, spot.y));
      const box = { x1: cx - w / 2, y1: cy - 9, x2: cx + w / 2, y2: cy + 2 };
      if (free(box)) { placed.push(box); chosen = { x: cx, y: cy }; break; }
    }
    // Nowhere free: put it above anyway rather than drop the value.
    labels[r.id] = chosen || { x: px, y: Math.max(pad.top + 8, py - 8) };
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', marginTop: 8, overflow: 'visible' }}
      role="img"
      aria-label="Temperature in degrees Celsius against time"
    >
      {FEVER_C < maxY && (
        <rect
          x={pad.left} y={y(maxY)} width={W - pad.left - pad.right}
          height={Math.max(0, y(FEVER_C) - y(maxY))}
          fill={categoryTint(theme, 'temp', theme.name === 'night' ? 0.16 : 0.10)}
        />
      )}

      {/* Degrees: gridline, tick and label per whole degree; a shorter tick per half. */}
      {degrees.map((g) => (
        <g key={g}>
          <line x1={pad.left} y1={y(g)} x2={W - pad.right} y2={y(g)} stroke={theme.line} strokeWidth="0.75" />
          <line x1={pad.left - 4} y1={y(g)} x2={pad.left} y2={y(g)} stroke={theme.inkFaint} strokeWidth="1" />
          <text x={pad.left - 7} y={y(g) + 3} fontSize="8.5" fill={theme.inkFaint} textAnchor="end" fontVariantNumeric="tabular-nums">{g}</text>
        </g>
      ))}
      {halves.map((g) => (
        <line key={g} x1={pad.left - 2.5} y1={y(g)} x2={pad.left} y2={y(g)} stroke={theme.inkFaint} strokeWidth="0.75" />
      ))}
      <text x={pad.left - 7} y={pad.top - 7} fontSize="8.5" fill={theme.inkSoft} textAnchor="end" fontWeight="600">°C</text>
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={axisY} stroke={theme.inkFaint} strokeWidth="1" />

      <line x1={pad.left} y1={y(FEVER_C)} x2={W - pad.right} y2={y(FEVER_C)} stroke={theme.warn} strokeWidth="1" strokeDasharray="4 3" />

      {/* Time along the bottom. */}
      <line x1={pad.left} y1={axisY} x2={W - pad.right} y2={axisY} stroke={theme.inkFaint} strokeWidth="1" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={pad.top} x2={x(t)} y2={axisY} stroke={theme.line} strokeWidth="0.75" />
          <line x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + 4} stroke={theme.inkFaint} strokeWidth="1" />
          <text x={x(t)} y={axisY + 14} fontSize="8.5" fill={theme.inkFaint} textAnchor="middle">
            {new Date(t).getHours() === 0 ? shortDate(t) : clockTime(t)}
          </text>
        </g>
      ))}
      <line x1={W - pad.right} y1={axisY} x2={W - pad.right} y2={axisY + 4} stroke={theme.inkFaint} strokeWidth="1" />
      <text x={W - pad.right} y={axisY + 14} fontSize="8.5" fill={theme.inkFaint} textAnchor="end">now</text>
      <text x={pad.left} y={H - 3} fontSize="8.5" fill={theme.inkFaint}>
        {shortDate(from)} {clockTime(from)}
      </text>

      {readings.length > 1 && <path d={path} fill="none" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" />}
      {readings.map((r) => (
        <g key={r.id}>
          <circle cx={x(r.start_ts)} cy={y(r.c)} r="3.2" fill={isFever(r.amount) ? theme.warn : accent} stroke={theme.surface} strokeWidth="1.5">
            <title>{`${r.c.toFixed(1)} °C · ${shortDate(r.start_ts)} ${clockTime(r.start_ts)}`}</title>
          </circle>
          <text
            x={labels[r.id].x} y={labels[r.id].y}
            fontSize="9" fill={isFever(r.amount) ? theme.warn : theme.inkSoft} textAnchor="middle"
            fontVariantNumeric="tabular-nums" stroke={theme.surface} strokeWidth="3" paintOrder="stroke"
          >{r.c.toFixed(1)}</text>
        </g>
      ))}
    </svg>
  );
}
