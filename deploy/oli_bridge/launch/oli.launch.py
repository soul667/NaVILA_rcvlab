from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from ament_index_python.packages import get_package_share_directory
import os


def generate_launch_description():
    pkg_dir = get_package_share_directory("oli_bridge")
    params_file = os.path.join(pkg_dir, "config", "oli_params.yaml")

    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "params_file",
                default_value=params_file,
                description="Path to OLI bridge parameters",
            ),
            DeclareLaunchArgument(
                "robot_accid",
                default_value="HU_D04_01_001",
                description="OLI robot serial number (accid)",
            ),
            DeclareLaunchArgument(
                "robot_ip",
                default_value="10.192.1.2",
                description="OLI robot IP address",
            ),
            Node(
                package="oli_bridge",
                executable="bridge_node",
                name="oli_bridge",
                parameters=[
                    LaunchConfiguration("params_file"),
                    {
                        "robot_accid": LaunchConfiguration("robot_accid"),
                        "robot_ip": LaunchConfiguration("robot_ip"),
                    },
                ],
                output="screen",
            ),
        ]
    )
