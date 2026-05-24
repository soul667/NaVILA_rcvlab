export interface InferResult {
  raw_output: string;
  action: string;
  distance_cm: number;
  degree: number;
  latency_ms: number;
}

export interface HistoryItem {
  timestamp: number;
  instruction: string;
  num_frames: number;
  result: InferResult;
  frames_b64?: string[];
  last_frame_b64?: string;
}

export interface HealthData {
  status: string;
  model_loaded: boolean;
  model_path: string;
  num_video_frames: number;
  gpu_name: string;
  gpu_memory_used_gb: number;
  gpu_memory_total_gb: number;
}

export interface StateData {
  instruction: string;
  paused: boolean;
}

export interface SessionSummary {
  id: number;
  start_time: number;
  end_time: number;
  instruction: string;
  count: number;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
  total: number;
}

export interface SessionDetailResponse {
  items: HistoryItem[];
}
