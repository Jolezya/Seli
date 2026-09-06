// Weight tracker: her weight against the WHO weight-for-age chart — which
// curve she is on, whether she is staying on it, and the milestones parents
// actually remember (spec §7).

import React, { useMemo, useState } from 'react';
import { Card, CardTitle, Chip, Button, Muted } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import { inRange, RANGES, formatGrams } from '../lib/weight.js';
import { growthSummary, bandSeries, curveSeries } from '../lib/growth.js';
import { ordinal, SEXES } from '../lib/who.js';
import { shortDate, toDateInput, fromDateInput, addDays, localNoon } from '../lib/time.js';

const MONTH_DAYS = 30.4375;

export default function WeightCard({ theme, events, store, now }) {
  const [adding, setAdding] = useState(false);
  const [editingFacts, setEditingFacts] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({ date: toDateInput(now), grams: '' });

  const sex = SEXES.includes(store.prefs.sex) ? store.prefs.sex : 'girl';
  const birthTs = fromDateInput(store.prefs.birthDate) ?? localNoon(now);
  const range = store.prefs.weightRange;
  const accent = categoryColor(theme, 'weight');
  const refColor = categoryColor(theme, 'expected');
  const pronoun = sex === 'girl' ? { she: 'she', her: 'her' } : { she: 'he', her: 'his' };

  const g = useMemo(() => growthSummary(events, { birthTs, sex }, now), [events, birthTs, sex, now]);
  const visible = useMemo(() => inRange(g.list, range, now), [g.list, range, now]);
  const selected = selectedId ? g.list.find((p) => p.id === selectedId) : null;

  const submit = (e) => {
    e.preventDefault();
    const ts = fromDateInput(draft.date) ?? now;
    if (store.setWeight(ts, draft.grams)) {
      setAdding(false);
      setSelectedId(null);
      setDraft({ date: toDateInput(now), grams: '' });
    }
  };

  const startEdit = (point) => {
    setDraft({ date: toDateInput(point.start_ts), grams: String(point.amount) });
    setAdding(true);
  };

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={<Chip theme={theme} accent={accent} active={adding} onClick={() => setAdding((v) => !v)}>Add</Chip>}
      >Weight</CardTitle>

      {adding && (
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={draft.date}
            min={toDateInput(birthTs)}
            max={toDateInput(now)}
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

      {g.latest ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em',
              color: theme.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
            }}>{formatGrams(g.latest.amount)}</div>
            {g.sinceBirth != null ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: g.sinceBirth >= 0 ? theme.good : theme.bad }}>
                {signed(g.sinceBirth)} g since birth
              </div>
            ) : g.list.length > 1 && (
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.good }}>
                {signed(g.latest.amount - g.list[g.list.length - 2].amount)} g
              </div>
            )}
            <Muted theme={theme}>{shortDate(g.latest.start_ts)}</Muted>
          </div>

          <PercentileLine theme={theme} g={g} refColor={refColor} sex={sex} />

          <Muted theme={theme} style={{ marginTop: 2 }}>
            {g.today?.weighedToday != null
              ? `Weighed today · the 50th percentile is ${formatGrams(g.today.median)}`
              : g.today?.onCurve != null && `Today ≈ ${formatGrams(g.today.onCurve)} on ${pronoun.her} curve`}
            {g.milestones?.doubled
              ? ` · doubled birth weight ${shortDate(g.milestones.doubled.ts)}`
              : g.milestones?.doubledProjected
                && ` · doubles birth weight ≈ ${shortDate(g.milestones.doubledProjected.ts)} (${formatGrams(g.milestones.target)})`}
          </Muted>

          {g.rhythm?.due && (
            <Muted theme={theme} style={{ marginTop: 2, color: theme.warn }}>
              Last weighed {g.rhythm.daysSince} days ago · time for a weigh-in
            </Muted>
          )}

          <GrowthChart
            theme={theme}
            g={g}
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
              point={selected}
              previous={g.list[g.list.indexOf(selected) - 1] || null}
              accent={accent}
              onEdit={() => startEdit(selected)}
              onDelete={() => { store.remove(selected.id, 'Weigh-in'); setSelectedId(null); }}
            />
          )}
        </>
      ) : (
        <Muted theme={theme} style={{ padding: '8px 0 4px' }}>
          No weigh-ins yet — tap <strong>Add</strong> to record the first one. Birth weight makes the best start.
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
        <Chip theme={theme} accent={refColor} active={editingFacts} onClick={() => setEditingFacts((v) => !v)}>
          Born {shortDate(birthTs)} · {sex}
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
        </div>
      )}

      <Muted theme={theme} size={11} style={{ marginTop: 8 }}>
        <span style={{ color: accent }}>●</span> weigh-ins · <span style={{ color: accent }}>dashed</span> = {pronoun.her} curve
        {g.pctLabel ? ` (${g.pctLabel})` : ''} · <span style={{ color: refColor }}>bands</span> = WHO 3rd–97th, darker 15th–85th, line = 50th
      </Muted>
    </Card>
  );
}

