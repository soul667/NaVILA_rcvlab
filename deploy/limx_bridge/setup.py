from setuptools import setup

package_name = "limx_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/limx.launch.py"]),
        ("share/" + package_name + "/config", ["config/limx_params.yaml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="soul667",
    maintainer_email="soul667@github.com",
    description="LimX Dynamics robot bridge for NaVILA",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "bridge_node = limx_bridge.bridge_node:main",
        ],
    },
)
