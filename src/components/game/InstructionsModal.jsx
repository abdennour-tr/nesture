/**
 * InstructionsModal.jsx
 * ---------------------------------------------------------------------------
 * ONE instructions modal for every game.
 *
 * Client feedback: "i was shown the instructions the very first time i went
 * into the games but never ever again — which makes sense. but there should be
 * an optional provision for user to see them again if they wish to."
 *
 * Behaviour:
 *   • Auto-opens the first time a learner opens a given game (per-game flag in
 *     localStorage).
 *   • Always reachable afterwards from the "How to play" button that
 *     GameLevelSelect and GameHUD render on every screen.
 *
 * Usage:
 *   const help = useInstructions('bubble');
 *   <button onClick={help.open}>How to play</button>
 *   <InstructionsModal game={GAMES.bubble} {...help} />
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import GameRules from './GameRules';
import { hasSeenInstructions, markInstructionsSeen } from './gameShell';
import '../../styles/GameShell.css';

/**
 * @param {string} gameId  key from GAMES
 * @param {boolean} autoShow  show automatically on first ever visit (default true)
 */
export function useInstructions(gameId, autoShow = true) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (autoShow && !hasSeenInstructions(gameId)) setIsOpen(true);
  }, [gameId, autoShow]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    markInstructionsSeen(gameId);
    setIsOpen(false);
  }, [gameId]);

  return { isOpen, open, close };
}

export default function InstructionsModal({
  game,
  isOpen,
  close,
  onStart,              // optional: primary button starts play instead of just closing
  primaryLabel,
}) {
  if (!game) return null;

  const handlePrimary = () => {
    close();
    if (onStart) onStart();
  };

  /* Rendered with the SAME card as every in-game rules screen (GameRules), so
     "How to play" looks identical whether it is opened from the level screen or
     from the header during play. It used to be a separate `.gs-modal` design —
     one more way the games looked like different products. */
  return (
    <AnimatePresence>
      {isOpen && (
        <div onClick={close} role="presentation">
          <div onClick={(e) => e.stopPropagation()}>
            <GameRules
              emoji={game.emoji}
              title={`How to play ${game.title}`}
              subtitle={game.subtitle}
              rules={game.steps.map((text, i) => ({ icon: i + 1, text }))}
              onStart={handlePrimary}
              startLabel={primaryLabel || "Got it, let's play!"}
            />
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** The standard "?" button — same icon, same place, in every game. */
export function HelpButton({ onClick, label = 'How to play', compact = false }) {
  return (
    <button
      className={`gs-action${compact ? ' gs-action--icon' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <HelpCircle size={18} />
      {!compact && <span>{label}</span>}
    </button>
  );
}
