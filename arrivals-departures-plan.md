# Arrivals & Departures — End-to-End Plan

## Top-Level Overview

**Goal:** Each stop in a journey should carry separate arrival and departure times
(scheduled and actual), delays should always be computed against arrival times,
and the infill predictor should use whichever actual times are available (ARR or DEP)
when building its prediction.

**Scope:** Python gap detector → Kafka struct → ksqlDB pipeline → DB schema migration
→ infill predictor → delayed-trains API → per-train detail API/page.

**Not in scope:** changes to the ksqlDB `LIVE_JOURNEY_STATE` collection logic
(that already collects every individual movement including separate ARR and DEP
messages). No changes to the approvals workflow, gap analytics, or dashboard pages
beyond what is needed for display.

---

## Sub-Tasks

---

### Sub-Task 1 — Python gap detector: separate ARR/DEP events per station

**Status:** `[ ] pending`

**Intent**

`completed_journey_gap_detector.py` currently matches **one** event per scheduled
tiploc by consuming the first matching entry in `STATIONS_VISITED`. Because Network
Rail fires separate ARRIVAL and DEPARTURE messages, two entries for the same station
arrive in that list. The detector must now extract **both** and store them as
`actual_arrival` / `actual_departure` on the station dict, while also surfacing the
already-computed `scheduled_arrival` and `scheduled_departure` in the outgoing
Kafka payload.

**Expected Outcomes**

- Each visited station dict in the published Kafka message carries:
  - `scheduled_arrival`  — HH:MM from CIF schedule `arrival` / `public_arrival`
  - `scheduled_departure` — HH:MM from CIF schedule `departure` / `public_departure`
  - `actual_arrival`    — HH:MM:SS from the matched ARRIVAL movement (or null)
  - `actual_departure`  — HH:MM:SS from the matched DEPARTURE movement (or null)
  - `actual_time` is kept as-is (= `actual_arrival` when present, else `actual_departure`)
    so the existing pipeline continues working unchanged.
  - `event` is kept as-is (first matched event type, for backward compat)
- Missed stations carry nulls for actual fields but still carry both `scheduled_*` fields.

**Todo List**

1. In `process_message`, after building `visited_events`, group events by stanox so
   both ARR and DEP can be looked up per station.
2. In the station-matching loop (lines 683–724), instead of consuming one event per
   tiploc, find both the ARRIVAL event and the DEPARTURE event (matched by stanox/tiploc,
   unconsumed, with event string containing "ARR" or "DEP"/"DEPARTURE"). Mark both as
   consumed.
3. Populate the station dict with `actual_arrival`, `actual_departure`, `scheduled_arrival`,
   `scheduled_departure`.
4. Set `actual_time = actual_arrival or actual_departure` (preserve existing semantics).
5. Missed-station dicts already have `scheduled_arrival` / `scheduled_departure` — just
   ensure they are passed through.

**Relevant Context**

- File: `gap_detector/completed_journey_gap_detector.py`
- Matching loop: lines 683–724
- `format_epoch` helper: line 341 — reuse for formatting both actual times
- `sched_dep` / `sched_arr` / `sched_pass` already computed at lines 679–681
- `STATIONS_VISITED` struct in ksqlDB declares `EVENT VARCHAR` — values from
  Network Rail are `"ARRIVAL"` and `"DEPARTURE"` (uppercase)

---

### Sub-Task 2 — Kafka struct & ksqlDB pipeline: add 4 new fields

**Status:** `[ ] pending`

**Intent**

The ksqlDB `JOURNEY_GAPS_PREDICTED_STREAM` struct and the `ALL_STATIONS_FLAT`
/ `PREDICTED_GAPS_FLAT` CSAS streams do not carry `scheduled_arrival`,
`scheduled_departure`, `actual_arrival`, or `actual_departure`.
Adding them ensures the JDBC Sink writes the new columns to Postgres.

**Expected Outcomes**

- `JOURNEY_GAPS_PREDICTED_STREAM` struct (in `05-predicted-gaps-sink-pipeline.sql`)
  has 4 new `VARCHAR` fields inside the `stations ARRAY<STRUCT<...>>`.
- `JOURNEY_GAPS_EXPLODED` struct is correspondingly widened.
- `ALL_STATIONS_FLAT` SELECT projects all 4 new fields via `station->xxx`.
- `PREDICTED_GAPS_FLAT` projects the same new fields.
- The `fields.whitelist` in `07-connector-journey-stations-sink.json` includes the
  4 new field names.
- The `transforms.lowerFields.renames` in the same connector maps them correctly.

**Todo List**

1. In `05-predicted-gaps-sink-pipeline.sql`, add 4 fields to the `JOURNEY_GAPS_PREDICTED_STREAM`
   stations struct:
   `scheduled_arrival VARCHAR, scheduled_departure VARCHAR, actual_arrival VARCHAR, actual_departure VARCHAR`
