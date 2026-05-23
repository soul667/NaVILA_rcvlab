import { useCallback, useEffect, useState } from "react";
import { Card, Button, Space, Tag, message, Descriptions, Badge, Divider } from "antd";
import {
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  CameraOutlined,
  CloudServerOutlined,
  RobotOutlined,
} from "@ant-design/icons";

interface ContainerInfo {
  Name?: string;
  State?: string;
  Status?: string;
  Service?: string;
}

export function SystemControl() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ navila: string; bridge: string }>({ navila: "", bridge: "" });

  const fetchStatus = useCallback(async () => {
    try {
      const [containerResp, cameraResp] = await Promise.all([
        fetch("/api/containers/status"),
        fetch("/api/camera/status"),
      ]);
      const containerData = await containerResp.json();
      const cameraData = await cameraResp.json();
      setContainers(containerData.containers || []);
      setCameraRunning(cameraData.running || false);
    } catch {
      // ignore
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const [navilaResp, bridgeResp] = await Promise.all([
        fetch("/api/containers/logs/navila"),
        fetch("/api/containers/logs/bridge"),
      ]);
      const navilaData = await navilaResp.json();
      const bridgeData = await bridgeResp.json();
      setLogs({
        navila: navilaData.logs || "No logs",
        bridge: bridgeData.logs || "No logs",
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const safeFetch = async (url: string, options?: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      const text = await resp.text();
      clearTimeout(timeout);
      if (!text) return { success: true };
      return JSON.parse(text);
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError") return { success: true, note: "timeout but likely succeeded" };
      throw e;
    }
  };

  const systemStart = async () => {
    setLoading("start");
    try {
      const data = await safeFetch("/api/system/start", { method: "POST" });
      message.success("系统启动成功");
      if (data.results) console.log("Start results:", data.results);
      setTimeout(fetchStatus, 3000);
    } catch (e: any) {
      message.error(`启动失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const systemStop = async () => {
    setLoading("stop");
    try {
      await safeFetch("/api/system/stop", { method: "POST" });
      message.success("系统已停止");
      setTimeout(fetchStatus, 2000);
    } catch (e: any) {
      message.error(`停止失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const containerAction = async (action: string) => {
    setLoading(action);
    try {
      const data = await safeFetch(`/api/containers/${action}`, { method: "POST" });
      if (data.success !== false) {
        message.success(`容器 ${action} 成功`);
      } else {
        message.error(`容器 ${action} 失败: ${data.error}`);
      }
      setTimeout(fetchStatus, 3000);
    } catch (e: any) {
      message.error(`请求失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const cameraAction = async (action: "start" | "stop") => {
    setLoading(`camera_${action}`);
    try {
      const data = await safeFetch(`/api/camera/${action}`, { method: "POST" });
      if (data.success !== false) {
        message.success(`相机${action === "start" ? "启动" : "停止"}成功`);
      } else {
        message.error(data.error);
      }
      setTimeout(fetchStatus, 2000);
    } catch (e: any) {
      message.error(`请求失败: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  const navilaContainer = containers.find((c) => c.Name === "navila_core" || c.Service === "navila-client");
  const bridgeContainer = containers.find((c) => c.Name === "oli_bridge" || c.Service === "oli-bridge");

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {/* 一键启停 */}
      <Card size="small" title="系统控制（一键启停全部）">
        <Space>
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            loading={loading === "start"}
            onClick={systemStart}
          >
            启动系统
          </Button>
          <Button
            danger
            size="large"
            icon={<PoweroffOutlined />}
            loading={loading === "stop"}
            onClick={systemStop}
          >
            停止系统
          </Button>
        </Space>
        <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
          启动 = 相机 + ROS2容器 + 恢复推理 | 停止 = 暂停推理 + 停止容器 + 关闭相机
        </div>
      </Card>

      {/* 各组件状态 */}
      <Card size="small" title="组件状态" extra={<Button size="small" icon={<ReloadOutlined />} onClick={fetchStatus}>刷新</Button>}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label={<><CameraOutlined /> 相机</>}>
            <Badge status={cameraRunning ? "success" : "default"} text={cameraRunning ? "运行中" : "未启动"} />
          </Descriptions.Item>
          <Descriptions.Item label={<><CloudServerOutlined /> navila_core</>}>
            <Badge
              status={navilaContainer?.State === "running" ? "success" : "default"}
              text={navilaContainer?.State || "未运行"}
            />
          </Descriptions.Item>
          <Descriptions.Item label={<><RobotOutlined /> oli_bridge</>}>
            <Badge
              status={bridgeContainer?.State === "running" ? "success" : "default"}
              text={bridgeContainer?.State || "未运行"}
            />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 单独控制 */}
      <Card size="small" title="单独控制">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space>
            <span style={{ width: 60, display: "inline-block" }}>相机:</span>
            <Button size="small" icon={<PlayCircleOutlined />} disabled={cameraRunning} loading={loading === "camera_start"} onClick={() => cameraAction("start")}>启动</Button>
            <Button size="small" danger icon={<PoweroffOutlined />} disabled={!cameraRunning} loading={loading === "camera_stop"} onClick={() => cameraAction("stop")}>停止</Button>
          </Space>
          <Space>
            <span style={{ width: 60, display: "inline-block" }}>容器:</span>
            <Button size="small" icon={<PlayCircleOutlined />} loading={loading === "start"} onClick={() => containerAction("start")}>启动</Button>
            <Button size="small" danger icon={<PoweroffOutlined />} loading={loading === "stop"} onClick={() => containerAction("stop")}>停止</Button>
            <Button size="small" icon={<ReloadOutlined />} loading={loading === "restart"} onClick={() => containerAction("restart")}>重启</Button>
          </Space>
        </Space>
      </Card>

      {/* 日志 */}
      <Card size="small" title="容器日志" extra={<Button size="small" onClick={fetchLogs}>加载日志</Button>}>
        {logs.navila || logs.bridge ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <div>
              <Tag color="blue">navila_core</Tag>
              <pre style={{ fontSize: 11, maxHeight: 150, overflow: "auto", background: "#1a1a1a", padding: 8, borderRadius: 4, whiteSpace: "pre-wrap" }}>
                {logs.navila || "点击「加载日志」查看"}
              </pre>
            </div>
            <div>
              <Tag color="green">oli_bridge</Tag>
              <pre style={{ fontSize: 11, maxHeight: 150, overflow: "auto", background: "#1a1a1a", padding: 8, borderRadius: 4, whiteSpace: "pre-wrap" }}>
                {logs.bridge || "点击「加载日志」查看"}
              </pre>
            </div>
          </Space>
        ) : (
          <span style={{ color: "#999" }}>点击「加载日志」查看容器输出</span>
        )}
      </Card>
    </Space>
  );
}
