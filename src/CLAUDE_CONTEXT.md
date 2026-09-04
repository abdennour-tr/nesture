# Nesture — Contexte Projet pour Claude

## Projet
- **Chemin local** : `C:\Users\hp elitebbok 840\Downloads\nesture-main\nesture-main`
- **Stack** : React (JSX), React Router v6, Framer Motion, MediaPipe Hands, Web Audio API, Supabase
- **Lancer** : `npm start` depuis le dossier ci-dessus

## Jeux existants (routes dans App.js)
| Jeu | Difficulté | Jeu |
|-----|-----------|-----|
| Path Tracing | `/play/path-difficulty` | `/play/path-game` |
| Finger Copy | `/play/finger-copy-difficulty` | `/play/finger-copy-game` |
| Trace Type | `/play/trace-type-difficulty` | `/play/trace-type-game` |
| Finger Piano | `/play/finger-piano-difficulty` | `/play/finger-piano-game` |
| **Pinch Coin** | `/play/pinch-coin-difficulty` | `/play/pinch-coin-game` |

## Fichiers modifiés (session précédente)
1. `src/pages/PinchCoinGame.jsx` — jeu amélioré complet
   - Pause overlay + bouton Home
   - Switch Camera ↔ Touch en cours de jeu
   - Anti-jitter MediaPipe (EMA α=0.45, hysteresis, RELEASE_FRAMES=3)
   - Seuils pinch par niveau : Easy=0.095 / Medium=0.072 / Hard=0.055
   - Score composite OT : accuracy 40% + stability 30% + speed 30%
   - Composant `GoldCoin` CSS (pas d'emoji)
   - Minuterie mm:ss, grille résultats 6 métriques + anneau performance
2. `src/styles/PinchCoinGame.css` — styles premium
   - Fond photo Montessori (base64 intégré, sans animation)
   - Overlay dégradé sombre pour lisibilité
   - Pause overlay, boutons Home/Pause, anneau conic-gradient
   - `@media (prefers-reduced-motion)` pour accessibilité
3. `src/pages/PinchCoinDifficulty.jsx` — hint mode switching ajouté

## Hooks & utilitaires clés
- `useHandTracking(videoRef, canvasRef, enabled, pauseProcessing, maxHands)`
  → retourne `{ landmarks, isTracking, isSimulationMode }`
- `soundManager` (singleton) : `init()`, `playCountdown()`, `playComplete()`, `playCelebration()`, `playClick()`
- Sessions API : `api.post('/sessions/start')` + `api.post('/sessions/end')`

## Pour reprendre le contexte dans une nouvelle session
Colle ce message au début :
> "Je travaille sur le projet Nesture (React, thérapie occupationnelle pour enfants).
> Lis le fichier CLAUDE_CONTEXT.md dans src/ pour le contexte complet.
> Le dernier travail : amélioration de PinchCoinGame avec fond photo Montessori."
