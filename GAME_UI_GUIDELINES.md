# Nesture — Game UI Guidelines

Written in response to client feedback round 1, whose headline finding was:

> "Currently it looks like screens from 2 different products."

This document is the contract that stops that happening again. **Every mini-game
follows it.** If a rule here is inconvenient for one game, change the rule for
all games — do not make an exception for one.

---

## 1. The canonical journey

Every game, without exception, moves the learner through the same five screens:

```
Game card  →  [Instructions]  →  Level select  →  Play (HUD)  →  Result
```

* **Instructions** open automatically the first time a learner opens that game,
  and are available forever after behind a **How to play** button.
* **Level select** is always `GameLevelSelect` — one screen, never a multi-step
  wizard. (Pinch the Coin used to be a two-step Step 1 / Step 2 wizard. It isn't
  any more.)
* **Play** always shows `GameHUD` with the same controls in the same order.

## 2. Shared components — use them, don't re-implement them

| File | What it owns |
|---|---|
| `src/components/game/gameShell.js` | Difficulty constants, input-mode wording, game registry, instructions copy, theme + tutorial persistence |
| `src/components/game/GameLevelSelect.jsx` | The level-select screen |
| `src/components/game/InstructionsModal.jsx` | The instructions modal, the `useInstructions` hook, the `HelpButton` |
| `src/components/game/GameHUD.jsx` | The in-game bar |
| `src/styles/GameShell.css` | All tokens and all shared layout |

A game's own `*Difficulty.jsx` should be **a config object and nothing else** —
look at `BubbleDifficulty.jsx` (40 lines) for the shape.

## 2b. One design: Trace → Find → Type

Trace → Find → Type is the reference. Its palette, top bar, panels and rules
card are what `GameShell.css` contains, and every other screen uses them:

* **Palette** — dark base `#090B14 → #111424` with indigo / purple / cyan
  pools, glass surfaces, teal + indigo accents. Dark is the default; light is
  the opt-in. There are **no per-game backgrounds** — a game is identified by
  its emoji and title, not by repainting the furniture. Giving each game its own
  gradient is what made them look like different products in the first place.
* **Top bar** — emoji + title on the left, 38px glass icon buttons on the right
  (`.gs-topbar` / `.gs-action`, ported from `.tt-header` / `.tt-icon-btn`).
  The level screen and the game it leads into use the same bar.
* **Level cards** — solid panels with a hairline border and a 3px difficulty bar
  on top (`.tt-step-container`), plus the 28px numbered square
  (`.tt-step-number`).
* **Rules** — one component, `GameRules.jsx`. Games supply CONTENT only. That
  includes Trace → Find → Type itself: keeping a private copy in the reference
  game is exactly how the six games drifted apart.
* **Theme** — one value in `gameShell.js`, with `subscribeGameTheme` so every
  toggle stays in sync, and `applyStoredGameTheme()` called once in `index.js`
  so `<html>` carries the attribute before the first paint (portalled dialogs
  live outside every page's DOM and cannot inherit it otherwise).

Section 11 of `GameShell.css` applies the same frame to the games themselves.
It overrides each game's page background, header and icon buttons — and
deliberately leaves the **play field** alone. The sea, the meadow and the piggy
bank are the game, not the furniture. Those overrides are single-class
selectors, so every game must import `GameShell.css` **after** its own
stylesheet.

## 3. Difficulty is Easy / Medium / Hard. Always.

Never show "Level 1 / 2 / 3" to a learner. Some engines still switch on numeric
levels internally; use `levelNumber(key)` at the navigation boundary and keep
the numbers out of the UI.

The three difficulty colours are fixed tokens, identical in every game:

| | Token | Colour |
|---|---|---|
| Easy | `--gs-easy` | green |
| Medium | `--gs-medium` | amber |
| Hard | `--gs-hard` | red |

Per-game personality comes from `--gs-accent` (the title pill, the mode toggle,
the background), never from re-colouring the difficulty levels.

## 4. Laptop-first layout — no scrolling to press Start

The client tested on a laptop and had to scroll past empty space to reach the
level buttons. The rules that prevent it:

* `.gs-page` is a flex column pinned to `100dvh` with `overflow: hidden`.
* Vertical rhythm uses `vh`-based `clamp()` so headings shrink on short screens
  instead of pushing content off the bottom.
* The level grid is `grid-template-columns: repeat(3, minmax(0, 1fr))` —
  **equal tracks**, so all three cards are the same width.
* Cards are `align-items: stretch` — same height.
* The Start button uses `margin-top: auto` — **all three buttons land on the
  same horizontal line** regardless of how much text each card holds.

**Test matrix before shipping any level-select change:**
1280×720 · 1366×768 · 1440×900 · 1920×1080 · one tablet width.
Nothing may require a vertical scroll at 1366×768.

## 5. Feature parity

If a feature exists in one game it exists in all of them. As of this pass:

* **How to play** — every level-select screen **and every in-game header**.
  The pattern is the same in all six games: a `HelpCircle` icon button in the
  header's right-hand group, a `showHelp` state, and the game's own existing
  `RulesModal` re-rendered with `resume` (which relabels its primary button
  "Back to the game"). Opening it pauses the round; closing it resumes.
  Games without an `isPaused` flag must still freeze anything that costs the
  learner time — see `helpOpenedAtRef` in `FingerCopyGame.jsx`, which pushes
  `challengeStartTime` forward by exactly how long the modal was open.
* **Light / dark theme** — was only in Trace → Find → Type; now in the shared
  shell and HUD, persisted in `localStorage` under `nesture.gameTheme`.
* **Camera / Touch-Mouse switch** — on the level-select screen and mid-game.
* **Pause** — in the HUD.
* **End game** — in every in-game header, via `EndGameControl`. It runs that
  game's own finish routine (`finishRef.current()`, or `setGamePhase('results')`
  where the score is computed by a phase-keyed effect), so a session stopped
  early is scored and saved exactly like a completed one, from whatever has
  been done. LetterQuest's "End session" button was the model; unlike it, ours
  confirms first, because it sits in the header where a stray tap is likely.

