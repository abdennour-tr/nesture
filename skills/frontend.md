# Skill: Frontend — React SPA

> How the NestureAI React app is built: routing, state, the game/tracking layer,
> and the two analysis engines. Read `project.md` first for domain context.

---

## 1. Overview

Single-page React 18 app scaffolded with **Create React App (`react-scripts`
5.0.1)** — **not** Vite (the README's "Vite" line is inaccurate; the build is
CRA). Entry: `src/index.js` → `src/App.js`. Styling is plain CSS files under
`src/styles/` plus generous inline styles; there is **no CSS framework or CSS-in-JS
library** — matching this convention matters for consistency.

---

## 2. Architecture

```
src/
├── App.js                 Router, route guards, impersonation banner
├── index.js               React root, i18n bootstrap
├── i18n.js                i18next config
├── store/index.js         Zustand: useAuthStore + useSessionStore
├── services/              Data, auth, AI (see backend.md for edge side)
│   ├── api.js             axios-SHAPED shim → supabaseDB.js
│   ├── supabaseDB.js      All Postgres reads/writes (source of truth)
│   ├── supabaseClient.js  createClient + profile helpers
│   ├── localDB.js         IndexedDB fallback (legacy)
│   ├── authService.js     signIn/signUp/validation/role routing
│   ├── aiEngine.js        Post-session reflex + LPI scoring (rule-based)
│   ├── reflexEngine/      Real-time reflex detection (see §6)
│   └── reportBuilder.js   PDF/XLSX session reports (jspdf/exceljs)
├── hooks/                 useHandTracking, useMediaPipeTracking, useFaceMesh,
│                          useGestureDetection, useReflexEngine, useSessionData,
│                          useSessionManager, useTextToSpeech, useFeatureFlag
├── pages/                 Route components (dashboards + games)
├── components/
│   ├── dashboards/        Parent/OT cards, SubscriptionTab
│   ├── game/              GameHUD, HandPointer, GameShell, PianoHand, ...
│   └── shared/            Atlas modals, Sidebar, ErrorBoundary, chat, ...
├── styles/                Per-feature CSS
├── locales/en/            i18n translations
└── utils/                 security.js, otScore.js, soundManager.js,
                           hand/pointer filters + their *.test.js
```

---

## 3. Routing (`src/App.js`)

- `react-router-dom` v6 with `future={{ v7_startTransition, v7_relativeSplatPath }}`.
- **`ProtectedRoute allowedRoles={[...]}`** blocks unauthenticated users and
  redirects wrong-role users to their own home via `getRouteForRole`.
- **`PublicRoute`** bounces already-authenticated users away from login/signup.
- While the session restores, both render `<FullPageSpinner/>` gated on
  `isInitializing`.
- **`/admin` is intentionally NOT wrapped in `ProtectedRoute`** — admin gating is
  handled inside `AdminDashboard`. Be careful changing this.
- Game routes are all `allowedRoles={['learner']}` under `/play/*`.

> **Sealing an unfinished game requires BOTH** the route redirect in `App.js`
> **and** `comingSoon: true` on the card in `LearnerHome.jsx`. One without the
> other leaves a hole (see the Finger Piano comment in `App.js`).

---

## 4. State management (Zustand)

`src/store/index.js` exposes two stores:

- **`useAuthStore`** — `user` (Supabase auth), `profile` (public.users row),
  `originalProfile` (held during admin impersonation), `isInitializing`,
  `isLoading`, `error`. Actions: `init`, `login`, `signup`, `logout`,
  `updateProfile`, `impersonate`, `stopImpersonating`. Persisted with
  `persist` middleware into **`sessionStorage`** (key `nesture-auth`), only
  `profile` + `originalProfile` are `partialize`d.
- **`useSessionStore`** — active game session: `activeSession`, `gestures[]`,
  `isRecording`. `endSession(reflexEngineOutput)` forwards to
  `supabaseDB.endSession()` which merges realtime + `aiEngine` output.

Guideline: read auth state via `useAuthStore` selectors; never read
`sessionStorage` directly.

---

## 5. Data access convention

Pages call the **axios-shaped shim** `api.js` (`api.get('/sessions/learner/:id')`,
`api.post('/sessions/start', body)`), which routes to `supabaseDB.js`. When adding
an endpoint, add a route handler in `api.js` **and** the implementation in
`supabaseDB.js`; do not import `supabaseDB` into page components directly.

