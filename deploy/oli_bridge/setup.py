from setuptools import setup

package_name = "oli_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/oli.launch.py"]),
        ("share/" + package_name + "/config", ["config/oli_params.yaml"]),
    ],
    install_requires=["setuptools", "websocket-client"],
    zip_safe=True,
    maintainer="soul667",
    maintainer_email="soul667@github.com",
    description="LimX OLI humanoid robot bridge for NaVILA (WebSocket protocol)",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "bridge_node = oli_bridge.bridge_node:main",
        ],
    },
)
