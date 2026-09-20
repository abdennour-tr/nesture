/**
 * The level screen already asks "Hand in the air / Touch" and passes the
 * answer as ?mode=camera|touch. The game must not ask the same question again
 * (client feedback: "trace → find → type — I find this pop-up to be
 * redundant"). The popup only remains for a URL that carries no mode.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import TraceTypeGame from './TraceTypeGame';
import useHandTracking from '../hooks/useHandTracking';

let mockQuery = 'level=1';

jest.mock('../hooks/useHandTracking');
jest.mock('../hooks/useTextToSpeech', () => ({ useTextToSpeech: () => ({ speak: jest.fn() }) }));
jest.mock('../utils/soundManager', () => ({ soundManager: new Proxy({}, { get: () => jest.fn() }) }));
jest.mock('../store', () => {
  const auth = { user: { id: 'test-user' }, profile: null };
  const session = { startSession: jest.fn(), endSession: jest.fn() };
  return { useAuthStore: () => auth, useSessionStore: () => session };
});
jest.mock('../services/api', () => ({ post: () => Promise.resolve({ data: { session_id: 'test-session' } }) }));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(mockQuery)],
}));
jest.mock('../components/game/gameShell', () => ({
  getGameTheme: () => 'dark', subscribeGameTheme: () => () => {}, toggleGameTheme: jest.fn(),
}));
jest.mock('./traceTypeWords', () => ({
  buildRound: () => ({ word: 'AB' }), traceTuning: () => ({ spacing: 40, tolerance: 30 }),
  emojiForWord: () => '',
}));
jest.mock('./letterStrokes', () => ({
  buildLetter: () => ({ path: 'M20 20 L40 20', waypoints: [{ x: 20, y: 20 }], jumps: [] }),
}));
jest.mock('../components/game/TouchModePose', () => () => null);
jest.mock('framer-motion', () => {
  const React = require('react');
  const elements = new Map();
  return {
    AnimatePresence: ({ children }) => children,
    motion: new Proxy({}, { get: (_, tag) => {
      if (!elements.has(tag)) elements.set(tag, React.forwardRef((props, ref) => {
        const { initial, animate, exit, transition, whileHover, whileTap, ...domProps } = props;
        return React.createElement(tag, { ...domProps, ref });
      }));
      return elements.get(tag);
    } }),
  };
});

let root, container;
const popupShown = () => container.textContent.includes('How do you want to play?');
/** Whether the game asked for the camera on its latest render. */
const cameraRequested = () => {
  const calls = useHandTracking.mock.calls;
  return calls[calls.length - 1][2] === true;
};

async function renderWith(q) {
  mockQuery = q;
  await act(async () => { root.render(<TraceTypeGame />); });
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no SVG geometry; same stubs as TraceTypeGame.test.jsx.
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 480, height: 480 });
  SVGElement.prototype.getScreenCTM = () => ({ a: 1.6, b: 0, c: 0, d: 1.6, e: 0, f: 0,
    inverse: () => ({ a: 0.625, b: 0, c: 0, d: 0.625, e: 0, f: 0 }) });
  sessionStorage.setItem('tracetype_rules_seen', '1');
  useHandTracking.mockImplementation(() => ({
    landmarks: null, trackingTimestamp: null, activeHandKey: null, isTracking: false,
    releaseCamera: jest.fn(),
    landmarksRef: { current: null }, trackingTimestampRef: { current: null },
    activeHandKeyRef: { current: null }, handStatusRef: { current: 'no-hand' },
    frameSeqRef: { current: 0 },
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  delete SVGElement.prototype.getScreenCTM;
  jest.restoreAllMocks();
  jest.clearAllMocks();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('mode=camera from the level screen skips the popup and starts the camera', async () => {
  await renderWith('level=1&difficulty=easy&mode=camera');
  expect(popupShown()).toBe(false);
  expect(cameraRequested()).toBe(true);
  // The camera's own "show your hand" step is what comes next.
  expect(container.querySelector('.tt-hand-detect-overlay')).not.toBeNull();
});

test('mode=touch from the level screen skips the popup and never starts the hand camera', async () => {
  await renderWith('level=1&difficulty=easy&mode=touch');
  expect(popupShown()).toBe(false);
  expect(cameraRequested()).toBe(false);
  // Straight into play: neither the popup nor the camera "show your hand"
  // overlay (both use .tt-hand-detect-overlay) is on screen.
  expect(container.querySelector('.tt-hand-detect-overlay')).toBeNull();
});

test('a URL with no mode still gets the popup as a fallback', async () => {
  await renderWith('level=1');
  expect(popupShown()).toBe(true);
  expect(cameraRequested()).toBe(false);
});

test('an invalid mode is ignored and falls back to the popup', async () => {
  await renderWith('level=1&mode=banana');
  expect(popupShown()).toBe(true);
});
