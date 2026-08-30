// The day log: what actually happened, day by day, editable — plus the data
// buttons that let a parent take their data with them (spec §8).

import React, { useMemo, useRef, useState } from 'react';
import { Card, CardTitle, Chip, Button, Muted, Emoji, Divider, haptic } from '../ui.jsx';
import { categoryColor } from '../theme.js';
import {
  dayLabel, clockTime, addDays, startOfLocalDay, formatDuration,
  toDatetimeLocal, fromDatetimeLocal, MINUTE,
} from '../lib/time.js';
import { eventsOnDay, isTimedType, durationOf, ALL_TYPES } from '../lib/events.js';
import { toCSV, download, stamp, readFile } from '../lib/files.js';

const LABELS = {
  nurse: { emoji: '🤱', name: 'Nursing' },
  bottle: { emoji: '🍼', name: 'Bottle' },
  nap: { emoji: '😴', name: 'Nap' },
  night: { emoji: '🌙', name: 'Night sleep' },
  tummy: { emoji: '🤸', name: 'Tummy time' },
  wet: { emoji: '💧', name: 'Wet' },
  poop: { emoji: '💩', name: 'Poop' },
  vitd: { emoji: '💊', name: 'Vitamin D' },
  weight: { emoji: '⚖️', name: 'Weight' },
  note: { emoji: '📝', name: 'Note' },
  massage: { emoji: '💆', name: 'Massage' },
  exercise: { emoji: '🤸‍♀️', name: 'Exercise' },
};

export default function DayLog({ theme, events, store, now }) {
  const [dayTs, setDayTs] = useState(() => startOfLocalDay(now));
  const [editing, setEditing] = useState(null);
  const [noteDraft, setNoteDraft] = useState(null);

  const dayEvents = useMemo(
    () => eventsOnDay(events, dayTs).slice().sort((a, b) => b.start_ts - a.start_ts),
    [events, dayTs],
  );
  const stats = useMemo(() => dayStats(dayEvents, now), [dayEvents, now]);
  const isFuture = startOfLocalDay(dayTs) >= startOfLocalDay(now);

  return (
    <Card theme={theme}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <NavButton theme={theme} onClick={() => setDayTs((d) => addDays(d, -1))} label="Previous day">‹</NavButton>
        <div style={{ fontSize: 14, fontWeight: 650, color: theme.ink }}>{dayLabel(dayTs, now)}</div>
        <NavButton theme={theme} onClick={() => setDayTs((d) => addDays(d, 1))} label="Next day" disabled={isFuture}>›</NavButton>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Stat theme={theme}>
          {stats.feeds} {stats.feeds === 1 ? 'feed' : 'feeds'} ({stats.nurse} nursing · {stats.bottle} bottle)
        </Stat>
        {stats.napMin > 0 && <Stat theme={theme}>{stats.napMin}m nap time</Stat>}
        {stats.nightMin > 0 && <Stat theme={theme}>{formatDuration(stats.nightMin * MINUTE)} night sleep</Stat>}
        <Stat theme={theme}>{stats.wet} wet</Stat>
        <Stat theme={theme}>{stats.poop} poop</Stat>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button theme={theme} onClick={() => setNoteDraft(noteDraft == null ? '' : null)}>+ Note</Button>
        <Button theme={theme} onClick={() => store.setPrefs({ logHidden: !store.prefs.logHidden })}>
          {store.prefs.logHidden ? `Show log (${dayEvents.length})` : 'Hide log'}
        </Button>
      </div>

      {noteDraft != null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = noteDraft.trim();
            if (!text) { setNoteDraft(null); return; }
            // A note lands on the day being viewed, at the current clock time.
            const base = new Date(dayTs);
            const nowDate = new Date(now);
            base.setHours(nowDate.getHours(), nowDate.getMinutes(), 0, 0);
            store.log('note', { start_ts: base.getTime(), descr: text });
            setNoteDraft(null);
          }}
          style={{ display: 'flex', gap: 8, marginTop: 10 }}
        >
          <input
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="What happened?"
            style={{
              flex: 1, minWidth: 0, border: `1px solid ${theme.line}`, background: theme.bg,
              color: theme.ink, borderRadius: 10, padding: '9px 10px', fontSize: 13,
            }}
          />
          <Button theme={theme} tone="accent" type="submit">Save</Button>
        </form>
      )}

      {!store.prefs.logHidden && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
          {dayEvents.length === 0 && <Muted theme={theme}>Nothing logged on this day.</Muted>}
          {dayEvents.map((event) => (
            <Entry key={event.id} theme={theme} event={event} now={now} onEdit={() => setEditing(event)} />
          ))}
        </div>
      )}

      {editing && (
        <EditDialog
          theme={theme}
          event={editing}
          store={store}
          onClose={() => setEditing(null)}
        />
      )}

      <Divider theme={theme} />
      <DataButtons theme={theme} store={store} />
    </Card>
  );
}

