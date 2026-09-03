import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store.js';
import { resolveTheme, nextThemeBoundary, autoThemeName } from './theme.js';
import { MAX_WIDTH } from './ui.jsx';
import Header from './components/Header.jsx';
import TaskCard from './components/TaskCard.jsx';
import Tiles from './components/Tiles.jsx';
import WeightCard from './components/WeightCard.jsx';
import Overview from './components/Overview.jsx';
import PatternsCard from './components/PatternsCard.jsx';
import DayLog from './components/DayLog.jsx';
import Toast from './components/Toast.jsx';
import { ErrorBanner, installErrorReporter } from './components/ErrorReport.jsx';
import { PUSH_AVAILABLE, currentSubscription, subscribe, unsubscribe } from './lib/push.js';

/** Types a home-screen shortcut may log via ?log= (spec §10). */
const SHORTCUT_TYPES = ['wet', 'poop', 'nurse', 'massage', 'exercise'];

export default function App() {
  const store = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [problems, setProblems] = useState([]);
  const shortcutHandled = useRef(false);

  // Anything that throws goes on the screen. An error inside an event handler
  // is invisible otherwise — the app keeps rendering and simply stops
  // responding, which is indistinguishable from a frozen screenshot.
  useEffect(() => installErrorReporter((message) => {
    setProblems((current) => {
      const seen = current.find((p) => p.message === message);
      if (seen) return current.map((p) => (p === seen ? { ...p, count: p.count + 1 } : p));
      return [...current, { message, count: 1 }].slice(-3);
    });
  }), []);

  // One ticking clock for the whole app: "2h 5m ago" has to keep moving.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const theme = useMemo(
    () => resolveTheme(store.prefs.themeOverride, now),
    [store.prefs.themeOverride, now],
  );

  // Paint the page and the status bar to match the theme.
  useEffect(() => {
    document.body.style.background = theme.bg;
    document.body.style.color = theme.ink;
    document.documentElement.style.colorScheme = theme.name === 'night' ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
  }, [theme]);

  // A home-screen shortcut deep-links here and logs instantly, once.
  useEffect(() => {
    if (shortcutHandled.current) return;
    shortcutHandled.current = true;
    const type = new URLSearchParams(window.location.search).get('log');
    if (type && SHORTCUT_TYPES.includes(type)) {
      store.logPoint(type);
      store.showToast(`Logged ${type}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [store]);

  // Push is optional: without a VAPID key configured the bell never appears.
  useEffect(() => {
    if (!PUSH_AVAILABLE) return;
    currentSubscription().then((sub) => setPushEnabled(Boolean(sub))).catch(() => {});
  }, []);

  const togglePush = async () => {
    const result = pushEnabled
      ? await unsubscribe(store.client)
      : await subscribe(store.client);
    if (result.ok) {
      setPushEnabled(!pushEnabled);
      store.showToast(pushEnabled ? 'Daily reminder turned off' : 'Daily reminder turned on ✓');
    } else {
      store.showToast(result.error || "Couldn't change the reminder");
    }
  };

  const toggleTheme = () => {
    const auto = autoThemeName(now);
    const current = theme.name;
    const next = current === 'night' ? 'day' : 'night';
    // An override that matches automation is simply no override at all.
    store.setPrefs({
      themeOverride: next === auto ? null : { name: next, until: nextThemeBoundary(now) },
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: theme.bg,
      color: theme.ink,
      transition: 'background 400ms ease',
    }}>
      <main style={{
        maxWidth: MAX_WIDTH,
        margin: '0 auto',
        padding: `calc(12px + env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-left, 0px)) calc(84px + env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-right, 0px))`,
      }}>
        <Header
          theme={theme}
          status={store.status}
          onRefresh={store.refresh}
          onToggleTheme={toggleTheme}
          push={{ available: PUSH_AVAILABLE, enabled: pushEnabled, onToggle: togglePush }}
        />
        <TaskCard theme={theme} events={store.events} store={store} now={now} />
        <Tiles theme={theme} events={store.events} store={store} now={now} />
        <WeightCard theme={theme} events={store.events} store={store} now={now} />
        <Overview theme={theme} events={store.events} store={store} now={now} />
        <PatternsCard theme={theme} events={store.events} now={now} />
        <DayLog theme={theme} events={store.events} store={store} now={now} />
      </main>

      <ErrorBanner problems={problems} onDismiss={() => setProblems([])} />
      <Toast theme={theme} toast={store.toast} onDismiss={store.dismissToast} />
    </div>
  );
}
