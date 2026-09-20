import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import TraceTypeGame from './TraceTypeGame';
import useHandTracking from '../hooks/useHandTracking';

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
  useSearchParams: () => [new URLSearchParams('level=1')],
}));
jest.mock('../components/game/gameShell', () => ({
  getGameTheme: () => 'dark', subscribeGameTheme: () => () => {}, toggleGameTheme: jest.fn(),
}));
jest.mock('./traceTypeWords', () => ({
  buildRound: () => ({ word: 'AB' }), traceTuning: () => ({ spacing: 40, tolerance: 30 }),
}));
jest.mock('./letterStrokes', () => ({
  buildLetter: () => ({ path: 'M20 20 L40 20', waypoints: [{ x: 20, y: 20 }], jumps: [] }),
}));
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

let root, container, tracking, frames, nextFrame;
const releaseCamera = jest.fn();
const hand = (x = 0.5, y = 0.5) => Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
const opacity = () => Number(container.querySelector('.tt-global-pointer > g').style.opacity);

async function render() {
  await act(async () => { root.render(<TraceTypeGame />); });
}

async function advance(ms) {
  for (let remaining = ms; remaining > 0; remaining -= 16) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(16, remaining));
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    });
  }
}

const frameSeqRef = { current: 0 };
const landmarksRef = { current: null };
const trackingTimestampRef = { current: null };
const activeHandKeyRef = { current: null };

async function sample(key = 'hand-1', present = true, position = []) {
  const ts = performance.now();
  const lm = present ? hand(...position) : null;
  frameSeqRef.current += 1;
  landmarksRef.current = lm;
  trackingTimestampRef.current = ts;
  activeHandKeyRef.current = key;
  tracking = {
    ...tracking,
    landmarks: lm,
    isTracking: present,
    activeHandKey: key,
    trackingTimestamp: ts,
    frameSeqRef,
    landmarksRef,
    trackingTimestampRef,
    activeHandKeyRef,
  };
  await render();
}

async function enterFind() {
  // Map the camera's index onto the only trace waypoint (20,20 in SVG space).
  const coordinate = 0.5 + (20 / 300 - 0.5) / 1.65;
  await sample('hand-1', true, [1 - coordinate, coordinate]);
  await advance(1000);
  expect(container.querySelector('.step-find')).not.toBeNull();
  document.elementFromPoint = () => container.querySelector('button[data-key="A"]');
}

beforeEach(async () => {
  jest.useFakeTimers('modern');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  frames = new Map();
  nextFrame = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => frames.delete(id));
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 480, height: 480 });
  SVGElement.prototype.getScreenCTM = () => ({ a: 1.6, b: 0, c: 0, d: 1.6, e: 0, f: 0,
    inverse: () => ({ a: 0.625, b: 0, c: 0, d: 0.625, e: 0, f: 0 }) });
  sessionStorage.setItem('tracetype_rules_seen', '1');
  frameSeqRef.current = 0;
  landmarksRef.current = null;
  trackingTimestampRef.current = null;
  activeHandKeyRef.current = null;
  tracking = {
    landmarks: null,
    trackingTimestamp: null,
    activeHandKey: null,
    isTracking: false,
    releaseCamera,
    frameSeqRef,
    landmarksRef,
    trackingTimestampRef,
    activeHandKeyRef,
  };
  useHandTracking.mockImplementation(() => tracking);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
  const camera = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Hand in the Air'));
  await act(async () => { camera.click(); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  delete SVGElement.prototype.getScreenCTM;
  delete document.elementFromPoint;
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('shows a fresh hand even when slow tracking changes its identity on every result', async () => {
  for (let i = 0; i < 8; i++) {
    await advance(500);
    await sample(`hand-${i}`);
    await advance(120);
    expect(opacity()).toBeGreaterThan(0.85);
  }
});

test('keeps the pointer visible between slow camera results, then hides a truly lost hand', async () => {
  await sample();
  await advance(32);
  await sample();
  for (let i = 0; i < 12; i++) {
    await advance(300);
    expect(opacity()).toBeGreaterThan(0.95);
    await sample();
  }
  await advance(16);
  await sample('hand-1', false);
  await advance(200);
  expect(opacity()).toBeGreaterThan(0.95);
  await advance(1800);
  expect(opacity()).toBeLessThan(0.04);
  await sample('hand-returned');
  await advance(120);
  expect(opacity()).toBeGreaterThan(0.85);
});

test('a visible held pointer cannot finish a keyboard dwell during tracking loss', async () => {
  await enterFind();
  for (let i = 0; i < 12; i++) {
    await sample();
    await advance(100);
  }
  const key = () => container.querySelector('button[data-key="A"]');
  expect(key().classList.contains('correct')).toBe(false);
  await sample('hand-1', false);
  await advance(600);
  expect(opacity()).toBeGreaterThan(0.95);
  expect(key().classList.contains('correct')).toBe(false);
  for (let i = 0; i < 14; i++) {
    await sample();
    await advance(100);
  }
  expect(key().classList.contains('correct')).toBe(false);
  for (let i = 0; i < 3; i++) {
    await sample();
    await advance(100);
  }
  expect(key().classList.contains('correct')).toBe(true);
});

test('stalled inference clears the dwell even while the last pointer remains visible', async () => {
  await enterFind();
  for (let i = 0; i < 12; i++) {
    await sample();
    await advance(100);
  }
  await advance(400); // no callbacks, including no explicit no-hand result
  expect(opacity()).toBeGreaterThan(0.95);
  expect(container.querySelector('button[data-key="A"]').classList.contains('correct')).toBe(false);
  await advance(1500);
  expect(opacity()).toBeLessThan(0.04);
});

test('slow but valid camera frames can still complete a keyboard dwell', async () => {
  await enterFind();
  for (let i = 0; i < 4; i++) {
    await sample();
    await advance(500);
  }
  expect(opacity()).toBeGreaterThan(0.95);
  expect(container.querySelector('button[data-key="A"]').classList.contains('correct')).toBe(true);
});