2. Widen the `JOURNEY_GAPS_EXPLODED` CSAS (it is a CREATE STREAM AS SELECT from the
   struct — ksqlDB derives its schema from the SELECT, so no explicit struct change
   needed, but the DROP/CREATE must be rerun).
3. Add the 4 new `station->xxx` projections to the `ALL_STATIONS_FLAT` SELECT.
4. Add them to `PREDICTED_GAPS_FLAT` SELECT (for infill pipeline completeness).
5. In `07-connector-journey-stations-sink.json`, add all 4 to `fields.whitelist`
   and add their UPPER→lower renames to `transforms.lowerFields.renames`.

**Relevant Context**

- File: `confluent-setup/05-predicted-gaps-sink-pipeline.sql` lines 33–48 (struct)
- File: `confluent-setup/07-connector-journey-stations-sink.json` lines 27–31
- Existing pattern for renames: `SCHEDULED_TIME:scheduled_time`, etc.
- The `JOURNEY_GAPS_EXPLODED` stream is defined via CSAS in step 2a of
  `05-predicted-gaps-sink-pipeline.sql` — DROP and recreate it when re-running.

---

### Sub-Task 3 — DB migration: add 4 columns to `journey_stations`

**Status:** `[ ] pending`

**Intent**

Add `scheduled_arrival`, `scheduled_departure`, `actual_arrival`, `actual_departure`
columns to the `journey_stations` Postgres table so the JDBC Sink can write them.

**Expected Outcomes**

- New migration file `exploration_ui/report-explorer/db/migrations/003_journey_stations_arr_dep.sql`
  exists with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for all 4 columns.
- Existing rows are unaffected (columns default to NULL).
- The migration is safe to run multiple times (`IF NOT EXISTS`).

**Todo List**

1. Create `exploration_ui/report-explorer/db/migrations/003_journey_stations_arr_dep.sql`.
2. Add `ALTER TABLE journey_stations ADD COLUMN IF NOT EXISTS scheduled_arrival TEXT;`
3. Add `ALTER TABLE journey_stations ADD COLUMN IF NOT EXISTS scheduled_departure TEXT;`
4. Add `ALTER TABLE journey_stations ADD COLUMN IF NOT EXISTS actual_arrival TEXT;`
5. Add `ALTER TABLE journey_stations ADD COLUMN IF NOT EXISTS actual_departure TEXT;`

**Relevant Context**

- File: `exploration_ui/report-explorer/db/migrations/002_journey_stations_table.sql`
  — follow the same BEGIN/COMMIT pattern and `IF NOT EXISTS` guards.

---

### Sub-Task 4 — Infill predictor: use arrival times for delay, both for interpolation

**Status:** `[ ] pending`

**Intent**

`infill_predictor.py` currently uses `scheduled_time` (departure-biased) and
`actual_time` when computing delays and choosing interpolation neighbours.
It should:
- Compare against `scheduled_arrival` (when available) to compute how late a train
  arrived. Departure is secondary — if arrival is missing, fall back to departure.
- Use `actual_arrival or actual_departure` as the actual epoch for interpolation,
  in that priority order.
- When building the `prediction_basis` reasoning dict, note which event types were used.

**Expected Outcomes**

- `_is_on_time` and delay calculations use `scheduled_arrival` → `scheduled_departure`
  → `scheduled_time` in that priority order.
- Interpolation uses `actual_arrival or actual_departure or actual_time` as the
  epoch for each neighbour.
- `predict_missed_stop` prediction basis records `"arrival_used": true/false`.
- Existing behaviour is preserved when new fields are absent (graceful fallback).

**Todo List**

1. In `infill_predictor.py`, add a helper `_best_actual(station)` that returns the
   first non-null from `actual_arrival`, `actual_departure`, `actual_time`.
2. Add a helper `_best_scheduled(station)` that returns the first non-null from
   `scheduled_arrival`, `scheduled_departure`, `scheduled_time`.
3. Replace all direct `.get("actual_time")` calls in `predict_missed_stop` and
   `_is_on_time` with `_best_actual(station)`.
4. Replace all direct `.get("scheduled_time")` delay-calculation calls with
   `_best_scheduled(station)`.
5. Update `prediction_basis` dicts to include which fields were used.

**Relevant Context**

- File: `gap_detector/infill_predictor.py`
- `_is_on_time`: line 157 — uses `actual_time` and `scheduled_time`
- `predict_missed_stop`: line 173 — uses `actual_time` via `_parse_hhmmss_to_ms`
- Helpers `_parse_hhmm_to_ms` / `_parse_hhmmss_to_ms` are already present — reuse them.

---

### Sub-Task 5 — Delayed-trains API: delay based on arrival

**Status:** `[ ] pending`

**Intent**

`GET /api/delayed-trains` computes delay by picking the first visited stop per
journey (DISTINCT ON, station_index ASC) and comparing `actual_time` vs `scheduled_time`.
With the new columns, it should:
- Prefer the stop's `actual_arrival` over `actual_departure` for the actual time.
- Prefer `scheduled_arrival` over `scheduled_departure` over `scheduled_time` for
  the scheduled baseline.
