const { spawn, exec } = require("child_process");
const http = require("http");
const WebSocket = require("ws");

let cameraProcess = null;

const FASTRTPS_PROFILE = "/home/guest/code/NaVILA_rcvlab/deploy/fastdds_no_shm.xml";
const DEPLOY_DIR = "/home/guest/code/NaVILA_rcvlab";
const COMPOSE_FILE = "deploy/docker-compose.oli-remote.yml";
const ROBOT_WS_URL = "ws://10.192.1.2:5000";
const ROBOT_ACCID = "HU_D04_01_118";

function execAsync(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { shell: "/bin/bash", timeout: 30000, ...options }, (err, stdout, stderr) => {
      if (err) reject({ error: err.message, stdout, stderr });
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // =========================================================================
  // Camera API
  // =========================================================================

  if (req.method === "POST" && req.url === "/api/camera/start") {
    if (cameraProcess) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: "Camera already running" }));
      return;
    }

    const env = {
      ...process.env,
      FASTRTPS_DEFAULT_PROFILES_FILE: FASTRTPS_PROFILE,
    };

    cameraProcess = spawn(
      "bash",
      ["-c", "source /opt/ros/humble/setup.bash && ros2 launch realsense2_camera rs_launch.py serial_no:=\"'338622074043'\""],
      { env, detached: true }
    );

    cameraProcess.stdout.on("data", (data) => {
      console.log(`[camera] ${data.toString().trim()}`);
    });
    cameraProcess.stderr.on("data", (data) => {
      console.log(`[camera] ${data.toString().trim()}`);
    });
    cameraProcess.on("close", (code) => {
      console.log(`[camera] process exited with code ${code}`);
      cameraProcess = null;
    });

    setTimeout(() => {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, pid: cameraProcess?.pid }));
    }, 1000);
    return;
  }

  if (req.method === "POST" && req.url === "/api/camera/stop") {
    if (!cameraProcess) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: "Camera not running" }));
      return;
    }

    try {
      process.kill(-cameraProcess.pid, "SIGINT");
    } catch (e) {
      try {
        cameraProcess.kill("SIGINT");
      } catch (e2) {}
    }
    cameraProcess = null;
    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/camera/status") {
    const running = cameraProcess !== null;
    if (running) {
      exec(
        "source /opt/ros/humble/setup.bash && ros2 topic list | grep camera",
        { shell: "/bin/bash" },
        (err, stdout) => {
          const topics = stdout ? stdout.trim().split("\n").filter(Boolean) : [];
          res.writeHead(200);
          res.end(JSON.stringify({ running: true, pid: cameraProcess?.pid, topics }));
        }
      );
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ running: false }));
    }
    return;
  }

  // =========================================================================
  // Docker Compose (containers) API
  // =========================================================================

  if (req.method === "POST" && req.url === "/api/containers/start") {
    try {
      const result = await execAsync(
        `docker compose -f ${COMPOSE_FILE} up -d`,
        { cwd: DEPLOY_DIR }
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, output: result.stdout || result.stderr }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: e.stderr || e.error }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/containers/stop") {
    try {
      const result = await execAsync(
        `docker compose -f ${COMPOSE_FILE} stop -t 5`,
        { cwd: DEPLOY_DIR, timeout: 60000 }
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, output: result.stdout || result.stderr }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: e.stderr || e.error }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/containers/restart") {
    try {
      const result = await execAsync(
        `docker compose -f ${COMPOSE_FILE} restart`,
        { cwd: DEPLOY_DIR }
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, output: result.stdout || result.stderr }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: e.stderr || e.error }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/containers/status") {
    try {
      const result = await execAsync(
        `docker compose -f ${COMPOSE_FILE} ps --format json`,
        { cwd: DEPLOY_DIR }
      );
      const lines = result.stdout.split("\n").filter(Boolean);
      const containers = lines.map((line) => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, containers }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, containers: [], error: e.stderr || e.error }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/containers/logs/navila") {
    try {
      const result = await execAsync(
        `docker logs navila_core --tail 20 2>&1`,
        { cwd: DEPLOY_DIR }
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, logs: result.stdout }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, logs: e.stdout || e.stderr || e.error }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/containers/logs/bridge") {
    try {
      const result = await execAsync(
        `docker logs oli_bridge --tail 20 2>&1`,
        { cwd: DEPLOY_DIR }
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, logs: result.stdout }));
    } catch (e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, logs: e.stdout || e.stderr || e.error }));
    }
    return;
  }

  // =========================================================================
  // Full system start/stop (camera + containers + inference resume)
  // =========================================================================

  if (req.method === "POST" && req.url === "/api/system/start") {
    const results = [];

    // 1. Start camera
    if (!cameraProcess) {
      const env = { ...process.env, FASTRTPS_DEFAULT_PROFILES_FILE: FASTRTPS_PROFILE };
      cameraProcess = spawn(
        "bash",
      ["-c", "source /opt/ros/humble/setup.bash && ros2 launch realsense2_camera rs_launch.py serial_no:=\"'338622074043'\""],
        { env, detached: true }
      );
      cameraProcess.stdout.on("data", (d) => console.log(`[camera] ${d.toString().trim()}`));
      cameraProcess.stderr.on("data", (d) => console.log(`[camera] ${d.toString().trim()}`));
      cameraProcess.on("close", (code) => { cameraProcess = null; });
      results.push("camera: started");
    } else {
      results.push("camera: already running");
    }

    // Wait for camera to init
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Start containers
    try {
      await execAsync(`docker compose -f ${COMPOSE_FILE} up -d`, { cwd: DEPLOY_DIR });
      results.push("containers: started");
    } catch (e) {
      results.push(`containers: error - ${e.stderr || e.error}`);
    }

    // 3. Resume inference
    try {
      const http2 = require("http");
      await new Promise((resolve, reject) => {
        const r = http2.request("http://10.16.117.238:8000/resume", { method: "POST" }, (resp) => {
          resolve();
        });
        r.on("error", reject);
        r.end();
      });
      results.push("inference: resumed");
    } catch (e) {
      results.push(`inference: ${e.message}`);
    }

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, results }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/system/stop") {
    const results = [];

    // 1. Pause inference
    try {
      const http2 = require("http");
      await new Promise((resolve, reject) => {
        const r = http2.request("http://10.16.117.238:8000/pause", { method: "POST" }, (resp) => {
          resolve();
        });
        r.on("error", reject);
        r.end();
      });
      results.push("inference: paused");
    } catch (e) {
      results.push(`inference: ${e.message}`);
    }

    // 2. Stop containers
    try {
      await execAsync(`docker compose -f ${COMPOSE_FILE} stop -t 5`, { cwd: DEPLOY_DIR, timeout: 60000 });
      results.push("containers: stopped");
    } catch (e) {
      results.push(`containers: error - ${e.stderr || e.error}`);
    }

    // 3. Stop camera
    if (cameraProcess) {
      try { process.kill(-cameraProcess.pid, "SIGINT"); } catch (e) {
        try { cameraProcess.kill("SIGINT"); } catch (e2) {}
      }
      cameraProcess = null;
      results.push("camera: stopped");
    } else {
      results.push("camera: not running");
    }

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, results }));
    return;
  }

  // =========================================================================
  // Robot Command Proxy (独立 WebSocket 连接，避免和 oli_bridge 冲突)
  // =========================================================================

  if (req.method === "POST" && req.url === "/api/robot/command") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { title, data } = JSON.parse(body);
        const guid = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

        const ws = new WebSocket(ROBOT_WS_URL);
        const timeout = setTimeout(() => {
          ws.close();
          res.writeHead(200);
          res.end(JSON.stringify({ success: false, error: "timeout" }));
        }, 20000);

        ws.on("open", () => {
          const msg = {
            accid: ROBOT_ACCID,
            title,
            timestamp: Date.now(),
            guid,
            data: data || {},
          };
          ws.send(JSON.stringify(msg));
        });

        ws.on("message", (raw) => {
          try {
            const resp = JSON.parse(raw.toString());
            // 只关心我们发的指令的 response
            if (resp.title && resp.title.startsWith("response_") && resp.guid === guid) {
              clearTimeout(timeout);
              ws.close();
              res.writeHead(200);
              res.end(JSON.stringify({ success: true, data: resp.data }));
            }
            // 跳过 notify 消息
          } catch {}
        });

        ws.on("error", (err) => {
          clearTimeout(timeout);
          res.writeHead(200);
          res.end(JSON.stringify({ success: false, error: err.message }));
        });
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: "Invalid JSON body" }));
      }
    });
    return;
  }

  // =========================================================================
  // Motion Parameters API (write to client_params.yaml)
  // =========================================================================

  if (req.method === "POST" && req.url === "/api/motion-params") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const params = JSON.parse(body);
        const fs = require("fs");
        const yamlPath = DEPLOY_DIR + "/deploy/navila_client/config/client_params.yaml";

        const yaml = `# NaVILA Client Parameters (Step-by-step navigation mode)
navila_core:
  ros__parameters:
    server_url: "http://10.16.117.238:8000"
    num_frames: 8
    instruction: "navigate to the goal"
    jpeg_quality: 80

    # Motion control parameters
    forward_speed_ratio: ${params.forward_speed_ratio}
    turn_speed_ratio: ${params.turn_speed_ratio}
    forward_speed_ms: ${params.forward_speed_ms}
    turn_speed_degs: ${params.turn_speed_degs}
    stop_duration: ${params.stop_duration}
    stabilize_duration: ${params.stabilize_duration}
`;
        fs.writeFileSync(yamlPath, yaml);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: "Params saved. Restart container to apply." }));
      } catch (e) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = 3002;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`OLI Panel API server running on http://0.0.0.0:${PORT}`);
  console.log("Endpoints:");
  console.log("  Camera:     POST /api/camera/start|stop  GET /api/camera/status");
  console.log("  Containers: POST /api/containers/start|stop|restart  GET /api/containers/status");
  console.log("  Logs:       GET /api/containers/logs/navila|bridge");
  console.log("  System:     POST /api/system/start|stop");
});
