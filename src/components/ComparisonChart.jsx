// Comparison chart: one metric as bars over a 7/14/30-day window (spec §8).

import React, { useMemo } from 'react';
import { Card, CardTitle, Chip, Muted } from '../ui.jsx';
import { categoryColor } from '../theme.js';
import { METRICS, metricByKey, metricSeries, mean } from '../lib/analytics.js';

const WINDOWS = [7, 14, 30];

/** Colour a metric borrows from its category. */
const METRIC_CATEGORY = {
  feeds: 'nurse', bottle_ml: 'bottle', nap: 'nap',
  night: 'night', tummy: 'tummy', wet: 'wet', poop: 'poop',
};

export default function ComparisonChart({ theme, events, store, now }) {
  const metric = metricByKey(store.prefs.metric);
  const days = store.prefs.window;
  const accent = categoryColor(theme, METRIC_CATEGORY[metric.key] || 'nurse');

  const series = useMemo(() => metricSeries(events, metric, days, now), [events, metric, days, now]);
  const values = series.map((d) => d.value);
  const max = Math.max(...values, 1);
  const average = mean(values);
  const daysLogged = values.filter((v) => v > 0).length;
  const today = values[values.length - 1];
  const showLabels = days <= 14;

  return (
    <Card theme={theme}>
      <CardTitle theme={theme}>Compare</CardTitle>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
        {METRICS.map((m) => (
          <Chip
            key={m.key}
            theme={theme}
            accent={categoryColor(theme, METRIC_CATEGORY[m.key] || 'nurse')}
            active={m.key === metric.key}
            onClick={() => store.setPrefs({ metric: m.key })}
          >{m.label}</Chip>
        ))}
      </div>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3, height: 108 }}>
        {/* Average reference line, drawn behind the bars. */}
        {average > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: 0, right: 0,
              bottom: `${(average / max) * 88}%`,
              borderTop: `1px dashed ${theme.inkFaint}`, opacity: 0.7,
            }}
          >
            {/* Anchored left: the most recent bars sit on the right, and a
                label over today's bar is exactly the one you cannot read. */}
            <span style={{
              position: 'absolute', left: 0, top: -13, fontSize: 9,
              color: theme.inkFaint, background: theme.surfaceBottom, padding: '0 3px',
            }}>avg {average.toFixed(1)}</span>
          </div>
        )}

        {series.map((d) => (
          <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', minWidth: 0 }}>
            {showLabels && d.value > 0 && (
              <span style={{ fontSize: 9, color: theme.inkSoft, marginBottom: 2, fontVariantNumeric: 'tabular-nums' }}>
                {d.value}
              </span>
            )}
            <div
              title={`${d.key}: ${d.value}${metric.unit}`}
              style={{
                width: '100%',
                height: `${Math.max(d.value > 0 ? 3 : 1.5, (d.value / max) * 88)}%`,
                background: d.value > 0 ? accent : theme.line,
                borderRadius: 4,
                opacity: d.value > 0 ? 1 : 0.6,
                transition: 'height 220ms ease',
              }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Muted theme={theme} size={11}>
          Average {average.toFixed(1)}{metric.unit} per day · {daysLogged} {daysLogged === 1 ? 'day' : 'days'} logged · Today {today}{metric.unit}
        </Muted>
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((d) => (
            <Chip key={d} theme={theme} accent={accent} active={days === d} onClick={() => store.setPrefs({ window: d })}>
              {d}d
            </Chip>
          ))}
        </div>
      </div>
    </Card>
  );
}
