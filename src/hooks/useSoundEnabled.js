/**
 * useSoundEnabled.js
 * The app-wide sound on/off switch, as a React state pair.
 *
 * Every game used to keep its own `useState(true)` for the sound icon while
 * the actual on/off flag lived in the shared `soundManager` singleton. Muting
 * one game therefore silenced every other game while their icons still said
 * "on". This hook reads the singleton directly and re-renders when it changes,
 * so the icon and the sound can no longer disagree.
 *
 *   const [soundEnabled, setSoundEnabled] = useSoundEnabled();
 *   setSoundEnabled(false);          // or setSoundEnabled((on) => !on)
 */
import { useCallback, useSyncExternalStore } from 'react';
import { soundManager } from '../utils/soundManager';

export default function useSoundEnabled() {
  const enabled = useSyncExternalStore(
    soundManager.subscribe,
    soundManager.isEnabled,
    () => true, // server render: sound on
  );

  /* Accepts a value or an updater, like a useState setter. The updater runs
     here, outside React, so StrictMode's double-invocation cannot flip the
     switch twice. */
  const setEnabled = useCallback((value) => {
    const next = typeof value === 'function' ? value(soundManager.isEnabled()) : value;
    soundManager.setEnabled(next);
  }, []);

  return [enabled, setEnabled];
}
