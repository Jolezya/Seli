// The toast. Its most important job is carrying Undo: deleting is always
// explicit and always undoable (spec §17).

import React from 'react';
import { surfaceStyle, MAX_WIDTH } from '../ui.jsx';

export default function Toast({ theme, toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div style={{
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      width: `min(${MAX_WIDTH}px, calc(100vw - 24px))`,
      zIndex: 50,
    }}>
      <div style={{
        ...surfaceStyle(theme, { radius: 16 }),
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <span style={{ flex: 1, fontSize: 13, color: theme.ink }}>{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={toast.action.run}
            style={{
              appearance: 'none', border: 'none', background: 'transparent',
              color: theme.good, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 4,
            }}
          >{toast.action.label}</button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            appearance: 'none', border: 'none', background: 'transparent',
            color: theme.inkFaint, fontSize: 15, cursor: 'pointer', padding: 4,
          }}
        >×</button>
      </div>
    </div>
  );
}