function NavButton({ theme, onClick, children, label, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        appearance: 'none', border: `1px solid ${theme.line}`, background: 'transparent',
        color: theme.ink, width: 32, height: 32, borderRadius: 10, fontSize: 16,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, padding: 0,
      }}
    >{children}</button>
  );
}

function Stat({ theme, children }) {
  return (
    <span style={{
      fontSize: 11.5, color: theme.inkSoft, border: `1px solid ${theme.line}`,
      borderRadius: 999, padding: '4px 9px',
    }}>{children}</span>
  );
}

function Entry({ theme, event, now, onEdit }) {
  const meta = LABELS[event.type] || { emoji: '•', name: event.type };
  const timed = isTimedType(event.type);
  const ongoing = timed && event.end_ts == null;

  const time = timed && event.end_ts != null
    ? `ended ${clockTime(event.end_ts)}`
    : clockTime(event.start_ts);

  const details = [];
  if (event.type === 'bottle' && event.amount != null) details.push(`${event.amount} ml`);
  if (event.type === 'weight' && event.amount != null) details.push(`${event.amount} g`);
  if (event.side) details.push(`by ${event.side}`);
  if (timed) details.push(ongoing ? 'in progress' : formatDuration(durationOf(event, now)));
  if (event.descr) details.push(event.descr);

  return (
    <button
      type="button"
      onClick={() => { haptic(10); onEdit(); }}
      style={{
        appearance: 'none', border: 'none', background: 'transparent', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px',
        borderBottom: `1px solid ${theme.line}`, cursor: 'pointer', width: '100%',
      }}
    >
      <Emoji char={meta.emoji} size={17} />
      <span style={{ fontSize: 13, color: theme.ink, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{meta.name}</span>
        {details.length > 0 && (
          <span style={{ color: theme.inkSoft }}> · {details.join(' · ')}</span>
        )}
      </span>
      <span style={{
        fontSize: 12, color: ongoing ? categoryColor(theme, event.type) : theme.inkSoft,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{ongoing ? 'running' : time}</span>
    </button>
  );
}

function EditDialog({ theme, event, store, onClose }) {
  const [start, setStart] = useState(toDatetimeLocal(event.start_ts));
  const [end, setEnd] = useState(event.end_ts ? toDatetimeLocal(event.end_ts) : '');
  const [amount, setAmount] = useState(event.amount ?? '');
  const [descr, setDescr] = useState(event.descr ?? '');
  const meta = LABELS[event.type] || { emoji: '•', name: event.type };
  const timed = isTimedType(event.type);
  const hasAmount = event.type === 'bottle' || event.type === 'weight';

  const save = () => {
    const patch = { start_ts: fromDatetimeLocal(start) ?? event.start_ts };
    if (timed) patch.end_ts = end ? fromDatetimeLocal(end) : null;
    if (hasAmount) patch.amount = amount === '' ? null : Number(amount);
    if (event.type === 'note') patch.descr = descr;
    store.update(event.id, patch);
    onClose();
  };

  const field = {
    border: `1px solid ${theme.line}`, background: theme.bg, color: theme.ink,
    borderRadius: 10, padding: '9px 10px', fontSize: 13, width: '100%', minWidth: 0,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: theme.surface, borderRadius: 20,
          padding: 16, boxShadow: theme.shadowAmbient,
          marginBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Emoji char={meta.emoji} size={20} />
          <strong style={{ fontSize: 15, color: theme.ink }}>Edit {meta.name.toLowerCase()}</strong>
        </div>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <Muted theme={theme} size={11} style={{ marginBottom: 4 }}>{timed ? 'Started' : 'Time'}</Muted>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={field} />
        </label>

        {timed && (
          <label style={{ display: 'block', marginBottom: 10 }}>
            <Muted theme={theme} size={11} style={{ marginBottom: 4 }}>Ended (blank = still going)</Muted>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={field} />
          </label>
        )}

        {hasAmount && (
          <label style={{ display: 'block', marginBottom: 10 }}>
            <Muted theme={theme} size={11} style={{ marginBottom: 4 }}>
              {event.type === 'weight' ? 'Grams' : 'Millilitres'}
            </Muted>
            <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} style={field} />
          </label>
        )}

        {event.type === 'note' && (
          <label style={{ display: 'block', marginBottom: 10 }}>
            <Muted theme={theme} size={11} style={{ marginBottom: 4 }}>Note</Muted>
            <input value={descr} onChange={(e) => setDescr(e.target.value)} style={field} />
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'space-between' }}>
          <Button
            theme={theme}
            tone="danger"
            onClick={() => { store.remove(event.id, meta.name); onClose(); }}
          >Delete</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button theme={theme} onClick={onClose}>Cancel</Button>
            <Button theme={theme} tone="accent" onClick={save}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Back up / Restore / Clear / Export. Clearing is armed, scoped and undoable. */
function DataButtons({ theme, store }) {
  const fileInput = useRef(null);
  const [armed, setArmed] = useState(false);
  const [scope, setScope] = useState('all');

  const doRestore = async (file) => {
    if (!file) return;
    try {
      const result = store.restore(JSON.parse(await readFile(file)));
      store.showToast(result.ok
        ? `Restored ${result.total} entries (${result.added} new)`
        : `Restore failed — ${result.error}`);
    } catch {
      store.showToast('Restore failed — that file could not be read.');
    }
  };

  const clear = () => {
    const before = scope === 'old' ? Date.now() - 30 * 24 * 60 * 60 * 1000 : null;
    const count = store.clearData({ before });
    if (!count) store.showToast('Nothing matched — nothing was deleted.');
    setArmed(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          theme={theme}
          onClick={() => {
            download(stamp('checkin-backup', 'json'), JSON.stringify(store.backup(), null, 2));
            store.showToast('Backup downloaded ✓', null, 3000);
          }}
        >Back up data</Button>
        <Button theme={theme} onClick={() => fileInput.current?.click()}>Restore</Button>
        <Button
          theme={theme}
          onClick={() => download(stamp('checkin-export', 'csv'), toCSV(store.backup().events), 'text/csv')}
        >Export CSV</Button>
        <Button theme={theme} tone="danger" onClick={() => setArmed((v) => !v)}>Clear data</Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={(e) => { doRestore(e.target.files?.[0]); e.target.value = ''; }}
          style={{ display: 'none' }}
        />
      </div>

      {armed && (
        <div style={{
          marginTop: 10, padding: 12, borderRadius: 12, border: `1px solid ${theme.bad}`,
        }}>
          <div style={{ fontSize: 12.5, color: theme.bad, fontWeight: 600, marginBottom: 8 }}>
            This deletes entries on every synced device. It can be undone from the toast.
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <Chip theme={theme} active={scope === 'all'} onClick={() => setScope('all')}>Everything</Chip>
            <Chip theme={theme} active={scope === 'old'} onClick={() => setScope('old')}>Older than 30 days</Chip>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button theme={theme} onClick={() => setArmed(false)}>Cancel</Button>
            <Button theme={theme} tone="danger" onClick={clear}>Yes, delete</Button>
          </div>
        </div>
      )}

      <Muted theme={theme} size={11} style={{ marginTop: 10 }}>
        Synced across your devices. A local copy is kept on each phone too.
      </Muted>
    </div>
  );
}

/** Per-day stat pills. */
export function dayStats(dayEvents, now = Date.now()) {
  const count = (type) => dayEvents.filter((e) => e.type === type).length;
  const minutes = (type) => Math.round(
    dayEvents.filter((e) => e.type === type).reduce((sum, e) => sum + durationOf(e, now), 0) / MINUTE,
  );
  const nurse = count('nurse');
  const bottle = count('bottle');
  return {
    nurse, bottle, feeds: nurse + bottle,
    napMin: minutes('nap'), nightMin: minutes('night'), tummyMin: minutes('tummy'),
    wet: count('wet'), poop: count('poop'),
  };
}

export { ALL_TYPES };