function signed(n) {
  return `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n)).toLocaleString()}`;
}

/** "38th percentile · same curve since birth (35th → 38th)". */
function PercentileLine({ theme, g, refColor, sex }) {
  if (g.pct == null) return null;
  const t = g.trend;
  let tail = null;
  let color = refColor;
  if (!t) {
    tail = `for a ${sex} ${sex === 'girl' ? 'her' : 'his'} age`;
  } else if (t.flag) {
    color = theme.warn;
    tail = `crossed ${t.crossed} percentile lines ${t.direction === 'up' ? 'upwards' : 'downwards'} since ${shortDate(g.first.start_ts)} (${ordinal(t.fromPct)} → ${ordinal(t.toPct)}) · worth mentioning at the next check`;
  } else if (t.direction === 'same') {
    tail = `same curve since ${shortDate(g.first.start_ts)} (${ordinal(t.fromPct)} → ${ordinal(t.toPct)})`;
  } else {
    tail = `drifting ${t.direction} since ${shortDate(g.first.start_ts)} (${ordinal(t.fromPct)} → ${ordinal(t.toPct)}), within the usual range`;
  }
  return (
    <Muted theme={theme} style={{ marginTop: 4, color }}>
      <strong style={{ color: theme.ink }}>{g.pctLabel} percentile</strong> · {tail}
    </Muted>
  );
}

/** The row under the chart for a tapped weigh-in, with edit and delete. */
function PointDetail({ theme, point, previous, accent, onEdit, onDelete }) {
  const gain = previous && point.ageDays > previous.ageDays
    ? Math.round((point.amount - previous.amount) / (point.ageDays - previous.ageDays))
    : null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8,
      padding: '8px 10px', borderRadius: 12, background: categoryTint(theme, 'weight', 0.10),
    }}>
      <div style={{ flex: 1, minWidth: 160, fontSize: 12, color: theme.ink }}>
        <strong>{shortDate(point.start_ts)}</strong> · {formatGrams(point.amount)}
        {point.pct != null && ` · ${ordinal(point.pct)} percentile`}
        {gain != null && ` · ${signed(gain)} g/day since ${shortDate(previous.start_ts)}`}
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
    ...extra,
  };
}

/**
 * The chart: WHO bands behind, her weigh-ins on top, her own curve carried
 * forward to today. Ages on the x-axis, because that is the chart's unit; the
 * dates of the visible span sit at the ends. Fixed aspect so text and dots
 * never stretch (spec §11).
 */
