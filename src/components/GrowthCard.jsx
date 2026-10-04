// Growth: weight, length and head against the WHO charts — which curve she is
// on, whether she is staying on it, and the milestones parents remember
// (spec §7). One card, three tabs, the same chart for each; one form for a
// clinic visit, where all three are usually measured together.

import React, { useMemo, useState } from 'react';
import { Card, CardTitle, Chip, Button, Muted } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import { inRange, RANGES } from '../lib/weight.js';
import {
  growthSummary, measureSummary, weightForLength, bandSeries, curveSeries,
  MEASURES, MEASURE_KEYS, formatMeasure, formatMeasureShort, formatChange, parseMeasure, visitLine,
} from '../lib/growth.js';
import { ordinal, SEXES } from '../lib/who.js';
import { shortDate, toDateInput, fromDateInput, addDays, localNoon, MONTH_DAYS } from '../lib/time.js';

const TABS = [
  { key: 'weight', label: 'Weight' },
  { key: 'length', label: 'Length' },
  { key: 'head', label: 'Head' },
];

/** How each tab names its points and its empty state. */
const COPY = {
  weight: { point: 'weigh-ins', one: 'Weigh-in', empty: 'No weigh-ins yet. Tap Add to record the first one; birth weight makes the best start.' },
  length: { point: 'measurements', one: 'Length', empty: 'No length measurements yet. Tap Add to record one; her birth length from the health card makes the best start.' },
  head: { point: 'measurements', one: 'Head measurement', empty: 'No head measurements yet. Tap Add to record one; the size at birth from the health card makes the best start.' },
};

