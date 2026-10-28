#!/usr/bin/env bash
# =============================================================================
# cloud/topics.sh — Confluent Cloud Topic Provisioner
#
# Creates all Network Rail Gap Engine Kafka topics in the currently-selected
# Confluent Cloud Kafka cluster using the Confluent CLI.
#
# Prerequisites:
#   confluent login
#   confluent environment use <env-id>
#   confluent kafka cluster use <cluster-id>
#
# Or set environment variables to skip interactive selection:
#   CONFLUENT_CLOUD_ENV_ID         — Confluent Cloud environment ID  (e.g. env-abc123)
#   CONFLUENT_CLOUD_CLUSTER_ID     — Kafka cluster ID                (e.g. lkc-abc123)
#   CONFLUENT_CLOUD_API_KEY        — Kafka API key
#   CONFLUENT_CLOUD_API_SECRET     — Kafka API secret
#
# Confluent Cloud does not support KafkaTopic CRDs — topics are created with
# `confluent kafka topic create`.  Replication factor is always 3 in Cloud.
# =============================================================================

set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Preflight ──────────────────────────────────────────────────────────────────
if ! command -v confluent &>/dev/null; then
    error "'confluent' CLI not found. Install: https://docs.confluent.io/confluent-cli/current/install.html"
    exit 1
fi

# ── Optional: select environment & cluster from env vars ──────────────────────
if [[ -n "${CONFLUENT_CLOUD_ENV_ID:-}" ]]; then
    info "Using environment: $CONFLUENT_CLOUD_ENV_ID"
    confluent environment use "$CONFLUENT_CLOUD_ENV_ID"
fi

if [[ -n "${CONFLUENT_CLOUD_CLUSTER_ID:-}" ]]; then
    info "Using cluster: $CONFLUENT_CLOUD_CLUSTER_ID"
    confluent kafka cluster use "$CONFLUENT_CLOUD_CLUSTER_ID"
fi

# Resolve the active cluster for display
ACTIVE_CLUSTER=$(confluent kafka cluster describe -o json 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','unknown'))" 2>/dev/null || echo "unknown")

# ── API key flags (optional) ───────────────────────────────────────────────────
API_FLAGS=()
if [[ -n "${CONFLUENT_CLOUD_API_KEY:-}" && -n "${CONFLUENT_CLOUD_API_SECRET:-}" ]]; then
    API_FLAGS=(--api-key "$CONFLUENT_CLOUD_API_KEY" --api-secret "$CONFLUENT_CLOUD_API_SECRET")
fi

# ── Topic definitions ──────────────────────────────────────────────────────────
# Format: "TOPIC_NAME:partitions:cleanup_policy:retention_ms"
#   cleanup_policy : delete | compact | compact,delete
#   retention_ms   : -1 = keep forever (compact topics)
declare -a TOPICS=(
    # Connector-produced
    "NR_TRAIN_MESSAGES:3:delete:604800000"
    "NR_TIPLOC_REFERENCE:3:compact:-1"
    "NR_ACTIVE_SCHEDULE:3:compact:-1"

    # ksqlDB-produced (CSAS)
    "FLATTENED_RAIL_TEXT:3:delete:604800000"
    "SCHEDULE_TABLE:3:compact:-1"
    "TRAIN_ACTIVATION_TABLE:3:compact:-1"
    "MOVEMENT_STREAM:3:delete:604800000"
    "LIVE_JOURNEY_STATE:3:compact:-1"
    "COMPLETED_JOURNEYS:3:delete:604800000"

    # Application-produced
    "NR_JOURNEY_GAPS:3:delete:604800000"
    "NR_JOURNEY_GAPS_PREDICTED:3:delete:604800000"

    # Sink pipeline
    "JOURNEY_GAPS_EXPLODED:3:delete:604800000"
    "PREDICTED_GAPS_FLAT:3:delete:604800000"
    "ALL_STATIONS_FLAT:3:delete:604800000"

    # Dead-letter queues
    "PREDICTED_GAPS_FLAT_DLQ:3:delete:604800000"
    "ALL_STATIONS_FLAT_DLQ:3:delete:604800000"
)

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Network Rail Gap Engine — Confluent Cloud Topic Provisioner"
echo "  Active cluster : $ACTIVE_CLUSTER"
echo "  Topics to create: ${#TOPICS[@]}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CREATED=0
SKIPPED=0
FAILED=0

# ── Create function ────────────────────────────────────────────────────────────
create_topic() {
    local name="$1"
    local partitions="$2"
    local cleanup="$3"
    local retention="$4"

    # Check existence — `confluent kafka topic describe` exits non-zero if missing
    if confluent kafka topic describe "$name" ${API_FLAGS[@]+"${API_FLAGS[@]}"} &>/dev/null 2>&1; then
        warn "Topic '$name' already exists — skipping."
        (( SKIPPED++ )) || true
        return 0
    fi

    info "Creating '$name' (partitions=$partitions, cleanup=$cleanup, retention=${retention}ms)..."

    local config_args=(
        --partitions "$partitions"
        --config "cleanup.policy=$cleanup"
    )
    # -1 retention means keep forever (compact topics) — omit the config so
    # Confluent Cloud uses its default unlimited retention for compact topics.
    if [[ "$retention" != "-1" ]]; then
        config_args+=(--config "retention.ms=$retention")
    fi

    if confluent kafka topic create "$name" \
        "${config_args[@]}" \
        ${API_FLAGS[@]+"${API_FLAGS[@]}"} \
        2>&1; then
        success "Created '$name'."
        (( CREATED++ )) || true
    else
        error "Failed to create '$name'."
        (( FAILED++ )) || true
    fi
}

# ── Main loop ──────────────────────────────────────────────────────────────────
for entry in "${TOPICS[@]}"; do
    IFS=':' read -r topic parts cleanup retention <<< "$entry"
    create_topic "$topic" "$parts" "$cleanup" "$retention"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Done.  Created: $CREATED  Skipped: $SKIPPED  Failed: $FAILED"
echo ""

if [[ "$FAILED" -gt 0 ]]; then
    error "$FAILED topic(s) failed to create. Review output above."
    exit 1
fi

# ── List all topics for confirmation ──────────────────────────────────────────
info "Current topics in cluster:"
confluent kafka topic list ${API_FLAGS[@]+"${API_FLAGS[@]}"} 2>/dev/null || warn "Could not list topics."
echo ""
