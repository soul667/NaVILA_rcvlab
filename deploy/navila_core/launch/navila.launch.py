from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from ament_index_python.packages import get_package_share_directory
import os


def generate_launch_description():
    pkg_dir = get_package_share_directory("navila_core")
    params_file = os.path.join(pkg_dir, "config", "navila_params.yaml")

    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "params_file", default_value=params_file, description="Path to params"
            ),
            Node(
                package="navila_core",
                executable="inference_node",
                name="navila_core",
                parameters=[LaunchConfiguration("params_file")],
                output="screen",
            ),
        ]
    )
