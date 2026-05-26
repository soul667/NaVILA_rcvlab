import { useEffect, useState } from "react";
import { Card, Slider, InputNumber, Row, Col, Button, Space, message, Descriptions } from "antd";
import { SaveOutlined, ReloadOutlined } from "@ant-design/icons";

interface MotionParams {
  forward_speed_ratio: number;
  turn_speed_ratio: number;
  forward_speed_ms: number;
  turn_speed_degs: number;
  stop_duration: number;
  stabilize_duration: number;
}

const DEFAULT_PARAMS: MotionParams = {
  forward_speed_ratio: 0.3,
  turn_speed_ratio: 0.3,
  forward_speed_ms: 0.2,
  turn_speed_degs: 30.0,
  stop_duration: 0.5,
  stabilize_duration: 1.0,
};

export function MotionParamsPanel() {
  const [params, setParams] = useState<MotionParams>(DEFAULT_PARAMS);
  const [saved, setSaved] = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("oli_motion_params");
    if (stored) {
      try {
        setParams(JSON.parse(stored));
      } catch {}
    }
  }, []);

  const updateParam = (key: keyof MotionParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const saveParams = async () => {
    // Save to localStorage
    localStorage.setItem("oli_motion_params", JSON.stringify(params));

    // Write to server (update yaml via API)
    try {
      const resp = await fetch("/api/motion-params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await resp.json();
      if (data.success) {
        message.success("参数已保存，重启容器后生效");
      } else {
        // API might not exist yet, just save locally
        message.success("参数已保存到本地");
      }
    } catch {
      message.success("参数已保存到本地");
    }
    setSaved(true);
  };

  const resetParams = () => {
    setParams(DEFAULT_PARAMS);
    setSaved(false);
  };

  // Calculate example execution times
  const exampleForwardTime = (25 / 100) / params.forward_speed_ms; // 25cm
  const exampleTurnTime = 30 / params.turn_speed_degs; // 30 degrees

  return (
    <Card
      size="small"
      title="运动参数调节"
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={resetParams}>
            重置
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            onClick={saveParams}
            disabled={saved}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        {/* Speed Ratios */}
        <Row gutter={16} align="middle">
          <Col span={8}>
            <span style={{ fontSize: 12 }}>前进速度比值</span>
          </Col>
          <Col span={10}>
            <Slider
              min={0.05}
              max={0.8}
              step={0.05}
              value={params.forward_speed_ratio}
              onChange={(v) => updateParam("forward_speed_ratio", v)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={0.05}
              max={0.8}
              step={0.05}
              value={params.forward_speed_ratio}
              onChange={(v) => updateParam("forward_speed_ratio", v ?? 0.3)}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>

        <Row gutter={16} align="middle">
          <Col span={8}>
            <span style={{ fontSize: 12 }}>转弯速度比值</span>
          </Col>
          <Col span={10}>
            <Slider
              min={0.05}
              max={0.8}
              step={0.05}
              value={params.turn_speed_ratio}
              onChange={(v) => updateParam("turn_speed_ratio", v)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={0.05}
              max={0.8}
              step={0.05}
              value={params.turn_speed_ratio}
              onChange={(v) => updateParam("turn_speed_ratio", v ?? 0.3)}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>

        {/* Real-world speed estimates */}
        <Row gutter={16} align="middle">
          <Col span={8}>
            <span style={{ fontSize: 12 }}>实际前进速度 (m/s)</span>
          </Col>
          <Col span={10}>
            <Slider
              min={0.05}
              max={1.0}
              step={0.05}
              value={params.forward_speed_ms}
              onChange={(v) => updateParam("forward_speed_ms", v)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={0.05}
              max={1.0}
              step={0.05}
              value={params.forward_speed_ms}
              onChange={(v) => updateParam("forward_speed_ms", v ?? 0.2)}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>

        <Row gutter={16} align="middle">
          <Col span={8}>
            <span style={{ fontSize: 12 }}>实际转弯速度 (°/s)</span>
          </Col>
          <Col span={10}>
            <Slider
              min={5}
              max={90}
              step={5}
              value={params.turn_speed_degs}
              onChange={(v) => updateParam("turn_speed_degs", v)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={5}
              max={90}
              step={5}
              value={params.turn_speed_degs}
              onChange={(v) => updateParam("turn_speed_degs", v ?? 30)}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>

        {/* Timing */}
        <Row gutter={16} align="middle">
          <Col span={8}>
            <span style={{ fontSize: 12 }}>停止时间 (s)</span>
          </Col>
          <Col span={10}>
            <Slider
              min={0.01}
              max={2.0}
              step={0.01}
              value={params.stop_duration}
              onChange={(v) => updateParam("stop_duration", v)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={0.01}
              max={2.0}
              step={0.01}
              value={params.stop_duration}
              onChange={(v) => updateParam("stop_duration", v ?? 0.01)}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>

        <Row gutter={16} align="middle">
          <Col span={8}>
            <span style={{ fontSize: 12 }}>稳定等待 (s)</span>
          </Col>
          <Col span={10}>
            <Slider
              min={0.01}
              max={5.0}
              step={0.01}
              value={params.stabilize_duration}
              onChange={(v) => updateParam("stabilize_duration", v)}
            />
          </Col>
          <Col span={6}>
            <InputNumber
              size="small"
              min={0.01}
              max={5.0}
              step={0.01}
              value={params.stabilize_duration}
              onChange={(v) => updateParam("stabilize_duration", v ?? 0.01)}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>

        {/* Preview */}
        <Descriptions size="small" column={1} title="执行预估" bordered>
          <Descriptions.Item label="前进25cm">
            以 ratio={params.forward_speed_ratio} 执行 {exampleForwardTime.toFixed(2)}s
          </Descriptions.Item>
          <Descriptions.Item label="转弯30°">
            以 ratio={params.turn_speed_ratio} 执行 {exampleTurnTime.toFixed(2)}s
          </Descriptions.Item>
          <Descriptions.Item label="单步总耗时">
            推理~1s + 执行 + 停止{params.stop_duration}s + 等待{params.stabilize_duration}s
          </Descriptions.Item>
        </Descriptions>
      </Space>
    </Card>
  );
}
