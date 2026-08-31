// Today's Tasks. Four daily care items, "done" meaning an event of that type
// exists today in LOCAL time — so the list resets itself at local midnight with
// no state of its own to go stale (spec §6).

import React, { useState } from 'react';
import { Card, CardTitle, Chip, Button, Emoji, haptic } from '../ui.jsx';
import { categoryColor, categoryTint } from '../theme.js';
import { clockTime, formatDuration, MINUTE } from '../lib/time.js';
import { eventsOnDay, openSession, totalDurationOnDay } from '../lib/events.js';

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

  const doneCount = [vitd, massage, exercise].filter(Boolean).length + (tummyDone ? 1 : 0);
  const allDone = doneCount === 4;

  // Gentle escalation: the header warms to amber once the day is half gone and
  // tasks remain. It deliberately stops there — a red alarm on a newborn's
  // evening nags rather than helps, and these are gentle daily habits, not
  // deadlines.
  const hour = new Date(now).getHours();
  const headerColor = allDone ? theme.good
    : hour >= 12 ? theme.warn
    : theme.inkSoft;

  if (allDone) {
    return (
      <Card theme={theme} style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.good, fontWeight: 600 }}>
          <Emoji char="✅" size={16} /> All four daily tasks done
        </div>
      </Card>
    );
  }

  return (
    <Card theme={theme}>
      <CardTitle
        theme={theme}
        right={<span style={{ fontSize: 11, fontWeight: 700, color: headerColor }}>{doneCount}/4 done</span>}
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
            <Button theme={theme} onClick={() => setPickingCarer(true)} style={{ padding: '6px 12px' }}>Done</Button>
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
            <Chip
              theme={theme}
              accent={categoryColor(theme, 'tummy')}
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
            : <Button theme={theme} onClick={() => { haptic(); store.logPoint('massage'); }} style={{ padding: '6px 12px' }}>Done</Button>}
        </TaskRow>

        <TaskRow theme={theme} emoji="🤸‍♀️" label="Exercise" category="exercise" done={Boolean(exercise)}>
          {exercise
            ? <Done theme={theme}>Exercise done {clockTime(exercise.start_ts)}</Done>
            : <Button theme={theme} onClick={() => { haptic(); store.logPoint('exercise'); }} style={{ padding: '6px 12px' }}>Done</Button>}
        </TaskRow>
      </div>
    </Card>
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
