# NaVILA + OLI Humanoid Robot Deployment Guide

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Jetson (Docker)                               │
├────────────────────┬─────────────────────┬───────────────────────────┤
│    navila-core     │     oli-bridge       │    foxglove-bridge        │
│    (GPU, VLA)      │  (WebSocket->OLI)    │      :8765                │
└────────┬───────────┴──────────┬──────────┴───────────────────────────┘
         │     ROS2 Topics      │
         ▼                      ▼
/navila/observation/rgb  ←── oli_bridge ←── /camera/camera/color/image_raw (RealSense)
/navila/action           ──→ oli_bridge ──→ WebSocket ws://10.192.1.2:5000
                                            (request_set_walk_vel_sync, 30Hz)
```

## Data Flow

```
RealSense Camera (rs_launch.py)
       │
       │  /camera/camera/color/image_raw
       ▼
OLI Bridge (camera subscriber) ──→ /navila/observation/rgb
       │                                      │
       │                                      ▼
       │                              NaVILA Core (2Hz inference)
       │                                      │
       │              /navila/action           │
       │◄─────────────────────────────────────┘
       │
       │  _action_callback: m/s → ratio [-1,1]
       │  _send_walk_cmd: 30Hz hold-last-command
       ▼
WebSocket → ws://10.192.1.2:5000
       │
       │  {"title": "request_set_walk_vel_sync", "data": {"x":..., "y":0, "yaw":...}}
       ▼
OLI Humanoid Robot
```

## Prerequisites

### Hardware
- NVIDIA Jetson (JetPack 6 / L4T r36.x) — runs NaVILA inference
- Intel RealSense camera — mounted on robot, connected to Jetson via USB
- LimX OLI humanoid robot — communicates via WiFi WebSocket

### Software
- Docker + nvidia-container-runtime on Jetson
- ROS2 Humble (host, for RealSense driver)

### Network
- Jetson connected to OLI robot WiFi (e.g., `HU_D04_xxx`, password: `12345678`)
- Robot WebSocket endpoint: `ws://10.192.1.2:5000`

---

## Quick Start

### Step 0: Debug Mode (Recommended First)

First validate the entire pipeline **without connecting to the real robot**:

```bash
cd deploy

# oli_params.yaml already has dry_run: true by default

# Start debug compose (only navila-core + oli-bridge, no foxglove)
docker compose -f docker-compose.oli-debug.yml up

# In another terminal, check the pipeline:
# 1. Verify camera images flow through
ros2 topic hz /navila/observation/rgb

# 2. Set an instruction
ros2 service call /navila/set_instruction navila_msgs/srv/SetInstruction \
  "{instruction: 'navigate to the door'}"

# 3. Watch what commands would be sent (logged every 1s)
docker compose -f docker-compose.oli-debug.yml logs -f oli-bridge
# You should see: [DRY RUN] Would send: x=0.500 y=0.000 yaw=-0.200

# 4. When satisfied, stop debug
docker compose -f docker-compose.oli-debug.yml down
```

### Step 1: Switch to Real Mode

Edit `oli_bridge/config/oli_params.yaml`:
```yaml
    dry_run: false  # Now commands will be sent to robot
```

### 1. Pull Docker Image

```bash
docker pull ghcr.io/soul667/navila_rcvlab:cecd23c17e0e943465ebaebcf0c7c65d55de5031-jetson
```

### 2. Start RealSense Camera (Host)

RealSense runs on the **host** (not in Docker) because it needs USB access:

```bash
# Terminal 1: Start RealSense camera driver
ros2 launch realsense2_camera rs_launch.py

# Verify camera is publishing:
ros2 topic hz /camera/camera/color/image_raw
```

### 3. Configure OLI Bridge

Edit `deploy/oli_bridge/config/oli_params.yaml`:

```yaml
oli_bridge:
  ros__parameters:
    # !! Change these to match your robot !!
    robot_ip: "10.192.1.2"        # OLI robot IP
    ws_port: 5000                  # WebSocket port
    robot_accid: "HU_D04_01_001"  # Your robot serial number (SN)

    # RealSense topic (default from rs_launch.py)
    camera_topic: "/camera/camera/color/image_raw"

    # Velocity config
    max_linear_vel: 0.5           # m/s clamp from NaVILA
    max_angular_vel: 1.0          # rad/s clamp from NaVILA
    robot_max_linear_vel: 0.8     # m/s when ratio=1.0
    robot_max_angular_vel: 1.0    # rad/s when ratio=1.0

    # Control rate (must >= 30Hz)
    send_rate: 30.0

    # Stop robot if no action for 2s
    action_timeout: 2.0
```

