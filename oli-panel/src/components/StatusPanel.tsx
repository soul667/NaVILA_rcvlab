import { useEffect, useState } from "react";
import { Card, Descriptions, Tag, Space, Statistic, Row, Col, Badge, Collapse } from "antd";
import { SyncOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import type { IMUData, JointState, ActionLibraryStatus, RobotNotifyInfo } from "../types/robot";

interface Props {
  connected: boolean;
  robotInfo: RobotNotifyInfo[];
  sendRequest: (title: string, data?: Record<string, unknown>, timeout?: number) => Promise<any>;
}

export function StatusPanel({ connected, robotInfo, sendRequest }: Props) {
  const [imu, setImu] = useState<IMUData | null>(null);
  const [joints, setJoints] = useState<JointState | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionLibraryStatus | null>(null);
  const [polling] = useState(true);

  useEffect(() => {
    if (!connected || !polling) return;

    const poll = async () => {
      try {
        const [imuResp, actionResp] = await Promise.all([
          sendRequest("request_get_imu_data"),
          sendRequest("request_get_action_library_status"),
        ]);

        if (imuResp.data.result === "success") {
          setImu(imuResp.data as unknown as IMUData);
        }
        if (actionResp.data.result === "success") {
          setActionStatus(actionResp.data as unknown as ActionLibraryStatus);
        }
      } catch (e) {
        console.warn("Poll error:", e);
      }
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [connected, polling, sendRequest]);

  const fetchJoints = async () => {
    try {
      const resp = await sendRequest("request_get_joint_state");
      if (resp.data.result === "success") {
        setJoints(resp.data as unknown as JointState);
      }
    } catch (e) {
      console.warn("Joint fetch error:", e);
    }
  };

  // Extract battery info from robotInfo notify
  const batteryInfo = robotInfo.find((r) => r.name === "peripheral");
  const batCharge = batteryInfo?.values.find((v) => v.key === "bat_chg")?.value;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {/* Connection Status */}
      <Card size="small" title="连接状态">
        <Space>
          <Badge status={connected ? "success" : "error"} text={connected ? "已连接" : "未连接"} />
          {connected && <Tag icon={<SyncOutlined spin />} color="processing">实时监控中</Tag>}
        </Space>
      </Card>

      {/* Hardware Diagnostics from notify_robot_info */}
      <Card size="small" title="硬件诊断">
        <Space wrap>
          {robotInfo.map((info) => (
            <Tag
              key={info.name}
              icon={info.message === "OK" ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              color={info.message === "OK" ? "success" : "error"}
            >
              {info.name}: {info.message}
            </Tag>
          ))}
          {batteryInfo && (
            <>
              <Tag color={batCharge === "ON" ? "blue" : "default"}>
                充电: {batCharge || "N/A"}
              </Tag>
            </>
          )}
        </Space>
      </Card>

      {/* IMU Data */}
      <Card size="small" title="IMU 姿态">
        {imu ? (
          <Row gutter={16}>
            <Col span={8}>
              <Statistic title="Roll" value={imu.euler[0].toFixed(2)} suffix="°" />
            </Col>
            <Col span={8}>
              <Statistic title="Pitch" value={imu.euler[1].toFixed(2)} suffix="°" />
            </Col>
            <Col span={8}>
              <Statistic title="Yaw" value={imu.euler[2].toFixed(2)} suffix="°" />
            </Col>
            <Col span={8}>
              <Statistic title="Acc X" value={imu.acc[0].toFixed(2)} suffix="m/s²" />
            </Col>
            <Col span={8}>
              <Statistic title="Acc Y" value={imu.acc[1].toFixed(2)} suffix="m/s²" />
            </Col>
            <Col span={8}>
              <Statistic title="Acc Z" value={imu.acc[2].toFixed(2)} suffix="m/s²" />
            </Col>
          </Row>
        ) : (
          <span>等待数据...</span>
        )}
      </Card>

      {/* Action Library Status */}
      <Card size="small" title="动作库状态">
        {actionStatus ? (
          <Descriptions column={2} size="small">
            <Descriptions.Item label="模式">
              <Tag color={actionStatus.action_library_mode === "action_library" ? "blue" : "green"}>
                {actionStatus.action_library_mode === "action_library" ? "动作库模式" : "遥控模式"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={actionStatus.action_library_state === "running" ? "orange" : "default"}>
                {actionStatus.action_library_state === "running" ? "执行中" : "空闲"}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <span>等待数据...</span>
        )}
      </Card>

      {/* Joint States (collapsible, on-demand) */}
      <Collapse
        items={[
          {
            key: "joints",
            label: `关节状态 (${joints ? joints.names.length + " joints" : "点击加载"})`,
            children: joints ? (
              <div style={{ maxHeight: 300, overflow: "auto", fontSize: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "2px 8px" }}>关节</th>
                      <th style={{ textAlign: "right", padding: "2px 8px" }}>位置(rad)</th>
                      <th style={{ textAlign: "right", padding: "2px 8px" }}>速度</th>
                      <th style={{ textAlign: "right", padding: "2px 8px" }}>力矩</th>
                    </tr>
                  </thead>
                  <tbody>
                    {joints.names.map((name, i) => (
                      <tr key={name} style={{ borderTop: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "2px 8px" }}>{name}</td>
                        <td style={{ textAlign: "right", padding: "2px 8px" }}>{joints.q[i]?.toFixed(3)}</td>
                        <td style={{ textAlign: "right", padding: "2px 8px" }}>{joints.dq[i]?.toFixed(3)}</td>
                        <td style={{ textAlign: "right", padding: "2px 8px" }}>{joints.tau[i]?.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <span>加载中...</span>
            ),
          },
        ]}
        onChange={(keys) => {
          if (keys.includes("joints") && !joints) fetchJoints();
        }}
      />
    </Space>
  );
}
