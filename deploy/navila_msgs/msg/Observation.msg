# Standardized observation message for NaVILA VLA inference
# Combines RGB image, optional depth, and camera metadata

std_msgs/Header header

# RGB image (required)
sensor_msgs/Image rgb

# Depth image (optional, zero-size if unavailable)
sensor_msgs/Image depth

# Camera intrinsics
sensor_msgs/CameraInfo camera_info

# Navigation instruction from user (e.g., "go to the kitchen")
string instruction

# Sequence index for multi-frame input
uint32 frame_index
uint32 total_frames
