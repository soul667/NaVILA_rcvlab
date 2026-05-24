import { useState, useEffect, useCallback } from 'react';
import type { HealthData, StateData, HistoryItem, SessionsResponse } from './types';
import { fetchHealth, fetchState, fetchHistory, fetchSessions } from './api';

export function usePolling(intervalMs = 3000) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [state, setState] = useState<StateData | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, s, hist, sess] = await Promise.all([
        fetchHealth(),
        fetchState(),
        fetchHistory(),
        fetchSessions(),
      ]);
      setHealth(h);
      setState(s);
      setHistory(hist);
      setSessions(sess);
    } catch (e) {
      console.error('Poll error:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { health, state, history, sessions, refresh };
}
