/**
 * GameHUD.jsx
 * ---------------------------------------------------------------------------
 * The in-game bar every mini-game shows. Same controls, same order, same
 * place — so a learner who has played one game already knows the next one.
 *
 *   [← Exit] [Level pill] [stats…]        [mode] [?] [theme] [pause]
 *
 * Client feedback addressed here:
 *   • "this game has an option to toggle the theme but others don't" → theme
 *     lives in the shared HUD, so it is available everywhere.
 *   • "there should be an optional provision for user to see [instructions]
 *     again" → the "?" button is always present during play.
 *   • Camera/Touch can be flipped mid-game in every game, not just some.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Hand, MousePointer2, Moon, Sun, Pause, Play as PlayIcon,
} from 'lucide-react';
import { HelpButton } from './InstructionsModal';
import { INPUT_MODES, getGameTheme, toggleGameTheme, subscribeGameTheme, DIFFICULTY_BY_KEY, normaliseLevel } from './gameShell';
import '../../styles/GameShell.css';

export default function GameHUD({
  level,                 // 'easy' | 'medium' | 'hard' | 1 | 2 | 3
  stats = [],            // [{ icon, label, value }]
  mode,                  // 'camera' | 'touch' (omit for camera-only games)
  onModeChange,
  onHelp,
  paused,
  onTogglePause,
  onExit,
  exitLabel = 'Exit',
}) {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(getGameTheme);
  useEffect(() => subscribeGameTheme(setTheme), []);
  const lvl = DIFFICULTY_BY_KEY[normaliseLevel(level)];

  const toggleTheme = () => toggleGameTheme();

  return (
    <div className="gs-hud" style={{ '--lvl': lvl.color }}>
      <div className="gs-hud-left">
        <button className="gs-back" onClick={onExit || (() => navigate('/play'))}>
          <ArrowLeft size={18} /> {exitLabel}
        </button>
        <span className="gs-hud-level">{lvl.emoji} {lvl.label}</span>
        {stats.map((s) => (
          <span key={s.label} className="gs-hud-stat" title={s.label}>
            {s.icon} {s.value}
          </span>
        ))}
      </div>

      <div className="gs-hud-right">
        {mode && onModeChange && (
          <button
            className="gs-action"
            onClick={() => onModeChange(mode === 'camera' ? 'touch' : 'camera')}
            title={`Switch to ${mode === 'camera' ? INPUT_MODES.touch.label : INPUT_MODES.camera.label}`}
          >
            {mode === 'camera' ? <Hand size={18} /> : <MousePointer2 size={18} />}
            {INPUT_MODES[mode].label}
          </button>
        )}

        {onHelp && <HelpButton onClick={onHelp} compact />}

        <button
          className="gs-action gs-action--icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title="Toggle light / dark theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {onTogglePause && (
          <button
            className="gs-action gs-action--icon"
            onClick={onTogglePause}
            aria-label={paused ? 'Resume' : 'Pause'}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <PlayIcon size={18} /> : <Pause size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}
