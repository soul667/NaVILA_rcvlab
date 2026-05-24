import { useState, useEffect, useCallback } from 'react';
import { Tag, Typography, Space, Button, Select } from 'antd';
import {
  CompressOutlined, PauseCircleOutlined, PlayCircleOutlined,
  LeftOutlined, RightOutlined, HomeOutlined,
} from '@ant-design/icons';
import type { HistoryItem, StateData, HealthData, SessionSummary } from './types';
import { fetchHealth, fetchState, fetchHistory, fetchSessions, fetchSessionDetail } from './api';

const { Text } = Typography;

interface Props {
  standalone?: boolean;
  visible?: boolean;
  onClose?: () => void;
  item?: HistoryItem | null;
  state?: StateData | null;
  health?: HealthData | null;
}

export default function FullscreenView({ standalone, visible, onClose, item: propItem, state: propState, health: propHealth }: Props) {
  const [health, setHealth] = useState<HealthData | null>(propHealth || null);
  const [state, setState] = useState<StateData | null>(propState || null);
  const [latestItem, setLatestItem] = useState<HistoryItem | null>(propItem || null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [replayItems, setReplayItems] = useState<HistoryItem[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [h, s, hist, sess] = await Promise.all([
        fetchHealth(), fetchState(), fetchHistory(), fetchSessions(),
      ]);
      setHealth(h);
      setState(s);
      if (hist.length > 0) setLatestItem(hist[hist.length - 1]);
      setSessions(sess.sessions);
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!standalone && !visible) return;
    if (mode !== 'live') return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [standalone, visible, mode, refresh]);

  useEffect(() => {
    if (!standalone) {
      setHealth(propHealth || null);
      setState(propState || null);
      setLatestItem(propItem || null);
    }
  }, [standalone, propHealth, propState, propItem]);

  if (!standalone && !visible) return null;

  const currentItem = mode === 'replay' ? replayItems[replayIndex] : latestItem;
  const frames = currentItem?.frames_b64 || (currentItem?.last_frame_b64 ? [currentItem.last_frame_b64] : []);
  const r = currentItem?.result;

  const actionColorMap: Record<string, string> = {
    move_forward: '#4ade80', turn_left: '#60a5fa', turn_right: '#fb923c', stop: '#f87171',
  };
  const getActionLabel = () => {
    if (!r) return '';
    switch (r.action) {
      case 'move_forward': return `Forward ${r.distance_cm}cm`;
      case 'turn_left': return `Left ${r.degree}\u00b0`;
      case 'turn_right': return `Right ${r.degree}\u00b0`;
      case 'stop': return 'Stop';
      default: return r.action;
    }
  };

  const handleSessionSelect = async (sessionId: number) => {
    const data = await fetchSessionDetail(sessionId);
    setReplayItems(data.items);
    setReplayIndex(0);
    setMode('replay');
  };

  const handleBackToLive = () => {
    setMode('live');
    setReplayItems([]);
    setReplayIndex(0);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001, background: 'linear-gradient(rgba(0,0,0,0.8), transparent)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          {mode === 'replay' && (
            <Button size="small" icon={<HomeOutlined />} onClick={handleBackToLive} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }}>Back to Live</Button>
          )}
          <Tag color={mode === 'live' ? 'green' : 'blue'}>{mode === 'live' ? '\u25cf LIVE' : '\u25b6 REPLAY'}</Tag>
          <Select
            placeholder="View session..."
            size="small"
            style={{ width: 260 }}
            options={sessions.map(s => ({ value: s.id, label: `${s.instruction.slice(0, 30)} (${s.count} inferences)` }))}
            onSelect={handleSessionSelect}
            allowClear
            onClear={handleBackToLive}
          />
        </Space>
        {onClose && (
          <Button size="small" icon={<CompressOutlined />} onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }}>Exit</Button>
        )}
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 2, padding: 2 }}>
        {frames.length > 0 ? frames.map((f, i) => (
          <div key={i} style={{ position: 'relative', overflow: 'hidden' }}>
            <img src={`data:image/jpeg;base64,${f}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <span style={{ position: 'absolute', bottom: 4, left: 6, background: 'rgba(0,0,0,0.6)', color: '#aaa', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{i + 1}/{frames.length}</span>
          </div>
        )) : (
          <div style={{ gridColumn: '1/-1', gridRow: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Text type="secondary" style={{ fontSize: 18 }}>No frames yet</Text>
          </div>
        )}
      </div>

      {mode === 'replay' && replayItems.length > 0 && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 10001, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.7)', padding: '8px 16px', borderRadius: 8 }}>
          <Button icon={<LeftOutlined />} disabled={replayIndex <= 0} onClick={() => setReplayIndex(i => i - 1)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }} />
          <Text style={{ color: '#fff', fontSize: 14 }}>{replayIndex + 1} / {replayItems.length}</Text>
          <Button icon={<RightOutlined />} disabled={replayIndex >= replayItems.length - 1} onClick={() => setReplayIndex(i => i + 1)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }} />
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', padding: '40px 24px 20px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ marginBottom: 8 }}><Text style={{ color: '#888', fontSize: 12 }}>INSTRUCTION</Text></div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{currentItem?.instruction || state?.instruction || '-'}</div>
          {r && (
            <Space size={12}>
              <Tag color={actionColorMap[r.action] || 'default'} style={{ fontSize: 14, padding: '4px 12px' }}>{getActionLabel()}</Tag>
              <Text style={{ color: '#aaa', fontSize: 13 }}>{r.raw_output}</Text>
            </Space>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ marginBottom: 4 }}>
            <Space size={16}>
              {health && <Text style={{ color: '#666', fontSize: 12 }}>{health.gpu_name} &bull; {health.gpu_memory_used_gb}/{health.gpu_memory_total_gb} GB</Text>}
              <Tag color={state?.paused ? 'orange' : 'green'}>{state?.paused ? <><PauseCircleOutlined /> Paused</> : <><PlayCircleOutlined /> Running</>}</Tag>
            </Space>
          </div>
          {r && <Text style={{ color: '#22d3ee', fontSize: 24, fontWeight: 700 }}>{r.latency_ms.toFixed(0)}ms</Text>}
          {mode === 'replay' && currentItem && <div><Text style={{ color: '#666', fontSize: 11 }}>{new Date(currentItem.timestamp * 1000).toLocaleString()}</Text></div>}
        </div>
      </div>
    </div>
  );
}
