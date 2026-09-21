/**
 * Client feedback: "dans tous les jeux il faut que end game existe lorsque
 * l'user click sur pause" — the End game button lives in the header, which the
 * pause overlay covers, so a learner who paused had no way to finish and see
 * the report.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import BubbleGame from '../../pages/BubbleGame';
import LadybugGame from '../../pages/LadybugGame';
import PinchCoinGame from '../../pages/PinchCoinGame';
import useHandTracking from '../../hooks/useHandTracking';

jest.mock('../../hooks/useHandTracking');
jest.mock('../../utils/soundManager', () => ({
  soundManager: new Proxy({}, {
    get: (_, key) => {
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
  useSearchParams: () => [new URLSearchParams('level=1&mode=touch')],
}));
jest.mock('./TouchModePose', () => () => null);
jest.mock('./CameraLandmarks', () => () => null);
jest.mock('./GameResults', () => () => <div data-testid="report">Report</div>);
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
const byText = (text, root = container) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const pauseButton = () => container.querySelector('[title="Pause"]');
const reportShown = () => !!document.querySelector('[data-testid="report"]');

async function advance(ms) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  ['bubble_rules_seen', 'ladybug_rules_seen', 'pinchcoin_rules_seen']
    .forEach((k) => sessionStorage.setItem(k, '1'));
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

describe.each([
  ['Pop the Bubble', BubbleGame],
  ['Follow the Ladybug', LadybugGame],
  ['Pinch the Coin', PinchCoinGame],
])('%s', (_, Game) => {
  async function play() {
    await act(async () => { root.render(<Game />); });
    await advance(6000);          // the 3-2-1 finishes and the round starts
    await act(async () => { pauseButton().click(); });
    expect(container.textContent).toContain('Paused');
  }

  test('the pause card offers End game', async () => {
    await play();
    expect(byText('End game')).toBeTruthy();
  });

  test('"Keep playing" leaves the learner on the pause card, it does not resume behind their back', async () => {
    await play();
    await act(async () => { byText('End game').click(); });
    // The confirm sits above the pause card, which stays put behind it.
    expect(byText('Show my report', document.body)).toBeTruthy();
    await act(async () => { byText('Keep playing', document.body).click(); });
    expect(container.textContent).toContain('Paused');
    expect(reportShown()).toBe(false);
  });

  test('confirming from the pause card ends the round and shows the report', async () => {
    await play();
    await act(async () => { byText('End game').click(); });
    await act(async () => { byText('Show my report', document.body).click(); });
    await advance(100);
    expect(reportShown()).toBe(true);
  });
});
