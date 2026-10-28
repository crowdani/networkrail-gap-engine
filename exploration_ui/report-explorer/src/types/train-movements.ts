export interface TrainMovement {
  id: number;
  msg_type: string;
  train_id: string;
  train_uid: string;
  train_service_code: string | null;
  msg_queue_timestamp: number | null;
  actual_timestamp: number | null;
  actual_ts: Date | string;
  loc_stanox: string;
  tiploc_code: string | null;
  event_type: string | null;
  event_source: string | null;
  planned_timestamp: number | null;
  variation_status: string | null;
  timetable_variation: number | null;
  current_train_id: string | null;
  delay_monitoring_point: boolean | null;
  next_report_run_time: string | null;
  reporting_stanox: string | null;
  auto_expected: boolean | null;
  direction_ind: string | null;
  route: string | null;
  platform: string | null;
  line_ind: string | null;
  created_at: Date | string;
}

export interface TrainActivation {
  id: number;
  msg_type: string;
  train_id: string;
  train_uid: string;
  train_service_code: string | null;
  schedule_source: string | null;
  schedule_type: string | null;
  sched_origin_stanox: string | null;
  origin_dep_timestamp: number | null;
  tp_origin_timestamp: number | null;
  creation_timestamp: number | null;
  d1266_record_number: string | null;
  train_call_type: string | null;
  train_call_mode: string | null;
  schedule_key: string | null;
  schedule_wtt_id: string | null;
  created_at: Date | string;
}

export interface MovementsApiResponse {
  movements: TrainMovement[];
  total: number;
  page: number;
  pageSize: number;
}

