"""
Single launch file for NaVILA + OLI Bridge (all-in-one container).
Launches navila_core inference + oli_bridge in a single process.
"""

from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from ament_index_python.packages import get_package_share_directory
import os


def generate_launch_description():
    oli_pkg_dir = get_package_share_directory("oli_bridge")
    navila_pkg_dir = get_package_share_directory("navila_core")

    oli_params_file = os.path.join(oli_pkg_dir, "config", "oli_params.yaml")
    navila_params_file = os.path.join(navila_pkg_dir, "config", "navila_params.yaml")

    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "oli_params_file",
                default_value=oli_params_file,
                description="Path to OLI bridge parameters",
            ),
            DeclareLaunchArgument(
                "navila_params_file",
                default_value=navila_params_file,
                description="Path to NaVILA core parameters",
            ),
            # NaVILA Core (VLA inference)
            Node(
                package="navila_core",
                executable="inference_node",
                name="navila_core",
                parameters=[LaunchConfiguration("navila_params_file")],
                output="screen",
            ),
            # OLI Bridge (WebSocket -> robot)
            Node(
                package="oli_bridge",
                executable="bridge_node",
                name="oli_bridge",
                parameters=[LaunchConfiguration("oli_params_file")],
                output="screen",
            ),
        ]
    )
