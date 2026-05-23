export FASTRTPS_DEFAULT_PROFILES_FILE=/home/guest/code/NaVILA_rcvlab/deploy/fastdds_no_shm.xml
ros2 launch realsense2_camera rs_launch.py


docker exec navila_core bash -c "source /opt/ros/humble/setup.bash && source /ros2_ws/install/setup.bash && ros2 service call /navila/set_instruction navila_msgs/srv/SetInstruction \"{instruction: 'go to the red chair'}\""

source /opt/ros/humble/setup.bash && source /ros2_ws/install/setup.bash && ros2 service call /navila/set_instruction navila_msgs/srv/SetInstruction "{instruction: 'go to the red chair'}"


搞定。架构如下：
服务器端（A6000）：
- deploy/Dockerfile.server — 构建推理镜像（CUDA 12.2, torch 2.3, flash-attn, 下载模型）
- deploy/docker-compose.server.yml — 启动 FastAPI 服务，暴露 :8000
- deploy/inference_server/server.py — FastAPI 应用，POST /infer 接收 base64 图像帧 + instruction，返回动作
Jetson 端：
- deploy/navila_client/ — 轻量 ROS2 节点，订阅 /navila/observation/rgb，把帧编码成 JPEG base64 发到服务器，收到结果后发布 /navila/action
- deploy/docker-compose.oli-remote.yml — 启动 navila-client + oli-bridge
使用步骤：
1. 服务器上构建并启动：
docker compose -f deploy/docker-compose.server.yml build --build-arg HF_TOKEN=hf_xxx
docker compose -f deploy/docker-compose.server.yml up
2. 修改 deploy/navila_client/config/client_params.yaml 里的 server_url 为服务器 IP：
server_url: "http://YOUR_SERVER_IP:8000"
3. Jetson 上启动 RealSense + compose：
FASTRTPS_DEFAULT_PROFILES_FILE=./deploy/fastdds_no_shm.xml ros2 launch realsense2_camera rs_launch.py
docker compose -f deploy/docker-compose.oli-remote.yml up