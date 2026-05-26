import { useState, useRef, useCallback, useEffect } from "react";
import { Card, Button, Space, Slider, Row, Col, Tag, InputNumber, message } from "antd";
import { UpOutlined, DownOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";

interface Props {
  connected: boolean;
  sendCommand: (title: string, data?: Record<string, unknown>) => void;
}

async function robotCommand(title: string, data: Record<string, unknown> = {}) {
  const resp = await fetch("/api/robot/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, data }),
  });
  return resp.json();
}

export function HeadControl({ connected, sendCommand }: Props) {
  const [pitch, setPitch] = useState(0); // degrees, positive=up, negative=down
  const [yaw, setYaw] = useState(0); // degrees, positive=left, negative=right
  const [step, setStep] = useState(10); // degrees per click
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 15));
  };

  const sendHeadPosition = useCallback(async (newPitch: number, newYaw: number) => {
    setSending(true);
    try {
      const result = await robotCommand("request_set_head_position", {
        pitch: newPitch,
        yaw: newYaw,
      });
      if (result.success) {
        addLog(`头部移动: pitch=${newPitch}° yaw=${newYaw}°`);
      } else {
        addLog(`失败: ${result.error || "unknown"}`);
        message.error(`头部控制失败: ${result.error || "unknown"}`);
      }
    } catch (e: any) {
      addLog(`错误: ${e.message}`);
      message.error(`头部控制错误: ${e.message}`);
    } finally {
      setSending(false);
    }
  }, []);

  const handleUp = () => {
    const newPitch = Math.min(30, pitch + step);
    setPitch(newPitch);
    sendHeadPosition(newPitch, yaw);
  };

  const handleDown = () => {
    const newPitch = Math.max(-30, pitch - step);
    setPitch(newPitch);
    sendHeadPosition(newPitch, yaw);
  };

  const handleLeft = () => {
    const newYaw = Math.min(45, yaw + step);
    setYaw(newYaw);
    sendHeadPosition(pitch, newYaw);
  };

  const handleRight = () => {
    const newYaw = Math.max(-45, yaw - step);
    setYaw(newYaw);
    sendHeadPosition(pitch, newYaw);
  };

  const handleReset = () => {
    setPitch(0);
    setYaw(0);
    sendHeadPosition(0, 0);
  };

  return (
    <Card
      size="small"
      title="头部控制"
      extra={
        <Space>
          <Tag color={sending ? "processing" : "default"}>
            pitch: {pitch}° | yaw: {yaw}°
          </Tag>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        {/* Direction buttons */}
        <Row gutter={8} justify="center" align="middle">
          <Col span={24} style={{ textAlign: "center", marginBottom: 8 }}>
            <Button
              type="primary"
              icon={<UpOutlined />}
              disabled={!connected || sending || pitch >= 30}
              onClick={handleUp}
              style={{ width: 64 }}
            >
              抬头
            </Button>
          </Col>
        </Row>
        <Row gutter={8} justify="center" align="middle">
          <Col style={{ textAlign: "right" }}>
            <Button
              icon={<UpOutlined style={{ transform: "rotate(-90deg)" }} />}
              disabled={!connected || sending || yaw >= 45}
              onClick={handleLeft}
              style={{ width: 64 }}
            >
              左转
            </Button>
          </Col>
          <Col>
            <Button
              icon={<ReloadOutlined />}
              disabled={!connected || sending}
              onClick={handleReset}
              style={{ width: 64 }}
            >
              归零
            </Button>
          </Col>
          <Col>
            <Button
              icon={<UpOutlined style={{ transform: "rotate(90deg)" }} />}
              disabled={!connected || sending || yaw <= -45}
              onClick={handleRight}
              style={{ width: 64 }}
            >
              右转
            </Button>
          </Col>
        </Row>
        <Row gutter={8} justify="center" align="middle">
          <Col span={24} style={{ textAlign: "center", marginTop: 8 }}>
            <Button
              type="primary"
              icon={<DownOutlined />}
              disabled={!connected || sending || pitch <= -30}
              onClick={handleDown}
              style={{ width: 64 }}
            >
              低头
            </Button>
          </Col>
        </Row>

        {/* Step size control */}
        <Row gutter={16} align="middle" style={{ marginTop: 16 }}>
          <Col span={6}><span style={{ fontSize: 12 }}>步进角度</span></Col>
          <Col span={12}>
            <Slider
              min={5}
              max={30}
              step={5}
              value={step}
              onChange={setStep}
              marks={{ 5: "5°", 10: "10°", 15: "15°", 30: "30°" }}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={1}
              max={45}
              value={step}
              onChange={(v) => setStep(v ?? 10)}
              style={{ width: "100%" }}
              addonAfter="°"
            />
          </Col>
        </Row>

        {/* Direct angle input */}
        <Row gutter={16} align="middle">
          <Col span={12}>
            <Space>
              <span style={{ fontSize: 12 }}>Pitch:</span>
              <InputNumber
                size="small"
                min={-30}
                max={30}
                value={pitch}
                onChange={(v) => {
                  const val = v ?? 0;
                  setPitch(val);
                  sendHeadPosition(val, yaw);
                }}
                style={{ width: 70 }}
                addonAfter="°"
              />
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <span style={{ fontSize: 12 }}>Yaw:</span>
              <InputNumber
                size="small"
                min={-45}
                max={45}
                value={yaw}
                onChange={(v) => {
                  const val = v ?? 0;
                  setYaw(val);
                  sendHeadPosition(pitch, val);
                }}
                style={{ width: 70 }}
                addonAfter="°"
              />
            </Space>
          </Col>
        </Row>

        {/* Log */}
        <div style={{ background: "#1a1a1a", borderRadius: 4, padding: 8, maxHeight: 100, overflow: "auto", fontSize: 11, fontFamily: "monospace" }}>
          {log.length === 0 ? (
            <span style={{ color: "#666" }}>头部控制日志</span>
          ) : (
            log.map((l, i) => <div key={i} style={{ color: i === 0 ? "#52c41a" : "#aaa" }}>{l}</div>)
          )}
        </div>

        <div style={{ fontSize: 11, color: "#666" }}>
          Pitch: -30°(低头) ~ +30°(抬头) | Yaw: -45°(右转) ~ +45°(左转)
          <br />
          通过 request_set_head_position 发送到机器人
        </div>
      </Space>
    </Card>
  );
}
