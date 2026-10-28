#!/usr/bin/env python3
"""
Infill Time Predictor Service
==============================
Standalone Kafka stream processor.

  INPUT  : NR_JOURNEY_GAPS        (produced by completed_journey_gap_detector.py)
  OUTPUT : NR_JOURNEY_GAPS_PREDICTED

Each message from NR_JOURNEY_GAPS already contains a stations[] array built by
the gap detector.  This service reads every missed stop in that array, runs the
InfillPredictor against the surrounding visited-stop actual timestamps, and
republishes the enriched record to NR_JOURNEY_GAPS_PREDICTED.

No database, no external HTTP calls — everything needed is in the payload.

Environment variables:
  KAFKA_BROKER        broker address  (default: kafka.confluent.svc.cluster.local:9092)
  INPUT_TOPIC         topic to consume (default: NR_JOURNEY_GAPS)
  OUTPUT_TOPIC        topic to produce (default: NR_JOURNEY_GAPS_PREDICTED)
  CONSUMER_GROUP      consumer group id (default: infill-predictor-v1)
  AUTO_OFFSET_RESET   earliest | latest (default: earliest)
"""

import json
import logging
import os
import signal
import time
from typing import Any, Dict, List, Optional

from kafka import KafkaConsumer, KafkaProducer

from infill_predictor import InfillPredictor

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [infill-predictor] %(message)s",
)
logger = logging.getLogger("infill_predictor_service")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
_BROKER_RAW       = os.getenv("KAFKA_BROKER",    "kafka.confluent.svc.cluster.local:9092")
BOOTSTRAP_SERVERS = [s.strip() for s in _BROKER_RAW.split(",") if s.strip()]
INPUT_TOPIC       = os.getenv("INPUT_TOPIC",      "NR_JOURNEY_GAPS")
OUTPUT_TOPIC      = os.getenv("OUTPUT_TOPIC",     "NR_JOURNEY_GAPS_PREDICTED")
CONSUMER_GROUP    = os.getenv("CONSUMER_GROUP",   "infill-predictor-v1")
AUTO_OFFSET_RESET = os.getenv("AUTO_OFFSET_RESET", "earliest")

# ---------------------------------------------------------------------------
# Shutdown handling
# ---------------------------------------------------------------------------
_running = True


def _handle_shutdown(signum, _frame):
    global _running
    logger.info("Signal %s received — shutting down gracefully", signum)
    _running = False


signal.signal(signal.SIGINT,  _handle_shutdown)
signal.signal(signal.SIGTERM, _handle_shutdown)


# ---------------------------------------------------------------------------
# Processor
# ---------------------------------------------------------------------------

