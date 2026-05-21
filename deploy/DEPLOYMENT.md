# Real Robot Deployment Guide

## Overview

NaVILA real robot deployment uses ROS2 Humble + Docker, with a standardized message interface that decouples the VLA inference from robot-specific hardware.

```
┌─────────────────────────────────────────────────────────────┐
│                      docker-compose                          │
├───────────────┬───────────────┬──────────────┬──────────────┤
│  navila-core  │  limx-bridge  │   foxglove   │   rosboard   │
│  (GPU, VLA)   │  (adapter)    │   :8765      │   :8888      │
└───────┬───────┴───────┬───────┴──────────────┴──────────────┘
        │               │
        │  ROS2 Topics  │
        ▼               ▼
 /navila/observation/rgb  ←── limx_bridge ←── /limx/camera/...
 /navila/action           ──→ limx_bridge ──→ /limx/cmd_vel
 /navila/robot_state      ←── limx_bridge ←── /limx/odom
 /navila/status           (system health)
```

## Prerequisites

- NVIDIA Jetson (JetPack 6 / L4T r36.x)
- Docker + nvidia-container-runtime
- Network access to `ghcr.io`

## Quick Start

```bash
cd deploy

# Start all services
docker compose up -d

# Check status
docker compose logs -f navila_core

# Stop
docker compose down
```

## Architecture

### Custom Messages (`navila_msgs`)

| Message | Purpose |
|---------|---------|
| `Observation.msg` | RGB + depth + camera_info + instruction + frame index |
| `Action.msg` | command + linear/angular velocity + confidence + reasoning |
| `RobotState.msg` | pose + velocity + joint_states + battery + locomotion_mode |
| `SystemStatus.msg` | model_loaded + inference metrics + GPU stats + errors |

### Services

| Service | Purpose |
|---------|---------|
| `SetInstruction.srv` | Set navigation instruction for the VLA |
| `SetMode.srv` | Switch between idle / inference / recording |

### Topics

| Topic | Type | Direction |
|-------|------|-----------|
| `/navila/observation/rgb` | `sensor_msgs/Image` | Camera → Core |
| `/navila/observation/depth` | `sensor_msgs/Image` | Camera → Core |
| `/navila/action` | `navila_msgs/Action` | Core → Bridge |
| `/navila/robot_state` | `navila_msgs/RobotState` | Bridge → Core |
| `/navila/status` | `navila_msgs/SystemStatus` | Core → All |

### Nodes

- **navila_core** - VLA inference node. Buffers 8 frames, runs inference at 2Hz, publishes `Action`.
- **limx_bridge** - Adapter for LimX Dynamics robots. Converts between standard NaVILA topics and LimX SDK topics.
- **foxglove_bridge** - WebSocket bridge for Foxglove Studio visualization.
- **rosboard** - Web-based ROS2 topic viewer at port 8888.

## Docker Images

Images are built via GitHub Actions and pushed to:

```
ghcr.io/soul667/navila-rcvlab:latest-jetson
```

The model (`a8cheng/navila-llama3-8b-8f`) is pre-downloaded inside the image.

### Build locally (optional)

```bash
docker buildx build \
  --file deploy/Dockerfile.jetson \
  --build-arg HF_TOKEN=your_token \
  -t navila:local .
```

## Configuration

### NaVILA Core (`config/navila_params.yaml`)

```yaml
navila_core:
  ros__parameters:
    model_path: "/models/navila-llama3-8b-8f"
    num_frames: 8
    inference_rate: 2.0
    device: "cuda:0"
    instruction: "navigate to the goal"
```

### LimX Bridge (`config/limx_params.yaml`)

```yaml
limx_bridge:
  ros__parameters:
    max_linear_vel: 0.5
    max_angular_vel: 1.0
    camera_topic: "/limx/camera/color/image_raw"
    odom_topic: "/limx/odom"
    joint_topic: "/limx/joint_states"
```

## Adding a New Robot

1. Copy `deploy/limx_bridge` as a template (e.g., `deploy/unitree_bridge`)
2. Modify `bridge_node.py`:
   - Update subscribed topics to match your robot's SDK
   - Adjust velocity mapping in `_action_callback`
   - Update state aggregation in `_publish_robot_state`
3. Update `package.xml` and `setup.py` with new package name
4. Add the new service to `docker-compose.yml`

## Visualization

### Foxglove Studio

1. Open [Foxglove Studio](https://foxglove.dev/studio)
2. Connect to `ws://<jetson-ip>:8765`
3. Add panels for:
   - Image: `/navila/observation/rgb`
   - Plot: `/navila/action` (velocity commands)
   - Log: `/navila/status`

### Rosboard

Open `http://<jetson-ip>:8888` in a browser.

## CI/CD

GitHub Actions workflow (`.github/workflows/docker-build.yml`) triggers on:
- Push to `main` (paths: `deploy/`, `llava/`, `pyproject.toml`)
- Manual dispatch

Requires repo secret: `HF_TOKEN` (HuggingFace token for model download during build).

## Runtime Commands

```bash
# Set navigation instruction
ros2 service call /navila/set_instruction navila_msgs/srv/SetInstruction "{instruction: 'go to the kitchen'}"

# Switch to idle mode
ros2 service call /navila/set_mode navila_msgs/srv/SetMode "{mode: 'idle'}"

# Monitor action output
ros2 topic echo /navila/action

# Check system status
ros2 topic echo /navila/status
```
