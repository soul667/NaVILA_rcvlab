import { useState, useRef } from "react";
import { Card, Button, Space, InputNumber, Row, Col, message, Tag, Divider, Slider } from "antd";
import { RotateLeftOutlined, RotateRightOutlined, ArrowUpOutlined, StopOutlined } from "@ant-design/icons";

export function ManualTest() {
  const [speedRatio, setSpeedRatio] = useState(0.3);
  const [duration, setDuration] = useState(1.0);
  const [executing, setExecuting] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const addLog = (msg: string) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20));
  };

  const executeAction = async (label: string, x: number, yaw: number, dur: number) => {
    if (executing) return;
    setExecuting(label);
    addLog(`开始: ${label} | x=${x.toFixed(2)} yaw=${yaw.toFixed(2)} 持续${dur.toFixed(2)}s`);

    const startTime = Date.now();
    let sendCount = 0;

    intervalRef.current = setInterval(async () => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed >= dur) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
        // Send stop
        await fetch("/api/robot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "request_set_walk_vel_sync", data: { x: 0, y: 0, yaw: 0 } }),
        });
        addLog(`完成: ${label} | 实际${elapsed.toFixed(2)}s | 发送${sendCount}次`);
        setExecuting(null);
      } else {
        await fetch("/api/robot/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "request_set_walk_vel_sync", data: { x, y: 0, yaw } }),
        });
        sendCount++;
      }
    }, 33); // ~30Hz
  };

  const stop = async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
    try {
      await fetch("/api/robot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "request_set_walk_vel_sync", data: { x: 0, y: 0, yaw: 0 } }),
      });
    } catch {}
    addLog("急停");
    setExecuting(null);
  };

  return (
    <Card size="small" title="手动运动测试" extra={<Tag color={executing ? "processing" : "default"}>{executing || "空闲"}</Tag>}>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">

        {/* 参数调节 */}
        <Card size="small" type="inner" title="参数">
          <Row gutter={16} align="middle">
            <Col span={4}><span style={{ fontSize: 12 }}>速度比值</span></Col>
            <Col span={14}>
              <Slider min={0.05} max={1.0} step={0.05} value={speedRatio} onChange={setSpeedRatio} marks={{ 0.1: "0.1", 0.3: "0.3", 0.5: "0.5", 0.8: "0.8" }} />
            </Col>
            <Col span={6}>
              <InputNumber size="small" min={0.05} max={1.0} step={0.05} value={speedRatio} onChange={(v) => setSpeedRatio(v ?? 0.3)} style={{ width: "100%" }} />
            </Col>
          </Row>
          <Row gutter={16} align="middle" style={{ marginTop: 8 }}>
            <Col span={4}><span style={{ fontSize: 12 }}>执行时间(s)</span></Col>
            <Col span={14}>
              <Slider min={0.1} max={5.0} step={0.1} value={duration} onChange={setDuration} marks={{ 0.5: "0.5", 1: "1", 2: "2", 3: "3", 5: "5" }} />
            </Col>
            <Col span={6}>
              <InputNumber size="small" min={0.1} max={10.0} step={0.1} value={duration} onChange={(v) => setDuration(v ?? 1.0)} style={{ width: "100%" }} />
            </Col>
          </Row>
        </Card>

        {/* 执行按钮 */}
        <Row gutter={8}>
          <Col span={6}>
            <Button block type="primary" icon={<ArrowUpOutlined />} disabled={!!executing} onClick={() => executeAction(`前进 x=${speedRatio} ${duration}s`, speedRatio, 0, duration)}>
              前进
            </Button>
          </Col>
          <Col span={6}>
            <Button block icon={<RotateLeftOutlined />} disabled={!!executing} onClick={() => executeAction(`左转 yaw=${speedRatio} ${duration}s`, 0, speedRatio, duration)}>
              左转
            </Button>
          </Col>
          <Col span={6}>
            <Button block icon={<RotateRightOutlined />} disabled={!!executing} onClick={() => executeAction(`右转 yaw=-${speedRatio} ${duration}s`, 0, -speedRatio, duration)}>
              右转
            </Button>
          </Col>
          <Col span={6}>
            <Button block danger icon={<StopOutlined />} onClick={stop}>
              急停
            </Button>
          </Col>
        </Row>

        {/* 快捷测试 */}
        <Divider style={{ margin: "4px 0" }}>快捷测试（使用当前速度比值）</Divider>
        <Space wrap>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进0.5s`, speedRatio, 0, 0.5)}>前进0.5s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进1s`, speedRatio, 0, 1.0)}>前进1s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进2s`, speedRatio, 0, 2.0)}>前进2s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转0.5s`, 0, speedRatio, 0.5)}>左转0.5s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转1s`, 0, speedRatio, 1.0)}>左转1s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转2s`, 0, speedRatio, 2.0)}>左转2s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转0.5s`, 0, -speedRatio, 0.5)}>右转0.5s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转1s`, 0, -speedRatio, 1.0)}>右转1s</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转2s`, 0, -speedRatio, 2.0)}>右转2s</Button>
        </Space>

        <Divider style={{ margin: "4px 0" }}>校准测试（ratio=0.9, 36°/s）</Divider>
        <Space wrap>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转15° (0.42s)`, 0, 0.9, 15/36)}>左转15°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转30° (0.83s)`, 0, 0.9, 30/36)}>左转30°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转45° (1.25s)`, 0, 0.9, 45/36)}>左转45°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转90° (2.5s)`, 0, 0.9, 90/36)}>左转90°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转15° (0.42s)`, 0, -0.9, 15/36)}>右转15°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转30° (0.83s)`, 0, -0.9, 30/36)}>右转30°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转45° (1.25s)`, 0, -0.9, 45/36)}>右转45°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`右转90° (2.5s)`, 0, -0.9, 90/36)}>右转90°</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`左转360° (10s)`, 0, 0.9, 10)}>左转360°</Button>
        </Space>

        <Divider style={{ margin: "4px 0" }}>前进校准（ratio=0.3, ~0.2m/s）</Divider>
        <Space wrap>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进10cm (0.5s)`, 0.3, 0, 0.5)}>前进10cm</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进25cm (1.25s)`, 0.3, 0, 1.25)}>前进25cm</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进50cm (2.5s)`, 0.3, 0, 2.5)}>前进50cm</Button>
          <Button size="small" disabled={!!executing} onClick={() => executeAction(`前进1m (5s)`, 0.3, 0, 5.0)}>前进1m</Button>
        </Space>

        {/* 日志 */}
        <div style={{ background: "#1a1a1a", borderRadius: 4, padding: 8, maxHeight: 150, overflow: "auto", fontSize: 11, fontFamily: "monospace" }}>
          {log.length === 0 ? (
            <span style={{ color: "#666" }}>点击按钮开始测试，记录会显示在这里</span>
          ) : (
            log.map((l, i) => <div key={i} style={{ color: i === 0 ? "#52c41a" : "#aaa" }}>{l}</div>)
          )}
        </div>

        <div style={{ fontSize: 11, color: "#666" }}>
          测试方法: 调整速度比值和时间，点击按钮观察机器人运动。记录实际转了多少度/走了多远，用来校准参数。
        </div>
      </Space>
    </Card>
  );
}