export default function GrowthCard({ theme, events, store, now }) {
  const blank = () => ({ date: toDateInput(now), weight: '', length: '', head: '', editId: null, editKey: null });
  const [adding, setAdding] = useState(false);
  const [editingFacts, setEditingFacts] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(blank);

  const tab = MEASURE_KEYS.includes(store.prefs.growthTab) ? store.prefs.growthTab : 'weight';
  const sex = SEXES.includes(store.prefs.sex) ? store.prefs.sex : 'girl';
  const birthTs = fromDateInput(store.prefs.birthDate) ?? localNoon(now);
  const dueTs = fromDateInput(store.prefs.dueDate);
  const correct = Boolean(store.prefs.correctAge);
  const settings = useMemo(() => ({ birthTs, sex, dueTs, correct }), [birthTs, sex, dueTs, correct]);
  const range = store.prefs.weightRange;
  const accent = categoryColor(theme, 'weight');
  const refColor = categoryColor(theme, 'expected');
  const pronoun = sex === 'girl' ? { she: 'she', her: 'her' } : { she: 'he', her: 'his' };

  const g = useMemo(
    () => (tab === 'weight' ? growthSummary(events, settings, now) : measureSummary(events, tab, settings, now)),
    [events, tab, settings, now],
  );
  const wfl = useMemo(() => (tab === 'length' ? weightForLength(events, sex) : null), [events, tab, sex]);
  const visible = useMemo(() => inRange(g.list, range, now), [g.list, range, now]);
  const selected = selectedId ? g.list.find((p) => p.id === selectedId) : null;

  const switchTab = (key) => {
    setSelectedId(null);
    store.setPrefs({ growthTab: key });
  };

  const submit = (e) => {
    e.preventDefault();
    const ts = fromDateInput(draft.date) ?? now;
    const amounts = {};
    for (const key of MEASURE_KEYS) {
      const typed = draft[key];
      if (String(typed).trim() === '') continue;
      const amount = parseMeasure(key, typed);
      if (amount == null) {
        const m = MEASURES[key];
        store.showToast(key === 'weight'
          ? `Weight is in grams, between ${m.min} and ${m.max.toLocaleString()}.`
          : `${m.label} is in centimetres, like ${key === 'length' ? '61,5' : '40,2'}.`);
        return;
      }
      amounts[key] = amount;
    }
    if (!Object.keys(amounts).length) { store.showToast('Enter at least one measurement.'); return; }

    for (const [key, amount] of Object.entries(amounts)) {
      // Editing a point moves that very row, date and all; anything else on
      // the form is a measurement for the chosen day.
      if (draft.editId && draft.editKey === key) store.update(draft.editId, { start_ts: localNoon(ts), amount });
      else store.setMeasure(key, ts, amount);
    }
    store.showToast(`Saved ${shortDate(ts)}: ${visitLine(settings, ts, amounts)}`, null, 9000);
    setAdding(false);
    setSelectedId(null);
    setDraft(blank());
  };

  const startEdit = (point) => {
    const shown = tab === 'weight' ? String(point.amount) : (point.amount / 10).toFixed(1);
    setDraft({ ...blank(), date: toDateInput(point.start_ts), [tab]: shown, editId: point.id, editKey: tab });
    setAdding(true);
  };

  const toggleForm = () => {
    setDraft(blank());
    setAdding((v) => !v);
  };

  const copy = COPY[tab];

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={<Chip theme={theme} accent={accent} active={adding} onClick={toggleForm}>Add</Chip>}
      >Growth</CardTitle>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }} role="tablist" aria-label="Measurement">
        {TABS.map((t) => (
          <Chip key={t.key} theme={theme} accent={accent} active={tab === t.key} onClick={() => switchTab(t.key)}>{t.label}</Chip>
        ))}
      </div>

      {adding && (
        <VisitForm theme={theme} draft={draft} setDraft={setDraft} onSubmit={submit} birthTs={birthTs} now={now} />
      )}

      {g.latest ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em',
              color: theme.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
            }}>{formatMeasure(tab, g.latest.amount)}</div>
            {g.sinceBirth != null && g.list.length > 1 ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: g.sinceBirth >= 0 ? theme.good : theme.bad }}>
                {formatChange(tab, g.sinceBirth)} since birth
              </div>
            ) : g.change != null && (
              <div style={{ fontSize: 13, fontWeight: 600, color: g.change >= 0 ? theme.good : theme.bad }}>
                {formatChange(tab, g.change)}
              </div>
            )}
            <Muted theme={theme}>{shortDate(g.latest.start_ts)}</Muted>
          </div>

          <PercentileLine theme={theme} g={g} refColor={refColor} sex={sex} />

          <Muted theme={theme} style={{ marginTop: 2 }}>
            {g.today?.measuredToday != null
              ? `${tab === 'weight' ? 'Weighed' : 'Measured'} today · the 50th percentile is ${formatMeasure(tab, g.today.median)}`
              : g.today?.onCurve != null && `Today ≈ ${formatMeasure(tab, g.today.onCurve)} on ${pronoun.her} curve`}
            {tab === 'weight' && (g.milestones?.doubled
              ? ` · doubled birth weight ${shortDate(g.milestones.doubled.ts)}`
              : g.milestones?.doubledProjected
                && ` · doubles birth weight ≈ ${shortDate(g.milestones.doubledProjected.ts)} (${formatMeasure('weight', g.milestones.target)})`)}
          </Muted>

          {tab === 'weight' && g.rhythm?.due && (
            <Muted theme={theme} style={{ marginTop: 2, color: theme.warn }}>
              Last weighed {g.rhythm.daysSince} days ago · time for a weigh-in
            </Muted>
          )}

          {tab === 'length' && <ProportionLine theme={theme} wfl={wfl} refColor={refColor} pronoun={pronoun} />}

          <GrowthChart
            theme={theme}
            g={g}
            mkey={tab}
            points={visible}
            sex={sex}
            range={range}
            now={now}
            accent={accent}
            refColor={refColor}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
          />

          {selected && (
            <PointDetail
              theme={theme}
              mkey={tab}
              point={selected}
              previous={g.list[g.list.indexOf(selected) - 1] || null}
              accent={accent}
              onEdit={() => startEdit(selected)}
              onDelete={() => { store.remove(selected.id, copy.one); setSelectedId(null); }}
            />
          )}
        </>
      ) : (
        <Muted theme={theme} style={{ padding: '4px 0 4px' }}>{copy.empty}</Muted>
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
        <Chip theme={theme} accent={refColor} active={editingFacts} onClick={() => setEditingFacts((v) => !v)}>
          Born {shortDate(birthTs)} · {sex}{g.corrected ? ' · corrected' : ''}
        </Chip>
      </div>

      {editingFacts && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="date"
            value={store.prefs.birthDate}
            max={toDateInput(now)}
            onChange={(e) => { if (fromDateInput(e.target.value)) store.setPrefs({ birthDate: e.target.value }); }}
            aria-label="Birth date"
            style={inputStyle(theme, { flex: '1 1 130px' })}
          />
          {SEXES.map((s) => (
            <Chip key={s} theme={theme} accent={refColor} active={sex === s} onClick={() => store.setPrefs({ sex: s })}>
              {s === 'girl' ? 'Girl' : 'Boy'}
            </Chip>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 100%', fontSize: 12, color: theme.inkSoft }}>
            Due
            <input
              type="date"
              value={store.prefs.dueDate || ''}
              onChange={(e) => store.setPrefs({ dueDate: e.target.value || null })}
              aria-label="Due date"
              style={inputStyle(theme, { flex: '1 1 130px' })}
            />
          </label>
          {g.early.earlyDays > 0 && (
            <>
              <Chip theme={theme} accent={refColor} active={correct} onClick={() => store.setPrefs({ correctAge: !correct })}>
                {correct ? 'Corrected age on' : 'Corrected age off'}
              </Chip>
              <Muted theme={theme} size={11} style={{ flex: '1 1 100%' }}>
                Born {earlyLabel(g.early.earlyDays)} early, at {g.early.weeks} weeks {g.early.days} days.
                {' '}Corrected age counts from the due date, so the charts compare {pronoun.her} with babies of the same maturity.
                {' '}Charts usually correct only before 37 weeks; it is your call.
              </Muted>
            </>
          )}
        </div>
      )}

      <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
        <span style={{ color: accent }}>●</span> {copy.point} · <span style={{ color: accent }}>dashed</span> = {pronoun.her} curve
        {g.pctLabel ? ` (${g.pctLabel})` : ''} · <span style={{ color: refColor }}>bands</span> = WHO 3rd–97th, darker 15th–85th, line = 50th
        {g.corrected && ' · ages corrected to the due date'}
      </Muted>
    </Card>
  );
}

/**
 * One form for a clinic visit: the date, then any of weight, length and
 * head. Length and head take centimetres with a comma or a point.
 */
function VisitForm({ theme, draft, setDraft, onSubmit, birthTs, now }) {
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const label = { fontSize: 11, color: theme.inkSoft, display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 90px', minWidth: 0 };
  return (
    <form onSubmit={onSubmit} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ ...label, flex: '1 1 100%' }}>
          Date
          <input
            type="date"
            value={draft.date}
            min={toDateInput(birthTs)}
            max={toDateInput(now)}
            onChange={set('date')}
            style={inputStyle(theme, { width: '100%' })}
          />
        </label>
        <label style={label}>
          Weight · g
          <input type="text" inputMode="numeric" placeholder="5580" value={draft.weight} onChange={set('weight')} style={inputStyle(theme, { width: '100%' })} />
        </label>
        <label style={label}>
          Length · cm
          <input type="text" inputMode="decimal" placeholder="61,5" value={draft.length} onChange={set('length')} style={inputStyle(theme, { width: '100%' })} />
        </label>
        <label style={label}>
          Head · cm
          <input type="text" inputMode="decimal" placeholder="40,2" value={draft.head} onChange={set('head')} style={inputStyle(theme, { width: '100%' })} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Muted theme={theme} size={11} style={{ flex: 1 }}>
          Fill in any of the three. Measured at home? A centimetre either way moves her several percentiles; clinic measurements make the steadiest line.
        </Muted>
        <Button theme={theme} tone="accent" type="submit">Save</Button>
      </div>
    </form>
  );
}

