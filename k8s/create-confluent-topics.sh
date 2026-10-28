#!/usr/bin/env bash
# =============================================================================
# create-confluent-topics.sh
#
# Creates all Network Rail Gap Engine Kafka topics in the Confluent Platform
# environment running in the 'confluent' namespace on OpenShift.
#
# Uses the Confluent Platform KafkaTopic CRD (platform.confluent.io/v1beta1),
# which is the equivalent of Strimzi's KafkaTopic for Confluent Operator.
#
# Usage:
#   ./k8s/create-confluent-topics.sh
#
# Prerequisites:
#   - oc / kubectl logged in with access to the 'confluent' namespace
#   - Confluent Operator running (confluent-operator pod healthy)
#   - Kafka cluster named 'kafka' healthy in namespace 'confluent'
# =============================================================================

set -euo pipefail

NAMESPACE="${CONFLUENT_NAMESPACE:-confluent}"
KAFKA_CLUSTER="${CONFLUENT_KAFKA_CLUSTER:-kafka}"

# Replication / ISR — single-broker default; raise for multi-broker clusters
REPLICATION_FACTOR="${CONFLUENT_REPLICATION_FACTOR:-1}"
MIN_ISR="${CONFLUENT_MIN_ISR:-1}"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Preflight checks ──────────────────────────────────────────────────────────
if ! command -v oc &>/dev/null && ! command -v kubectl &>/dev/null; then
    error "Neither 'oc' nor 'kubectl' found in PATH."
    exit 1
fi
CMD=$(command -v oc 2>/dev/null || command -v kubectl)

if ! $CMD get namespace "$NAMESPACE" &>/dev/null; then
    error "Namespace '$NAMESPACE' not found. Is the Confluent environment deployed?"
    exit 1
fi

if ! $CMD get kafka "$KAFKA_CLUSTER" -n "$NAMESPACE" &>/dev/null 2>&1; then
    warn "Kafka cluster '$KAFKA_CLUSTER' not found in namespace '$NAMESPACE'."
    warn "Topics will be created anyway — they will bind once the cluster is ready."
fi

# ── Topic definition ──────────────────────────────────────────────────────────
# Format: "topic-name:partitions"
# Mirrors the Strimzi KafkaTopic definitions in k8s/kafka.yaml, plus the
# additional topics produced by stomp_client/main.py.
declare -a TOPICS=(
    # High-volume topics (3 partitions — consumed by journey-builder)
    "train-movements:3"
    "train-activations:3"
    "journey-updates:3"

    # Per-type routed topics from the STOMP client (1 partition each)
    "train-movements-py:1"
    "train-activations-py:1"
    "train-cancellations-py:1"
    "train-reinstatements-py:1"

    # Additional STOMP message types
    "train-coo-py:1"     # Change of Origin
    "train-coi-py:1"     # Change of Identity
    "train-events:1"     # Catch-all for unrouted message types
)

# ── Create function ───────────────────────────────────────────────────────────
create_topic() {
    local name="$1"
    local partitions="$2"

    # Check if already exists
    if $CMD get kafkatopics.platform.confluent.io "$name" -n "$NAMESPACE" &>/dev/null 2>&1; then
        warn "Topic '$name' already exists — skipping."
        return 0
    fi

    info "Creating topic '$name' (partitions=$partitions, replication=$REPLICATION_FACTOR) ..."

    $CMD apply -n "$NAMESPACE" -f - <<EOF
apiVersion: platform.confluent.io/v1beta1
kind: KafkaTopic
metadata:
  name: ${name}
  namespace: ${NAMESPACE}
spec:
  replicas: ${REPLICATION_FACTOR}
  partitionCount: ${partitions}
  configs:
    min.insync.replicas: "${MIN_ISR}"
    retention.ms: "604800000"
    cleanup.policy: "delete"
EOF

    success "Topic '$name' created."
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Network Rail Gap Engine — Confluent Topic Provisioner"
echo "  Namespace : $NAMESPACE"
echo "  Cluster   : $KAFKA_CLUSTER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CREATED=0
SKIPPED=0

for entry in "${TOPICS[@]}"; do
    topic="${entry%%:*}"
    parts="${entry##*:}"
    if $CMD get kafkatopics.platform.confluent.io "$topic" -n "$NAMESPACE" &>/dev/null 2>&1; then
        warn "Topic '$topic' already exists — skipping."
        (( SKIPPED++ )) || true
    else
        create_topic "$topic" "$parts"
        (( CREATED++ )) || true
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Done. Created: $CREATED  Skipped (already existed): $SKIPPED"
echo ""

# ── Wait for topics to become Ready ──────────────────────────────────────────
info "Waiting up to 60s for topics to reach Ready state..."
READY=0
TIMEOUT=60
START=$(date +%s)

while true; do
    READY=0
    NOT_READY=()
    for entry in "${TOPICS[@]}"; do
        topic="${entry%%:*}"
        state=$($CMD get kafkatopics.platform.confluent.io "$topic" -n "$NAMESPACE" \
            -o jsonpath='{.status.state}' 2>/dev/null || echo "Unknown")
        if [[ "$state" == "CREATED" ]]; then
            (( READY++ )) || true
        else
            NOT_READY+=("$topic($state)")
        fi
    done

    if [[ "$READY" -eq "${#TOPICS[@]}" ]]; then
        success "All ${#TOPICS[@]} topics are Ready."
        break
    fi

    NOW=$(date +%s)
    if (( NOW - START >= TIMEOUT )); then
        warn "Timed out waiting. Not yet ready: ${NOT_READY[*]}"
        warn "Topics may still reconcile — check with:"
        warn "  $CMD get kafkatopics.platform.confluent.io -n $NAMESPACE"
        break
    fi

    sleep 5
done

echo ""
info "Current topic status:"
$CMD get kafkatopics.platform.confluent.io -n "$NAMESPACE" 2>/dev/null || \
    warn "Could not list KafkaTopics — check permissions."
echo ""