### 4. Start NaVILA + OLI Bridge (Docker)

```bash
cd deploy

# Start all services
docker compose -f docker-compose.oli.yml up -d

# Check logs
docker compose -f docker-compose.oli.yml logs -f oli-bridge
docker compose -f docker-compose.oli.yml logs -f navila-core
```

### 5. Set Navigation Instruction

```bash
# Tell NaVILA what to do
ros2 service call /navila/set_instruction navila_msgs/srv/SetInstruction \
  "{instruction: 'navigate to the door'}"
```

### 6. Stop

```bash
docker compose -f docker-compose.oli.yml down
```

---

## Important Notes

### Robot Must Be in Correct Mode

The OLI robot must be in **移动操作模式 (Mobile Operation Mode)** or **动作库模式 (Action Library Mode)** for walk commands to work.

- In **全身操作模式 (Whole Body Mode)**, `request_set_walk_vel_sync` will be **ignored**
- If the robot is executing an action from the action library, commands will not be responded to

### 30Hz Continuous Sending

The robot requires velocity commands at **≥30Hz**. The bridge implements "hold-last-command":
- NaVILA inference runs at 2Hz
- Bridge caches the latest velocity and re-sends at 30Hz
- If no new action arrives within `action_timeout` (default 2s), bridge sends `{x:0, y:0, yaw:0}` (stop)

### Safety Features

| Feature | Description |
|---------|-------------|
| Action timeout | Stops robot if NaVILA stops publishing (2s default) |
| Graceful shutdown | Sends 5x stop commands before closing WebSocket |
| Auto-reconnect | Reconnects WebSocket every 3s if connection drops |
| Velocity clamping | Limits velocity before conversion to ratio |
| Error logging | Logs `response_set_walk_vel_sync` failures |

---

## Monitoring & Debugging

### Check Topics

```bash
# See if camera images are flowing
ros2 topic hz /camera/camera/color/image_raw
ros2 topic hz /navila/observation/rgb

# See NaVILA actions
ros2 topic echo /navila/action

# System status
ros2 topic echo /navila/status
```

### Foxglove Studio Visualization

1. Open [Foxglove Studio](https://foxglove.dev/studio)
2. Connect to `ws://<jetson-ip>:8765`
3. Add panels:
   - **Image**: `/navila/observation/rgb` — see what the model sees
   - **Plot**: `/navila/action.linear_velocity` and `.angular_velocity`
   - **Log**: `/navila/status`

### WebSocket Connection Debug

```bash
# Inside the oli-bridge container
docker exec -it oli_bridge bash
ros2 topic echo /navila/action  # verify actions are being published

# Check bridge status logs (every 5s)
docker compose -f docker-compose.oli.yml logs oli-bridge | grep "Status"
```

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `WebSocket connection failed` | Robot WiFi not connected or wrong IP | Check WiFi connection, verify `robot_ip` |
| `Walk command failed: fail_invalid_mode` | Robot in wrong mode | Switch to 移动操作模式 |
| `Walk command failed: fail_motor` | Motor error | Check robot hardware |
| No images on `/navila/observation/rgb` | Camera not running or wrong topic | Verify `ros2 topic hz /camera/camera/color/image_raw` |
| Robot not moving | NaVILA model not loaded or action_timeout | Check `navila-core` logs |

---

## Runtime Commands

```bash
# Set navigation goal
ros2 service call /navila/set_instruction navila_msgs/srv/SetInstruction \
  "{instruction: 'go to the kitchen'}"

# Switch to idle (stop inference)
ros2 service call /navila/set_mode navila_msgs/srv/SetMode "{mode: 'idle'}"

# Resume inference
ros2 service call /navila/set_mode navila_msgs/srv/SetMode "{mode: 'inference'}"

# Manual emergency stop: just kill the bridge
docker compose -f docker-compose.oli.yml stop oli-bridge
```

---

## File Structure

```
deploy/
├── docker-compose.oli.yml        # OLI deployment compose file
├── OLI_DEPLOYMENT.md             # This file
├── oli_bridge/
│   ├── config/
│   │   └── oli_params.yaml       # Robot connection & velocity config
│   ├── launch/
│   │   └── oli.launch.py         # ROS2 launch file
│   ├── oli_bridge/
│   │   ├── __init__.py
│   │   └── bridge_node.py        # Main bridge node (WebSocket + ROS2)
│   ├── resource/
│   │   └── oli_bridge
│   ├── package.xml
│   └── setup.py
├── navila_core/                   # VLA inference node
│   └── ...
└── navila_msgs/                   # Custom ROS2 messages
    └── ...
```