/** "Weight for length: 55th, in proportion" — under the Length tab. */
function ProportionLine({ theme, wfl, refColor, pronoun }) {
  if (!wfl) {
    return (
      <Muted theme={theme} style={{ marginTop: 2 }}>
        Weight for length appears when a weigh-in is within a week of a length measurement.
      </Muted>
    );
  }
  const off = wfl.verdict !== 'proportion';
  const words = wfl.verdict === 'light' ? `light for ${pronoun.her} length · worth mentioning at the next check`
    : wfl.verdict === 'heavy' ? `heavy for ${pronoun.her} length · worth mentioning at the next check`
      : 'in proportion';
  return (
    <Muted theme={theme} style={{ marginTop: 2, color: off ? theme.warn : refColor }}>
      <strong style={{ color: theme.ink }}>Weight for length: {wfl.pctLabel}</strong>, {words}
      <span style={{ color: theme.inkFaint }}>
        {' · '}{formatMeasure('length', wfl.length.amount)} and {formatMeasure('weight', wfl.weight.amount)}
        {wfl.gapDays === 0 ? ` on ${shortDate(wfl.length.start_ts)}` : ` within ${wfl.gapDays} day${wfl.gapDays === 1 ? '' : 's'}`}
      </span>
    </Muted>
  );
}

