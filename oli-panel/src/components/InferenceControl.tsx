import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Button, Space, Input, Tag, message, Statistic, Row, Col, Badge, Alert } from "antd";
import {
  CloudServerOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SendOutlined,
  ReloadOutlined,
  ApiOutlined,
} from "@ant-design/icons";

interface InferenceState {
  instruction: string;
  paused: boolean;
  sap?: {
    current_index: number;
    total: number;
    current_subtask: { id: number; instruction: string; done_condition: string } | null;
    is_complete: boolean;
  } | null;
}

interface HealthInfo {
  status: string;
  model_loaded: boolean;
  model_path: string;
  num_video_frames: number;
  gpu_name: string;
  gpu_memory_used_gb: number;
  gpu_memory_total_gb: number;
}

interface Props {
  serverUrl: string;
}

export function InferenceControl({ serverUrl }: Props) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [state, setState] = useState<InferenceState | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [serverReachable, setServerReachable] = useState(false);
  const [kiroStatus, setKiroStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [kiroLatency, setKiroLatency] = useState<number | null>(null);

  const KIRO_API_URL = "http://10.16.115.153:8990";

  // Use proxy path to avoid CORS issues
  const apiBase = "/inference";

  const fetchHealth = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/health`);
      if (resp.ok) {
        const data = await resp.json();
        setHealth(data);
        setServerReachable(true);
      } else {
        setServerReachable(false);
      }
    } catch {
      setServerReachable(false);
      setHealth(null);
    }
  }, [serverUrl]);

  const instructionInitRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/state`);
      if (resp.ok) {
        const data = await resp.json();
        setState(data);
        // 只在首次加载时同步服务器的 instruction 到输入框
        if (!instructionInitRef.current && data.instruction) {
          setInstruction(data.instruction);
          instructionInitRef.current = true;
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Poll state every 3s
  useEffect(() => {
    fetchHealth();
    fetchState();
    const timer = setInterval(() => {
      fetchState();
    }, 3000);
    const healthTimer = setInterval(fetchHealth, 10000);
    return () => {
      clearInterval(timer);
      clearInterval(healthTimer);
    };
  }, [fetchHealth, fetchState]);

  const setInstructionOnServer = async () => {
    if (!instruction.trim()) {
      message.warning("请输入导航指令");
      return;
    }
    setLoading("instruction");
    try {
      const resp = await fetch(`${apiBase}/set_instruction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });
      if (resp.ok) {
        message.success("指令已设置");
        fetchState();
      } else {
        message.error("设置失败");
      }
    } catch (e: any) {
      message.error(`请求失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const pause = async () => {
    setLoading("pause");
    try {
      await fetch(`${apiBase}/pause`, { method: "POST" });
      message.success("推理已暂停");
      fetchState();
    } catch (e: any) {
      message.error(`暂停失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const resume = async () => {
    setLoading("resume");
    try {
      await fetch(`${apiBase}/resume`, { method: "POST" });
      message.success("推理已恢复");
      fetchState();
    } catch (e: any) {
      message.error(`恢复失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const testKiroApi = async () => {
    setKiroStatus("testing");
    setKiroLatency(null);
    const start = performance.now();
    try {
      const resp = await fetch(`${KIRO_API_URL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "sk-kiro-rs-qazWSXedcRFV123456",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const elapsed = Math.round(performance.now() - start);
      setKiroLatency(elapsed);
      if (resp.ok) {
        setKiroStatus("ok");
        message.success(`Kiro API 正常 (${elapsed}ms)`);
      } else {
        const err = await resp.text();
        setKiroStatus("fail");
        message.error(`Kiro API 返回 ${resp.status}: ${err.slice(0, 100)}`);
      }
    } catch (e: any) {
      setKiroLatency(Math.round(performance.now() - start));
      setKiroStatus("fail");
      message.error(`Kiro API 不可达: ${e.message}`);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {/* Server Status */}
      <Card
        size="small"
        title={
          <Space>
            <CloudServerOutlined />
            推理服务器
          </Space>
        }
        extra={
          <Space>
            <Badge status={serverReachable ? "success" : "error"} text={serverReachable ? "在线" : "离线"} />
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchHealth}>
              刷新
            </Button>
          </Space>
        }
      >
        {health ? (
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="GPU" value={health.gpu_name} valueStyle={{ fontSize: 14 }} />
            </Col>
            <Col span={6}>
              <Statistic
                title="显存使用"
                value={health.gpu_memory_used_gb.toFixed(1)}
                suffix={`/ ${health.gpu_memory_total_gb.toFixed(0)} GB`}
                valueStyle={{ fontSize: 14 }}
              />
            </Col>
            <Col span={6}>
              <Statistic title="模型帧数" value={health.num_video_frames} valueStyle={{ fontSize: 14 }} />
            </Col>
            <Col span={6}>
              <Statistic
                title="模型状态"
                value={health.model_loaded ? "已加载" : "未加载"}
                valueStyle={{ fontSize: 14, color: health.model_loaded ? "#52c41a" : "#ff4d4f" }}
              />
            </Col>
          </Row>
        ) : (
          <span style={{ color: "#999" }}>无法连接到推理服务器 ({serverUrl})</span>
        )}
      </Card>

      {/* Inference Control */}
      <Card size="small" title="推理控制">
        <Space direction="vertical" style={{ width: "100%" }}>
          {/* Current state */}
          {state && (
            <Space>
              <Tag color={state.paused ? "orange" : "green"}>
                {state.paused ? "已暂停" : "运行中"}
              </Tag>
              <span style={{ fontSize: 12, color: "#999" }}>
                当前指令: {state.instruction}
              </span>
            </Space>
          )}

          {/* Set instruction */}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="输入导航指令，如: navigate to the red chair"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onPressEnter={setInstructionOnServer}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={loading === "instruction"}
              onClick={setInstructionOnServer}
            >
              设置
            </Button>
          </Space.Compact>

          {/* Quick instructions */}
          <Space wrap>
            <span style={{ fontSize: 12, color: "#666" }}>快捷指令:</span>
            {[
              "navigate to the goal",
              "navigate to the red chair",
              "go to the door",
              "find the table",
              "stop",
            ].map((cmd) => (
              <Button
                key={cmd}
                size="small"
                onClick={() => {
                  setInstruction(cmd);
                  // Auto-send
                  fetch(`${apiBase}/set_instruction`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ instruction: cmd }),
                  }).then(() => {
                    message.success(`指令已设置: ${cmd}`);
                    fetchState();
                  });
                }}
              >
                {cmd}
              </Button>
            ))}
          </Space>

          {/* Pause / Resume */}
          <Space style={{ marginTop: 8 }}>
            <Button
              icon={<PauseCircleOutlined />}
              loading={loading === "pause"}
              disabled={state?.paused === true}
              onClick={pause}
            >
              暂停推理
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={loading === "resume"}
              disabled={state?.paused === false}
              onClick={resume}
            >
              恢复推理
            </Button>
          </Space>

          {/* SAP Status */}
          {state?.sap && (
            <Alert
              type={state.sap.is_complete ? "success" : "info"}
              showIcon
              message={
                state.sap.is_complete
                  ? "任务分解已完成"
                  : `子任务 ${state.sap.current_index + 1}/${state.sap.total}`
              }
              description={state.sap.current_subtask?.instruction}
              style={{ marginTop: 8 }}
            />
          )}
        </Space>
      </Card>

      {/* Kiro API Test */}
      <Card size="small" title={<Space><ApiOutlined /> Kiro VLM API</Space>}>
        <Space>
          <Button
            onClick={testKiroApi}
            loading={kiroStatus === "testing"}
          >
            Test Kiro API
          </Button>
          {kiroStatus === "ok" && (
            <Tag color="success">OK{kiroLatency ? ` (${kiroLatency}ms)` : ""}</Tag>
          )}
          {kiroStatus === "fail" && (
            <Tag color="error">FAIL{kiroLatency ? ` (${kiroLatency}ms)` : ""}</Tag>
          )}
        </Space>
        <div style={{ marginTop: 4, fontSize: 11, color: "#666" }}>
          直连 {KIRO_API_URL}（不走代理）
        </div>
      </Card>
    </Space>
  );
}
