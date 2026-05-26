import { useState } from "react";
import { Layout, Tabs, Input, Space, Typography, theme, ConfigProvider, Drawer, Button } from "antd";
import { RobotOutlined, DashboardOutlined, ControlOutlined, ThunderboltOutlined, BellOutlined, DesktopOutlined, CloudServerOutlined, SettingOutlined } from "@ant-design/icons";
import { useRobotWS } from "./hooks/useRobotWS";
import { StatusPanel } from "./components/StatusPanel";
import { ModeControl } from "./components/ModeControl";
import { WalkControl } from "./components/WalkControl";
import { ActionLibrary } from "./components/ActionLibrary";
import { NotificationLog } from "./components/NotificationLog";
import { SystemControl } from "./components/SystemControl";
import { InferenceControl } from "./components/InferenceControl";
import { MotionParamsPanel } from "./components/MotionParamsPanel";
import { EmergencyStop } from "./components/EmergencyStop";
import { ManualTest } from "./components/ManualTest";

const { Header, Content } = Layout;
const { Title } = Typography;

const DEFAULT_WS_URL = "ws://10.192.1.2:5000";
const DEFAULT_ACCID = "HU_D04_01_118";
const DEFAULT_INFERENCE_URL = "http://10.16.117.238:8000";

function App() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [accid, setAccid] = useState(DEFAULT_ACCID);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { connected, robotInfo, notifications, sendRequest, sendCommand } =
    useRobotWS({ url: wsUrl, accid, autoConnect: true });

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: { colorPrimary: "#1677ff" },
      }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            height: 48,
            lineHeight: "48px",
          }}
        >
          <RobotOutlined style={{ fontSize: 20, color: "#1677ff" }} />
          <Title level={5} style={{ margin: 0, color: "#fff", whiteSpace: "nowrap" }}>
            OLI Control
          </Title>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {connected ? (
              <span style={{ color: "#52c41a", fontSize: 12 }}>● 已连接</span>
            ) : (
              <span style={{ color: "#ff4d4f", fontSize: 12 }}>● 断开</span>
            )}
            <Button
              size="small"
              type="text"
              icon={<SettingOutlined style={{ color: "#fff" }} />}
              onClick={() => setSettingsOpen(true)}
            />
          </div>
        </Header>

        <Content style={{ padding: "8px 8px 100px 8px" }}>
          <Tabs
            defaultActiveKey="system"
            size="small"
            tabBarStyle={{ marginBottom: 8 }}
            items={[
              {
                key: "system",
                label: (
                  <span>
                    <DesktopOutlined /> 系统
                  </span>
                ),
                children: <SystemControl />,
              },
              {
                key: "status",
                label: (
                  <span>
                    <DashboardOutlined /> 状态
                  </span>
                ),
                children: (
                  <StatusPanel
                    connected={connected}
                    robotInfo={robotInfo}
                    sendRequest={sendRequest}
                  />
                ),
              },
              {
                key: "control",
                label: (
                  <span>
                    <ControlOutlined /> 模式
                  </span>
                ),
                children: <ModeControl connected={connected} />,
              },
              {
                key: "walk",
                label: (
                  <span>
                    <ThunderboltOutlined /> 行走
                  </span>
                ),
                children: <WalkControl connected={connected} sendCommand={sendCommand} />,
              },
              {
                key: "test",
                label: (
                  <span>
                    🎯 测试
                  </span>
                ),
                children: <ManualTest />,
              },
              {
                key: "actions",
                label: (
                  <span>
                    <PlayIcon /> 动作
                  </span>
                ),
                children: <ActionLibrary connected={connected} />,
              },
              {
                key: "inference",
                label: (
                  <span>
                    <CloudServerOutlined /> 推理
                  </span>
                ),
                children: (
                  <Space direction="vertical" style={{ width: "100%" }} size="middle">
                    <InferenceControl serverUrl={DEFAULT_INFERENCE_URL} />
                    <MotionParamsPanel />
                  </Space>
                ),
              },
              {
                key: "logs",
                label: (
                  <span>
                    <BellOutlined /> 日志
                  </span>
                ),
                children: <NotificationLog notifications={notifications} />,
              },
            ]}
          />
        </Content>

        {/* 全局急停按钮 */}
        <EmergencyStop sendCommand={sendCommand} />

        {/* 设置抽屉 */}
        <Drawer
          title="连接设置"
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          placement="bottom"
          height="auto"
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              addonBefore="WebSocket"
              placeholder="ws://10.192.1.2:5000"
            />
            <Input
              value={accid}
              onChange={(e) => setAccid(e.target.value)}
              addonBefore="机器人SN"
              placeholder="HU_D04_01_118"
            />
            <div style={{ fontSize: 12, color: "#999" }}>
              修改后自动重连。推理服务器: {DEFAULT_INFERENCE_URL}
            </div>
          </Space>
        </Drawer>
      </Layout>
    </ConfigProvider>
  );
}

function PlayIcon() {
  return <span role="img" aria-label="play">▶</span>;
}

export default App;
