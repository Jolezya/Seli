// Making failures loud, for the app itself.
//
// The sync dot already covers writes that Supabase rejects. This covers the
// other silent failure: JavaScript that throws. A React error boundary alone is
// not enough — it does NOT catch errors thrown inside event handlers, which is
// exactly the shape of "the app renders but tapping does nothing". So this
// listens on window as well, and puts whatever went wrong on the screen.

import React from 'react';

const shell = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  // Deliberately hard-coded rather than themed: if the crash is in the theme
  // or the store, themed values may be exactly what is unavailable.
  background: '#7A1D16',
  color: '#FFF1EE',
  font: '500 12.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: 'calc(10px + env(safe-area-inset-top, 0px)) 12px 10px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
  wordBreak: 'break-word',
};

/** One line per distinct problem, with a count if it keeps happening. */
export function ErrorBanner({ problems, onDismiss }) {
  if (!problems.length) return null;
  return (
    <div style={shell} role="alert">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', marginBottom: 3 }}>
            Something went wrong in the app
          </strong>
          {problems.map((p) => (
            <div key={p.message} style={{ opacity: 0.95, marginTop: 2 }}>
              {p.message}{p.count > 1 ? ` (${p.count}×)` : ''}
            </div>
          ))}
          <div style={{ opacity: 0.75, marginTop: 5, fontSize: 11.5 }}>
            Your logged entries are safe on this phone. Screenshot this and send it on.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            appearance: 'none', border: '1px solid rgba(255,255,255,0.4)',
            background: 'transparent', color: 'inherit', borderRadius: 8,
            padding: '3px 8px', fontSize: 12, cursor: 'pointer', flex: 'none',
          }}
        >Hide</button>
      </div>
    </div>
  );
}

/** Readable text from anything that can be thrown. */
export function describeThrown(value) {
  if (!value) return 'Unknown error';
  if (typeof value === 'string') return value;
  const name = value.name || 'Error';
  const message = value.message || String(value);
  // The first stack frame usually names the file, which is what makes a report
  // actionable when it comes back as a photograph of a phone screen.
  const frame = typeof value.stack === 'string'
    ? (value.stack.split('\n')[1] || '').trim().replace(/^at\s+/, '')
    : '';
  return frame ? `${name}: ${message} — ${frame}` : `${name}: ${message}`;
}

/**
 * Listen for anything that escapes: thrown errors (including from event
 * handlers) and rejected promises nobody caught.
 */
export function installErrorReporter(report) {
  const onError = (event) => {
    report(describeThrown(event.error || event.message));
  };
  const onRejection = (event) => {
    report(describeThrown(event.reason));
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Catches render-time crashes, which would otherwise leave a blank screen. */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(error) {
    return { message: describeThrown(error) };
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <div style={{ ...shell, position: 'static', minHeight: '100vh' }} role="alert">
        <strong style={{ display: 'block', marginBottom: 6 }}>Seli could not draw the screen</strong>
        <div>{this.state.message}</div>
        <div style={{ opacity: 0.8, marginTop: 10, fontSize: 12 }}>
          Every entry you have logged is still saved. Screenshot this, then reopen the app.
        </div>
      </div>
    );
  }
}
