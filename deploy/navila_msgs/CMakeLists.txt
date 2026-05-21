cmake_minimum_required(VERSION 3.8)
project(navila_msgs)

find_package(ament_cmake REQUIRED)
find_package(std_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/Observation.msg"
  "msg/Action.msg"
  "msg/RobotState.msg"
  "msg/SystemStatus.msg"
  "srv/SetInstruction.srv"
  "srv/SetMode.srv"
  DEPENDENCIES std_msgs sensor_msgs geometry_msgs
)

ament_export_dependencies(rosidl_default_runtime)
ament_package()
