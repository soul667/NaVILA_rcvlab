import { useState } from "react";
import { Card, Button, Space, Tag, message, Alert } from "antd";
import { CameraOutlined, PoweroffOutlined } from "@ant-design/icons";

interface Props {
  connected: boolean;
}

/**
 * 相机控制面板
 * 通过后端 API 启动/停止 RealSense 相机节点
 * 注意：相机运行在宿主机上（不在 Docker 内），需要后端 API 支持
 */
export function CameraControl(_props: Props) {
  const [cameraRunning, setCameraRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const startCamera = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/camera/start", { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        setCameraRunning(true);
        message.success("相机启动成功");
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 相机已启动`]);
      } else {
        message.error(`启动失败: ${data.error}`);
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 启动失败: ${data.error}`]);
      }
    } catch (e: any) {
      message.error(`请求失败: ${e.message}`);
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 请求失败: ${e.message}`]);
    } finally {
      setLoading(false);
    }
  };

  const stopCamera = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/camera/stop", { method: "POST" });
      const data = await resp.json();
      if (data.success) {
        setCameraRunning(false);
        message.success("相机已停止");
        setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 相机已停止`]);
      } else {
        message.error(`停止失败: ${data.error}`);
      }
    } catch (e: any) {
      message.error(`请求失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    try {
      const resp = await fetch("/api/camera/status");
      const data = await resp.json();
      setCameraRunning(data.running);
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 状态: ${data.running ? "运行中" : "未运行"} ${data.topics ? "topics: " + data.topics.join(", ") : ""}`,
      ]);
    } catch (e: any) {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 状态查询失败: ${e.message}`]);
    }
  };

  return (
    <Card
      size="small"
      title="RealSense 相机"
      extra={
        <Tag color={cameraRunning ? "success" : "default"}>
          {cameraRunning ? "运行中" : "未启动"}
        </Tag>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="相机运行在宿主机上，需要启动后端 API 服务才能控制"
          description="运行: cd oli-panel && node server.js"
          style={{ marginBottom: 8 }}
        />
        <Space>
          <Button
            type="primary"
            icon={<CameraOutlined />}
            loading={loading}
            disabled={cameraRunning}
            onClick={startCamera}
          >
            启动相机
          </Button>
          <Button
            danger
            icon={<PoweroffOutlined />}
            loading={loading}
            disabled={!cameraRunning}
            onClick={stopCamera}
          >
            停止相机
          </Button>
          <Button onClick={checkStatus}>检查状态</Button>
        </Space>

        {logs.length > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: "#1a1a1a",
              borderRadius: 4,
              maxHeight: 150,
              overflow: "auto",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            {logs.map((log, i) => (
              <div key={i} style={{ color: "#aaa" }}>
                {log}
              </div>
            ))}
          </div>
        )}
      </Space>
    </Card>
  );
}
