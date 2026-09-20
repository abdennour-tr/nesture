/**
 * Client feedback: "i did switch off the sound in trace->find->type and since
 * then i can not hear sound in any other game — even when i go in the games it
 * says sound icon is turned on".
 *
 * Uses the REAL soundManager singleton — sharing it is the whole point.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import TraceTypeGame from '../pages/TraceTypeGame';
import BubbleGame from '../pages/BubbleGame';
import PinchCoinGame from '../pages/PinchCoinGame';
import LadybugGame from '../pages/LadybugGame';
import useHandTracking from './useHandTracking';
import useSoundEnabled from './useSoundEnabled';
import { soundManager } from '../utils/soundManager';

let mockQuery = 'level=1&mode=touch';
jest.mock('./useHandTracking');
jest.mock('./useTextToSpeech', () => ({ useTextToSpeech: () => ({ speak: jest.fn() }) }));
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
  useSearchParams: () => [new URLSearchParams(mockQuery)],
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
const soundIconOn = () => !!container.querySelector('button svg.lucide-volume2');
const soundIconOff = () => !!container.querySelector('button svg.lucide-volume-x');
const soundButton = () => container.querySelector('svg.lucide-volume2, svg.lucide-volume-x').closest('button');

async function show(Comp) {
  await act(async () => { root.render(<Comp />); });
}
async function click(el) {
  await act(async () => { el.click(); });
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});   // jsdom has no AudioContext
  soundManager.setEnabled(true);
  ['tracetype_rules_seen', 'bubble_rules_seen', 'pinchcoin_rules_seen', 'ladybug_rules_seen']
    .forEach((k) => sessionStorage.setItem(k, '1'));
  useHandTracking.mockImplementation(() => ({
    landmarks: null, multiHandData: null, isTracking: false, isSimulationMode: false,
    trackingTimestamp: null, activeHandKey: null, handHint: null, error: null,
    releaseCamera: jest.fn(),
    landmarksRef: { current: null }, trackingTimestampRef: { current: null },
    activeHandKeyRef: { current: null }, handStatusRef: { current: 'no-hand' },
    frameSeqRef: { current: 0 },
  }));
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 480, height: 480 });
  SVGElement.prototype.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
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
  delete SVGElement.prototype.getScreenCTM;
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test.each([
  ['Pop the Bubble', BubbleGame],
  ['Pinch the Coin', PinchCoinGame],
  ['Follow the Ladybug', LadybugGame],
])('muting in Trace → Find → Type carries over honestly to %s, and can be undone there', async (_, Game) => {
  await show(TraceTypeGame);
  expect(soundIconOn()).toBe(true);
  await click(soundButton());                 // mute in Trace → Find → Type
  expect(soundManager.isEnabled()).toBe(false);
  expect(soundIconOff()).toBe(true);

  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await show(Game);                           // go to another game
  // The bug: the icon said "on" while the sound was off.
  expect(soundIconOff()).toBe(true);
  expect(soundIconOn()).toBe(false);

  await click(soundButton());                 // turn it back on from here
  expect(soundManager.isEnabled()).toBe(true);
  expect(soundIconOn()).toBe(true);
});

test('the toggle survives StrictMode (an updater run twice must not flip it twice)', async () => {
  function Button() {
    const [on, setOn] = useSoundEnabled();
    return <button onClick={() => setOn((s) => !s)}>{on ? 'on' : 'off'}</button>;
  }
  await act(async () => { root.render(<React.StrictMode><Button /></React.StrictMode>); });
  await click(container.querySelector('button'));
  expect(soundManager.isEnabled()).toBe(false);
  expect(container.textContent).toBe('off');
  await click(container.querySelector('button'));
  expect(soundManager.isEnabled()).toBe(true);
  expect(container.textContent).toBe('on');
});

test('setEnabled notifies subscribers once per real change', () => {
  const fn = jest.fn();
  const off = soundManager.subscribe(fn);
  soundManager.setEnabled(false);
  soundManager.setEnabled(false);   // no change → no notification
  soundManager.setEnabled(true);
  off();
  soundManager.setEnabled(false);   // unsubscribed
  expect(fn.mock.calls).toEqual([[false], [true]]);
  soundManager.setEnabled(true);
});