function GrowthChart({ theme, g, points, sex, range, now, accent, refColor, selectedId, onSelect }) {
  const W = 340;
  const H = 180;
  const pad = { top: 12, right: 14, bottom: 22, left: 8 };

  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? null;
  const ageToday = g.ageToday;
  const fromDay = rangeDays == null ? 0 : Math.max(0, ageToday - (rangeDays - 1));
  const toDay = ageToday + Math.max(2, Math.round((ageToday - fromDay) * 0.04));
  const step = Math.max(1, Math.floor((toDay - fromDay) / 120));

  const bands = useMemo(() => bandSeries(sex, fromDay, toDay, step), [sex, fromDay, toDay, step]);
  const curve = useMemo(
    () => (g.latest ? curveSeries(sex, g.z, Math.max(fromDay, g.latest.ageDays), ageToday, step) : []),
    [sex, g.z, g.latest, fromDay, ageToday, step],
  );
  if (!bands.length) return null;

  const shown = points.filter((p) => p.ageDays >= fromDay && p.ageDays <= toDay);
  const ys = [
    ...bands.map((b) => b.lo2), ...bands.map((b) => b.hi2),
    ...shown.map((p) => p.amount), ...curve.map((c) => c.grams),
  ].filter((v) => v != null);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(maxY - minY, 200);

  const x = (day) => pad.left + ((day - fromDay) / (toDay - fromDay)) * (W - pad.left - pad.right);
  const y = (grams) => pad.top + (1 - (grams - minY) / spanY) * (H - pad.top - pad.bottom);
  const pt = (day, grams) => `${x(day).toFixed(1)},${y(grams).toFixed(1)}`;

  const area = (hiKey, loKey) => `M${bands.map((b) => pt(b.day, b[hiKey])).join(' L')} L${[...bands].reverse().map((b) => pt(b.day, b[loKey])).join(' L')} Z`;
  const line = (rows, key) => `M${rows.map((r) => pt(r.day, r[key])).join(' L')}`;

  const actualPath = shown.length > 1 ? `M${shown.map((p) => pt(p.ageDays, p.amount)).join(' L')}` : null;
  const curvePath = curve.length > 1 ? line(curve, 'grams') : null;
  const todayOnCurve = g.today?.onCurve;

  // Age ticks: whole months from birth, thinned so labels never collide.
  const monthsShown = (toDay - fromDay) / MONTH_DAYS;
  const every = monthsShown > 14 ? 3 : monthsShown > 7 ? 2 : 1;
  const ticks = [];
  for (let m = 1; m * MONTH_DAYS <= toDay; m += every) {
    const day = m * MONTH_DAYS;
    if (day >= fromDay) ticks.push({ day, label: `${m} mo` });
  }
  const birthTs = addDays(localNoon(now), -ageToday);
  const leftDate = shortDate(addDays(birthTs, fromDay));
  const rightDate = shortDate(now);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', marginTop: 12, overflow: 'visible' }}
      role="img"
      aria-label={`Weight against the WHO weight-for-age chart for a ${sex}`}
    >
      <path d={area('hi2', 'lo2')} fill={categoryTint(theme, 'expected', theme.name === 'night' ? 0.14 : 0.10)} />
      <path d={area('hi1', 'lo1')} fill={categoryTint(theme, 'expected', theme.name === 'night' ? 0.18 : 0.13)} />
      <path d={line(bands, 'med')} fill="none" stroke={refColor} strokeWidth="1" opacity="0.7" />
      {ticks.map((t) => (
        <g key={t.label}>
          <line x1={x(t.day)} y1={pad.top} x2={x(t.day)} y2={H - pad.bottom} stroke={theme.line} strokeWidth="0.75" />
          <text x={x(t.day)} y={H - pad.bottom + 11} fontSize="8.5" fill={theme.inkFaint} textAnchor="middle">{t.label}</text>
        </g>
      ))}

      {curvePath && <path d={curvePath} fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 4" />}
      {actualPath && <path d={actualPath} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

      {todayOnCurve != null && g.today.weighedToday == null && (
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
            <circle cx={x(p.ageDays)} cy={y(p.amount)} r="12" fill="transparent" />
            <circle cx={x(p.ageDays)} cy={y(p.amount)} r={isSel ? 5 : 3.5} fill={accent} stroke={theme.surface} strokeWidth="1.5" />
            {isEnd && (
              <text
                x={Math.max(pad.left + 14, Math.min(W - pad.right - 14, x(p.ageDays)))}
                y={y(p.amount) - 9}
                fontSize="9"
                fill={theme.inkSoft}
                textAnchor="middle"
                fontWeight={isSel ? 700 : 400}
              >{p.amount.toLocaleString()}</text>
            )}
          </g>
        );
      })}

      <text x={pad.left} y={H - 3} fontSize="8.5" fill={theme.inkFaint}>{fromDay === 0 ? `birth · ${leftDate}` : leftDate}</text>
      <text x={W - pad.right} y={H - 3} fontSize="8.5" fill={theme.inkFaint} textAnchor="end">today · {rightDate}</text>
    </svg>
  );
}
