#!/usr/bin/env python3
"""
Infill Time Predictor — payload-only implementation.

Predicts passing times for missed stations using the surrounding visited-station
actual timestamps that are already present in the gap detector's stations[] array.
No database connection required.

Prediction strategies (applied in order):
  1. ON_TIME_INTERPOLATION   — both neighbours are on-time (≤ threshold) → use scheduled time
  2. LINEAR_INTERPOLATION    — both neighbours present, interpolate between their actual timestamps
                               by fractional schedule position
  3. SINGLE_STATION_EXTRAPOLATION — only one neighbour; offset from its actual time by the
                               scheduled inter-station gap, preserving the running delay
  4. SCHEDULE_ONLY           — no neighbour data; fall back to scheduled time, low confidence

Arrival / departure rules
──────────────────────────
Each missed stop receives both predicted_arrival and predicted_departure where
applicable, subject to timetabling constraints:

  • ORIGIN stop (first stop in journey)  — no arrival; departure only.
    The train starts here so there is no inbound arrival time.
    Neighbour actual times are sampled using departure times where available.

  • DESTINATION stop (last stop in journey) — no departure; arrival only.
    The train terminates here so there is no outbound departure time.
    Neighbour actual times are sampled using arrival times where available.

  • JUNCTION / PASSTHROUGH stop — a single predicted time only.
    Detected when the stop has only one scheduled time field (either
    scheduled_arrival or scheduled_departure is absent/null), meaning
    the train passes through without a public dwell.  The single time
    is written to whichever field is present; neighbours are sampled
    with a preference matching that field (arrival or departure).

  • INTERMEDIATE passenger stop — both arrival and departure.
    Two separate anchors are computed:
      predicted_arrival  — interpolated/extrapolated from neighbour arrival times
      predicted_departure — interpolated/extrapolated from neighbour departure times
    When a neighbour has no explicit actual_departure the arrival time is used
    as a fallback so that the prediction still runs.

The legacy predicted_time field is always set for backwards compatibility:
  • ORIGIN        → predicted_departure
  • DESTINATION   → predicted_arrival
  • JUNCTION      → the single pass-through time
  • INTERMEDIATE  → predicted_arrival

Each station object in the stations[] list is expected to have at minimum:
    station_index        int
    tiploc               str
    stanox               str
    visited              bool
    scheduled_time       str | None   — "HH:MM" legacy single time
    scheduled_arrival    str | None   — "HH:MM"
    scheduled_departure  str | None   — "HH:MM"
    actual_time          str | None   — "HH:MM:SS" (visited stops only)
    actual_arrival       str | None   — "HH:MM:SS"
    actual_departure     str | None   — "HH:MM:SS"

The predictor adds to each missed stop:
    predicted_arrival        str | None   — "HH:MM:SS"
    predicted_departure      str | None   — "HH:MM:SS"
    predicted_arrival_ms     int | None   — epoch ms
    predicted_departure_ms   int | None   — epoch ms
    predicted_time           str | None   — "HH:MM:SS" (legacy, see rules above)
    predicted_time_ms        int | None   — epoch ms (legacy)
    predicted_delay_minutes  int
    prediction_method        str
    prediction_confidence    float  0–1
    prediction_basis         dict         — human-readable reasoning
    stop_role                str          — ORIGIN | DESTINATION | JUNCTION | INTERMEDIATE
"""

import logging
import zoneinfo
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

ON_TIME_THRESHOLD_MINUTES = 3   # ± minutes to consider "on-time"

# ---------------------------------------------------------------------------
# Stop roles
# ---------------------------------------------------------------------------

ROLE_ORIGIN       = "ORIGIN"
ROLE_DESTINATION  = "DESTINATION"
ROLE_JUNCTION     = "JUNCTION"
ROLE_INTERMEDIATE = "INTERMEDIATE"


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def _parse_hhmm_to_ms(time_str: Optional[str], schedule_date: Optional[str]) -> Optional[int]:
    """
    Parse "HH:MM" or "HHMM" scheduled time string to epoch ms (UTC),
    anchored to schedule_date (YYYY-MM-DD, UK local).
    Returns None if anything is missing or unparseable.
    """
    if not time_str or not schedule_date:
        return None
    try:
        clean = time_str.replace(":", "").replace("H", "").strip()
        if len(clean) < 4 or not clean[:4].isdigit():
            return None
        hour, minute = int(clean[:2]), int(clean[2:4])
        uk = zoneinfo.ZoneInfo("Europe/London")
        base = datetime.strptime(schedule_date, "%Y-%m-%d")
        local_dt = base.replace(hour=hour, minute=minute, second=0, microsecond=0, tzinfo=uk)
        return int(local_dt.timestamp() * 1000)
    except Exception:
        return None


