import { useState } from 'react';
import {
  Layout, Card, Row, Col, Statistic, Input, Button, Space, Tag, Tabs,
  List, Image, Typography, Badge, Modal, Empty,
} from 'antd';
import {
  ThunderboltOutlined, ClockCircleOutlined, PlayCircleOutlined,
  PauseCircleOutlined, SendOutlined, DesktopOutlined, DatabaseOutlined,
  FullscreenOutlined,
} from '@ant-design/icons';
import { usePolling } from './hooks';
import { setInstruction, pause, resume, fetchSessionDetail } from './api';
import type { HistoryItem, SessionSummary } from './types';
import FullscreenView from './FullscreenView';

const { Header, Content } = Layout;
const { Text } = Typography;

function ActionTag({ item }: { item: HistoryItem }) {
  const r = item.result;
  const map: Record<string, { color: string; label: string }> = {
    move_forward: { color: 'green', label: `Forward ${r.distance_cm}cm` },
    turn_left: { color: 'blue', label: `Left ${r.degree}\u00b0` },
    turn_right: { color: 'orange', label: `Right ${r.degree}\u00b0` },
    stop: { color: 'red', label: 'Stop' },
  };
  const m = map[r.action] || { color: 'default', label: r.action };
  return <Tag color={m.color}>{m.label}</Tag>;
}

function FrameStrip({ item }: { item: HistoryItem }) {
  const frames = item.frames_b64 || (item.last_frame_b64 ? [item.last_frame_b64] : []);
  if (frames.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, overflowX: 'auto', direction: 'rtl', maxWidth: 500 }}>
      {frames.map((f, i) => (
        <div key={i} style={{ direction: 'ltr', flexShrink: 0 }}>
          <Image
            src={`data:image/jpeg;base64,${f}`}
            width={80}
            height={60}
            style={{ objectFit: 'cover', borderRadius: 4 }}
            preview={{ mask: null }}
          />
        </div>
      ))}
    </div>
  );
}

function HistoryItemRow({ item }: { item: HistoryItem }) {
  const time = new Date(item.timestamp * 1000).toLocaleTimeString();
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 0' }}>
      <FrameStrip item={item} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={8}>
          <ActionTag item={item} />
          <Text type="secondary" style={{ fontSize: 12 }}>{time}</Text>
        </Space>
        <div><Text type="secondary" style={{ fontSize: 13 }}>{item.instruction}</Text></div>
        <div><Text italic style={{ fontSize: 12, color: '#666' }}>{item.result.raw_output}</Text></div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#22d3ee' }}>{item.result.latency_ms.toFixed(0)}ms</div>
        <Text type="secondary" style={{ fontSize: 11 }}>{item.num_frames} frames</Text>
      </div>
    </div>
  );
}

function SessionList({ sessions, onSelect }: { sessions: SessionSummary[]; onSelect: (id: number) => void }) {
  return (
    <List
      dataSource={sessions}
      renderItem={(s) => {
        const start = new Date(s.start_time * 1000);
        const duration = Math.round(s.end_time - s.start_time);
        return (
          <List.Item
            onClick={() => onSelect(s.id)}
            style={{ cursor: 'pointer', padding: '12px 16px', borderRadius: 8, marginBottom: 8, background: 'rgba(255,255,255,0.02)' }}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Text strong>{s.instruction}</Text>
                  <Tag>{s.count} inferences</Tag>
                </Space>
              }
              description={`${start.toLocaleDateString()} ${start.toLocaleTimeString()} \u2022 ${duration}s duration`}
            />
          </List.Item>
        );
      }}
    />
  );
}