- The existing midnight-crossing delay arithmetic is correct and need not change.

**Expected Outcomes**

- The `first_visited` CTE uses `COALESCE(actual_arrival, actual_departure, actual_time)`
  and `COALESCE(scheduled_arrival, scheduled_departure, scheduled_time)` in the delay
  calculation.
- The API response column names remain unchanged so the frontend requires no update.
- The `WHERE visited = true AND actual_time IS NOT NULL` guard also accepts rows where
  only `actual_arrival` is set (COALESCE handles this).

**Todo List**

1. In `route.ts` `first_visited` CTE, change the `actual_time IS NOT NULL` guard to
   `COALESCE(actual_arrival, actual_departure, actual_time) IS NOT NULL`.
2. Change the `actual_time ~ '^\\d{2}:\\d{2}'` regex guard similarly.
3. Replace the `actual_time` and `scheduled_time` references in the `with_delay`
   delay-minutes arithmetic with the appropriate COALESCEs.
4. Keep `actual_time` and `scheduled_time` in the SELECT for the origin_station
   display columns — frontend uses them as labels.

**Relevant Context**

- File: `exploration_ui/report-explorer/src/app/api/delayed-trains/route.ts`
- Delay arithmetic block: lines 97–105
- `first_visited` CTE guard: lines 41–48

---

### Sub-Task 6 — Per-train API & page: show ARR and DEP columns

**Status:** `[ ] pending`

**Intent**

The per-train detail view (`/trains/[trainId]`) currently shows a single
"Scheduled" and "Actual" column per stop. With separate arrival/departure times
available, the table should show:
- **Sched Arr** / **Sched Dep** instead of a single "Scheduled"
- **Actual Arr** / **Actual Dep** instead of a single "Actual"
- The delay badge still computes against ARR (actual_arrival vs scheduled_arrival,
  with fallback).
- The predicted time infill (blue clock icon) appears in the **Actual Arr** column
  for missed stops.

**Expected Outcomes**

- `GET /api/trains/[trainId]` response includes `scheduled_arrival`,
  `scheduled_departure`, `actual_arrival`, `actual_departure` in each record row.
- `trains/[trainId]/page.tsx` table renders separate ARR/DEP columns.
- The delay label uses `actual_arrival` (or fallback) vs `scheduled_arrival`
  (or fallback).

**Todo List**

1. In `exploration_ui/report-explorer/src/app/api/trains/[trainId]/route.ts`,
   add `js.scheduled_arrival`, `js.scheduled_departure`, `js.actual_arrival`,
   `js.actual_departure` to the primary `journey_stations` SELECT, with the same
   `normaliseTime` mapping applied on the way out.
2. Update the secondary `predicted_gaps` SELECT similarly (columns will be NULL for
   older records — that is fine).
3. In `trains/[trainId]/page.tsx`, add the 4 fields to `PredictedGapStop` interface.
4. Replace the single "Scheduled" `<th>` with two: "Sched Arr" and "Sched Dep".
5. Replace the single "Actual" `<th>` with two: "Act Arr" and "Act Dep".
6. Update the delay calculation to use `actual_arrival ?? actual_time` vs
   `scheduled_arrival ?? scheduled_time`.
7. Keep the predicted time in the "Act Arr" cell for missed stops.

**Relevant Context**

- File: `exploration_ui/report-explorer/src/app/api/trains/[trainId]/route.ts`
  lines 53–110 (primary SELECT)
- File: `exploration_ui/report-explorer/src/app/trains/[trainId]/page.tsx`
  lines 25–51 (PredictedGapStop interface), lines 522–539 (table cells)
- The `normaliseTime` function at line 4 of the route handles all time formats.

---

## Implementation Order

Sub-tasks must be done in order — each layer depends on the previous:

1. Sub-Task 1 (Python detector) — produces new Kafka fields
2. Sub-Task 2 (ksqlDB/Kafka struct) — carries them through the pipeline
3. Sub-Task 3 (DB migration) — creates the columns the Sink writes to
4. Sub-Task 4 (Infill predictor) — consumes the new fields for better predictions
5. Sub-Task 5 (Delayed-trains API) — queries arrival-based delay
6. Sub-Task 6 (Per-train API + page) — displays both columns

Re-deploying the Kafka pipeline (Sub-Tasks 1–3) requires:
- Restarting the gap-detector pod (picks up new Python code).
- Dropping and recreating the ksqlDB streams `JOURNEY_GAPS_PREDICTED_STREAM`,
  `JOURNEY_GAPS_EXPLODED`, `ALL_STATIONS_FLAT`, `PREDICTED_GAPS_FLAT`
  (run `05-predicted-gaps-sink-pipeline.sql` again with `SET auto.offset.reset = earliest`).
- Updating and restarting the Confluent JDBC Sink connector
  `07-connector-journey-stations-sink.json`.
- Running the DB migration `003_journey_stations_arr_dep.sql`.