def _parse_hhmmss_to_ms(time_str: Optional[str], schedule_date: Optional[str]) -> Optional[int]:
    """
    Parse "HH:MM:SS" actual time string to epoch ms (UTC),
    anchored to schedule_date (YYYY-MM-DD, UK local).
    """
    if not time_str or not schedule_date:
        return None
    try:
        parts = time_str.strip().split(":")
        if len(parts) < 2:
            return None
        hour, minute = int(parts[0]), int(parts[1])
        second = int(parts[2]) if len(parts) > 2 else 0
        uk = zoneinfo.ZoneInfo("Europe/London")
        base = datetime.strptime(schedule_date, "%Y-%m-%d")
        local_dt = base.replace(hour=hour, minute=minute, second=second, microsecond=0, tzinfo=uk)
        return int(local_dt.timestamp() * 1000)
    except Exception:
        return None


def _ms_to_hhmmss(epoch_ms: Optional[int]) -> Optional[str]:
    """Epoch ms → "HH:MM:SS" UK local time string."""
    if epoch_ms is None:
        return None
    try:
        uk = zoneinfo.ZoneInfo("Europe/London")
        return datetime.fromtimestamp(epoch_ms / 1000.0, tz=uk).strftime("%H:%M:%S")
    except Exception:
        return None


def _delay_minutes(actual_ms: Optional[int], scheduled_ms: Optional[int]) -> Optional[float]:
    """Return (actual - scheduled) in minutes, or None if either is absent."""
    if actual_ms is None or scheduled_ms is None:
        return None
    return (actual_ms - scheduled_ms) / 60_000.0


def _actual_arrival_time(station: Dict[str, Any]) -> Optional[str]:
    """Best actual arrival time: actual_arrival → actual_time."""
    return station.get("actual_arrival") or station.get("actual_time")


def _actual_departure_time(station: Dict[str, Any]) -> Optional[str]:
    """Best actual departure time: actual_departure → actual_time."""
    return station.get("actual_departure") or station.get("actual_time")


def _best_actual_time(station: Dict[str, Any]) -> Optional[str]:
    """
    Return the best available actual time string for a station, preferring
    arrival over departure over the legacy single actual_time field.
    Used as a general fallback and for delay-on-time checks.
    """
    return (
        station.get("actual_arrival") or
        station.get("actual_departure") or
        station.get("actual_time")
    )


def _best_scheduled_time(station: Dict[str, Any]) -> Optional[str]:
    """
    Return the best available scheduled time string for a station, preferring
    arrival over departure over the legacy single scheduled_time field.
    Delays must always be computed against arrival time.
    """
    return (
        station.get("scheduled_arrival") or
        station.get("scheduled_departure") or
        station.get("scheduled_time")
    )


def _scheduled_arrival_time(station: Dict[str, Any]) -> Optional[str]:
    """Best scheduled arrival time: scheduled_arrival → scheduled_time."""
    return station.get("scheduled_arrival") or station.get("scheduled_time")


def _scheduled_departure_time(station: Dict[str, Any]) -> Optional[str]:
    """Best scheduled departure time: scheduled_departure → scheduled_time."""
    return station.get("scheduled_departure") or station.get("scheduled_time")


def _scheduled_dwell_ms(station: Dict[str, Any], schedule_date: Optional[str]) -> int:
    """
    Return the scheduled dwell time in milliseconds (departure − arrival).
    Returns 0 if either time is absent or the result is negative.
    """
    arr_ms = _parse_hhmm_to_ms(station.get("scheduled_arrival") or station.get("scheduled_time"),
                                schedule_date)
    dep_ms = _parse_hhmm_to_ms(station.get("scheduled_departure") or station.get("scheduled_time"),
                                schedule_date)
    if arr_ms is None or dep_ms is None:
        return 0
    dwell = dep_ms - arr_ms
    # Handle midnight rollover (e.g. arr 23:59, dep 00:01)
    if dwell < 0:
        dwell += 86_400_000  # 24 h in ms
    return max(0, dwell)


