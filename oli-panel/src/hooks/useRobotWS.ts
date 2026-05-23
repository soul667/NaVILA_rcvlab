import { useCallback, useEffect, useRef, useState } from "react";
import type { RobotRequest, RobotResponse, RobotNotifyInfo } from "../types/robot";

function generateGuid(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

interface UseRobotWSOptions {
  url: string;
  accid: string;
  autoConnect?: boolean;
}

interface PendingRequest {
  resolve: (resp: RobotResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function useRobotWS({ url, accid, autoConnect = true }: UseRobotWSOptions) {
  const [connected, setConnected] = useState(false);
  const [robotInfo, setRobotInfo] = useState<RobotNotifyInfo[]>([]);
  const [notifications, setNotifications] = useState<RobotResponse[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log("[WS] Connected to", url);
    };

    ws.onclose = () => {
      setConnected(false);
      console.log("[WS] Disconnected");
      // Auto reconnect after 3s
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = (e) => {
      console.error("[WS] Error:", e);
    };

    ws.onmessage = (event) => {
      try {
        const msg: RobotResponse = JSON.parse(event.data);
        const { title, guid } = msg;

        // Handle response to pending request
        if (title.startsWith("response_")) {
          const pending = pendingRef.current.get(guid);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRef.current.delete(guid);
            pending.resolve(msg);
          }
        }

        // Handle notify messages
        if (title.startsWith("notify_")) {
          if (title === "notify_robot_info") {
            const result = msg.data.result as RobotNotifyInfo[];
            setRobotInfo(result);
          } else {
            setNotifications((prev) => [msg, ...prev].slice(0, 50));
          }
        }
      } catch (e) {
        console.error("[WS] Parse error:", e);
      }
    };
  }, [url]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  /** Send a request and wait for response (promise-based) */
  const sendRequest = useCallback(
    (title: string, data: Record<string, unknown> = {}, timeout = 10000): Promise<RobotResponse> => {
      return new Promise((resolve, reject) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket not connected"));
          return;
        }

        const guid = generateGuid();
        const msg: RobotRequest = {
          accid,
          title,
          timestamp: Date.now(),
          guid,
          data,
        };

        const timer = setTimeout(() => {
          pendingRef.current.delete(guid);
          reject(new Error(`Request ${title} timed out`));
        }, timeout);

        pendingRef.current.set(guid, { resolve, reject, timer });
        wsRef.current.send(JSON.stringify(msg));
      });
    },
    [accid]
  );

  /** Fire-and-forget send (for high-frequency commands like walk vel) */
  const sendCommand = useCallback(
    (title: string, data: Record<string, unknown> = {}) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const msg: RobotRequest = {
        accid,
        title,
        timestamp: Date.now(),
        guid: generateGuid(),
        data,
      };
      wsRef.current.send(JSON.stringify(msg));
    },
    [accid]
  );

  useEffect(() => {
    if (autoConnect) connect();
    return () => disconnect();
  }, [autoConnect, connect, disconnect]);

  return {
    connected,
    robotInfo,
    notifications,
    sendRequest,
    sendCommand,
    connect,
    disconnect,
  };
}
