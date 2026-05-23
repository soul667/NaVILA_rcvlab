/** OLI Robot WebSocket Protocol Types */

export interface RobotRequest {
  accid: string;
  title: string;
  timestamp: number;
  guid: string;
  data: Record<string, unknown>;
}

export interface RobotResponse {
  accid: string;
  title: string;
  timestamp: number;
  guid: string;
  data: Record<string, unknown>;
}

export interface IMUData {
  euler: [number, number, number]; // roll, pitch, yaw (degrees)
  acc: [number, number, number]; // x, y, z (m/s²)
  gyro: [number, number, number]; // x, y, z (rad/s)
  quat: [number, number, number, number]; // w, x, y, z
}

export interface JointState {
  names: string[];
  q: number[]; // position
  dq: number[]; // velocity
  tau: number[]; // torque
}

export interface ActionLibraryStatus {
  action_library_mode: "action_library" | "remote_control";
  action_library_state: "running" | "idle";
}

export interface AtomicMotion {
  motion_index: number;
  motion_name_cn: string;
  motion_name_en: string;
}

export interface Dance {
  id: string;
  index: number;
  name: string;
  english_name: string;
  rc_mapping: string;
}

export interface RobotNotifyInfo {
  level: number;
  name: string;
  message: string;
  hardware_id: string;
  values: { key: string; value: string }[];
}

/** Robot mode state machine:
 * zero_torque -> damping -> prepare (standing) -> walk_mode
 *                                              -> action_library
 *                                              -> sit / lie_down
 */
export type RobotMode =
  | "unknown"
  | "zero_torque"
  | "damping"
  | "standing" // after prepare
  | "walking"
  | "sitting"
  | "lying"
  | "action_library"
  | "dancing"
  | "ub_manip" // 移动操作
  | "wb_manip"; // 原地操作