def _classify_stop_role(
    station: Dict[str, Any],
    all_stations: List[Dict[str, Any]],
) -> str:
    """
    Classify the timetabling role of a stop.

    ORIGIN      — first stop in the ordered journey (no inbound arrival)
    DESTINATION — last stop in the ordered journey (no outbound departure)
    JUNCTION    — timing point only: only one scheduled time exists, meaning
                  the train passes through without a public dwell period
    INTERMEDIATE — passenger stop with both arrival and departure
    """
    # Sort all stations by station_index to find true first/last
    sorted_indices = sorted(
        [s.get("station_index", 0) for s in all_stations]
    )
    if not sorted_indices:
        return ROLE_INTERMEDIATE

    my_idx = station.get("station_index", 0)

    if my_idx == sorted_indices[0]:
        return ROLE_ORIGIN

    if my_idx == sorted_indices[-1]:
        return ROLE_DESTINATION

    # Junction/passthrough: only one of scheduled_arrival / scheduled_departure
    # is present (the other is null/absent).  A stop with only scheduled_time
    # (legacy single field) and no separate arr/dep is also a passthrough.
    has_arr = bool(station.get("scheduled_arrival"))
    has_dep = bool(station.get("scheduled_departure"))

    if has_arr and not has_dep:
        return ROLE_JUNCTION
    if has_dep and not has_arr:
        return ROLE_JUNCTION
    if not has_arr and not has_dep:
        # Legacy single scheduled_time only — treat as passthrough
        return ROLE_JUNCTION

    return ROLE_INTERMEDIATE


# ---------------------------------------------------------------------------
# Per-role time selection helpers
# ---------------------------------------------------------------------------

def _role_actual_arrival(station: Dict[str, Any]) -> Optional[str]:
    """Actual arrival time for a station (arrival → legacy fallback)."""
    return _actual_arrival_time(station)


def _role_actual_departure(station: Dict[str, Any]) -> Optional[str]:
    """Actual departure time for a station (departure → legacy fallback)."""
    return _actual_departure_time(station)


def _role_sched_arrival(station: Dict[str, Any]) -> Optional[str]:
    """Scheduled arrival time for a station (arrival → legacy fallback)."""
    return _scheduled_arrival_time(station)


def _role_sched_departure(station: Dict[str, Any]) -> Optional[str]:
    """Scheduled departure time for a station (departure → legacy fallback)."""
    return _scheduled_departure_time(station)


# ---------------------------------------------------------------------------
# Predictor
# ---------------------------------------------------------------------------