Adding a feature to one game and not the others is a bug, not a nice-to-have.

## 6. Wording

* Input modes are **"Camera (hand)"** and **"Touch / Mouse"**. Never "touch
  action" — the client reasonably read that as "pinch the screen".
  Touch / Mouse mode is always press-and-drag with one finger or a mouse
  button. It never requires a two-finger screen pinch.
* Instruction steps live in `GAMES[id].steps` in `gameShell.js`, so tone stays
  consistent. Four steps, second person, present tense.

## 7. Hand tracking

* `useHandTracking` no longer returns `multiHandLandmarks[0]`. It runs
  `activeHandSelector`, which scores every visible hand on motion, pointing
  posture, apparent size and centredness, and hands the pointer to the hand the
  child is actually playing with. A hand resting on a cheek cannot steal it.
* Pointer games (Bubble, Ladybug) pass `{ requireMotion: true }`: if nothing is
  moving, `handStatus` is `'idle'` and `handHint` gives a line to show the
  child. Pose games (Finger Copy, Finger Piano) must **not** pass it.
* Always request `maxHands: 2`. With `maxHands: 1` MediaPipe picks one hand
  arbitrarily and the selector has nothing to choose between.
* **The hand pointer belongs to the whole viewport, never to one box.** Map the
  fingertip to `window.innerWidth / innerHeight` and draw it on a
  `position: fixed` full-screen SVG overlay. If a step needs coordinates inside
  a smaller element (a letter box, a board), convert the viewport point *back*
  into that element's user space with `svg.getScreenCTM().inverse()` — which
  respects the viewBox's `preserveAspectRatio` letterboxing — rather than
  mapping the hand's whole range onto the element. Trace → Find → Type used to
  do the latter (`p.x * 300`), so the pointer could not leave the letter box.
* **Only one pointer may push `handPointerFilter` per frame.** The filter is
  stateful; two effects pushing the same landmarks on one frame doubles its
  gain. One camera pointer per screen.
* **Release the webcam when a round ends.** MediaPipe's `Camera.stop()` only
  stops its own animation loop — it does **not** stop the `MediaStream`, so the
  camera and its privacy light stay on. `useHandTracking` now exposes
  `releaseCamera()`, which stops every track and clears `video.srcObject`; it
  runs on cleanup, on `pagehide`, and on unmount. Every game also calls it
  explicitly when `gamePhase === 'results'`. Any new game must do the same, and
  must never leave a `trackingEnabled` flag latched `true` (Magic Finger Copy
  did, which kept its camera on through the whole results screen).
* Hit tests on moving targets need a forgiving pad plus hysteresis
  (see `HIT_PAD_PX` / `KEEP_PAD_PX` / `DWELL_GRACE_MS` in `BubbleGame.jsx`).
  An exact `distance <= radius` test flickers on a tracked pointer and silently
  cancels dwell progress.

## 8. Level tuning must be visible

If a card promises "bigger to smaller coins", the sizes must differ enough to
see. Rule of thumb: **at least a 2× span between Easy and Hard** for any size
or tolerance the learner is meant to notice, and the level-select preview must
read the same constants the game does (see `pinchCoinLevels.js`).

Likewise, level gesture/content sets must be **disjoint** where the levels are
meant to feel different — `useGestureDetection.js` now logs an error in
development if Easy and Medium ever share a gesture again.

## 9. Known remaining work

* **LetterQuest** keeps a distinct gameplay shape by design, but still needs to
  adopt `GameLevelSelect`, `GameHUD` and the shared tokens.
* **Finger Piano** and **Magic Finger Copy** in-game headers still use their own
  markup; migrate them to `GameHUD`.
* A **Reset tutorials** control should be added to the learner settings screen,
  wired to `resetAllInstructions()` from `gameShell.js`.
