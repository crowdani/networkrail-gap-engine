#!/usr/bin/env python3
"""
Delay Cause Analyser
====================
Standalone Kafka stream processor.

  INPUT  : NR_JOURNEY_GAPS_PREDICTED   (produced by infill_time_predictor_service.py)
  OUTPUT : NR_JOURNEY_GAPS_ANALYSED

Each record already has a stations[] array with visited/missed stops, infill
predictions, and severity.  This service builds a compact plain-text prompt
from that data, calls the watsonx.ai LLM, and republishes the record with a
new top-level field:

  delay_analysis: {
      cause:             str   — short free-text cause statement
      category:          str   — one of: INFRASTRUCTURE, TIMETABLING, OPERATIONAL,
                                         EXTERNAL, ROLLING_STOCK, UNKNOWN
      confidence:        float — 0.0–1.0, as returned by the model
      detail:            str   — longer explanation
      approval_status:   str   — always "PENDING" on first write
      model_id:          str   — watsonx model used
      generated_at:      str   — ISO-8601 UTC timestamp
  }

If the LLM call fails, delay_analysis.cause = "ANALYSIS_UNAVAILABLE" and the
record is still published so the pipeline is not blocked.

Environment variables:
  KAFKA_BROKER          broker address         (default: kafka.confluent.svc.cluster.local:9092)
  INPUT_TOPIC           topic to consume       (default: NR_JOURNEY_GAPS_PREDICTED)
  OUTPUT_TOPIC          topic to produce       (default: NR_JOURNEY_GAPS_ANALYSED)
  CONSUMER_GROUP        consumer group id      (default: delay-cause-analyser-v1)
  AUTO_OFFSET_RESET     earliest | latest      (default: earliest)
  WATSONX_API_KEY       IBM Cloud API key      (required)
  WATSONX_PROJECT_ID    watsonx project id     (required)
  WATSONX_URL           watsonx endpoint       (default: https://eu-de.ml.cloud.ibm.com)
  WATSONX_MODEL_ID      model to use           (default: ibm/granite-13b-instruct-v2)
  WATSONX_MAX_TOKENS    max tokens to generate (default: 300)
"""

import json
import logging
import os
import signal
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ibm_watsonx_ai import Credentials
from ibm_watsonx_ai.foundation_models import ModelInference
from kafka import KafkaConsumer, KafkaProducer
from dotenv import load_dotenv
load_dotenv()
# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [delay-cause-analyser] %(message)s",
)
logger = logging.getLogger("delay_cause_analyser")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_BROKER_RAW       = os.getenv("KAFKA_BROKER",      "kafka.confluent.svc.cluster.local:9092")
BOOTSTRAP_SERVERS = [s.strip() for s in _BROKER_RAW.split(",") if s.strip()]
INPUT_TOPIC       = os.getenv("INPUT_TOPIC",        "NR_JOURNEY_GAPS_PREDICTED")
OUTPUT_TOPIC      = os.getenv("OUTPUT_TOPIC",       "NR_JOURNEY_GAPS_ANALYSED")
CONSUMER_GROUP    = os.getenv("CONSUMER_GROUP",     "delay-cause-analyser-v1")
AUTO_OFFSET_RESET = os.getenv("AUTO_OFFSET_RESET",  "earliest")

WATSONX_API_KEY    = os.getenv("WATSONX_API_KEY")
WATSONX_PROJECT_ID = os.getenv("WATSONX_PROJECT_ID")
WATSONX_URL        = os.getenv("WATSONX_URL",        "https://eu-de.ml.cloud.ibm.com")
WATSONX_MODEL_ID   = os.getenv("WATSONX_MODEL_ID",   "meta-llama/llama-3-3-70b-instruct")
WATSONX_MAX_TOKENS = int(os.getenv("WATSONX_MAX_TOKENS", "300"))

VALID_CATEGORIES = {
    "INFRASTRUCTURE", "TIMETABLING", "OPERATIONAL",
    "EXTERNAL", "ROLLING_STOCK", "UNKNOWN",
}

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
# Prompt builder
# ---------------------------------------------------------------------------

