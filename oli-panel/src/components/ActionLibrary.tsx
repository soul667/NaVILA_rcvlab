import { useEffect, useState } from "react";
import { Card, Button, Space, message, Spin } from "antd";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AtomicMotion, Dance } from "../types/robot";

interface Props {
  connected: boolean;
}

async function robotCommand(title: string, data: Record<string, unknown> = {}) {
  const resp = await fetch("/api/robot/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, data }),
  });
  return resp.json();
}

export function ActionLibrary({ connected }: Props) {
  const [motions, setMotions] = useState<AtomicMotion[]>([]);
  const [dances, setDances] = useState<Dance[]>([]);
  const [loadingMotions, setLoadingMotions] = useState(false);
  const [loadingDances, setLoadingDances] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);

  const fetchMotions = async () => {
    if (!connected) return;
    setLoadingMotions(true);
    try {
      const result = await robotCommand("request_get_atomic_motion_list");
      if (result.success && result.data?.result === "success") {
        setMotions(result.data.motion_list as AtomicMotion[]);
      }
    } catch (e: any) {
      message.error("获取动作列表失败: " + e.message);
    } finally {
      setLoadingMotions(false);
    }
  };

  const fetchDances = async () => {
    if (!connected) return;
    setLoadingDances(true);
    try {
      const result = await robotCommand("request_get_dance_list");
      if (result.success && result.data?.result === "success") {
        setDances(result.data.dances as Dance[]);
      }
    } catch (e: any) {
      message.error("获取舞蹈列表失败: " + e.message);
    } finally {
      setLoadingDances(false);
    }
  };

  useEffect(() => {
    if (connected) {
      fetchMotions();
      fetchDances();
    }
  }, [connected]);

  const executeMotion = async (motionName: string) => {
    setExecuting(motionName);
    try {
      // 使用 request_action_sync，在 walk 和 motion library 模式下都能用
      const result = await robotCommand("request_action_sync", { name: motionName });
      if (result.success && result.data?.result === "success") {
        message.success(`动作 ${motionName} 执行成功`);
      } else if (result.error === "timeout") {
        message.warning(`动作 ${motionName} 已发送（等待执行完成）`);
      } else {
        message.error(`动作失败: ${result.data?.result || result.error}`);
      }
    } catch (e: any) {
      message.error(`动作 ${motionName} 错误: ${e.message}`);
    } finally {
      setExecuting(null);
    }
  };

  const executeDance = async (danceName: string) => {
    setExecuting(danceName);
    try {
      // request_action_sync 支持舞蹈和动作混合
      const result = await robotCommand("request_action_sync", { name: danceName });
      if (result.success && result.data?.result === "success") {
        message.success(`舞蹈 ${danceName} 执行成功`);
      } else if (result.error === "timeout") {
        message.warning(`舞蹈 ${danceName} 已发送（等待执行完成）`);
      } else {
        message.error(`舞蹈失败: ${result.data?.result || result.error}`);
      }
    } catch (e: any) {
      message.error(`舞蹈 ${danceName} 错误: ${e.message}`);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {/* 动作库 */}
      <Card
        size="small"
        title={`动作库 (${motions.length})`}
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchMotions} loading={loadingMotions}>
            刷新
          </Button>
        }
      >
        {loadingMotions ? (
          <Spin />
        ) : (
          <Space wrap>
            {motions.map((m) => (
              <Button
                key={m.motion_name_en}
                size="small"
                icon={<PlayCircleOutlined />}
                loading={executing === m.motion_name_en}
                disabled={!connected || (executing !== null && executing !== m.motion_name_en)}
                onClick={() => executeMotion(m.motion_name_en)}
              >
                {m.motion_name_cn}
              </Button>
            ))}
            {motions.length === 0 && <span style={{ color: "#999" }}>暂无动作，请先进入动作库模式</span>}
          </Space>
        )}
      </Card>

      {/* 舞蹈 */}
      <Card
        size="small"
        title={`舞蹈列表 (${dances.length})`}
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchDances} loading={loadingDances}>
            刷新
          </Button>
        }
      >
        {loadingDances ? (
          <Spin />
        ) : (
          <Space wrap>
            {dances.map((d) => (
              <Button
                key={d.rc_mapping}
                size="small"
                icon={<PlayCircleOutlined />}
                loading={executing === d.rc_mapping}
                disabled={!connected || (executing !== null && executing !== d.rc_mapping)}
                onClick={() => executeDance(d.rc_mapping)}
              >
                {d.name} ({d.english_name})
              </Button>
            ))}
            {dances.length === 0 && <span style={{ color: "#999" }}>暂无舞蹈，请先进入舞蹈模式</span>}
          </Space>
        )}
      </Card>
    </Space>
  );
}
