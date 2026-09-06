/**
 * GameRules.jsx
 * ---------------------------------------------------------------------------
 * ONE rules card for every game, built to the Trace → Find → Type design.
 *
 * Before this, each game shipped its own `RulesModal` with its own markup and
 * its own colours — `bg-rules-card`, `lb-rules-card`, `pcg-rules-card`,
 * `fc-rules-card`, `fpp-rules-card`, `tt-rules-card` — six cards that looked
 * like six products. Trace → Find → Type's is the reference, so its structure
 * and palette are what this component renders; the other games keep their own
 * RULES CONTENT and pass it in.
 *
 * Structure (unchanged from `.tt-rules-card`):
 *
 *   [badge]  Title
 *            Subtitle
 *   ┌ scrolling list of rules, each with an icon tile ┐
 *   └ ─────────────────────────────────────────────── ┘
 *   [ dashed note — e.g. how the OT score is weighted ]
 *   [           primary button                        ]
 *
 * The layout rules matter and are deliberate: the card is a flex column capped
 * at the window height, and the LIST is the only part allowed to shrink and
 * scroll. That keeps the title and the start button on screen on a laptop —
 * the same reason the level screen is built the way it is.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import '../../styles/GameShell.css';

/**
 * @param {string} emoji     shown in the gradient badge
 * @param {string} title     e.g. "Pop the Bubble"
 * @param {string} subtitle  e.g. "Easy · Camera"
 * @param {Array}  rules     [{ icon, text }]
 * @param {node}   note      optional dashed footnote (the OT weighting line)
 * @param {func}   onStart   primary button
 * @param {bool}   resume    true when reopened mid-game from "How to play"
 * @param {string} startLabel overrides the primary button's text
 */
export default function GameRules({
  emoji,
  title,
  subtitle,
  rules = [],
  note,
  onStart,
  resume = false,
  startLabel,
}) {
  return (
    <motion.div
      className="gs-rules-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="gs-rules-card"
        initial={{ scale: 0.88, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      >
        <div className="gs-rules-head">
          <div className="gs-rules-badge">{emoji}</div>
          <div>
            <h2 className="gs-rules-title">{title}</h2>
            {subtitle && <p className="gs-rules-sub">{subtitle}</p>}
          </div>
        </div>

        <ul className="gs-rules-list">
          {rules.map((r, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
            >
              <span className="gs-rule-icon">{r.icon}</span>
              <span>{r.text}</span>
            </motion.li>
          ))}
        </ul>

        {note && <div className="gs-rules-note">{note}</div>}

        <button className="gs-rules-start" onClick={onStart}>
          <Play size={18} />
          {startLabel || (resume ? 'Back to the game' : "Let's go!")}
        </button>
      </motion.div>
    </motion.div>
  );
}
