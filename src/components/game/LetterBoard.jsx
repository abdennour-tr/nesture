import React from 'react';
import { motion } from 'framer-motion';

const ROWS = [
  ['A','B','C','D','E','F','G'],
  ['H','I','J','K','L','M','N'],
  ['O','P','Q','R','S','T','U'],
  ['V','W','X','Y','Z',' ','⌫'],
];

/**
 * LetterBoard – the RPM-style letter selection grid.
 *
 * Props:
 *   onLetterPress(letter)   — called when a letter is tapped / pointed at
 *   targetLetter            — optional: highlight the next expected letter
 *   lastGesture             — { letter, result: 'Perfect'|'Failed'|'Skipped' }
 *   disabled                — disable all keys
 *   size                    — 'normal' | 'large' (for Easy difficulty)
 *   indexTipPosition        — { x, y } normalised 0-1 from MediaPipe
 *   canvasWidth             — canvas width in px (for hit-test)
 *   canvasHeight            — canvas height in px
 */
export default function LetterBoard({
  onLetterPress,
  targetLetter,
  lastGesture,
  disabled,
  size = 'normal',
  indexTipPosition,
  canvasWidth,
  canvasHeight,
}) {
  const keySize  = size === 'large' ? 60 : 52;
  const fontSize = size === 'large' ? '1.2rem' : '1.05rem';
  const gap      = size === 'large' ? 10 : 8;

  const getKeyStyle = (letter) => {
    const isTarget  = targetLetter && letter === targetLetter;
    const isLast    = lastGesture?.letter === letter;
    const isSuccess = isLast && lastGesture?.result === 'Perfect';
    const isFailed  = isLast && lastGesture?.result === 'Failed';
    const isSpecial = letter === ' ' || letter === '⌫';

    // Check if the MediaPipe index tip is hovering over this key
    // (rough hit-test — proper one done in GamePage with bounding rects)
    const base = {
      width:  keySize,
      height: keySize,
      borderRadius: 10,
      border: '1.5px solid rgba(255,255,255,0.1)',
      background: 'rgba(255,255,255,0.07)',
      color: '#C8E8ED',
      fontFamily: 'Inter, sans-serif',
      fontWeight: 700,
      fontSize,
      cursor: disabled ? 'default' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.12s',
      opacity: disabled ? 0.5 : 1,
      userSelect: 'none',
      flexShrink: 0,
    };

    if (isSpecial) return { ...base, fontSize: '0.85rem', background: 'rgba(255,255,255,0.04)' };
    if (isSuccess) return { ...base, background: 'rgba(16,185,129,0.3)', border: '1.5px solid #10B981', color: '#10B981', boxShadow: '0 0 10px rgba(16,185,129,0.25)' };
    if (isFailed)  return { ...base, background: 'rgba(239,68,68,0.15)', border: '1.5px solid rgba(239,68,68,0.35)' };
    if (isTarget)  return { ...base, background: 'rgba(232,132,26,0.28)', border: '1.5px solid #E8841A', color: '#E8841A', boxShadow: '0 0 14px rgba(232,132,26,0.3)' };
    return base;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, alignItems: 'center' }}>
      {ROWS.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap, justifyContent: 'center' }}>
          {row.map((letter) => (
            <motion.button
              key={letter}
              id={`key-${letter === ' ' ? 'SPACE' : letter === '⌫' ? 'BACK' : letter}`}
              onClick={() => !disabled && onLetterPress(letter)}
              disabled={disabled}
              whileTap={{ scale: disabled ? 1 : 0.90 }}
              whileHover={{ scale: disabled ? 1 : 1.06 }}
              style={getKeyStyle(letter)}
            >
              {letter === ' ' ? '⎵' : letter}
            </motion.button>
          ))}
        </div>
      ))}
    </div>
  );
}
