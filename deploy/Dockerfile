FROM ros:humble-ros-base AS msg-builder

WORKDIR /ros2_ws/src
COPY deploy/navila_msgs ./navila_msgs

WORKDIR /ros2_ws
RUN . /opt/ros/humble/setup.sh && \
    colcon build --packages-select navila_msgs --cmake-args -DCMAKE_BUILD_TYPE=Release

FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV ROS_DISTRO=humble
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV ROS_DOMAIN_ID=0
ENV NAVILA_MODEL_DIR=/models

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg2 lsb-release software-properties-common && \
    curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
      -o /usr/share/keyrings/ros-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
      http://packages.ros.org/ros2/ubuntu $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/ros2.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-ros-base \
    ros-humble-cv-bridge \
    ros-humble-image-transport \
    ros-humble-foxglove-bridge \
    python3-pip \
    python3-colcon-common-extensions \
    git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY llava ./llava

RUN pip3 install --no-cache-dir -e . && \
    pip3 install --no-cache-dir \
    https://github.com/Dao-AILab/flash-attention/releases/download/v2.5.8/flash_attn-2.5.8+cu122torch2.3cxx11abiFALSE-cp310-cp310-linux_x86_64.whl && \
    pip3 install --no-cache-dir transformers==4.37.2 huggingface_hub

ARG HF_TOKEN=""
RUN python3 -c "\
from huggingface_hub import snapshot_download; \
snapshot_download( \
    repo_id='a8cheng/navila-llama3-8b-8f', \
    local_dir='/models/navila-llama3-8b-8f', \
    local_dir_use_symlinks=False, \
    token='${HF_TOKEN}' if '${HF_TOKEN}' else None \
)"

COPY --from=msg-builder /ros2_ws/install /ros2_ws/install

COPY deploy/navila_core /ros2_ws/src/navila_core
COPY deploy/limx_bridge /ros2_ws/src/limx_bridge

WORKDIR /ros2_ws
RUN . /opt/ros/humble/setup.sh && \
    . /ros2_ws/install/setup.sh && \
    colcon build --packages-select navila_core limx_bridge

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["ros2", "launch", "navila_core", "navila.launch.py"]
