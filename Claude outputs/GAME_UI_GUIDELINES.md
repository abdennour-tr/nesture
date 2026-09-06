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

* **How to play** — every level-select screen and every in-game HUD.
* **Light / dark theme** — was only in Trace → Find → Type; now in the shared
  shell and HUD, persisted in `localStorage` under `nesture.gameTheme`.
* **Camera / Touch-Mouse switch** — on the level-select screen and mid-game.
* **Pause** — in the HUD.

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
