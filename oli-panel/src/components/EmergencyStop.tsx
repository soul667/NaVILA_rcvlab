import { useState } from "react";
import { message } from "antd";

interface Props {
  sendCommand?: (title: string, data?: Record<string, unknown>) => void;
}

/**
 * 全局急停按钮 - 固定悬浮在页面右下角
 * 点击后：
 * 1. 通过 WebSocket 发送零速度给机器人
 * 2. 暂停云端推理
 * 3. 停止容器
 */
export function EmergencyStop({ sendCommand }: Props) {
  const [stopping, setStopping] = useState(false);

  const emergencyStop = async () => {
    setStopping(true);

    // 1. 立即发送零速度（如果 WebSocket 可用）
    if (sendCommand) {
      for (let i = 0; i < 5; i++) {
        sendCommand("request_set_walk_vel_sync", { x: 0, y: 0, yaw: 0 });
      }
    }

    // 2. 暂停推理
    try {
      await fetch("/inference/pause", { method: "POST" });
    } catch {}

    // 3. 停止容器
    try {
      await fetch("/api/system/stop", { method: "POST" });
    } catch {}

    message.warning("急停已执行：推理暂停 + 容器停止");
    setStopping(false);
  };

  return (
    <button
      onClick={emergencyStop}
      disabled={stopping}
      style={{
        position: "fixed",
        bottom: "env(safe-area-inset-bottom, 24px)",
        right: 24,
        zIndex: 9999,
        width: 80,
        height: 80,
        borderRadius: "50%",
        border: "4px solid #fff",
        background: stopping ? "#666" : "#ff4d4f",
        color: "#fff",
        fontSize: 16,
        fontWeight: "bold",
        cursor: stopping ? "not-allowed" : "pointer",
        boxShadow: "0 4px 20px rgba(255, 77, 79, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "manipulation",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        transition: "transform 0.1s, box-shadow 0.1s",
      }}
      onTouchStart={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.9)";
      }}
      onTouchEnd={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.9)";
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      {stopping ? "..." : "急停"}
    </button>
  );
}
