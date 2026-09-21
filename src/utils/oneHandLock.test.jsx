/**
 * Client feedback: "les jeux (ou les difficultés) qui ont besoin d'une seule
 * main, il suffit donc de détecter une main soit la droite ou la gauche celui
 * qui entre la première pour éviter la vibration comme dans le jeu Pinch the
 * coin."
 *
 * Every one-hand camera game must therefore ask its tracking hook for the side
 * lock. The lock's own behaviour is covered in activeHandSelector.test.js.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import BubbleGame from '../pages/BubbleGame';
import LadybugGame from '../pages/LadybugGame';
import PinchCoinGame from '../pages/PinchCoinGame';
import FingerCopyGame from '../pages/FingerCopyGame';
import TraceTypeGame from '../pages/TraceTypeGame';
import useHandTracking from '../hooks/useHandTracking';
import createActiveHandSelector from './activeHandSelector';

jest.mock('../hooks/useHandTracking');
jest.mock('../hooks/useTextToSpeech', () => ({ useTextToSpeech: () => ({ speak: jest.fn() }) }));
jest.mock('../utils/soundManager', () => ({
  soundManager: new Proxy({}, {
    get: (_, key) => {
      if (key === 'subscribe') return () => () => {};
      if (key === 'isEnabled') return () => true;
      return jest.fn();
    },
  }),
}));
jest.mock('../store', () => {
  const auth = { user: { id: 'test-user' }, profile: null };
  const session = { startSession: jest.fn(), endSession: jest.fn() };
  return { useAuthStore: () => auth, useSessionStore: () => session };
});
jest.mock('../services/api', () => ({
  post: () => Promise.resolve({ data: { session_id: 'test-session' } }),
  put: () => Promise.resolve({ data: {} }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams('level=1&mode=camera')],
}));
jest.mock('../components/game/TouchModePose', () => () => null);
jest.mock('../components/game/CameraLandmarks', () => () => null);
jest.mock('framer-motion', () => {
  const React = require('react');
  const elements = new Map();
  return {
    AnimatePresence: ({ children }) => children,
    motion: new Proxy({}, { get: (_, tag) => {
      if (!elements.has(tag)) elements.set(tag, React.forwardRef((props, ref) => {
        const { initial, animate, exit, transition, whileHover, whileTap, layout, ...domProps } = props;
        return React.createElement(tag, { ...domProps, ref });
      }));
      return elements.get(tag);
    } }),
  };
});

let root, container;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  ['bubble_rules_seen', 'ladybug_rules_seen', 'pinchcoin_rules_seen',
   'fingercopy_rules_seen', 'tracetype_rules_seen'].forEach((k) => sessionStorage.setItem(k, '1'));
  useHandTracking.mockImplementation(() => ({
    landmarks: null, multiHandData: null, isTracking: false, isSimulationMode: false,
    trackingTimestamp: null, activeHandKey: null, handHint: null, error: null,
    releaseCamera: jest.fn(),
    landmarksRef: { current: null }, trackingTimestampRef: { current: null },
    activeHandKeyRef: { current: null }, handStatusRef: { current: 'no-hand' },
    frameSeqRef: { current: 0 },
  }));
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 480, height: 480 });
  SVGElement.prototype.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
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
  jest.useRealTimers();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test.each([
  ['Pop the Bubble', BubbleGame],
  ['Follow the Ladybug', LadybugGame],
  ['Pinch the Coin', PinchCoinGame],
  ['Magic Finger Copy', FingerCopyGame],
  ['Trace → Find → Type', TraceTypeGame],
])('%s locks onto one hand in camera mode', async (_, Game) => {
  await act(async () => { root.render(<Game />); });
  const options = useHandTracking.mock.calls.at(-1)[5] || {};
  expect(options.handSideLock).toBe(true);
});

/* The rule itself, on the hand data: the hand that arrives first keeps the
   round even when the other one shakes far harder. */
test('the side lock ignores a violently shaking second hand', () => {
  const selector = createActiveHandSelector({ handSideLock: true });
  const hand = (x) => {
    const lm = Array.from({ length: 21 }, () => ({ x, y: 0.55, z: 0 }));
    lm[0] = { x, y: 0.65, z: 0 };
    lm[5] = { x: x - 0.02, y: 0.56, z: 0 };
    lm[8] = { x, y: 0.40, z: 0 };
    lm[9] = { x, y: 0.55, z: 0 };
    lm[17] = { x: x + 0.09, y: 0.60, z: 0 };
    return lm;
  };
  const first = selector.select([hand(0.35)], [{ label: 'Right' }], 0);
  expect(first.key).toBe('side:Right');

  for (let i = 0; i < 60; i += 1) {
    const shaking = hand(0.8 + (i % 2 ? 0.1 : -0.1));
    const result = selector.select([hand(0.35), shaking], [{ label: 'Right' }, { label: 'Left' }], 33 + i * 33);
    expect(result.key).toBe('side:Right');
    expect(result.landmarks[0].x).toBeCloseTo(0.35, 2);
  }
});
