/**
 * The camera-mode hand gate ("Show one of your hands to start playing").
 * Client feedback: it existed only in Trace → Find → Type; every other
 * one-hand camera game started its 3-2-1 with nobody in front of the camera.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import BubbleGame from '../../pages/BubbleGame';
import LadybugGame from '../../pages/LadybugGame';
import PinchCoinGame from '../../pages/PinchCoinGame';
import FingerCopyGame from '../../pages/FingerCopyGame';
import useHandTracking from '../../hooks/useHandTracking';

let mockQuery = '';
let mockTracking = {};

jest.mock('../../hooks/useHandTracking');
jest.mock('../../utils/soundManager', () => ({
  soundManager: new Proxy({}, {
    get: (_, key) => {
      // useSoundEnabled reads these two; everything else is a silent no-op.
      if (key === 'subscribe') return () => () => {};
      if (key === 'isEnabled') return () => true;
      return jest.fn();
    },
  }),
}));
jest.mock('../../store', () => {
  const auth = { user: { id: 'test-user' }, profile: null };
  const session = { startSession: jest.fn(), endSession: jest.fn() };
  return { useAuthStore: () => auth, useSessionStore: () => session };
});
jest.mock('../../services/api', () => ({
  post: () => Promise.resolve({ data: { session_id: 'test-session' } }),
  put: () => Promise.resolve({ data: {} }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(mockQuery)],
}));
jest.mock('./TouchModePose', () => () => null);
jest.mock('./CameraLandmarks', () => () => null);
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

const hand = () => Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
let root, container;

const GAMES = [
  { name: 'Pop the Bubble',     Comp: BubbleGame,     flag: 'bubble_rules_seen',     touch: true },
  { name: 'Follow the Ladybug', Comp: LadybugGame,    flag: 'ladybug_rules_seen',    touch: true },
  { name: 'Pinch the Coin',     Comp: PinchCoinGame,  flag: 'pinchcoin_rules_seen',  touch: true },
  { name: 'Magic Finger Copy',  Comp: FingerCopyGame, flag: 'fingercopy_rules_seen', touch: false },
];

const gateShown = () => container.textContent.includes('Show one of your hands');
/** Every game's countdown screen shows a "get ready" hint. */
const countdownShown = () => /Get (your|ready)/i.test(container.textContent);
const cameraRequested = () => {
  const calls = useHandTracking.mock.calls;
  return calls[calls.length - 1][2] === true;
};

async function render(Comp) {
  await act(async () => { root.render(<Comp />); });
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  mockTracking = {
    landmarks: null, multiHandData: null, isTracking: false, isSimulationMode: false,
    trackingTimestamp: null, activeHandKey: null, handHint: null, error: null,
    releaseCamera: jest.fn(),
    landmarksRef: { current: null }, trackingTimestampRef: { current: null },
    activeHandKeyRef: { current: null }, handStatusRef: { current: 'no-hand' },
    frameSeqRef: { current: 0 },
  };
  useHandTracking.mockImplementation(() => mockTracking);
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

describe.each(GAMES)('$name', ({ Comp, flag, touch }) => {
  beforeEach(() => sessionStorage.setItem(flag, '1'));

  test('camera mode waits for a hand before the countdown, with the camera on', async () => {
    mockQuery = 'level=1&mode=camera';
    await render(Comp);
    expect(gateShown()).toBe(true);
    expect(countdownShown()).toBe(false);
    expect(cameraRequested()).toBe(true);

    // A hand appears → the gate closes and the normal 3-2-1 begins.
    mockTracking = { ...mockTracking, landmarks: hand(), isTracking: true };
    await render(Comp);
    expect(gateShown()).toBe(false);
    expect(countdownShown()).toBe(true);
  });

  test('a camera that cannot start never strands the child on the gate', async () => {
    mockQuery = 'level=1&mode=camera';
    mockTracking = { ...mockTracking, isSimulationMode: true };
    await render(Comp);
    expect(gateShown()).toBe(false);
  });

  if (touch) {
    test('touch mode skips the gate', async () => {
      mockQuery = 'level=1&mode=touch';
      await render(Comp);
      expect(gateShown()).toBe(false);
      expect(countdownShown()).toBe(true);
    });

    test('"Play with touch instead" leaves the gate for the countdown', async () => {
      mockQuery = 'level=1&mode=camera';
      await render(Comp);
      const btn = container.querySelector('.hand-gate-touch');
      expect(btn).not.toBeNull();
      await act(async () => { btn.click(); });
      expect(gateShown()).toBe(false);
      expect(countdownShown()).toBe(true);
    });
  }
});
