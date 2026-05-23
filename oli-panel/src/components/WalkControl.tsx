import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Slider, Space, Button, Tag, InputNumber, Row, Col } from "antd";
import { StopOutlined } from "@ant-design/icons";

interface Props {
  connected: boolean;
  sendCommand: (title: string, data?: Record<string, unknown>) => void;
}

export function WalkControl({ connected, sendCommand }: Props) {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [sending, setSending] = useState(false);
  const [rate, setRate] = useState(30); // Hz
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const valuesRef = useRef({ x: 0, y: 0, yaw: 0 });

  // Keep ref in sync
  useEffect(() => {
    valuesRef.current = { x, y, yaw };
  }, [x, y, yaw]);

  const startSending = useCallback(() => {
    if (intervalRef.current) return;
    setSending(true);
    intervalRef.current = setInterval(() => {
      const { x, y, yaw } = valuesRef.current;
      sendCommand("request_set_walk_vel_sync", { x, y, yaw });
    }, 1000 / rate);
  }, [sendCommand, rate]);

  const stopSending = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
    setSending(false);
    // Send stop
    sendCommand("request_set_walk_vel_sync", { x: 0, y: 0, yaw: 0 });
    setX(0);
    setY(0);
    setYaw(0);
  }, [sendCommand]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Keyboard control
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!sending) return;
      const step = 0.1;
      switch (e.key) {
        case "w":
        case "ArrowUp":
          setX((v) => Math.min(1, +(v + step).toFixed(2)));
          break;
        case "s":
        case "ArrowDown":
          setX((v) => Math.max(-1, +(v - step).toFixed(2)));
          break;
        case "a":
        case "ArrowLeft":
          setYaw((v) => Math.min(1, +(v + step).toFixed(2)));
          break;
        case "d":
        case "ArrowRight":
          setYaw((v) => Math.max(-1, +(v - step).toFixed(2)));
          break;
        case "q":
          setY((v) => Math.min(1, +(v + step).toFixed(2)));
          break;
        case "e":
          setY((v) => Math.max(-1, +(v - step).toFixed(2)));
          break;
        case " ":
          e.preventDefault();
          stopSending();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sending, stopSending]);

  return (
    <Card
      size="small"
      title="行走速度控制"
      extra={
        <Space>
          <Tag color={sending ? "processing" : "default"}>
            {sending ? `发送中 ${rate}Hz` : "未发送"}
          </Tag>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          键盘: W/S=前后 A/D=旋转 Q/E=横移 空格=急停
        </div>

        <Row gutter={16}>
          <Col span={8}>
            <div style={{ textAlign: "center", marginBottom: 4 }}>
              <Tag>X 前后: {x.toFixed(2)}</Tag>
            </div>
            <Slider
              vertical
              min={-1}
              max={1}
              step={0.05}
              value={x}
              onChange={setX}
              style={{ height: 120, margin: "0 auto" }}
              tooltip={{ formatter: (v) => `${v?.toFixed(2)}` }}
            />
          </Col>
          <Col span={8}>
            <div style={{ textAlign: "center", marginBottom: 4 }}>
              <Tag>Y 横移: {y.toFixed(2)}</Tag>
            </div>
            <Slider
              vertical
              min={-1}
              max={1}
              step={0.05}
              value={y}
              onChange={setY}
              style={{ height: 120, margin: "0 auto" }}
              tooltip={{ formatter: (v) => `${v?.toFixed(2)}` }}
            />
          </Col>
          <Col span={8}>
            <div style={{ textAlign: "center", marginBottom: 4 }}>
              <Tag>Yaw 旋转: {yaw.toFixed(2)}</Tag>
            </div>
            <Slider
              vertical
              min={-1}
              max={1}
              step={0.05}
              value={yaw}
              onChange={setYaw}
              style={{ height: 120, margin: "0 auto" }}
              tooltip={{ formatter: (v) => `${v?.toFixed(2)}` }}
            />
          </Col>
        </Row>

        <Space style={{ marginTop: 16 }}>
          <Button
            type="primary"
            disabled={!connected || sending}
            onClick={startSending}
          >
            开始发送
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            disabled={!sending}
            onClick={stopSending}
          >
            急停
          </Button>
          <span style={{ fontSize: 12 }}>频率:</span>
          <InputNumber
            size="small"
            min={1}
            max={50}
            value={rate}
            onChange={(v) => setRate(v ?? 30)}
            disabled={sending}
            style={{ width: 60 }}
          />
          <span style={{ fontSize: 12 }}>Hz</span>
        </Space>
      </Space>
    </Card>
  );
}
