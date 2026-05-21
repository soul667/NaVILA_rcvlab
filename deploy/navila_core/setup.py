from setuptools import setup

package_name = "navila_core"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/navila.launch.py"]),
        ("share/" + package_name + "/config", ["config/navila_params.yaml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="soul667",
    maintainer_email="soul667@github.com",
    description="NaVILA VLA inference ROS2 node",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "inference_node = navila_core.inference_node:main",
        ],
    },
)
