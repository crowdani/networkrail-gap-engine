export interface GapDetectionResult {
  msg_type: string;
  train_id: string;
  train_uid: string;
  msg_queue_timestamp: string;
  actual_ts: Date;
  loc_stanox: string;
  loc_tiploc_code: string | null;
  stanox_array: string;
  tiploc_array: string;
  position_in_schedule: number;
  total_stops: number;
  prev_stanox: string;
  expected_prev_stanox: string;
  prev_tiploc_code: string | null;
  expected_tiploc_code: string | null;
  is_gap: boolean;
}

