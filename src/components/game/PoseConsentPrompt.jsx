/**
 * PoseConsentPrompt.jsx
 * ---------------------------------------------------------------------------
 * Asked once per touch-mode round, before the camera is opened.
 *
 * Touch mode has always meant the camera is off. Turning it on to observe
 * posture is a change the person in front of it should be told about, in words
 * a child and a parent can both read — not a line in a terms document they
 * agreed to at signup.
 *
 * Three rules this component follows:
 *
 *   1. NOTHING STARTS UNTIL SOMEONE CHOOSES. The camera hook's `enabled` stays
 *      false while this is on screen. Declining is a first-class outcome, not a
 *      dismissal to be retried.
 *   2. DECLINING COSTS NOTHING. The round plays identically either way. This
 *      screen says so, because a child who thinks saying no will spoil their
 *      game has not really been asked.
 *   3. IT SAYS WHAT IS KEPT. Not "we use your camera" but which measurements
 *      are stored, and that no video is.
 *
 * The choice is returned to the caller to record with the session, so a dataset
 * can always be traced to the wording that was consented to.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { Camera, X, Check, ShieldCheck } from 'lucide-react';
import '../../styles/PoseConsent.css';

/** Versioned: a dataset must be traceable to the exact wording agreed to. */
export const POSE_CONSENT_VERSION = 'pose-consent-v1';

export const POSE_CONSENT_COPY = {
  version: POSE_CONSENT_VERSION,
  title: 'Can we watch how you sit and move?',
  body:
    'While you play, the camera can look at where your shoulders, elbows and '
    + 'hands are. It helps us learn how to make these games better.',
  kept: [
    'The position of your shoulders, elbows, wrists and head',
    'How steady you sit and how often you reach across your body',
  ],
  notKept: [
    'No video or photo is saved — only the positions of those points',
    'Nobody watches you live',
  ],
  optional: 'You can say no. The game works exactly the same either way.',
};

export default function PoseConsentPrompt({ onDecision, learnerName }) {
  const decide = (granted) => {
    onDecision?.({
      granted,
      version: POSE_CONSENT_VERSION,
      decidedAt: new Date().toISOString(),
    });
  };

  return (
    <motion.div
      className="pc-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pc-title"
    >
      <motion.div
        className="pc-card"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <div className="pc-icon" aria-hidden="true"><Camera size={26} /></div>

        <h2 className="pc-title" id="pc-title">
          {learnerName ? `${learnerName}, ${POSE_CONSENT_COPY.title.toLowerCase()}` : POSE_CONSENT_COPY.title}
        </h2>
        <p className="pc-body">{POSE_CONSENT_COPY.body}</p>

        <div className="pc-lists">
          <div className="pc-list pc-list-yes">
            <h3 className="pc-list-title">What we look at</h3>
            <ul>
              {POSE_CONSENT_COPY.kept.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          <div className="pc-list pc-list-no">
            <h3 className="pc-list-title">What we never keep</h3>
            <ul>
              {POSE_CONSENT_COPY.notKept.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        </div>

        <p className="pc-optional">
          <ShieldCheck size={15} aria-hidden="true" />
          {POSE_CONSENT_COPY.optional}
        </p>

        <div className="pc-actions">
          {/* "No" comes first and is a full button, not a link tucked in a
              corner. A declined option that is harder to press than the
              accepted one is not really being offered. */}
          <button type="button" className="pc-btn pc-btn-no" onClick={() => decide(false)}>
            <X size={18} aria-hidden="true" />
            No thanks
          </button>
          <button type="button" className="pc-btn pc-btn-yes" onClick={() => decide(true)}>
            <Check size={18} aria-hidden="true" />
            Yes, that&rsquo;s okay
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
