/**
 * GameLevelSelect.jsx
 * ---------------------------------------------------------------------------
 * THE level-select screen. Every game renders this exact component, so the
 * learner meets the same journey each time:
 *
 *     Back • Title • [How to play] [Theme]
 *     Game title + one-line goal
 *     Input mode: Camera (hand) / Touch / Mouse
 *     Easy | Medium | Hard   ← three identical cards, one row, aligned buttons
 *
 * Guarantees that came straight out of client feedback:
 *   • No empty band at the top and no scrolling to reach the level buttons on
 *     a 1366×768 laptop (the page is a flex column pinned to 100dvh).
 *   • All three cards are the same width AND height, and their Start buttons
 *     sit on the same horizontal line (CSS grid equal tracks + margin-top:auto).
 *   • Instructions are always one click away.
 *   • The theme toggle is available here, not only in Trace→Find→Type.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Hand, MousePointer2, Moon, Sun } from 'lucide-react';
import InstructionsModal, { useInstructions, HelpButton } from './InstructionsModal';
import {
  DIFFICULTIES,
  INPUT_MODES,
  getGameTheme,
  toggleGameTheme,
  subscribeGameTheme,
} from './gameShell';
import '../../styles/GameShell.css';

const gridVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.06 } },
};
const cardVariants = {
  hidden: { opacity: 0, y: 26, scale: 0.96 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 210, damping: 21 },
  },
};

/**
 * @param {object}   game      entry from GAMES (gameShell.js)
 * @param {object}   levels    { easy: {desc, specs, preview}, medium: {...}, hard: {...} }
 * @param {function} onStart   (levelKey, mode) => void — defaults to router navigation
 * @param {string}   footNote  optional line under the grid
 */
export default function GameLevelSelect({ game, levels, onStart, footNote }) {
  const navigate = useNavigate();
  /* Auto-open only for games that do NOT show their own rules card when the
     round starts, or the learner meets the same card twice in a row. The
     "How to play" button below stays available either way. */
  const help = useInstructions(game.id, !game.rulesInGame);
  const supportsMode = (game.modes || []).length > 1;
  const [mode, setMode] = useState((game.modes || ['camera'])[0]);
  /* One shared theme, not a private copy: switching it here or in any game's
     header updates every screen at once. */
  const [theme, setTheme] = useState(getGameTheme);
  useEffect(() => subscribeGameTheme(setTheme), []);
  const toggleTheme = () => toggleGameTheme();

  const start = (levelKey) => {
    if (onStart) return onStart(levelKey, mode);
    navigate(`${game.route}?level=${levelKey}&mode=${mode}`);
  };

  return (
    <div
      className="gs-page"
      data-game-theme={theme}
      /* Only the accent varies per game; the background, surfaces and type
         come from GameShell.css and are identical everywhere. */
      style={{
        '--gs-accent': game.accent[0],
        '--gs-accent-2': game.accent[1],
      }}
    >
      {/* ── Top bar ───────────────────────────────────────────────────────
          The same bar the game itself shows while playing: emoji + title on
          the left, glass icon buttons on the right. Walking from this screen
          into the game should feel like the same screen, not a hand-off
          between two products. */}
      <div className="gs-topbar">
        <div className="gs-topbar-left">
          <button className="gs-back" onClick={() => navigate('/play')}>
            <ArrowLeft size={18} /> Games
          </button>
          <span className="gs-game-title">
            <span className="gs-title-icon">{game.emoji}</span>
            {game.title}
          </span>
        </div>

        <div className="gs-actions">
          <HelpButton onClick={help.open} compact />
          <button
            className="gs-action"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title="Toggle light / dark theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>

      {/* ── Compact header (no dead space above the fold) ───────────────── */}
      <motion.div
        className="gs-head"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1>Choose your level</h1>
        <p>{game.subtitle}</p>
      </motion.div>

      {/* ── Input mode ──────────────────────────────────────────────────── */}
      {supportsMode && (
        <>
          <motion.div
            className="gs-mode-row"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            {game.modes.map((m) => (
              <button
                key={m}
                className={`gs-mode-btn ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
              >
                {m === 'camera' ? <Hand size={18} /> : <MousePointer2 size={18} />}
                {INPUT_MODES[m].label}
              </button>
            ))}
          </motion.div>
          <p className="gs-mode-sub">{INPUT_MODES[mode].hint}</p>
        </>
      )}

      {/* ── Easy / Medium / Hard — three identical cards ────────────────── */}
      <motion.div
        className="gs-grid"
        variants={gridVariants}
        initial="hidden"
        animate="visible"
      >
        {DIFFICULTIES.map((d) => {
          const cfg = levels[d.key] || {};
          return (
            <motion.div
              key={d.key}
              className="gs-card"
              style={{ '--lvl': d.color, '--lvl-soft': d.soft }}
              variants={cardVariants}
              whileHover={{ y: -6 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => start(d.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(d.key); }
              }}
            >
              {/* The numbered rounded square the game uses to label a step,
                  so Easy / Medium / Hard read as 1 / 2 / 3 of one scale. */}
              <span className="gs-card-num">{d.n}</span>
              <span className="gs-card-emoji">{d.emoji}</span>
              <h2 className="gs-card-name">{d.label}</h2>
              <p className="gs-card-desc">{cfg.desc}</p>

              <div className="gs-card-preview">{cfg.preview}</div>

              <div className="gs-card-specs">
                {(cfg.specs || []).map((s) => (
                  <span key={s} className="gs-spec">{s}</span>
                ))}
              </div>

              <button
                className="gs-card-play"
                onClick={(e) => { e.stopPropagation(); start(d.key); }}
              >
                <Play size={18} /> Start {d.label}
              </button>
            </motion.div>
          );
        })}
      </motion.div>

      <p className="gs-foot">
        {footNote ||
          (supportsMode
            ? '💡 You can switch between Camera and Touch / Mouse at any time during the game.'
            : '💡 Tap “How to play” at any time to see the instructions again.')}
      </p>

      <InstructionsModal game={game} {...help} />
    </div>
  );
}