class InfillPredictorService:
    """
    Reads NR_JOURNEY_GAPS, enriches every missed stop with a predicted
    passing time, and writes to NR_JOURNEY_GAPS_PREDICTED.
    """

    def __init__(self) -> None:
        self.consumer: Optional[KafkaConsumer] = None
        self.producer: Optional[KafkaProducer] = None
        self.predictor = InfillPredictor()
        self._connect()

    # ------------------------------------------------------------------
    # Kafka connect / reconnect
    # ------------------------------------------------------------------

    def _connect(self) -> None:
        logger.info("Connecting to Kafka: %s", BOOTSTRAP_SERVERS)
        while _running:
            try:
                self.consumer = KafkaConsumer(
                    INPUT_TOPIC,
                    bootstrap_servers=BOOTSTRAP_SERVERS,
                    group_id=CONSUMER_GROUP,
                    auto_offset_reset=AUTO_OFFSET_RESET,
                    enable_auto_commit=True,
                    auto_commit_interval_ms=5_000,
                    key_deserializer=lambda k: k.decode("utf-8", errors="ignore") if k else None,
                    value_deserializer=lambda v: json.loads(v.decode("utf-8")) if v else {},
                )
                self.producer = KafkaProducer(
                    bootstrap_servers=BOOTSTRAP_SERVERS,
                    key_serializer=lambda k: k.encode("utf-8") if k else None,
                    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                    acks="all",
                    retries=3,
                )
                logger.info(
                    "Connected. Consuming %s → enriching → publishing %s",
                    INPUT_TOPIC, OUTPUT_TOPIC,
                )
                return
            except Exception as exc:
                logger.error("Kafka connection failed: %s  — retrying in 5 s", exc)
                time.sleep(5)

    # ------------------------------------------------------------------
    # Message processing
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Delay calculation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _hhmm_to_minutes(t: Optional[str]) -> Optional[int]:
        """Parse 'HH:MM' or 'HHMM' to minutes-since-midnight. Returns None on failure."""
        if not t:
            return None
        try:
            clean = t.replace(":", "").strip()
            if len(clean) >= 4 and clean[:4].isdigit():
                return int(clean[:2]) * 60 + int(clean[2:4])
        except Exception:
            pass
        return None

    @staticmethod
    def _hhmmss_to_minutes(t: Optional[str]) -> Optional[float]:
        """Parse 'HH:MM:SS' to minutes-since-midnight. Returns None on failure."""
        if not t:
            return None
        try:
            parts = t.strip().split(":")
            if len(parts) >= 2:
                return int(parts[0]) * 60 + int(parts[1]) + (int(parts[2]) / 60.0 if len(parts) > 2 else 0)
        except Exception:
            pass
        return None

    def _stop_delay_minutes(self, station: Dict[str, Any]) -> Optional[float]:
        """
        Return (actual - scheduled) delay in minutes for a visited stop, or None.
        Prefers arrival times; falls back to departure and then legacy single fields.
        """
        actual_min = (
            self._hhmmss_to_minutes(station.get("actual_arrival")) or
            self._hhmmss_to_minutes(station.get("actual_departure")) or
            self._hhmmss_to_minutes(station.get("actual_time"))
        )
        sched_min = (
            self._hhmm_to_minutes(station.get("scheduled_arrival")) or
            self._hhmm_to_minutes(station.get("scheduled_departure")) or
            self._hhmm_to_minutes(station.get("scheduled_time"))
        )
        if actual_min is None or sched_min is None:
            return None
        diff = actual_min - sched_min
        # Handle midnight wraparound (e.g. sched 23:58, actual 00:02)
        if diff > 720:
            diff -= 1440
        elif diff < -720:
            diff += 1440
        return round(diff, 1)

    def _add_delay_to_stations(self, stations: List[Dict[str, Any]]) -> None:
        """Annotate every visited stop with a delay_minutes field (in-place)."""
        for s in stations:
            if s.get("visited"):
                s["delay_minutes"] = self._stop_delay_minutes(s)

    def _journey_delay_summary(self, stations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Build a top-level journey_delay summary from visited stops.
        A journey is considered delayed if any stop is > 3 minutes late.
        """
        delays = [
            s["delay_minutes"]
            for s in stations
            if s.get("visited") and s.get("delay_minutes") is not None
        ]
        if not delays:
            return {"is_delayed": False, "max_delay_minutes": None, "avg_delay_minutes": None, "delayed_stops": 0}

        max_delay = max(delays)
        avg_delay = round(sum(delays) / len(delays), 1)
        delayed_stops = sum(1 for d in delays if d > 3)
        return {
            "is_delayed":         max_delay > 3,
            "max_delay_minutes":  round(max_delay, 1),
            "avg_delay_minutes":  avg_delay,
            "delayed_stops":      delayed_stops,
        }

    # ------------------------------------------------------------------
    # Message processing
    # ------------------------------------------------------------------

    def _process(self, key: Optional[str], value: Dict[str, Any]) -> None:
        """Enrich a single NR_JOURNEY_GAPS record with infill predictions and delay data."""
        train_id      = key or value.get("train_id")
        stations      = value.get("stations") or []
        schedule_date = value.get("schedule_start_date") or ""

        if not stations:
            logger.debug("Train %s: no stations array — skipping", train_id)
            return

        # Annotate visited stops with delay_minutes
        self._add_delay_to_stations(stations)

        # Run infill prediction on any missed stops (no-op if none)
        missed_stops    = [s for s in stations if not s.get("visited")]
        predicted_count = self.predictor.predict_all_missed(stations, schedule_date) if missed_stops else 0

        # Summarise by method and by stop role
        method_counts: Dict[str, int] = {}
        role_counts:   Dict[str, int] = {}
        for s in missed_stops:
            m = s.get("prediction_method") or "NONE"
            method_counts[m] = method_counts.get(m, 0) + 1
            r = s.get("stop_role") or "UNKNOWN"
            role_counts[r] = role_counts.get(r, 0) + 1

        journey_delay = self._journey_delay_summary(stations)

        output = {
            **value,
            "stations": stations,
            "journey_delay": journey_delay,
            "prediction_summary": {
                "total_missed":    len(missed_stops),
                "total_predicted": predicted_count,
                "methods":         method_counts,
                "roles":           role_counts,
            },
        }

        if self.producer:
            self.producer.send(OUTPUT_TOPIC, key=train_id, value=output)

        logger.info(
            "Train %s: %d missed (roles=%s), delayed=%s (max=%.1f min) → %s",
            train_id, len(missed_stops),
            role_counts,
            journey_delay["is_delayed"],
            journey_delay["max_delay_minutes"] or 0.0,
            OUTPUT_TOPIC,
        )

    # ------------------------------------------------------------------
    # Poll loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        logger.info("Polling %s …", INPUT_TOPIC)
        while _running:
            try:
                batch = self.consumer.poll(timeout_ms=1_000)  # type: ignore[union-attr]
                if not batch:
                    continue
                for _tp, messages in batch.items():
                    for msg in messages:
                        try:
                            self._process(msg.key, msg.value)
                        except Exception as exc:
                            logger.error(
                                "Error processing key=%s: %s", msg.key, exc, exc_info=True
                            )
                if self.producer:
                    self.producer.flush()
            except Exception as exc:
                logger.error("Poll loop error: %s", exc, exc_info=True)
                time.sleep(2)

        # Graceful shutdown
        logger.info("Shutting down …")
        if self.consumer:
            self.consumer.close()
        if self.producer:
            self.producer.flush()
            self.producer.close()
        logger.info("Stopped.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    InfillPredictorService().run()