---

## 6. Hand tracking & the game layer

- **MediaPipe** runs entirely **on-device** in the browser — raw webcam frames
  never leave the client. Hooks: `useHandTracking` /`useMediaPipeTracking`
  (hands), `useFaceMesh` (face, for oculomotor reflexes), `useGestureDetection`.
- `useHandTracking(videoRef, canvasRef, enabled, pauseProcessing, maxHands)` →
  `{ landmarks, isTracking, isSimulationMode }`. A **simulation mode** exists for
  environments without a camera.
- Selection mechanics vary per game: **dwell time** (point ~2.5 s), **pinch**
  (thumb-index distance thresholds), **trace** (path following).
- Anti-jitter is standard: EMA smoothing (α≈0.45), hysteresis, release-frame
  debouncing. Thresholds are tuned **per difficulty** (e.g. Pinch Coin pinch:
  Easy 0.095 / Medium 0.072 / Hard 0.055).
- `utils/soundManager.js` is a singleton (`init`, `playCountdown`, `playComplete`,
  `playCelebration`, `playClick`) built on the Web Audio API.
- Shared game UI lives in `components/game/` (`GameShell`, `GameHUD`,
  `HandPointer`, `GameRules`, `InstructionsModal`). Follow `GAME_UI_GUIDELINES.md`
  for game visual conventions (no emoji as game assets — use CSS/SVG components
  like `GoldCoin`).

### Two engines, two moments
- **`reflexEngine/` (real-time):** ring buffer of MediaPipe frames
  (`MAX_BUFFER_FRAMES=300`, ~10 s @ 30fps), analysed in `WINDOW_FRAMES=150`
  (~5 s) windows so long sessions aren't scored only on the last 10 seconds.
  10 detector modules under `reflexDetectors/`; output via `outputFormatter.js`
  with `MIN_REPORTABLE_CONFIDENCE`.
- **`aiEngine.js` (post-session):** rule-based `REFLEX_RULES` mapping gesture
  indicators → reflex impact + recommended exercise IDs, plus the LPI score.

---

## 7. Coding standards

- **Components:** function components + hooks only. Pages are `.jsx`, services and
  utils are `.js`.
- **Naming:** PascalCase components, camelCase hooks prefixed `use`, one CSS file
  per feature under `styles/` matching the component name.
- **Motion:** Framer Motion for transitions; respect
  `@media (prefers-reduced-motion)` (already honored in game CSS).
- **Charts:** Recharts only.
- **i18n:** user-facing strings go through `t('key', 'fallback')`; add keys to
  `locales/en/translation.json`.
- **Errors:** wrap risky trees in `components/shared/ErrorBoundary`; surface user
  errors with `react-hot-toast`, log internals with `console.warn/error` + a
  `[Scope]` tag prefix (existing convention).
- **No browser storage in throwaway previews**, but the app itself uses
  `sessionStorage`/`localStorage` deliberately (auth persistence, cleanup on
  logout).

---

## 8. Best practices & gotchas

- On **logout**, `authService.signOut()` calls `sessionStorage.clear()` **and**
  `localStorage.clear()` to prevent cross-child data leakage — preserve this.
- Learner usernames without `@` are mapped internally to
  `<name>@learner.nestureai.com`, and learner passwords get a `_learner_suffix`
  before hitting Supabase Auth. Don't "fix" these — they are the COPPA login
  scheme.
- Some page files are very large (`GamePage.jsx` ~141 KB, `AdminDashboard.jsx`
  ~106 KB, `ParentDashboard.jsx` ~112 KB). Prefer surgical edits; extract shared
  logic into `components/` or `hooks/` rather than growing them further.
- Unit tests exist for pure utils (`activeHandSelector`, `handPointerFilter`,
  `pianoTapDetector`, `pointerMotion`, `TraceTypeGame`). New pure logic (scoring,
  filters, detectors) should ship with a colocated `*.test.js`.

---

## 9. Development guidelines

- `npm start` — dev server. `npm run build` — production bundle to `build/`.
- `npm test` — Jest (CRA). `npm run test:e2e` — Playwright (see `deployment.md`).
- Add a new game by: page + difficulty page, route pair in `App.js`, a card in
  `LearnerHome.jsx`, CSS in `styles/`, and reuse `components/game/` primitives.