def _build_prompt(value: Dict[str, Any]) -> str:
    """
    Build a compact structured prompt from the enriched gap record.
    Keeps the token count low by only including the information the LLM needs.
    """
    train_id      = value.get("train_id", "unknown")
    train_uid     = value.get("train_uid", "")
    date          = value.get("schedule_start_date", "")
    severity      = value.get("severity", "UNKNOWN")
    total         = value.get("total_scheduled_stops", 0)
    found         = value.get("found_stops_count", 0)
    missed        = value.get("missed_stops_count", 0)
    stations      = value.get("stations") or []
    journey_delay = value.get("journey_delay") or {}

    max_delay     = journey_delay.get("max_delay_minutes")
    avg_delay     = journey_delay.get("avg_delay_minutes")
    delayed_stops = journey_delay.get("delayed_stops", 0)
    is_delayed    = journey_delay.get("is_delayed", False)

    delay_summary = (
        f"max={max_delay:+.1f}min, avg={avg_delay:+.1f}min, {delayed_stops} late stops"
        if max_delay is not None
        else "no timing data"
    )

    # Summarise visited stops with actual vs scheduled and delay
    visited_lines: List[str] = []
    for s in stations:
        if s.get("visited"):
            name    = s.get("station_name") or s.get("tiploc") or s.get("stanox")
            sched   = s.get("scheduled_time", "?")
            actual  = s.get("actual_time", "?")
            delay   = s.get("delay_minutes")
            delay_s = f"{delay:+.1f}min" if delay is not None else ""
            visited_lines.append(f"  VISITED  {name:<35} sched={sched}  actual={actual}  {delay_s}")

    # Summarise missed stops with prediction info
    missed_lines: List[str] = []
    for s in stations:
        if not s.get("visited"):
            name    = s.get("station_name") or s.get("tiploc") or s.get("stanox")
            sched   = s.get("scheduled_time", "?")
            pred    = s.get("predicted_time", "?")
            delay   = s.get("predicted_delay_minutes")
            method  = s.get("prediction_method", "")
            delay_s = f"{delay:+.0f}min" if delay is not None else "?"
            missed_lines.append(
                f"  MISSED   {name:<35} sched={sched}  predicted={pred} ({delay_s}) [{method}]"
            )

    stop_summary = "\n".join(visited_lines + missed_lines) or "  (no stop data)"

    if missed > 0:
        focus = "identify the most likely cause of the missed stops and any running delays"
    else:
        focus = "identify the most likely cause of the running delays, as all stops were reported"

    prompt = f"""You are a UK rail operations analyst. Analyse the following train journey report and {focus}.

Journey summary:
  Train ID        : {train_id}
  Train UID       : {train_uid}
  Date            : {date}
  Severity        : {severity}
  Scheduled stops : {total}
  Visited stops   : {found}
  Missed stops    : {missed}
  Delayed         : {is_delayed} ({delay_summary})

Stop detail (VISITED = reporting point received with delay vs schedule, MISSED = no report received):
{stop_summary}

Instructions:
1. Identify the most likely cause based on the pattern of delays and/or missed reporting points.
2. Assign one category: INFRASTRUCTURE, TIMETABLING, OPERATIONAL, EXTERNAL, ROLLING_STOCK, or UNKNOWN.
3. Give a confidence score between 0.0 and 1.0.
4. Be concise. Base your answer only on the data above.
5. Output ONLY the JSON object below — no commentary, no markdown, no code fences, no extra text before or after.

{{"cause":"<one sentence cause statement>","category":"<CATEGORY>","confidence":<0.0-1.0>,"detail":"<2-3 sentence explanation>"}}"""

    return prompt


# ---------------------------------------------------------------------------
# LLM client
# ---------------------------------------------------------------------------

# Character budget for the stop-detail section before we truncate.
# Keeps total prompt well within context limits of smaller models.
_MAX_STOP_CHARS = 2_000