/** "38th percentile · same curve since birth (35th → 38th)". */
function PercentileLine({ theme, g, refColor, sex }) {
  if (g.pct == null) return null;
  const t = g.trend;
  let tail = null;
  let color = refColor;
  if (!t) {
    tail = g.corrected ? `on the WHO ${sex}s chart` : `for a ${sex} ${sex === 'girl' ? 'her' : 'his'} age`;
  } else if (t.flag) {
    color = theme.warn;
    tail = `crossed ${t.crossed} percentile lines ${t.direction === 'up' ? 'upwards' : 'downwards'} since ${shortDate(g.placedFirst.start_ts)} (${ordinal(t.fromPct)} → ${ordinal(t.toPct)}) · worth mentioning at the next check`;
  } else if (t.direction === 'same') {
    tail = `same curve since ${shortDate(g.placedFirst.start_ts)} (${ordinal(t.fromPct)} → ${ordinal(t.toPct)})`;
  } else {
    tail = `drifting ${t.direction} since ${shortDate(g.placedFirst.start_ts)} (${ordinal(t.fromPct)} → ${ordinal(t.toPct)}), within the usual range`;
  }
  return (
    <Muted theme={theme} style={{ marginTop: 4, color }}>
      <strong style={{ color: theme.ink }}>{g.pctLabel} percentile</strong>
      {g.corrected && <span style={{ color: theme.inkSoft }}> at corrected age {ageLabel(g.latest.chartDay)}</span>}
      {' · '}{tail}
    </Muted>
  );
}

/** "2½ weeks" / "5 days" / "3 weeks" */
function earlyLabel(days) {
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = days / 7;
  const whole = Math.floor(weeks);
  const rem = days - whole * 7;
  const half = rem >= 3 && rem <= 4 ? '½' : '';
  const n = rem >= 5 ? whole + 1 : whole;
  return `${n}${half} week${n === 1 && !half ? '' : 's'}`;
}

/** "8 wk" / "3 mo" — the unit clinicians read the chart in. */
function ageLabel(days) {
  if (days < 0) return `${Math.abs(days)} d before due`;
  if (days < 14 * 7) return `${Math.floor(days / 7)} wk`;
  return `${Math.floor(days / MONTH_DAYS)} mo`;
}

