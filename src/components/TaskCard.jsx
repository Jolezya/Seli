// Today's Tasks. Four daily care items, "done" meaning an event of that type
// exists today in LOCAL time — so the list resets itself at local midnight with
// no state of its own to go stale (spec §6).

import React, { useState } from 'react';
import { Card, CardTitle, Chip, Button, Emoji, haptic } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import { clockTime, formatDuration, MINUTE } from '../lib/time.js';
import { eventsOnDay, openSession, totalDurationOnDay } from '../lib/events.js';
import { msLeftInDay, leftLabel, taskTone } from '../lib/tasks.js';
import { bathSchedule, toggleDay, WEEKDAYS, DEFAULT_BATH_DAYS } from '../lib/bath.js';

export const CARERS = ['Kay', 'Maren', 'Both'];
export const TUMMY_GOALS = [10, 15, 20, 30];

export default function TaskCard({ theme, events, store, now }) {
  const [pickingCarer, setPickingCarer] = useState(false);

  const todays = eventsOnDay(events, now);
  const doneOf = (type) => todays.find((e) => e.type === type) || null;

  const vitd = doneOf('vitd');
  const massage = doneOf('massage');
  const exercise = doneOf('exercise');

  const goal = store.prefs.tummyGoal;
  const tummyMs = totalDurationOnDay(events, 'tummy', now, now);
  const tummyMin = Math.floor(tummyMs / MINUTE);
  const tummyOpen = openSession(events, 'tummy');
  const tummyDone = tummyMin >= goal;

  // Bath is a fifth task on scheduled days only, so the other five days stay
  // uncluttered. The count follows.
  const bathDays = store.prefs.bathDays ?? DEFAULT_BATH_DAYS;
  const bath = bathSchedule(events, bathDays, now);
  const total = 4 + (bath.isBathDay ? 1 : 0);
  const doneCount = [vitd, massage, exercise].filter(Boolean).length + (tummyDone ? 1 : 0)
    + (bath.isBathDay && bath.doneToday ? 1 : 0);
  const allDone = doneCount === total;

  // Gentle escalation, and one countdown for the whole card: every task
  // shares the same deadline (local midnight, when the list resets), so a
  // timer per row would show the same number four times. The header warms
  // to amber once the day is half gone, or in the last two hours whatever
  // the clock says. It deliberately stops there — a red alarm on a newborn's
  // evening nags rather than helps; these are gentle daily habits, not
  // deadlines. Whole minutes only: the card already re-renders each minute.
  const left = msLeftInDay(now);
  const tone = taskTone({ allDone, now });
  const nudge = tone === 'nudge';
  const headerColor = tone === 'done' ? theme.good
    : tone === 'calm' ? theme.inkSoft
    : theme.warn;

  if (allDone) {
    return (
      <Card theme={theme} style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.good, fontWeight: 600 }}>
          <Emoji char="✅" size={16} /> All {total === 5 ? 'five' : 'four'} daily tasks done
        </div>
      </Card>
    );
  }

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={(
          <span style={{ fontSize: 11, fontWeight: 700, color: headerColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {doneCount}/{total} done · {leftLabel(left)}
          </span>
        )}
      >
        <span style={{ color: headerColor }}>Today's tasks</span>
      </CardTitle>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 1. Vitamin D — records WHO gave it, in the `side` column. */}
        <TaskRow theme={theme} emoji="💊" label="Give vitamin D" category="vitd" done={Boolean(vitd)}>
          {vitd ? (
            <Done theme={theme}>
              Vitamin D given {clockTime(vitd.start_ts)}{vitd.side ? ` · by ${vitd.side}` : ''}
            </Done>
          ) : pickingCarer ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CARERS.map((who) => (
                <Chip
                  key={who}
                  theme={theme}
                  accent={categoryColor(theme, 'vitd')}
                  onClick={() => {
                    haptic();
                    store.logPoint('vitd', { side: who });
                    setPickingCarer(false);
                  }}
                >{who}</Chip>
              ))}
            </div>
          ) : (
            <>
              {nudge && <Hint theme={theme}>not yet today</Hint>}
              <Button theme={theme} onClick={() => setPickingCarer(true)} style={{ padding: '6px 12px' }}>Done</Button>
            </>
          )}
        </TaskRow>

        {/* 2. Tummy time — the one task measured in minutes, not a checkbox. */}
        <TaskRow
          theme={theme}
          emoji="🤸"
          label="Tummy time"
          category="tummy"
          done={tummyDone}
          // Always visible: an empty track spanning the row reads as "none of
          // this goal yet", which is information. It only looked like a
          // rendering fault when it was a short bar floating under the buttons.
          // The fill uses exact elapsed time, not whole minutes, so it starts
          // moving the moment a session begins rather than sitting at zero for
          // the first minute.
          below={<Progress theme={theme} minutes={tummyMs / MINUTE} goal={goal} category="tummy" />}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* The chip already says how far there is to go, so the nudge
                here is its colour, not another word: three items would wrap
                the row. */}
            <Chip
              theme={theme}
              accent={categoryColor(theme, 'tummy')}
              style={nudge && !tummyDone ? { borderColor: theme.warn, color: theme.warn } : null}
              onClick={() => {
                const next = TUMMY_GOALS[(TUMMY_GOALS.indexOf(goal) + 1) % TUMMY_GOALS.length];
                store.setPrefs({ tummyGoal: next });
              }}
              title="Tap to change the daily goal"
            >{tummyMin}/{goal}m</Chip>
            <Button
              theme={theme}
              tone={tummyOpen ? 'accent' : 'plain'}
              onClick={() => { haptic(); store.toggleSession('tummy'); }}
              style={{ padding: '6px 12px' }}
            >{tummyOpen ? 'Going…' : 'Start'}</Button>
          </div>
        </TaskRow>

        {/* 3 + 4. One-tap tasks. */}
        <TaskRow theme={theme} emoji="💆" label="Massage" category="massage" done={Boolean(massage)}>
          {massage
            ? <Done theme={theme}>Massage done {clockTime(massage.start_ts)}</Done>
            : (
              <>
                {nudge && <Hint theme={theme}>not yet today</Hint>}
                <Button theme={theme} onClick={() => { haptic(); store.logPoint('massage'); }} style={{ padding: '6px 12px' }}>Done</Button>
              </>
            )}
        </TaskRow>

        {/* 5. Bath, on its scheduled days. Logs the same event the tile logs. */}
        {bath.isBathDay && (
          <TaskRow theme={theme} emoji="🛁" label="Bath" category="bath" done={Boolean(bath.doneToday)}>
            {bath.doneToday
              ? <Done theme={theme}>Bath done {clockTime(bath.doneToday.start_ts)}</Done>
              : (
                <>
                  {nudge && <Hint theme={theme}>not yet today</Hint>}
                  <Button theme={theme} onClick={() => { haptic(); store.logPoint('bath'); }} style={{ padding: '6px 12px' }}>Done</Button>
                </>
              )}
          </TaskRow>
        )}

        <TaskRow theme={theme} emoji="🤸‍♀️" label="Exercise" category="exercise" done={Boolean(exercise)}>
          {exercise
            ? <Done theme={theme}>Exercise done {clockTime(exercise.start_ts)}</Done>
            : (
              <>
                {nudge && <Hint theme={theme}>not yet today</Hint>}
                <Button theme={theme} onClick={() => { haptic(); store.logPoint('exercise'); }} style={{ padding: '6px 12px' }}>Done</Button>
              </>
            )}
        </TaskRow>
      </div>

      <BathDays theme={theme} days={bathDays} onToggle={(d) => store.setPrefs({ bathDays: toggleDay(bathDays, d) })} />
    </Card>
  );
}

