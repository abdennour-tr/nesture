import { GAME_PROFILES, gameIdFromName, PRIMITIVE_REFLEXES } from '../../../services/reflexProfiles';

export const PLAYER_GAMES = [
  { id: 'letterquest', title: 'LetterQuest', description: 'Build words, one letter at a time.', route: '/play/difficulty', category: 'Words & spelling', art: 'letters' },
  { id: 'pinch-coin', title: 'Pinch the Coin', description: 'Pinch, carry, and collect golden coins.', route: '/play/pinch-coin-difficulty', category: 'Pinch & release', art: 'coin' },
  { id: 'ladybug', title: 'Follow the Ladybug', description: 'Follow a little explorer with your fingertip.', route: '/play/ladybug-difficulty', category: 'Tracking & control', art: 'ladybug' },
  { id: 'bubble', title: 'Pop the Bubble', description: 'Point, aim, and pop a sky full of bubbles.', route: '/play/bubble-difficulty', category: 'Aim & precision', art: 'bubble' },
  { id: 'trace-type', title: 'Trace → Find → Type', description: 'Discover letters by tracing, finding, and typing.', route: '/play/trace-type-difficulty', category: 'Letters & movement', art: 'trace' },
  { id: 'finger-piano', title: 'Finger Piano', description: 'Make music with a little finger practice.', route: '/play/finger-piano-difficulty', category: 'Finger coordination', art: 'piano' },
  { id: 'finger-copy', title: 'Magic Finger Copy', description: 'Look at a hand shape, then make it your own.', route: '/play/finger-copy-difficulty', category: 'Hand coordination', art: 'hand' },
];

export function numberOrNull(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function sessionNotes(session) {
  try {
    const notes = typeof session.notes === 'string' ? JSON.parse(session.notes) : session.notes;
    return notes && typeof notes === 'object' ? notes : {};
  } catch { return {}; }
}

export function accuracyPercent(session) {
  // Keep the saved accuracy separate from a game's composite performance score.
  if (session.accuracy_recorded === false) return null;
  const n = numberOrNull(session.accuracy_score);
  return n == null || n > 100 ? null : Math.round(n <= 1 ? n * 100 : n);
}

export function performanceScore(session) {
  // Only this explicitly named field has a shared 0–100 performance scale.
  const n = numberOrNull(sessionNotes(session).performanceScore);
  return n != null && n <= 100 ? Math.round(n) : null;
}

export function isCompleted(session) {
  return Boolean(session.end_time) || session.scenario === 'Completed Session';
}

export function buildPlayerSummary(sessions) {
  const ordered = [...sessions].sort((a, b) => (Date.parse(b.start_time) || 0) - (Date.parse(a.start_time) || 0));
  const completed = ordered.filter(isCompleted);
  const accuracy = completed.map(accuracyPercent).filter(n => n != null);
  const byGame = Object.fromEntries(PLAYER_GAMES.map(game => {
    const rows = completed.filter(s => gameIdFromName(s.game_name) === game.id);
    const scores = rows.map(performanceScore).filter(n => n != null);
    const accuracies = rows.map(accuracyPercent).filter(n => n != null);
    return [game.id, { sessions: rows, best: scores.length ? Math.max(...scores) : null,
      bestAccuracy: accuracies.length ? Math.max(...accuracies) : null,
      latest: rows[0] || null }];
  }));
  const explored = Object.values(byGame).filter(g => g.sessions.length > 0).length;
  const targets = PRIMITIVE_REFLEXES.map(key => ({ key, count: completed.filter(session =>
    GAME_PROFILES[gameIdFromName(session.game_name)]?.targets.some(target => target.key === key)
  ).length })).filter(target => target.count > 0);
  return { ordered, completed, byGame, explored, targets,
    averageAccuracy: accuracy.length ? Math.round(accuracy.reduce((a, b) => a + b, 0) / accuracy.length) : null,
    minutes: Math.round(completed.reduce((sum, s) => sum + (numberOrNull(s.duration_seconds) || 0), 0) / 60),
  };
}

export function gameTrend(sessions) {
  const scored = sessions.filter(s => accuracyPercent(s) != null);
  // Compare like-for-like: the two latest recorded results at the same difficulty.
  const latest = scored[0];
  const previous = latest?.difficulty ? scored.slice(1).find(s => s.difficulty === latest.difficulty) : null;
  return previous ? accuracyPercent(latest) - accuracyPercent(previous) : null;
}
