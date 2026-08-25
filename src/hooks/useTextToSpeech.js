import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Phonetic representations of letters for English and French to force phonetic sounds (phonics)
// instead of their alphabetical names.
const PHONETIC_MAP = {
  en: {
    A: "a",
    B: "b",
    C: "c",
    D: "d",
    E: "e",
    F: "f",
    G: "g",
    H: "h",
    I: "i",
    J: "j",
    K: "k",
    L: "l",
    M: "m",
    N: "n",
    O: "o",
    P: "p",
    Q: "q",
    R: "r",
    S: "s",
    T: "t",
    U: "u",
    V: "v",
    W: "w",
    X: "x",
    Y: "y",
    Z: "z",
    "⌫": "",
    " ": "space",
    "␣": "space",
  },
  fr: {
    A: "ah",
    B: "b",
    C: "k",
    D: "d",
    E: "euh",
    F: "ff",
    G: "g",
    H: "h",
    I: "ee",
    J: "j",
    K: "k",
    L: "ul",
    M: "mm",
    N: "un",
    O: "oh",
    P: "p",
    Q: "k",
    R: "rr",
    S: "ss",
    T: "t",
    U: "ew",
    V: "vv",
    W: "w",
    X: "ks",
    Y: "ee",
    Z: "zz",
    "⌫": "",
    " ": "espace",
    "␣": "espace",
  }
};

/**
 * Custom hook to perform text-to-speech utilizing standard Web Speech API or Cloud fallback.
 * Implements a time-based text debounce and 50ms async cancel delay to resolve duplication.
 * Ranks system voices to prioritize high-fidelity voices and penalize robotic default ones.
 * 
 * @param {boolean} enabled - Overall enabled switch for TTS.
 */
export const useTextToSpeech = (enabled = true) => {
  const { i18n } = useTranslation();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const speechTimeoutRef = useRef(null);
  const lastSpeechRef = useRef({ text: '', time: 0 });

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Load and update voices asynchronously, caching list updates via event handler
  useEffect(() => {
    if (!supported) return;

    const updateVoices = () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        setVoices(window.speechSynthesis.getVoices() || []);
      }
    };

    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, [supported]);

  const cancel = useCallback(() => {
    if (speechTimeoutRef.current) {
      clearTimeout(speechTimeoutRef.current);
    }
    if (supported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [supported]);

  const speak = useCallback((text, options = {}) => {
    const now = Date.now();

    // 1. Time-based debounce: prevent speaking duplicate text within a 500ms window
    if (lastSpeechRef.current.text === text && (now - lastSpeechRef.current.time < 500)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[useTextToSpeech - Debounced Duplicate] "${text}" ignored (called within ${now - lastSpeechRef.current.time}ms)`);
      }
      return;
    }
    lastSpeechRef.current = { text, time: now };

    // Dev logging of TTS invocation
    if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost') {
      console.log(`[useTextToSpeech - Trigger] Text: "${text}" | Time: ${new Date().toLocaleTimeString()} | Options:`, options);
    }

    cancel();

    if (!supported || !enabled || !text) return;

    const {
      rate = 0.8,   // Slower rate for clear child pronunciation
      pitch = 1.1,  // Friendly high pitch
      voice = null,
      delay = 0,
      phonetic = false,
      useCloudTts = true, // Attempt Cloud TTS if endpoint is configured
    } = options;

    const currentLang = options.lang || i18n.language || 'en';
    const langKey = currentLang.startsWith('fr') ? 'fr' : 'en';
    const resolvedLang = langKey === 'fr' ? 'fr-FR' : 'en-US';

    let toSpeak = text;
    if (phonetic && text.length === 1) {
      const upperText = text.toUpperCase();
      const phoneticText = PHONETIC_MAP[langKey]?.[upperText];
      if (phoneticText) {
        toSpeak = phoneticText;
      }
    }

    const runSpeech = async () => {
      // Option A: Cloud TTS Proxy Fallback (if env variable is set)
      const cloudTtsUrl = process.env.REACT_APP_CLOUD_TTS_URL;
      if (useCloudTts && cloudTtsUrl) {
        try {
          const response = await fetch(cloudTtsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: toSpeak, lang: resolvedLang })
          });
          if (response.ok) {
            const blob = await response.blob();
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            audio.onplay = () => setIsSpeaking(true);
            audio.onended = () => setIsSpeaking(false);
            audio.onerror = () => setIsSpeaking(false);
            audio.play();
            return; // Success, exit out of local SpeechSynthesis
          }
        } catch (err) {
          console.warn('[useTextToSpeech] Cloud TTS failed. Falling back to native Web Speech API:', err);
        }
      }

      // Option B: Native Web Speech API
      try {
        // Double cancel to guarantee OS audio channel is flushed
        if (supported) {
          window.speechSynthesis.cancel();
        }

        // 50ms delay to allow OS audio channel flushing to fully complete
        setTimeout(() => {
          try {
            const utterance = new SpeechSynthesisUtterance(toSpeak);
            utterance.rate = rate;
            utterance.pitch = pitch;
            utterance.lang = resolvedLang; // Force language explicitly to prevent system locale overrides

            if (voice) {
              utterance.voice = voice;
            } else if (voices.length > 0) {
              const matchingVoices = voices.filter(v => v.lang.toLowerCase().startsWith(langKey));

              // Sort voices to prioritize premium voices and penalize poor quality robotic ones
              const sortedVoices = [...matchingVoices].sort((a, b) => {
                const aName = a.name.toLowerCase();
                const bName = b.name.toLowerCase();

                const getVoiceScore = (name) => {
                  // 1. Priority: Child/Junior friendly voices
                  if (name.includes('child') || name.includes('kid') || name.includes('junior') || name.includes('toy') || name.includes('young')) {
                    return 100;
                  }
                  // 2. Priority: Natural, enhanced premium OS voices (e.g. Samantha Enhanced, Siri)
                  if (name.includes('premium') || name.includes('natural') || name.includes('enhanced')) {
                    return 80;
                  }
                  // 3. Priority: Google online voices (Chrome high fidelity)
                  if (name.includes('google') && !name.includes('one')) {
                    return 60;
                  }
                  // 4. Priority: Known decent vendor defaults (Daniel, Samantha, Zira, Hazel)
                  if (name.includes('samantha') || name.includes('daniel') || name.includes('zira') || name.includes('hazel')) {
                    return 40;
                  }
                  // Penalty: Low quality robotic desktop fallback voices (e.g. David Desktop)
                  if (name.includes('david') || name.includes('desktop') || name.includes('robotic') || name.includes('synthesizer')) {
                    return -20;
                  }
                  return 0;
                };

                return getVoiceScore(bName) - getVoiceScore(aName);
              });

              utterance.voice = sortedVoices[0] || null;
            }

            utterance.onstart = () => setIsSpeaking(true);
            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);

            window.speechSynthesis.speak(utterance);
          } catch (err) {
            console.warn('[useTextToSpeech - Async Inner] Failed to speak:', err);
            setIsSpeaking(false);
          }
        }, 50);
      } catch (err) {
        console.warn('[useTextToSpeech] Failed to initialize speak execution:', err);
        setIsSpeaking(false);
      }
    };

    if (delay > 0) {
      speechTimeoutRef.current = setTimeout(runSpeech, delay);
    } else {
      runSpeech();
    }
  }, [supported, enabled, voices, i18n.language, cancel]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  return {
    supported,
    isSpeaking,
    speak,
    cancel,
    voices,
  };
};

export default useTextToSpeech;
