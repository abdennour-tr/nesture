/**
 * useSessionData.js
 * Shared data-fetching hooks for dashboards.
 * All API calls replaced with direct localDB calls — no HTTP requests.
 */
import { useState, useEffect, useCallback } from 'react';
import * as localDB from '../services/localDB.js';
import { analyseSession } from '../services/aiEngine.js';

/**
 * Generic async hook with loading/error state.
 * fetchFn must return a Promise.
 */
export function useFetch(fetchFn, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { execute(); }, [execute]);

  return { data, loading, error, refetch: execute };
}

/**
 * Load all data for a learner's dashboard.
 */
export function useLearnerDashboard(learnerId, limit = 10) {
  const [sessions,  setSessions]  = useState([]);
  const [reflexes,  setReflexes]  = useState([]);
  const [analysis,  setAnalysis]  = useState(null);
  const [exercises, setExercises] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetch = useCallback(async () => {
    if (!learnerId) return;
    setLoading(true);
    setError(null);
    try {
      const [sessionList, reflexList, exerciseList] = await Promise.all([
        localDB.getSessions(learnerId, limit),
        localDB.getReflexSummary(learnerId),
        localDB.getExercises(),
      ]);
      setSessions(sessionList);
      setReflexes(reflexList);
      setExercises(exerciseList);

      if (sessionList.length > 0) {
        const latestSession = sessionList[0];
        const sessionAnalysis = analyseSession(latestSession, []);
        setAnalysis({
          session_id: latestSession.id,
          ...sessionAnalysis,
        });
      }
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [learnerId, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  // Derived chart data (same shape the existing charts expect)
  const chartData = [...sessions].reverse().map((s, i) => ({
    session:      `S${i + 1}`,
    date:         (s.start_time || '').slice(0, 10),
    accuracy:     Math.round(parseFloat(s.accuracy_score  || 0) * 100),
    responseTime: parseFloat((parseFloat(s.avg_response_time_ms || 0) / 1000).toFixed(1)),
    lpi:          parseInt(s.lpi_score || 0),
    smoothness:   Math.round(parseFloat(s.trajectory_smoothness || 0) * 100),
  }));

  const latestSession = sessions[0] || null;
  const prevSession   = sessions[1] || null;

  const latestAcc = latestSession ? Math.round(parseFloat(latestSession.accuracy_score || 0) * 100) : null;
  const prevAcc   = prevSession   ? Math.round(parseFloat(prevSession.accuracy_score   || 0) * 100) : null;
  const accDelta  = (latestAcc !== null && prevAcc !== null) ? latestAcc - prevAcc : null;

  return {
    sessions, reflexes, analysis, exercises,
    loading, error, refetch: fetch,
    chartData, latestSession, prevSession,
    latestAcc, prevAcc, accDelta,
  };
}

/**
 * Load all learners with their latest stats (for OT multi-learner view).
 */
export function useAllLearnersStats() {
  const [learners,     setLearners]     = useState([]);
  const [learnerStats, setLearnerStats] = useState({});
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const learnerList = await localDB.getLearners();
      setLearners(learnerList);

      const stats = {};
      await Promise.all(learnerList.map(async (l) => {
        try {
          const [sessionList, reflexList] = await Promise.all([
            localDB.getSessions(l.id, 1),
            localDB.getReflexSummary(l.id),
          ]);
          const latest = sessionList[0] || null;
          const highFlags = reflexList.filter(
            r => r.confidence_level === 'High' && parseInt(r.score) < 40
          );
          stats[l.id] = {
            latestSession:  latest,
            reflexes:       reflexList,
            needsAttention: highFlags.length > 0,
            highFlags,
            accuracy: latest ? Math.round(parseFloat(latest.accuracy_score || 0) * 100) : null,
            lpi:      latest ? parseInt(latest.lpi_score || 0) : null,
          };
        } catch {
          stats[l.id] = { latestSession: null, reflexes: [], needsAttention: false, highFlags: [] };
        }
      }));
      setLearnerStats(stats);
    } catch (err) {
      setError(err?.message || 'Failed to load learners');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const attentionCount = Object.values(learnerStats).filter(s => s.needsAttention).length;

  return { learners, learnerStats, loading, error, refetch: fetch, attentionCount };
}