/** The row under the chart for a tapped point, with edit and delete. */
function PointDetail({ theme, mkey, point, previous, accent, onEdit, onDelete }) {
  let since = null;
  if (previous && point.ageDays > previous.ageDays) {
    const delta = point.amount - previous.amount;
    since = mkey === 'weight'
      ? `${formatChange('weight', delta / (point.ageDays - previous.ageDays)).replace(' g', '')} g/day since ${shortDate(previous.start_ts)}`
      : `${formatChange(mkey, delta)} since ${shortDate(previous.start_ts)}`;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8,
      padding: '8px 10px', borderRadius: 12, background: categoryTint(theme, 'weight', 0.10),
    }}>
      <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: theme.ink }}>
        <strong>{shortDate(point.start_ts)}</strong> · {formatMeasure(mkey, point.amount)}
        {point.pct != null && ` · ${ordinal(point.pct)} percentile`}
        {point.pct == null && point.chartDay < 0 && ' · before the due date, no percentile'}
        {since && ` · ${since}`}
        {point.ageDays === 0 && ' · birth'}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button theme={theme} onClick={onEdit} style={{ padding: '5px 10px', color: accent }}>Edit</Button>
        <Button theme={theme} onClick={onDelete} style={{ padding: '5px 10px', color: theme.bad }}>Delete</Button>
      </div>
    </div>
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
    boxSizing: 'border-box',
    ...extra,
  };
}

/**
 * The chart: WHO bands behind, her points on top, her own curve carried
 * forward to today. Ages on the x-axis, because that is the chart's unit; the
 * dates of the visible span sit at the ends. Fixed aspect so text and dots
 * never stretch (spec §11). Values in the measure's stored unit.
 */