class WatsonXClient:
    """Thin wrapper around ibm_watsonx_ai ModelInference."""

    def __init__(self) -> None:
        if not WATSONX_API_KEY or not WATSONX_PROJECT_ID:
            raise RuntimeError(
                "WATSONX_API_KEY and WATSONX_PROJECT_ID must be set"
            )
        credentials = Credentials(
            url=WATSONX_URL,
            api_key=WATSONX_API_KEY,
        )
        self._model = ModelInference(
            model_id=WATSONX_MODEL_ID,
            credentials=credentials,
            project_id=WATSONX_PROJECT_ID,
            params={
                "max_new_tokens": WATSONX_MAX_TOKENS,
                "temperature":    0.2,
                "top_p":          0.85,
            },
        )
        logger.info("watsonx client ready: model=%s url=%s", WATSONX_MODEL_ID, WATSONX_URL)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _call_model(model: ModelInference, prompt: str) -> str:
        """Call generate_text and always return a stripped string."""
        response = model.generate_text(prompt=prompt)
        return response.strip() if isinstance(response, str) else str(response).strip()

    @staticmethod
    def _extract_json(text: str) -> str:
        """
        Pull the first complete JSON object out of raw model output.
        Handles markdown fences and trailing commentary.
        """
        # Strip markdown fences
        if "```" in text:
            for part in text.split("```"):
                stripped = part.lstrip("json").strip()
                if stripped.startswith("{"):
                    text = stripped
                    break

        # Walk to find the balanced JSON object
        if "{" in text:
            start = text.index("{")
            depth = 0
            for i, ch in enumerate(text[start:], start):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return text[start : i + 1]
        return text

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def analyse(self, prompt: str) -> Dict[str, Any]:
        """
        Send prompt to watsonx, parse the JSON response.
        Returns a dict with cause/category/confidence/detail fields.
        On any error returns a safe fallback dict.

        If the model returns an empty string (common with smaller models
        when the prompt is long), we retry once with a truncated prompt
        that keeps only the journey summary header and caps the stop
        detail at _MAX_STOP_CHARS characters.
        """
        text = ""
        try:
            text = self._call_model(self._model, prompt)

            # Empty response — model likely ran out of context budget.
            # Retry with a shorter prompt (capped stop detail section).
            if not text:
                logger.warning(
                    "Empty response from model (prompt %d chars) — retrying with truncated prompt",
                    len(prompt),
                )
                short_prompt = self._truncate_prompt(prompt)
                text = self._call_model(self._model, short_prompt)

            if not text:
                logger.error("Model returned empty response even after truncation")
                return self._fallback("Model returned an empty response")

            text = self._extract_json(text)
            parsed = json.loads(text)

            category = str(parsed.get("category", "UNKNOWN")).upper()
            if category not in VALID_CATEGORIES:
                category = "UNKNOWN"
            return {
                "cause":      str(parsed.get("cause", "")).strip(),
                "category":   category,
                "confidence": float(parsed.get("confidence", 0.5)),
                "detail":     str(parsed.get("detail", "")).strip(),
            }
        except json.JSONDecodeError as exc:
            logger.warning(
                "LLM response was not valid JSON: %s | raw (first 500 chars): %s",
                exc,
                repr(text[:500]) if text else "<empty>",
            )
            return self._fallback("LLM response was not parseable as JSON")
        except Exception as exc:
            logger.error("watsonx call failed: %s", exc, exc_info=True)
            return self._fallback(str(exc))

    @staticmethod
    def _truncate_prompt(prompt: str) -> str:
        """
        Shorten the prompt by keeping the header and capping the stop-detail
        block to _MAX_STOP_CHARS characters, then re-appending the instructions.
        """
        instructions_marker = "Instructions:"
        stop_detail_marker  = "Stop detail"

        instr_idx = prompt.find(instructions_marker)
        stop_idx  = prompt.find(stop_detail_marker)

        if instr_idx == -1 or stop_idx == -1:
            # Can't identify sections — just hard-truncate
            return prompt[:3_000] + "\n\n" + prompt[instr_idx:] if instr_idx != -1 else prompt[:3_000]

        header       = prompt[:stop_idx]
        stop_section = prompt[stop_idx:instr_idx]
        instructions = prompt[instr_idx:]

        if len(stop_section) > _MAX_STOP_CHARS:
            stop_section = stop_section[:_MAX_STOP_CHARS] + "\n  ... (truncated)\n"

        return header + stop_section + instructions

    @staticmethod
    def _fallback(reason: str) -> Dict[str, Any]:
        return {
            "cause":      "ANALYSIS_UNAVAILABLE",
            "category":   "UNKNOWN",
            "confidence": 0.0,
            "detail":     f"Analysis could not be completed: {reason}",
        }


# ---------------------------------------------------------------------------
# Main processor
# ---------------------------------------------------------------------------

class DelayCauseAnalyserService:

    def __init__(self) -> None:
        self.consumer: Optional[KafkaConsumer] = None
        self.producer: Optional[KafkaProducer] = None
        self._llm = WatsonXClient()
        self._connect_kafka()

    # ------------------------------------------------------------------
    # Kafka
    # ------------------------------------------------------------------

    def _connect_kafka(self) -> None:
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
                    "Connected. Consuming %s → analysing → publishing %s",
                    INPUT_TOPIC, OUTPUT_TOPIC,
                )
                return
            except Exception as exc:
                logger.error("Kafka connection failed: %s — retrying in 5 s", exc)
                time.sleep(5)

    # ------------------------------------------------------------------
    # Message processing
    # ------------------------------------------------------------------

    def _process(self, key: Optional[str], value: Dict[str, Any]) -> None:
        train_id      = key or value.get("train_id")
        missed        = value.get("missed_stops_count", 0)
        severity      = value.get("severity", "NONE")
        journey_delay = value.get("journey_delay") or {}
        is_delayed    = journey_delay.get("is_delayed", False)

        # Call the LLM when there are gaps OR the journey is delayed.
        # If neither, pass the record straight through without an LLM call.
        needs_analysis = (missed > 0) or is_delayed

        if needs_analysis:
            prompt = _build_prompt(value)
            logger.debug("Train %s: sending prompt (%d chars) to watsonx", train_id, len(prompt))
            logger.info(prompt)
            result = self._llm.analyse(prompt)
            delay_analysis = {
                **result,
                "approval_status": "PENDING",
                "model_id":        WATSONX_MODEL_ID,
                "generated_at":    datetime.now(timezone.utc).isoformat(),
            }
            logger.info(
                "Train %s (%s missed, delayed=%s): category=%s confidence=%.2f → %s",
                train_id, missed, is_delayed,
                result["category"], result["confidence"],
                OUTPUT_TOPIC,
            )
        else:
            delay_analysis = None
            logger.debug("Train %s: on-time, no gaps — passing through without LLM call", train_id)

        output = {**value, "delay_analysis": delay_analysis}

        if self.producer:
            self.producer.send(OUTPUT_TOPIC, key=train_id, value=output)

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
    DelayCauseAnalyserService().run()
