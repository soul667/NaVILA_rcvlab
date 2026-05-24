import type { HealthData, StateData, HistoryItem, SessionsResponse, SessionDetailResponse } from './types';

const BASE = '';

export async function fetchHealth(): Promise<HealthData> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export async function fetchState(): Promise<StateData> {
  const res = await fetch(`${BASE}/state`);
  return res.json();
}

export async function fetchHistory(): Promise<HistoryItem[]> {
  const res = await fetch(`${BASE}/history`);
  return res.json();
}

export async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch(`${BASE}/history_all`);
  return res.json();
}

export async function fetchSessionDetail(id: number): Promise<SessionDetailResponse> {
  const res = await fetch(`${BASE}/history_all?session_id=${id}`);
  return res.json();
}

export async function setInstruction(instruction: string): Promise<void> {
  await fetch(`${BASE}/set_instruction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
}

export async function pause(): Promise<void> {
  await fetch(`${BASE}/pause`, { method: 'POST' });
}

export async function resume(): Promise<void> {
  await fetch(`${BASE}/resume`, { method: 'POST' });
}
