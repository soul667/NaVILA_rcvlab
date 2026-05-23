from setuptools import setup

package_name = "navila_client"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/client.launch.py"]),
        ("share/" + package_name + "/config", ["config/client_params.yaml"]),
    ],
    install_requires=["setuptools", "requests"],
    zip_safe=True,
    maintainer="soul667",
    maintainer_email="soul667@github.com",
    description="NaVILA remote inference client - sends frames to server API",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "client_node = navila_client.client_node:main",
        ],
    },
)
