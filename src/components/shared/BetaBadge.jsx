import React from 'react';

/**
 * BetaBadge — PRD v4.0 compliance.
 * Must be visible in the header of every screen.
 * Supports two variants: 'light' (for dark backgrounds) and 'dark' (for light backgrounds).
 */
export default function BetaBadge({ variant = 'light', size = 'default' }) {
  const isLight = variant === 'light';
  const isSmall = size === 'small';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: isLight
          ? 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(217,119,6,0.08))'
          : 'linear-gradient(135deg, #F59E0B, #D97706)',
        color: isLight ? '#FCD34D' : '#fff',
        fontSize: isSmall ? '0.5rem' : '0.58rem',
        fontFamily: "'Inter', sans-serif",
        fontWeight: 800,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        padding: isSmall ? '1px 6px' : '3px 9px',
        borderRadius: 20,
        border: isLight
          ? '1px solid rgba(245,158,11,0.25)'
          : '1px solid rgba(217,119,6,0.5)',
        verticalAlign: 'middle',
        marginLeft: 8,
        boxShadow: isLight
          ? '0 0 8px rgba(245,158,11,0.15)'
          : '0 2px 8px rgba(217,119,6,0.35)',
        userSelect: 'none',
        cursor: 'default',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
      title="You are using a beta version of NestureAI"
    >
      <span style={{
        display: 'inline-block',
        width: isSmall ? 4 : 5,
        height: isSmall ? 4 : 5,
        borderRadius: '50%',
        background: isLight ? '#FCD34D' : '#fff',
        animation: 'betaPulse 2s ease-in-out infinite',
        flexShrink: 0,
      }} />
      BETA
    </span>
  );
}
