/**
 * SoundManager — Programmatic sound effects for NestureAI PathTracer game.
 *
 * Uses the Web Audio API to synthesize all sounds in real-time via oscillators
 * and gain nodes. No external audio files are required.
 *
 * Design philosophy (children with motor impairments):
 *   • Gentle sine-wave tones — never startling
 *   • Musical intervals (major thirds, perfect fifths) for pleasant harmony
 *   • Smooth ADSR envelopes on every sound to eliminate clicks/pops
 *   • Warning sounds are informative, NOT punishing
 *   • Success sounds are rewarding but not overwhelming
 *   • Ambient pad is extremely subtle, creating a calm atmosphere
 */

// ---------------------------------------------------------------------------
// Note frequencies (A4 = 440 Hz, equal temperament)
// ---------------------------------------------------------------------------
const NOTE = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  C3: 130.81,
  E3: 164.81,
  G3: 196.0,
  B3: 246.94,
  B5: 987.77,
  C6: 1046.50,
};

class SoundManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;

    /** Whether sound effects are enabled. This singleton is shared by EVERY
        game, so this flag is the ONE source of truth for "is the sound on".
        Games read it through the useSoundEnabled hook instead of keeping
        their own copy (see setEnabled below). */
    this.enabled = true;

    /** Listeners told whenever `enabled` changes (useSoundEnabled). */
    this._listeners = new Set();
    // Bound so they can be handed straight to useSyncExternalStore.
    this.subscribe = this.subscribe.bind(this);
    this.isEnabled = this.isEnabled.bind(this);

    /** Master volume (0–1). Default is child-friendly quiet. */
    this.volume = 0.3;

    // --- Ambient state ---
    /** @type {GainNode|null} */
    this.ambientNode = null;

    /** @type {OscillatorNode[]} */
    this._ambientOscillators = [];

    /** @type {GainNode|null} */
    this._ambientLfo = null;

    /** Whether the ambient pad is currently playing */
    this.isAmbientPlaying = false;

    // --- On-path continuous tone state ---
    /** @type {OscillatorNode|null} */
    this._onPathOsc = null;

    /** @type {GainNode|null} */
    this._onPathGain = null;

    this._isOnPathPlaying = false;
  }

  // =========================================================================
  // Initialisation
  // =========================================================================

  /**
   * Initialise the AudioContext.
   * Must be called after a user gesture (click / touch) to satisfy browser
   * autoplay policies.
   */
  init() {
    if (this.ctx) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Resume if the context was created in a suspended state
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch (err) {
      console.warn('[SoundManager] Web Audio API not supported:', err);
    }
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Ensure the AudioContext is ready. Returns `false` if audio is unavailable
   * or disabled.
   * @returns {boolean}
   * @private
   */
  _ensureCtx() {
    if (!this.enabled) return false;
    if (!this.ctx) this.init();
    if (!this.ctx) return false;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return true;
  }

  /**
   * Create a gain node connected to the destination with the given volume
   * multiplier.
   * @param {number} [gain=1] — multiplier applied on top of master volume
   * @returns {GainNode}
   * @private
   */
  _createGain(gain = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.connect(this.ctx.destination);
    return g;
  }

  /**
   * Play a single tone with a full ADSR envelope.
   *
   * @param {number}  freq      — frequency in Hz
   * @param {object}  [opts]
   * @param {number}  [opts.attack=0.02]   — seconds
   * @param {number}  [opts.decay=0.1]     — seconds
   * @param {number}  [opts.sustain=0.4]   — gain level (0–1)
   * @param {number}  [opts.release=0.15]  — seconds
   * @param {number}  [opts.duration=0.3]  — total duration (sustain portion)
   * @param {number}  [opts.volume=1]      — volume multiplier (on top of master)
   * @param {string}  [opts.type='sine']   — oscillator type
   * @param {number}  [opts.delay=0]       — schedule delay in seconds
   * @param {GainNode} [opts.destination]  — optional destination node
   * @private
   */
  _playTone(freq, opts = {}) {
    if (!this._ensureCtx()) return;

    const {
      attack = 0.02,
      decay = 0.1,
      sustain = 0.4,
      release = 0.15,
      duration = 0.3,
      volume = 1,
      type = 'sine',
      delay = 0,
      destination = null,
    } = opts;

    const now = this.ctx.currentTime + delay;
    const peakGain = this.volume * volume;
    const sustainGain = peakGain * sustain;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    // ADSR envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + attack);
    gain.gain.linearRampToValueAtTime(sustainGain, now + attack + decay);
    gain.gain.setValueAtTime(sustainGain, now + attack + decay + duration);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay + duration + release);

    osc.connect(gain);
    gain.connect(destination || this.ctx.destination);

    osc.start(now);
    osc.stop(now + attack + decay + duration + release + 0.01);

    // Clean up references after the tone finishes
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  // =========================================================================
  // Sound Effects
  // =========================================================================

  /**
   * Pleasant ascending chime (C → E → G) played when a game starts.
   * Uses a major triad for an uplifting, inviting feeling.
   */
  playStartChime() {
    if (!this._ensureCtx()) return;

    const notes = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5];
    const spacing = 0.12;

    notes.forEach((freq, i) => {
      this._playTone(freq, {
        delay: i * spacing,
        attack: 0.03,
        decay: 0.08,
        sustain: 0.3,
        release: 0.25,
        duration: 0.15,
        volume: 0.7,
      });
    });
  }

  /**
   * Soft, continuous gentle tone that plays while the user's finger / pointer
   * is on the correct path.
   *
   * Call once to start; the tone persists until `stopOnPath()` is called
   * internally (or the next call to `playOnPath()` will be a no-op if
   * already playing).
   */
  playOnPath() {
    if (!this._ensureCtx()) return;
    if (this._isOnPathPlaying) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(NOTE.C4, now);

    // Gentle fade-in
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.volume * 0.18, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);

    this._onPathOsc = osc;
    this._onPathGain = gain;
    this._isOnPathPlaying = true;
  }

  /**
   * Stop the continuous on-path tone with a smooth fade-out.
   */
  stopOnPath() {
    if (!this._isOnPathPlaying || !this._onPathGain || !this._onPathOsc) return;

    const now = this.ctx.currentTime;
    this._onPathGain.gain.cancelScheduledValues(now);
    this._onPathGain.gain.setValueAtTime(this._onPathGain.gain.value, now);
    this._onPathGain.gain.linearRampToValueAtTime(0, now + 0.12);

    const oscRef = this._onPathOsc;
    const gainRef = this._onPathGain;

    oscRef.stop(now + 0.15);
    oscRef.onended = () => {
      oscRef.disconnect();
      gainRef.disconnect();
    };

    this._onPathOsc = null;
    this._onPathGain = null;
    this._isOnPathPlaying = false;
  }

  /**
   * Brief soft warning buzz when the user's finger goes off the path.
   * Intentionally gentle — informative, NOT punishing.
   */
  playOffPath() {
    if (!this._ensureCtx()) return;

    // Stop the on-path tone first
    this.stopOnPath();

    // A low, soft, very short buzz using a triangle wave
    this._playTone(180, {
      type: 'triangle',
      attack: 0.02,
      decay: 0.06,
      sustain: 0.2,
      release: 0.1,
      duration: 0.08,
      volume: 0.35,
    });
  }

  /**
   * Magical, sparkly chord when the user successfully connects two points.
   */
  playProgress() {
    if (!this._ensureCtx()) return;

    // A bright, magical arpeggio (C major 7th: C - E - G - B)
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.B5];
    const spacing = 0.04; // Very fast arpeggio

    notes.forEach((freq, i) => {
      this._playTone(freq, {
        delay: i * spacing,
        attack: 0.01,
        decay: 0.1,
        sustain: 0.1,
        release: 0.2,
        duration: 0.05,
        volume: 0.45,
        type: 'sine',
      });
    });

    // Add a tiny 'sparkle' high note on top
    this._playTone(NOTE.C6, {
      delay: notes.length * spacing,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.1,
      release: 0.3,
      duration: 0.05,
      volume: 0.2,
      type: 'triangle',
    });
  }

  /**
   * Celebration jingle — ascending arpeggio played on successful path
   * completion. Rewarding but not overwhelming.
   */
  playComplete() {
    if (!this._ensureCtx()) return;

    // Stop on-path tone
    this.stopOnPath();

    const arpeggio = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5];
    const spacing = 0.1;

    arpeggio.forEach((freq, i) => {
      this._playTone(freq, {
        delay: i * spacing,
        attack: 0.02,
        decay: 0.08,
        sustain: 0.35,
        release: 0.3,
        duration: 0.1,
        volume: 0.6,
      });
    });
  }

  /**
   * Extended celebration with multiple layered tones — played when an entire
   * session is complete. Richer and longer than `playComplete()`.
   */
  playCelebration() {
    if (!this._ensureCtx()) return;

    this.stopOnPath();

    // First phrase — ascending C major arpeggio
    const phrase1 = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5];
    phrase1.forEach((freq, i) => {
      this._playTone(freq, {
        delay: i * 0.12,
        attack: 0.025,
        decay: 0.1,
        sustain: 0.35,
        release: 0.3,
        duration: 0.12,
        volume: 0.55,
      });
    });

    // Second phrase — a sparkle octave leap
    const phrase2 = [NOTE.E5, NOTE.G5, NOTE.C5, NOTE.E5];
    const offset2 = phrase1.length * 0.12 + 0.15;

    phrase2.forEach((freq, i) => {
      this._playTone(freq, {
        delay: offset2 + i * 0.1,
        attack: 0.02,
        decay: 0.08,
        sustain: 0.3,
        release: 0.4,
        duration: 0.1,
        volume: 0.5,
      });
    });

    // Final sustained chord (C major)
    const chordDelay = offset2 + phrase2.length * 0.1 + 0.12;
    [NOTE.C4, NOTE.E4, NOTE.G4].forEach((freq) => {
      this._playTone(freq, {
        delay: chordDelay,
        attack: 0.05,
        decay: 0.15,
        sustain: 0.25,
        release: 0.6,
        duration: 0.4,
        volume: 0.4,
      });
    });
  }

  /**
   * Short beep for the countdown timer (3… 2… 1…).
   */
  playCountdown() {
    if (!this._ensureCtx()) return;

    this._playTone(NOTE.A4, {
      attack: 0.01,
      decay: 0.05,
      sustain: 0.3,
      release: 0.1,
      duration: 0.05,
      volume: 0.45,
    });
  }

  /**
   * Higher pitch "Go!" beep at the end of the countdown.
   */
  playCountdownGo() {
    if (!this._ensureCtx()) return;

    this._playTone(NOTE.E5, {
      attack: 0.01,
      decay: 0.06,
      sustain: 0.4,
      release: 0.15,
      duration: 0.1,
      volume: 0.55,
    });

    // Add a harmonic layer for emphasis
    this._playTone(NOTE.C5, {
      delay: 0.02,
      attack: 0.015,
      decay: 0.06,
      sustain: 0.3,
      release: 0.18,
      duration: 0.1,
      volume: 0.35,
    });
  }

  /**
   * UI click sound for buttons and interactive elements.
   */
  playClick() {
    if (!this._ensureCtx()) return;

    this._playTone(NOTE.G4, {
      attack: 0.005,
      decay: 0.04,
      sustain: 0.15,
      release: 0.06,
      duration: 0.02,
      volume: 0.3,
    });
  }

  /**
   * Very subtle hover sound — barely perceptible, just enough to give
   * auditory feedback for spatial awareness.
   */
  playHover() {
    if (!this._ensureCtx()) return;

    this._playTone(NOTE.C5, {
      attack: 0.008,
      decay: 0.03,
      sustain: 0.1,
      release: 0.04,
      duration: 0.01,
      volume: 0.12,
    });
  }

  // =========================================================================
  // Ambient Sound
  // =========================================================================

  /**
   * Start a gentle ambient pad — layered sine oscillators at harmonic
   * intervals with a slow LFO "breathing" modulation.
   *
   * Very low volume so it sits underneath everything else and creates a
   * calm, focused atmosphere.
   */
  startAmbient() {
    if (!this._ensureCtx()) return;
    if (this.isAmbientPlaying) return;

    const now = this.ctx.currentTime;
    const ambientVolume = this.volume * 0.15;

    // --- Master gain for the ambient group ---
    this.ambientNode = this.ctx.createGain();
    this.ambientNode.gain.setValueAtTime(0, now);
    this.ambientNode.gain.linearRampToValueAtTime(ambientVolume, now + 2.0);
    this.ambientNode.connect(this.ctx.destination);

    // --- LFO for slow "breathing" modulation ---
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.15, now); // Very slow — one cycle ≈ 6.7 s
    lfoGain.gain.setValueAtTime(ambientVolume * 0.35, now);
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientNode.gain);
    lfo.start(now);

    this._ambientLfoOsc = lfo;
    this._ambientLfoGain = lfoGain;

    // --- Layered sine oscillators (C3 – E3 – G3: C major triad) ---
    const chordFreqs = [NOTE.C3, NOTE.E3, NOTE.G3];

    this._ambientOscillators = chordFreqs.map((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      // Slightly detune each oscillator for a warm, wide sound
      osc.detune.setValueAtTime((i - 1) * 4, now);

      gain.gain.setValueAtTime(0.33, now); // Equal mix
      osc.connect(gain);
      gain.connect(this.ambientNode);
      osc.start(now);

      return { osc, gain };
    });

    this.isAmbientPlaying = true;
  }

  /**
   * Fade out and stop the ambient pad gracefully.
   */
  stopAmbient() {
    if (!this.isAmbientPlaying || !this.ambientNode) return;

    const now = this.ctx.currentTime;

    // Fade out over 1.5 seconds
    this.ambientNode.gain.cancelScheduledValues(now);
    this.ambientNode.gain.setValueAtTime(this.ambientNode.gain.value, now);
    this.ambientNode.gain.linearRampToValueAtTime(0, now + 1.5);

    // Schedule cleanup
    const cleanup = () => {
      // Stop oscillators
      this._ambientOscillators.forEach(({ osc, gain }) => {
        try { osc.stop(); } catch (_) { /* already stopped */ }
        osc.disconnect();
        gain.disconnect();
      });

      // Stop LFO
      if (this._ambientLfoOsc) {
        try { this._ambientLfoOsc.stop(); } catch (_) { /* noop */ }
        this._ambientLfoOsc.disconnect();
        this._ambientLfoGain.disconnect();
        this._ambientLfoOsc = null;
        this._ambientLfoGain = null;
      }

      if (this.ambientNode) {
        this.ambientNode.disconnect();
        this.ambientNode = null;
      }

      this._ambientOscillators = [];
      this.isAmbientPlaying = false;
    };

    // Use a timeout matching the fade-out duration
    setTimeout(cleanup, 1600);
  }

  // =========================================================================
  // Controls
  // =========================================================================

  /**
   * Set the master volume.
   * @param {number} v — value between 0 and 1
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));

    // Live-update ambient volume if playing
    if (this.isAmbientPlaying && this.ambientNode && this.ctx) {
      const now = this.ctx.currentTime;
      const newAmbientVol = this.volume * 0.15;
      this.ambientNode.gain.cancelScheduledValues(now);
      this.ambientNode.gain.setValueAtTime(this.ambientNode.gain.value, now);
      this.ambientNode.gain.linearRampToValueAtTime(newAmbientVol, now + 0.1);

      // Update LFO depth
      if (this._ambientLfoGain) {
        this._ambientLfoGain.gain.setValueAtTime(newAmbientVol * 0.35, now);
      }
    }

    // Live-update on-path tone volume if playing
    if (this._isOnPathPlaying && this._onPathGain && this.ctx) {
      const now = this.ctx.currentTime;
      this._onPathGain.gain.cancelScheduledValues(now);
      this._onPathGain.gain.setValueAtTime(this._onPathGain.gain.value, now);
      this._onPathGain.gain.linearRampToValueAtTime(this.volume * 0.18, now + 0.05);
    }
  }

  /**
   * Toggle sound on / off. Stops ambient & on-path sounds when disabling.
   * @returns {boolean} The new enabled state
   */
  toggle() {
    return this.setEnabled(!this.enabled);
  }

  /**
   * Turn sound on or off for the whole app.
   *
   * Client feedback: "i did switch off the sound in trace->find->type and since
   * then i can not hear sound in any other game — even when i go in the games
   * it says sound icon is turned on". Muting flipped this shared flag, but each
   * game started its own icon at "on" without reading it, so the icon lied and
   * the sound stayed off everywhere. Every game now reads and writes the state
   * here, and is re-rendered through the listeners when it changes.
   *
   * @param {boolean} on
   * @returns {boolean} The new enabled state
   */
  setEnabled(on) {
    const next = !!on;
    if (next === this.enabled) return this.enabled;
    this.enabled = next;

    if (!next) {
      this.stopOnPath();
      this.stopAmbient();
    } else {
      // Called from a click, so the browser allows resuming audio here.
      this.init();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    }

    this._listeners.forEach((fn) => {
      try { fn(next); } catch (err) { console.warn('[SoundManager] listener failed:', err); }
    });
    return next;
  }

  /**
   * Be told when sound is turned on/off anywhere in the app.
   * @param {(enabled: boolean) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Check whether sounds are currently enabled.
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Clean up all audio nodes and close the AudioContext.
   * Call when unmounting the game or navigating away.
   */
  dispose() {
    this.stopOnPath();
    this.stopAmbient();

    if (this.ctx) {
      // Give a moment for fade-outs, then close
      setTimeout(() => {
        if (this.ctx && this.ctx.state !== 'closed') {
          this.ctx.close().catch(() => {});
        }
        this.ctx = null;
      }, 200);
    }

    this._onPathOsc = null;
    this._onPathGain = null;
    this._isOnPathPlaying = false;
    this.ambientNode = null;
    this._ambientOscillators = [];
    this._ambientLfoOsc = null;
    this._ambientLfoGain = null;
    this.isAmbientPlaying = false;
  }
}

// ---------------------------------------------------------------------------
// Singleton instance — import this for convenient usage across components
// ---------------------------------------------------------------------------
export const soundManager = new SoundManager();

export default SoundManager;