function GrowthChart({ theme, g, mkey, points, sex, range, now, accent, refColor, selectedId, onSelect }) {
  const W = 340;
  const H = 180;
  const pad = { top: 12, right: 14, bottom: 22, left: 8 };
  const m = MEASURES[mkey];

  // Everything on the x-axis is a chart day: chronological age, or corrected
  // age when the family asked for it. Birth can then sit left of day 0.
  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? null;
  const ageToday = g.chartToday;
  const birthDay = -g.earlyDays;
  const fromDay = rangeDays == null ? birthDay : Math.max(birthDay, ageToday - (rangeDays - 1));
  const toDay = ageToday + Math.max(2, Math.round((ageToday - fromDay) * 0.04));
  const step = Math.max(1, Math.floor((toDay - fromDay) / 120));

  const bands = useMemo(() => bandSeries(sex, Math.max(0, fromDay), toDay, step, mkey), [sex, fromDay, toDay, step, mkey]);
  const curve = useMemo(
    () => (g.latest && g.z != null ? curveSeries(sex, g.z, Math.max(fromDay, 0, g.latest.chartDay), ageToday, step, mkey) : []),
    [sex, g.z, g.latest, fromDay, ageToday, step, mkey],
  );
  if (!bands.length) return null;

  const shown = points.filter((p) => p.chartDay >= fromDay && p.chartDay <= toDay);
  const ys = [
    ...bands.map((b) => b.lo2), ...bands.map((b) => b.hi2),
    ...shown.map((p) => p.amount), ...curve.map((c) => c.value),
  ].filter((v) => v != null);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(maxY - minY, m.minSpan);

  const x = (day) => pad.left + ((day - fromDay) / (toDay - fromDay)) * (W - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - minY) / spanY) * (H - pad.top - pad.bottom);
  const pt = (day, v) => `${x(day).toFixed(1)},${y(v).toFixed(1)}`;

  const area = (hiKey, loKey) => `M${bands.map((b) => pt(b.day, b[hiKey])).join(' L')} L${[...bands].reverse().map((b) => pt(b.day, b[loKey])).join(' L')} Z`;
  const line = (rows, key) => `M${rows.map((r) => pt(r.day, r[key])).join(' L')}`;

  const actualPath = shown.length > 1 ? `M${shown.map((p) => pt(p.chartDay, p.amount)).join(' L')}` : null;
  const curvePath = curve.length > 1 ? line(curve, 'value') : null;
  const todayOnCurve = g.today?.onCurve;

  // Age ticks: whole months from birth, thinned so labels never collide.
  const monthsShown = (toDay - fromDay) / MONTH_DAYS;
  const every = monthsShown > 14 ? 3 : monthsShown > 7 ? 2 : 1;
  const ticks = [];
  for (let mo = 1; mo * MONTH_DAYS <= toDay; mo += every) {
    const day = mo * MONTH_DAYS;
    // Skip a tick label that would run into the "today" date at the right edge.
    if (day >= fromDay && x(day) < W - pad.right - 44) ticks.push({ day, label: `${mo} mo` });
  }
  const birthTs = addDays(localNoon(now), -g.ageToday);
  const leftDate = shortDate(addDays(birthTs, fromDay - birthDay));
  const rightDate = shortDate(now);
  const dueTick = g.corrected && fromDay < 0 ? { day: 0, label: `due · ${shortDate(addDays(birthTs, g.earlyDays))}` } : null;
  const what = { weight: 'weight-for-age', length: 'length-for-age', head: 'head-circumference-for-age' }[mkey];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', marginTop: 12, overflow: 'visible' }}
      role="img"
      aria-label={`${m.label} against the WHO ${what} chart for a ${sex}`}
    >
      <path d={area('hi2', 'lo2')} fill={categoryTint(theme, 'expected', theme.name === 'night' ? 0.14 : 0.10)} />
      <path d={area('hi1', 'lo1')} fill={categoryTint(theme, 'expected', theme.name === 'night' ? 0.18 : 0.13)} />
      <path d={line(bands, 'med')} fill="none" stroke={refColor} strokeWidth="1" opacity="0.7" />
      {[...(dueTick ? [dueTick] : []), ...ticks].map((t) => (
        <g key={t.label}>
          <line x1={x(t.day)} y1={pad.top} x2={x(t.day)} y2={H - pad.bottom} stroke={theme.line} strokeWidth="0.75" />
          <text x={x(t.day)} y={H - pad.bottom + 11} fontSize="8.5" fill={theme.inkFaint} textAnchor="middle">{t.label}</text>
        </g>
      ))}

      {curvePath && <path d={curvePath} fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" />}
      {actualPath && <path d={actualPath} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

      {todayOnCurve != null && g.today.measuredToday == null && (
        <g>
          <line x1={x(ageToday)} y1={pad.top} x2={x(ageToday)} y2={H - pad.bottom} stroke={accent} strokeWidth="0.75" strokeDasharray="2 3" opacity="0.5" />
          <circle cx={x(ageToday)} cy={y(todayOnCurve)} r="4" fill={theme.surface} stroke={accent} strokeWidth="1.5" />
        </g>
      )}

      {shown.map((p, i) => {
        const isSel = p.id === selectedId;
        const isEnd = i === shown.length - 1 || i === 0 || isSel;
        return (
          <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: 'pointer' }}>
            <circle cx={x(p.chartDay)} cy={y(p.amount)} r="12" fill="transparent" />
            <circle cx={x(p.chartDay)} cy={y(p.amount)} r={isSel ? 5 : 3.5} fill={accent} stroke={theme.surface} strokeWidth="1.5" />
            {isEnd && (
              <text
                x={Math.max(pad.left + 14, Math.min(W - pad.right - 14, x(p.chartDay)))}
                y={y(p.amount) - 9}
                fontSize="9"
                fill={theme.inkSoft}
                textAnchor="middle"
                fontWeight={isSel ? 700 : 400}
              >{formatMeasureShort(mkey, p.amount)}</text>
            )}
          </g>
        );
      })}

      <text x={pad.left} y={H - 3} fontSize="8.5" fill={theme.inkFaint}>{fromDay === birthDay ? `birth · ${leftDate}` : leftDate}</text>
      <text x={W - pad.right} y={H - 3} fontSize="8.5" fill={theme.inkFaint} textAnchor="end">today · {rightDate}</text>
    </svg>
  );
}
