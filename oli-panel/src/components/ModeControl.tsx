import { useState } from "react";
import { Card, Button, Space, message, Popconfirm, Tag, Divider } from "antd";
import {
  PoweroffOutlined,
  ArrowUpOutlined,
  PauseCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";

interface Props {
  connected: boolean;
}

/**
 * 机器人模式说明：
 * - 零力矩(zero_torque): 电机完全无力，可自由摆动
 * - 阻尼(damping): 电机有阻力但不主动运动，用于安全停机
 * - 站立准备(prepare): 机器人缓慢站起，进入可控状态
 * - 行走模式(walk_mode): 可接收速度指令行走
 * - 动作库模式: 可执行预定义动作/舞蹈
 * - 坐下/躺下: 从站立状态转换
 */
export function ModeControl({ connected }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const exec = async (title: string, data: Record<string, unknown> = {}, label: string) => {
    if (!connected) {
      message.error("未连接到机器人");
      return;
    }
    setLoading(title);
    try {
      const resp = await fetch("/api/robot/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, data }),
      });
      const result = await resp.json();
      if (result.success && result.data?.result === "success") {
        message.success(`${label} 成功`);
      } else if (result.success === false && result.error === "timeout") {
        message.warning(`${label} 超时（可能仍在执行）`);
      } else {
        message.error(`${label} 失败: ${result.data?.result || result.error || "unknown"}`);
      }
    } catch (e: any) {
      message.error(`${label} 错误: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {/* 基础模式切换 */}
      <Card size="small" title="基础模式切换" extra={<Tag>状态机控制</Tag>}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <div style={{ marginBottom: 8, color: "#666", fontSize: 12 }}>
            流程: 零力矩 → 阻尼 → 站立准备 → 行走/动作库
          </div>
          <Space wrap>
            <Popconfirm
              title="确认进入零力矩模式？"
              description="电机将完全无力，机器人会倒下！请确保有人扶住。"
              onConfirm={() => exec("request_zero_torque", {}, "零力矩")}
              okText="确认"
              cancelText="取消"
            >
              <Button
                danger
                icon={<PoweroffOutlined />}
                loading={loading === "request_zero_torque"}
                disabled={!connected}
              >
                零力矩
              </Button>
            </Popconfirm>

            <Popconfirm
              title="确认进入阻尼模式？"
              description="电机有阻力但不主动运动，机器人会缓慢下蹲。"
              onConfirm={() => exec("request_damping", {}, "阻尼模式")}
              okText="确认"
              cancelText="取消"
            >
              <Button
                icon={<PauseCircleOutlined />}
                loading={loading === "request_damping"}
                disabled={!connected}
              >
                阻尼模式
              </Button>
            </Popconfirm>

            <Button
              type="primary"
              icon={<ArrowUpOutlined />}
              loading={loading === "request_prepare"}
              disabled={!connected}
              onClick={() => exec("request_prepare", {}, "站立准备")}
            >
              站立准备
            </Button>

            <Button
              loading={loading === "request_set_walk_mode"}
              disabled={!connected}
              onClick={() => exec("request_set_walk_mode", {}, "行走模式")}
            >
              进入行走模式
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 站立/坐下/躺下 */}
      <Card size="small" title="姿态控制">
        <Space wrap>
          <Button
            loading={loading === "request_standup_sitting"}
            disabled={!connected}
            onClick={() => exec("request_standup", { mode: "sitting" }, "从坐姿站起")}
          >
            从坐姿站起
          </Button>
          <Button
            loading={loading === "request_standup_lying"}
            disabled={!connected}
            onClick={() => exec("request_standup", { mode: "lying" }, "从躺姿站起")}
          >
            从躺姿站起
          </Button>
          <Button
            loading={loading === "request_from_stand_to_sit"}
            disabled={!connected}
            onClick={() => exec("request_from_stand_to_sit", {}, "坐下")}
          >
            坐下
          </Button>
          <Popconfirm
            title="确认躺下？"
            description="机器人将从站立状态躺下。"
            onConfirm={() => exec("request_lie_down", {}, "躺下")}
            okText="确认"
            cancelText="取消"
          >
            <Button loading={loading === "request_lie_down"} disabled={!connected}>
              躺下
            </Button>
          </Popconfirm>
        </Space>
      </Card>

      {/* 动作库模式 */}
      <Card size="small" title="动作库/舞蹈模式">
        <Space wrap>
          <Button
            loading={loading === "request_set_motion_engine_1"}
            disabled={!connected}
            onClick={() => exec("request_set_motion_engine", { mode: 1 }, "进入动作库模式")}
          >
            进入动作库模式
          </Button>
          <Button
            loading={loading === "request_set_motion_engine_0"}
            disabled={!connected}
            onClick={() => exec("request_set_motion_engine", { mode: 0 }, "退出动作库模式")}
          >
            退出动作库模式
          </Button>
          <Divider type="vertical" />
          <Button
            loading={loading === "request_enter_dance_mode_1"}
            disabled={!connected}
            onClick={() => exec("request_enter_dance_mode", { mode: 1 }, "进入舞蹈模式")}
          >
            进入舞蹈模式
          </Button>
          <Button
            loading={loading === "request_enter_dance_mode_0"}
            disabled={!connected}
            onClick={() => exec("request_enter_dance_mode", { mode: 0 }, "退出舞蹈模式")}
          >
            退出舞蹈模式
          </Button>
        </Space>
      </Card>

      {/* 原地踏步 */}
      <Card size="small" title="原地踏步">
        <Space>
          <Button
            loading={loading === "request_start_walktoggle"}
            disabled={!connected}
            onClick={() => exec("request_start_walktoggle", {}, "开始原地踏步")}
          >
            开始踏步
          </Button>
          <Button
            icon={<StopOutlined />}
            loading={loading === "request_stop_walktoggle"}
            disabled={!connected}
            onClick={() => exec("request_stop_walktoggle", {}, "停止原地踏步")}
          >
            停止踏步
          </Button>
        </Space>
      </Card>

      {/* LED 控制 */}
      <Card size="small" title="灯效控制">
        <Space wrap>
          <Button
            disabled={!connected}
            loading={loading === "request_enable_led_control"}
            onClick={() => exec("request_enable_led_control", { enable: 1 }, "开启灯效")}
          >
            开启灯效控制
          </Button>
          <Button
            disabled={!connected}
            onClick={() => exec("request_enable_led_control", { enable: 0 }, "关闭灯效")}
          >
            关闭灯效控制
          </Button>
          <Divider type="vertical" />
          {[
            { color: 0, label: "红", antColor: "red" },
            { color: 3, label: "绿", antColor: "green" },
            { color: 5, label: "蓝", antColor: "blue" },
            { color: 7, label: "白", antColor: "default" },
            { color: 6, label: "紫", antColor: "purple" },
          ].map(({ color, label, antColor }) => (
            <Button
              key={color}
              size="small"
              disabled={!connected}
              style={{ borderColor: antColor === "default" ? undefined : antColor }}
              onClick={() =>
                exec("request_led_control", { led_index: 0, led_state: 1, led_color: color }, `灯效${label}`)
              }
            >
              {label}
            </Button>
          ))}
          <Button
            size="small"
            disabled={!connected}
            onClick={() =>
              exec("request_led_control", { led_index: 0, led_state: 5, led_color: 5 }, "呼吸灯")
            }
          >
            呼吸灯
          </Button>
          <Button
            size="small"
            disabled={!connected}
            onClick={() =>
              exec("request_led_control", { led_index: 0, led_state: 0, led_color: 0 }, "关灯")
            }
          >
            关灯
          </Button>
        </Space>
      </Card>
    </Space>
  );
}