/** The bath schedule: seven small day chips, the scheduled ones filled. */
function BathDays({ theme, days, onToggle }) {
  const accent = categoryColor(theme, 'bath');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: theme.inkSoft, marginRight: 2 }}>Bath days</span>
      {WEEKDAYS.map((w) => {
        const on = days.includes(w.day);
        return (
          <button
            key={w.day}
            type="button"
            onClick={() => { haptic(); onToggle(w.day); }}
            aria-label={`${w.label}${on ? ', bath day' : ''}`}
            aria-pressed={on}
            style={{
              appearance: 'none', width: 26, height: 26, borderRadius: 999, padding: 0, cursor: 'pointer',
              border: `1px solid ${on ? accent : theme.line}`,
              background: on ? accent : 'transparent',
              color: on ? (theme.name === 'night' ? '#0C0C11' : '#FFFFFF') : theme.inkSoft,
              fontSize: 11, fontWeight: 700, lineHeight: 1,
            }}
          >{w.short}</button>
        );
      })}
    </div>
  );
}

function TaskRow({ theme, emoji, label, done, children, below }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: done ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Emoji char={emoji} size={18} />
        <span style={{
          fontSize: 13.5, color: theme.ink, flex: 1, minWidth: 110, fontWeight: 500,
        }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {children}
        </div>
      </div>
      {/* Full-width, so it reads as this row's progress rather than a stray
          mark floating under the buttons. */}
      {below}
    </div>
  );
}

/**
 * The last-two-hours nudge on a row still open: amber text, no icon, no
 * animation. It says what is left, and the button beside it is the answer.
 */
function Hint({ theme, children }) {
  return (
    <span style={{ fontSize: 11.5, color: theme.warn, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Done({ theme, children }) {
  return (
    <span style={{ fontSize: 12, color: theme.good, fontWeight: 600, textAlign: 'right' }}>
      ✅ {children}
    </span>
  );
}

function Progress({ theme, minutes, goal, category }) {
  const pct = Math.min(100, goal > 0 ? Math.max(0, minutes / goal) * 100 : 0);
  return (
    <div style={{
      width: '100%', height: 5, borderRadius: 999,
      background: categoryTint(theme, category, 0.18), overflow: 'hidden',
    }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: categoryColor(theme, category),
        transition: 'width 240ms ease',
      }} />
    </div>
  );
}

export { formatDuration };
