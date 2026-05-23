import { Card, List, Tag, Empty, Space } from "antd";
import type { RobotResponse } from "../types/robot";

interface Props {
  notifications: RobotResponse[];
}

export function NotificationLog({ notifications }: Props) {
  return (
    <Card size="small" title="消息推送日志" style={{ maxHeight: 400, overflow: "auto" }}>
      {notifications.length === 0 ? (
        <Empty description="暂无消息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={notifications}
          renderItem={(item) => (
            <List.Item>
              <Space>
                <Tag color="blue">{item.title.replace("notify_", "")}</Tag>
                <span style={{ fontSize: 12, color: "#666" }}>
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ fontSize: 12 }}>
                  {JSON.stringify(item.data).slice(0, 100)}
                </span>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