class InfillPredictor:
    """
    Predicts passing times for missed stops using only data already present
    in the stations[] list produced by the gap detector.
    """

    def __init__(self, on_time_threshold_minutes: int = ON_TIME_THRESHOLD_MINUTES):
        self.on_time_threshold = on_time_threshold_minutes

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _neighbours(
        self,
        stations: List[Dict[str, Any]],
        missed_idx: int,
    ) -> Tuple[Optional[Dict], Optional[Dict]]:
        """
        Return the nearest visited stop before and after missed_idx.
        Uses station_index for ordering.
        """
        before: Optional[Dict] = None
        after:  Optional[Dict] = None

        for s in stations:
            if not s.get("visited"):
                continue
            si = s.get("station_index", 0)
            mi = stations[missed_idx].get("station_index", missed_idx)
            if si < mi:
                if before is None or si > before.get("station_index", -1):
                    before = s
            elif si > mi:
                if after is None or si < after.get("station_index", 9999):
                    after = s

        return before, after

    def _is_on_time(
        self,
        station: Dict[str, Any],
        schedule_date: Optional[str],
    ) -> bool:
        actual_ms    = _parse_hhmmss_to_ms(_best_actual_time(station), schedule_date)
        scheduled_ms = _parse_hhmm_to_ms(_best_scheduled_time(station), schedule_date)
        delay = _delay_minutes(actual_ms, scheduled_ms)
        if delay is None:
            return False
        return abs(delay) <= self.on_time_threshold

    def _compute_anchor(
        self,
        missed_station: Dict[str, Any],
        missed_idx: int,
        stations: List[Dict[str, Any]],
        schedule_date: Optional[str],
        get_actual_fn,
        get_sched_fn,
    ) -> Tuple[Optional[int], str, Any, Any, Optional[float]]:
        """
        Compute a single predicted epoch-ms anchor for a missed stop, using the
        supplied per-type time-extraction callables.

        get_actual_fn(station) → actual "HH:MM:SS" str or None
        get_sched_fn(station)  → scheduled "HH:MM" str or None

        Returns: (pred_ms, method, before_station, after_station, weight_or_none)
          pred_ms  — predicted epoch ms, or None if no prediction possible
          method   — strategy name string
          before   — before-neighbour dict (may be None)
          after    — after-neighbour dict (may be None)
          weight   — interpolation weight [0..1] if LINEAR, else None
        """
        sched_ms = _parse_hhmm_to_ms(get_sched_fn(missed_station), schedule_date)
        before, after = self._neighbours(stations, missed_idx)

        # ---- Strategy 1: both neighbours on-time → use scheduled time ----
        if before and after:
            before_on_time = self._is_on_time(before, schedule_date)
            after_on_time  = self._is_on_time(after,  schedule_date)

            if before_on_time and after_on_time and sched_ms is not None:
                return sched_ms, "ON_TIME_INTERPOLATION", before, after, None

            # ---- Strategy 2: delay-weighted scheduled time ----
            # Apply a schedule-position-weighted blend of each neighbour's delay
            # to the missed stop's scheduled time.  This correctly handles:
            #   • non-uniform stop spacing (depot sidings, close-together stops)
            #   • multiple consecutive missed stops sharing the same neighbours
            #   • trains running early (negative delay)
            # Raw timestamp interpolation was intentionally removed: it compressed
            # all missed stops into the actual time window between neighbours,
            # ignoring the scheduled spacing between those stops.
            before_ms = _parse_hhmmss_to_ms(get_actual_fn(before), schedule_date)
            after_ms  = _parse_hhmmss_to_ms(get_actual_fn(after),  schedule_date)

            before_sched_ms = _parse_hhmm_to_ms(get_sched_fn(before), schedule_date)
            after_sched_ms  = _parse_hhmm_to_ms(get_sched_fn(after),  schedule_date)

            before_delay = _delay_minutes(before_ms, before_sched_ms) or 0.0
            after_delay  = _delay_minutes(after_ms,  after_sched_ms)  or 0.0

            weight: Optional[float] = None
            pred_ms: Optional[int] = None

            if sched_ms is not None:
                if (
                    before_sched_ms is not None
                    and after_sched_ms is not None
                    and after_sched_ms > before_sched_ms
                    # Only use weighted blend when neighbours are on the same leg
                    # (actual times monotonically increase with schedule)
                    and (before_ms is None or after_ms is None or after_ms > before_ms)
                ):
                    # Weight by scheduled position between the two neighbours
                    sched_span = after_sched_ms - before_sched_ms
                    weight = (sched_ms - before_sched_ms) / sched_span
                    blended_delay = before_delay + weight * (after_delay - before_delay)
                    pred_ms = int(sched_ms + blended_delay * 60_000)
                else:
                    # Fallback: simple average of the two neighbour delays
                    avg_delay = (before_delay + after_delay) / 2.0
                    pred_ms = int(sched_ms + avg_delay * 60_000)

            if pred_ms is not None:
                return pred_ms, "LINEAR_INTERPOLATION", before, after, weight

        # ---- Strategy 3: single neighbour — offset by scheduled gap ----
        # Prefer the closer neighbour (before), fall back to after.
        # Guard: if the scheduled gap exceeds ±2 h the neighbour is almost
        # certainly on the opposite leg of a round-trip; skip it and try the
        # other side.
        _2H_MS = 7_200_000
        for ref in (before, after):
            if ref is None:
                continue
            ref_actual_ms = _parse_hhmmss_to_ms(get_actual_fn(ref), schedule_date)
            ref_sched_ms  = _parse_hhmm_to_ms(get_sched_fn(ref), schedule_date)
            if ref_actual_ms is None or sched_ms is None or ref_sched_ms is None:
                continue
            sched_gap_ms = sched_ms - ref_sched_ms
            if abs(sched_gap_ms) > _2H_MS:
                # Neighbour is on the opposite leg — skip
                continue
            pred_ms = ref_actual_ms + sched_gap_ms
            return pred_ms, "SINGLE_STATION_EXTRAPOLATION", before, after, None

        # ---- Strategy 4: schedule only ----
        if sched_ms is not None:
            return sched_ms, "SCHEDULE_ONLY", before, after, None

        return None, "INSUFFICIENT_DATA", before, after, None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict_missed_stop(
        self,
        missed_station: Dict[str, Any],
        stations: List[Dict[str, Any]],
        schedule_date: Optional[str],
    ) -> Dict[str, Any]:
        """
        Predict the passing time for a single missed stop.

        For INTERMEDIATE stops, two independent anchors are computed:
          • arrival anchor  — derived from neighbours' actual_arrival times
          • departure anchor — derived from neighbours' actual_departure times
        For ORIGIN stops only the departure anchor is computed; for DESTINATION
        only the arrival anchor.  For JUNCTION stops the anchor matches the
        single scheduled field that is present.

        Args:
            missed_station: The station dict for the missed stop.
            stations:       Full ordered stations[] list for the journey.
            schedule_date:  "YYYY-MM-DD" date of the service (UK local).

        Returns the same missed_station dict with prediction fields added
        in-place (also returned for convenience).
        """
        missed_idx = next(
            (i for i, s in enumerate(stations) if s is missed_station),
            None
        )
        if missed_idx is None:
            return missed_station

        # Determine stop role before running prediction
        role = _classify_stop_role(missed_station, stations)

        # Resolve neighbours once here so the boundary clamp below can use them
        _before, _after = self._neighbours(stations, missed_idx)

        # ------------------------------------------------------------------
        # Choose which anchors to compute based on role
        # ------------------------------------------------------------------
        if role == ROLE_ORIGIN:
            # Departure only — use departure times throughout
            dep_ms, method, before, after, weight = self._compute_anchor(
                missed_station, missed_idx, stations, schedule_date,
                get_actual_fn=_role_actual_departure,
                get_sched_fn=_role_sched_departure,
            )
            arr_ms = None
            # For basis/confidence we need neighbour detail
            self._write_prediction(
                missed_station, role, schedule_date,
                pred_arr_ms=None, pred_dep_ms=dep_ms,
                method=method, before=before, after=after, weight=weight,
                actual_fn=_role_actual_departure, sched_fn=_role_sched_departure,
            )

        elif role == ROLE_DESTINATION:
            # Arrival only — use arrival times throughout
            arr_ms, method, before, after, weight = self._compute_anchor(
                missed_station, missed_idx, stations, schedule_date,
                get_actual_fn=_role_actual_arrival,
                get_sched_fn=_role_sched_arrival,
            )
            self._write_prediction(
                missed_station, role, schedule_date,
                pred_arr_ms=arr_ms, pred_dep_ms=None,
                method=method, before=before, after=after, weight=weight,
                actual_fn=_role_actual_arrival, sched_fn=_role_sched_arrival,
            )

        elif role == ROLE_JUNCTION:
            # Single passthrough — use whichever scheduled field is present
            has_sched_dep = bool(missed_station.get("scheduled_departure"))
            if has_sched_dep and not missed_station.get("scheduled_arrival"):
                actual_fn = _role_actual_departure
                sched_fn  = _role_sched_departure
                dep_ms, method, before, after, weight = self._compute_anchor(
                    missed_station, missed_idx, stations, schedule_date,
                    get_actual_fn=actual_fn, get_sched_fn=sched_fn,
                )
                self._write_prediction(
                    missed_station, role, schedule_date,
                    pred_arr_ms=None, pred_dep_ms=dep_ms,
                    method=method, before=before, after=after, weight=weight,
                    actual_fn=actual_fn, sched_fn=sched_fn,
                )
            else:
                actual_fn = _role_actual_arrival
                sched_fn  = _role_sched_arrival
                arr_ms, method, before, after, weight = self._compute_anchor(
                    missed_station, missed_idx, stations, schedule_date,
                    get_actual_fn=actual_fn, get_sched_fn=sched_fn,
                )
                self._write_prediction(
                    missed_station, role, schedule_date,
                    pred_arr_ms=arr_ms, pred_dep_ms=None,
                    method=method, before=before, after=after, weight=weight,
                    actual_fn=actual_fn, sched_fn=sched_fn,
                )

        else:  # INTERMEDIATE
            # Two independent anchors — arrival and departure
            arr_ms, arr_method, before_a, after_a, weight_a = self._compute_anchor(
                missed_station, missed_idx, stations, schedule_date,
                get_actual_fn=_role_actual_arrival,
                get_sched_fn=_role_sched_arrival,
            )
            dep_ms, dep_method, before_d, after_d, weight_d = self._compute_anchor(
                missed_station, missed_idx, stations, schedule_date,
                get_actual_fn=_role_actual_departure,
                get_sched_fn=_role_sched_departure,
            )
            # Use the stronger (arrival) prediction as the primary method/confidence
            method = arr_method or dep_method
            before = before_a or before_d
            after  = after_a  or after_d
            weight = weight_a if weight_a is not None else weight_d
            self._write_prediction(
                missed_station, role, schedule_date,
                pred_arr_ms=arr_ms, pred_dep_ms=dep_ms,
                method=method, before=before, after=after, weight=weight,
                actual_fn=_role_actual_arrival, sched_fn=_role_sched_arrival,
                dep_method=dep_method,
                dep_actual_fn=_role_actual_departure, dep_sched_fn=_role_sched_departure,
            )

        # ------------------------------------------------------------------
        # Safety net: if any scheduled time exists but the corresponding
        # predicted field is still null (e.g. INSUFFICIENT_DATA with no
        # neighbours, or a JUNCTION whose only time is the legacy
        # scheduled_time field), fill from schedule with SCHEDULE_ONLY so
        # that the UI always shows a predicted time for every missed stop
        # that has timetable data.
        # ------------------------------------------------------------------
        # Role-aware: ORIGIN never gets an arrival, DESTINATION never gets a
        # departure, and a JUNCTION gets a single time (arrival preferred).
        sched_arr_str = _scheduled_arrival_time(missed_station)
        sched_dep_str = _scheduled_departure_time(missed_station)
        if role == ROLE_ORIGIN:
            sched_arr_str = None
        elif role == ROLE_DESTINATION:
            sched_dep_str = None
        elif role == ROLE_JUNCTION:
            if missed_station.get("predicted_departure") is not None:
                sched_arr_str = None
            if sched_arr_str:
                sched_dep_str = None

        if missed_station.get("predicted_arrival") is None and sched_arr_str:
            arr_ms_fallback = _parse_hhmm_to_ms(sched_arr_str, schedule_date)
            if arr_ms_fallback is not None:
                missed_station["predicted_arrival"]    = _ms_to_hhmmss(arr_ms_fallback)
                missed_station["predicted_arrival_ms"] = arr_ms_fallback
                # Upgrade method/confidence if we had nothing at all
                if not missed_station.get("prediction_method") or missed_station.get("prediction_method") == "INSUFFICIENT_DATA":
                    missed_station["prediction_method"]     = "SCHEDULE_ONLY"
                    missed_station["prediction_confidence"] = 0.50
                if missed_station.get("predicted_time") is None:
                    missed_station["predicted_time"]    = _ms_to_hhmmss(arr_ms_fallback)
                    missed_station["predicted_time_ms"] = arr_ms_fallback

        if missed_station.get("predicted_departure") is None and sched_dep_str:
            dep_ms_fallback = _parse_hhmm_to_ms(sched_dep_str, schedule_date)
            if dep_ms_fallback is not None:
                missed_station["predicted_departure"]    = _ms_to_hhmmss(dep_ms_fallback)
                missed_station["predicted_departure_ms"] = dep_ms_fallback
                if not missed_station.get("prediction_method") or missed_station.get("prediction_method") == "INSUFFICIENT_DATA":
                    missed_station["prediction_method"]     = "SCHEDULE_ONLY"
                    missed_station["prediction_confidence"] = 0.50
                if missed_station.get("predicted_time") is None:
                    missed_station["predicted_time"]    = _ms_to_hhmmss(dep_ms_fallback)
                    missed_station["predicted_time_ms"] = dep_ms_fallback

        # ------------------------------------------------------------------
        # Physical boundary clamps — enforce journey-level monotonicity.
        #
        # Rule 1: pred_arr >= actual_departure of the nearest visited stop
        #         before this one (a train cannot arrive before it left the
        #         previous station).
        # Rule 2: pred_dep <= actual_arrival of the nearest visited stop
        #         after this one (a train cannot leave after it was already
        #         recorded at the next station).
        # Rule 3: pred_dep >= pred_arr (departure cannot precede arrival).
        #
        # All three are applied in order so each corrects the next.
        # ------------------------------------------------------------------
        final_arr_ms = missed_station.get("predicted_arrival_ms")
        final_dep_ms = missed_station.get("predicted_departure_ms")

        # Rule 1 — floor on arrival: must be >= before-neighbour's actual departure
        if _before is not None and final_arr_ms is not None:
            before_dep_ms = _parse_hhmmss_to_ms(
                _actual_departure_time(_before), schedule_date
            )
            if before_dep_ms is not None and final_arr_ms < before_dep_ms:
                final_arr_ms = before_dep_ms
                missed_station["predicted_arrival"]    = _ms_to_hhmmss(final_arr_ms)
                missed_station["predicted_arrival_ms"] = final_arr_ms

        # Rule 2 — ceiling on departure: must be <= after-neighbour's actual arrival
        if _after is not None and final_dep_ms is not None:
            after_arr_ms = _parse_hhmmss_to_ms(
                _actual_arrival_time(_after), schedule_date
            )
            if after_arr_ms is not None and final_dep_ms > after_arr_ms:
                final_dep_ms = after_arr_ms
                missed_station["predicted_departure"]    = _ms_to_hhmmss(final_dep_ms)
                missed_station["predicted_departure_ms"] = final_dep_ms

        # Rule 3 — departure must not precede arrival
        if (
            final_arr_ms is not None
            and final_dep_ms is not None
            and final_dep_ms < final_arr_ms
        ):
            missed_station["predicted_departure"]    = missed_station["predicted_arrival"]
            missed_station["predicted_departure_ms"] = final_arr_ms

        return missed_station

    def predict_all_missed(
        self,
        stations: List[Dict[str, Any]],
        schedule_date: Optional[str],
    ) -> int:
        """
        Run prediction on every missed stop in stations[].
        Mutates each missed stop in-place.  Returns count of stops predicted.
        """
        count = 0
        for station in stations:
            if not station.get("visited"):
                self.predict_missed_stop(station, stations, schedule_date)
                count += 1
        return count

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _write_prediction(
        self,
        station: Dict[str, Any],
        role: str,
        schedule_date: Optional[str],
        pred_arr_ms: Optional[int],
        pred_dep_ms: Optional[int],
        method: str,
        before: Optional[Dict],
        after: Optional[Dict],
        weight: Optional[float],
        actual_fn,
        sched_fn,
        dep_method: Optional[str] = None,
        dep_actual_fn=None,
        dep_sched_fn=None,
    ) -> None:
        """
        Write all prediction fields onto a missed stop, computing confidence
        and building the prediction_basis dict.
        """
        if method == "INSUFFICIENT_DATA" and pred_arr_ms is None and pred_dep_ms is None:
            station["stop_role"]               = role
            station["prediction_method"]       = "INSUFFICIENT_DATA"
            station["prediction_confidence"]   = 0.0
            station["predicted_arrival"]       = None
            station["predicted_arrival_ms"]    = None
            station["predicted_departure"]     = None
            station["predicted_departure_ms"]  = None
            station["predicted_time"]          = None
            station["predicted_time_ms"]       = None
            station["predicted_delay_minutes"] = None
            station["prediction_basis"]        = {
                "reasoning": "No scheduled time and no neighbour data",
                "stop_role": role,
            }
            return

        # Determine confidence from the primary anchor method and neighbour delay spread
        confidence = self._confidence_for(method, before, after, schedule_date, actual_fn, sched_fn)

        # Delay minutes against the primary anchor
        primary_ms   = pred_arr_ms if pred_arr_ms is not None else pred_dep_ms
        primary_sched_str = sched_fn(station)
        primary_sched_ms  = _parse_hhmm_to_ms(primary_sched_str, schedule_date)
        delay_min = int(round(_delay_minutes(primary_ms, primary_sched_ms) or 0))

        # Build legacy field: the single time consumers relied on pre-v2
        if role == ROLE_ORIGIN:
            legacy_ms = pred_dep_ms
        elif role == ROLE_DESTINATION:
            legacy_ms = pred_arr_ms
        elif role == ROLE_JUNCTION:
            legacy_ms = pred_dep_ms if pred_dep_ms is not None else pred_arr_ms
        else:
            legacy_ms = pred_arr_ms

        # Basis reasoning
        basis = self._build_basis(
            method, role, before, after, weight, schedule_date, station,
            actual_fn, sched_fn,
            dep_method=dep_method,
            dep_actual_fn=dep_actual_fn,
            dep_sched_fn=dep_sched_fn,
        )

        station["stop_role"]                = role
        station["predicted_arrival"]        = _ms_to_hhmmss(pred_arr_ms)
        station["predicted_arrival_ms"]     = pred_arr_ms
        station["predicted_departure"]      = _ms_to_hhmmss(pred_dep_ms)
        station["predicted_departure_ms"]   = pred_dep_ms
        station["predicted_time"]           = _ms_to_hhmmss(legacy_ms)
        station["predicted_time_ms"]        = legacy_ms
        station["predicted_delay_minutes"]  = delay_min
        station["prediction_confidence"]    = confidence
        station["prediction_method"]        = method
        station["prediction_basis"]         = basis

    def _confidence_for(
        self,
        method: str,
        before: Optional[Dict],
        after: Optional[Dict],
        schedule_date: Optional[str],
        actual_fn,
        sched_fn,
    ) -> float:
        if method == "ON_TIME_INTERPOLATION":
            return 0.95
        if method == "SCHEDULE_ONLY":
            return 0.50
        if method == "SINGLE_STATION_EXTRAPOLATION":
            return 0.70
        # LINEAR_INTERPOLATION — degrade with neighbour delay spread
        if before and after:
            before_delay = _delay_minutes(
                _parse_hhmmss_to_ms(actual_fn(before), schedule_date),
                _parse_hhmm_to_ms(sched_fn(before), schedule_date)
            ) or 0.0
            after_delay = _delay_minutes(
                _parse_hhmmss_to_ms(actual_fn(after), schedule_date),
                _parse_hhmm_to_ms(sched_fn(after), schedule_date)
            ) or 0.0
            delay_diff = abs(before_delay - after_delay)
            return round(max(0.6, 0.9 - delay_diff / 30.0), 2)
        return 0.70

    def _build_basis(
        self,
        method: str,
        role: str,
        before: Optional[Dict],
        after: Optional[Dict],
        weight: Optional[float],
        schedule_date: Optional[str],
        station: Dict[str, Any],
        actual_fn,
        sched_fn,
        dep_method: Optional[str] = None,
        dep_actual_fn=None,
        dep_sched_fn=None,
    ) -> Dict[str, Any]:
        dwell_ms = _scheduled_dwell_ms(station, schedule_date)
        base: Dict[str, Any] = {
            "stop_role":      role,
            "dwell_seconds":  dwell_ms // 1000 if dwell_ms > 0 else 0,
        }

        if method == "ON_TIME_INTERPOLATION":
            base["reasoning"]       = "Both neighbours on-time vs schedule; using scheduled time"
            base["scheduled_arr"]   = _scheduled_arrival_time(station)
            base["scheduled_dep"]   = _scheduled_departure_time(station)
            if before:
                base["before"] = before.get("station_name") or before.get("tiploc")
            if after:
                base["after"]  = after.get("station_name") or after.get("tiploc")

        elif method == "LINEAR_INTERPOLATION":
            base["reasoning"] = "Interpolated between neighbour actual timestamps by schedule position"
            if weight is not None:
                base["interpolation_weight"] = round(weight, 3)
            if before:
                before_delay = _delay_minutes(
                    _parse_hhmmss_to_ms(actual_fn(before), schedule_date),
                    _parse_hhmm_to_ms(sched_fn(before), schedule_date),
                ) or 0.0
                base["before"] = {
                    "station":      before.get("station_name") or before.get("tiploc"),
                    "actual":       actual_fn(before),
                    "delay_min":    round(before_delay, 1),
                }
            if after:
                after_delay = _delay_minutes(
                    _parse_hhmmss_to_ms(actual_fn(after), schedule_date),
                    _parse_hhmm_to_ms(sched_fn(after), schedule_date),
                ) or 0.0
                base["after"] = {
                    "station":      after.get("station_name") or after.get("tiploc"),
                    "actual":       actual_fn(after),
                    "delay_min":    round(after_delay, 1),
                }
            if dep_method and dep_actual_fn and role == ROLE_INTERMEDIATE:
                base["departure_method"] = dep_method
                if before:
                    dep_before_delay = _delay_minutes(
                        _parse_hhmmss_to_ms(dep_actual_fn(before), schedule_date),
                        _parse_hhmm_to_ms(_role_sched_departure(before) if dep_sched_fn else sched_fn(before), schedule_date),
                    ) or 0.0
                    base["before"]["actual_dep"]    = dep_actual_fn(before)
                    base["before"]["dep_delay_min"] = round(dep_before_delay, 1)
                if after:
                    dep_after_delay = _delay_minutes(
                        _parse_hhmmss_to_ms(dep_actual_fn(after), schedule_date),
                        _parse_hhmm_to_ms(_role_sched_departure(after) if dep_sched_fn else sched_fn(after), schedule_date),
                    ) or 0.0
                    base["after"]["actual_dep"]    = dep_actual_fn(after)
                    base["after"]["dep_delay_min"] = round(dep_after_delay, 1)

        elif method == "SINGLE_STATION_EXTRAPOLATION":
            ref = before or after
            if ref:
                ref_delay = _delay_minutes(
                    _parse_hhmmss_to_ms(actual_fn(ref), schedule_date),
                    _parse_hhmm_to_ms(sched_fn(ref), schedule_date),
                ) or 0.0
                base["reasoning"]       = "Offset from nearest-neighbour actual time by scheduled inter-station gap"
                base["reference"]       = ref.get("station_name") or ref.get("tiploc")
                base["position"]        = "before" if ref is before else "after"
                base["ref_actual"]      = actual_fn(ref)
                base["ref_delay_min"]   = round(ref_delay, 1)
                base["scheduled_arr"]   = _scheduled_arrival_time(station)
                base["scheduled_dep"]   = _scheduled_departure_time(station)

        elif method == "SCHEDULE_ONLY":
            base["reasoning"]     = "No neighbour actual data; using scheduled time"
            base["scheduled_arr"] = _scheduled_arrival_time(station)
            base["scheduled_dep"] = _scheduled_departure_time(station)

        return base
