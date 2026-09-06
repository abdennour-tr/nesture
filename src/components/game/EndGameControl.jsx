/**
 * EndGameControl.jsx
 * ---------------------------------------------------------------------------
 * The "End game" button every mini-game shows during play, plus its
 * confirmation step.
 *
 * LetterQuest (GamePage.jsx) already had one — a red "End session" button in
 * its controls row that stops the round early, saves, and shows the report.
 * None of the other games had any way to stop: a child who had had enough, or
 * a therapist who wanted the report now, could only exit and lose the session.
 * This gives all of them the same control, in the same place, with the same
 * wording.
 *
 * WHY IT CONFIRMS (LetterQuest's does not)
 * ----------------------------------------
 * These are children's games driven by a hand pointer, and this button ENDS
 * the round and writes the session. LetterQuest's sits in a controls row at
 * the bottom; ours sits in the header next to pause and sound, where a stray
 * tap is much likelier. One tap should not be able to end a therapy session,
 * so the button asks first. The confirm also states plainly that the report is
 * built from what has been done so far — ending early is a valid way to finish,
 * not a cancel.
 *
 * WHY THE DIALOG IS PORTALLED
 * --------------------------
 * The button lives inside each game's header, and those headers carry
 * `backdrop-filter: blur(...)` for their frosted-glass look. A filter — like a
 * transform — makes an element a CONTAINING BLOCK for `position: fixed`
 * descendants, so the dialog was positioned against the header strip instead
 * of the viewport and appeared clipped off the top of the screen. Rendering it
 * through a portal into <body> takes it out of that subtree, so
 * `position: fixed; inset: 0` means the viewport again. No future header effect
 * can break it either.
 */
import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, X } from 'lucide-react';
import '../../styles/GameShell.css';

/**
 * @param {function} onConfirm   called when the learner confirms — run the
 *                               game's normal finish routine (finishGame /
 *                               setGamePhase('results')).
 * @param {boolean}  disabled    hide/disable while not actually playing.
 * @param {string}   className   the host game's own icon-button class, so the
 *                               button matches that header's styling.
 * @param {boolean}  compact     icon only (headers that are tight on room).
 * @param {function} onAskingChange  called with true when the dialog opens and
 *   false when it closes. Games use it to freeze the round WITHOUT showing
 *   their pause card — see the note below.
 */
export default function EndGameControl({
  onConfirm,
  disabled = false,
  className = 'gs-action',
  compact = false,
  onAskingChange,
  label = 'End game',
}) {
  const [asking, setAsking] = useState(false);

  /* The round must FREEZE while the question is on screen — otherwise bubbles
     keep rising and the clock keeps running behind the dialog. Games do that
     by setting their own `isPaused`, but that also renders their pause card,
     so the learner saw two stacked cards. `onAskingChange` therefore reports
     the dialog's state, and each game both pauses AND suppresses its pause
     card while it is true. One card at a time. */
  const setAskingAndReport = useCallback((v) => {
    setAsking(v);
    if (onAskingChange) onAskingChange(v);
  }, [onAskingChange]);

  const open = useCallback(() => {
    if (disabled) return;
    setAskingAndReport(true);
  }, [disabled, setAskingAndReport]);

  const cancel = useCallback(() => {
    setAskingAndReport(false);
  }, [setAskingAndReport]);

  const confirm = useCallback(() => {
    setAskingAndReport(false);
    onConfirm();
  }, [onConfirm, setAskingAndReport]);

  return (
    <>
      <button
        className={className}
        onClick={open}
        disabled={disabled}
        title={label}
        aria-label={label}
      >
        <Flag size={compact ? 18 : 17} />
        {!compact && <span>{label}</span>}
      </button>

      {createPortal(
        <AnimatePresence>
          {asking && (
            <motion.div
              className="gs-modal-backdrop gs-modal-backdrop--top"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={cancel}
              role="dialog"
              aria-modal="true"
              aria-label="End the game?"
            >
              <motion.div
                className="gs-modal gs-modal--confirm"
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 250, damping: 24 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="gs-modal-emoji">🏁</div>
                <h2>Finish and see your report?</h2>
                <p className="gs-modal-lead">
                  Your report will be made from everything you have done so far.
                  You can always play again afterwards.
                </p>

                <div className="gs-modal-actions">
                  <button className="gs-btn-ghost" onClick={cancel} autoFocus>
                    <X size={18} /> Keep playing
                  </button>
                  <button className="gs-btn-primary gs-btn-danger" onClick={confirm}>
                    <Flag size={18} /> Show my report
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
