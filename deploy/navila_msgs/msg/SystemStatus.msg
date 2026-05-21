# System health and status

std_msgs/Header header

# Node states
bool model_loaded
bool inference_running
bool camera_connected
bool robot_connected

# Performance metrics
float64 inference_latency_ms
float64 fps
uint64 gpu_memory_used_mb
uint64 gpu_memory_total_mb
float64 gpu_utilization

# Error info
string last_error
uint32 error_count