export default function App() {
  const { health, state, history, sessions, refresh } = usePolling(3000);
  const [inputVal, setInputVal] = useState('');
  const [sessionDetail, setSessionDetail] = useState<HistoryItem[] | null>(null);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const handleSetInstruction = async () => {
    if (!inputVal.trim()) return;
    await setInstruction(inputVal.trim());
    setInputVal('');
    refresh();
  };

  const handleTogglePause = async () => {
    if (state?.paused) await resume();
    else await pause();
    refresh();
  };

  const handleSessionClick = async (id: number) => {
    const data = await fetchSessionDetail(id);
    setSessionDetail(data.items);
    setSessionModalOpen(true);
  };

  const avgLatency = history.length > 0
    ? Math.round(history.reduce((s, h) => s + h.result.latency_ms, 0) / history.length)
    : 0;

  return (
    <Layout style={{ minHeight: '100vh', background: '#141414' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1f1f1f', borderBottom: '1px solid #303030', padding: '0 32px' }}>
        <Space>
          <span style={{ fontSize: 24 }}>&#x1F916;</span>
          <Text strong style={{ fontSize: 18, color: '#fff' }}>NaVILA Inference Server</Text>
        </Space>
        <Space size={16}>
          <Button type="text" icon={<FullscreenOutlined />} onClick={() => setFullscreen(true)} style={{ color: '#fff' }}>Live View</Button>
          <Badge
            status={state?.paused ? 'warning' : health?.model_loaded ? 'success' : 'error'}
            text={<Text style={{ color: '#fff' }}>{state?.paused ? 'Paused' : health?.model_loaded ? 'Online' : 'Loading...'}</Text>}
          />
        </Space>
      </Header>

      <Content style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12} md={6}>
            <Card size="small"><Statistic title={<><DesktopOutlined /> GPU</>} value={health?.gpu_name || '-'} valueStyle={{ fontSize: 14 }} /></Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small"><Statistic title={<><DatabaseOutlined /> VRAM</>} value={health ? `${health.gpu_memory_used_gb} / ${health.gpu_memory_total_gb}` : '-'} suffix="GB" valueStyle={{ fontSize: 14 }} /></Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small"><Statistic title={<><ThunderboltOutlined /> Inferences</>} value={sessions?.total ? history.length : 0} /></Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small"><Statistic title={<><ClockCircleOutlined /> Avg Latency</>} value={avgLatency || '-'} suffix={avgLatency ? 'ms' : ''} /></Card>
          </Col>
        </Row>

        <Card size="small" style={{ marginBottom: 16 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="Enter navigation instruction..."
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onPressEnter={handleSetInstruction}
              style={{ flex: 1 }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={handleSetInstruction}>Set</Button>
          </Space.Compact>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">Current: </Text>
            <Text strong style={{ color: '#22d3ee' }}>{state?.instruction || '-'}</Text>
            <Button
              type={state?.paused ? 'default' : 'text'}
              danger={!state?.paused}
              icon={state?.paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              onClick={handleTogglePause}
              style={{ marginLeft: 16 }}
            >
              {state?.paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
        </Card>

        <Tabs
          defaultActiveKey="recent"
          items={[
            {
              key: 'recent',
              label: 'Recent 50',
              children: history.length === 0 ? (
                <Empty description="Waiting for robot to connect..." />
              ) : (
                <List
                  dataSource={[...history].reverse()}
                  renderItem={(item) => <HistoryItemRow item={item} />}
                  split
                />
              ),
            },
            {
              key: 'all',
              label: `All Sessions (${sessions?.total || 0})`,
              children: !sessions || sessions.sessions.length === 0 ? (
                <Empty description="No sessions yet" />
              ) : (
                <SessionList sessions={sessions.sessions} onSelect={handleSessionClick} />
              ),
            },
          ]}
        />

        <Modal
          title="Session Detail"
          open={sessionModalOpen}
          onCancel={() => setSessionModalOpen(false)}
          footer={null}
          width={900}
        >
          {sessionDetail && (
            <List
              dataSource={sessionDetail}
              renderItem={(item) => <HistoryItemRow item={item} />}
              split
            />
          )}
        </Modal>
      </Content>

      <FullscreenView
        visible={fullscreen}
        onClose={() => setFullscreen(false)}
        item={history.length > 0 ? history[history.length - 1] : null}
        state={state}
        health={health}
      />
    </Layout>
  );
}
