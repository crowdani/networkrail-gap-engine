#!/usr/bin/env bash
# =============================================================================
# 04-create-topics.sh
#
# Pre-creates all Kafka topics required by the Network Rail Gap Engine on
# Confluent Platform (OpenShift).  Topics are declared as KafkaTopic CRs
# (platform.confluent.io/v1beta1) so that the Confluent Operator manages them.
#
# Run this BEFORE applying 02-connectors-cr.yaml and BEFORE executing
# 03-ksqldb-streams-and-tables.sql, so that topics exist when connectors
# and ksqlDB try to bind to them.
#
# Usage:
#   ./confluent-setup/04-create-topics.sh
#
# Override defaults with environment variables:
#   CONFLUENT_NAMESPACE         (default: confluent)
#   CONFLUENT_KAFKA_CLUSTER     (default: kafka)
#   CONFLUENT_REPLICATION_FACTOR (default: 3)
#   CONFLUENT_MIN_ISR           (default: 2)
#
# Topic inventory (all SCREAMING_SNAKE_CASE):
#
#   Connector-produced  — must exist before connectors start
#     NR_TRAIN_MESSAGES      ActiveMQ source → raw NR envelopes        (3p)
#     NR_TIPLOC_REFERENCE    JDBC bulk-load of tiploc_reference         (1p, compact)
#     NR_ACTIVE_SCHEDULE     JDBC timestamp-load of active_schedule     (3p, compact)
#
#   ksqlDB-produced     — auto-created by CSAS, but declared here for
#                         explicit partition/retention control
#     FLATTENED_RAIL_TEXT    Exploded individual rail events            (3p)
#     SCHEDULE_TABLE         Compacted schedule lookup table            (3p, compact)
#     MOVEMENT_STREAM        Station-enriched movement events           (3p)
#     LIVE_JOURNEY_STATE     Per-journey state aggregate                (3p, compact)
#     COMPLETED_JOURNEYS     Terminated journey snapshots               (3p)
#
#   Application-produced — written by gap_detector / infill-predictor
#     NR_JOURNEY_GAPS             Gap analysis output from gap_detector          (3p)
#     NR_JOURNEY_GAPS_PREDICTED   Infill-predicted passing times (infill-predictor) (3p)
#
# =============================================================================

set -euo pipefail

NAMESPACE="${CONFLUENT_NAMESPACE:-confluent}"
KAFKA_CLUSTER="${CONFLUENT_KAFKA_CLUSTER:-kafka}"
REPLICATION_FACTOR="${CONFLUENT_REPLICATION_FACTOR:-3}"
MIN_ISR="${CONFLUENT_MIN_ISR:-2}"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Preflight ─────────────────────────────────────────────────────────────────
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

# ── Topic definitions ─────────────────────────────────────────────────────────
# Format: "TOPIC_NAME:partitions:cleanup_policy:retention_ms"
#   cleanup_policy : delete | compact | compact,delete
#   retention_ms   : -1 = keep forever (suits compact topics)
declare -a TOPICS=(
    # Connector-produced
    "NR_TRAIN_MESSAGES:3:delete:604800000"
    "NR_TIPLOC_REFERENCE:3:compact:-1"
    "NR_ACTIVE_SCHEDULE:3:compact:-1"

    # ksqlDB-produced (CSAS)
    "FLATTENED_RAIL_TEXT:3:delete:604800000"
    "SCHEDULE_TABLE:3:compact:-1"
    "MOVEMENT_STREAM:3:delete:604800000"
    "LIVE_JOURNEY_STATE:3:compact:-1"
    "COMPLETED_JOURNEYS:3:delete:604800000"

    # Application-produced
    "NR_JOURNEY_GAPS:3:delete:604800000"
    "NR_JOURNEY_GAPS_PREDICTED:3:delete:604800000"

    # Sink pipeline — explode + filter (ksqlDB CSAS → JDBC Sink)
    "JOURNEY_GAPS_EXPLODED:3:delete:604800000"
    "PREDICTED_GAPS_FLAT:3:delete:604800000"
    "ALL_STATIONS_FLAT:3:delete:604800000"
    # Dead-letter queues for the JDBC Sink connectors
    "PREDICTED_GAPS_FLAT_DLQ:3:delete:604800000"
    "ALL_STATIONS_FLAT_DLQ:3:delete:604800000"
)

# ── Create function ───────────────────────────────────────────────────────────
# The Confluent Operator can get into a "ghost" state where the KafkaTopic CR
# reports CREATED but the physical Kafka topic doesn't exist (e.g. after the
# topic was deleted directly from the broker).  We detect this and force a
# delete+recreate of the CR to make the Operator re-provision the topic.
create_topic() {
    local name="$1"
    local partitions="$2"
    local cleanup="$3"
    local retention="$4"

    # KafkaTopic names must be lowercase DNS labels — map SCREAMING_SNAKE to kebab
    local cr_name
    cr_name=$(echo "$name" | tr '[:upper:]_' '[:lower:]-')

    local cr_exists=false
    $CMD get kafkatopics.platform.confluent.io "$cr_name" -n "$NAMESPACE" &>/dev/null 2>&1 && cr_exists=true

    # Check if the physical topic actually exists in the broker
    local topic_exists=false
    if $CMD exec kafka-0 -n "$NAMESPACE" -- \
        kafka-topics --bootstrap-server localhost:9092 --describe --topic "$name" \
        &>/dev/null 2>&1; then
        topic_exists=true
    fi

    if $cr_exists && $topic_exists; then
        warn "Topic '$name' (CR: $cr_name) already exists in broker — skipping."
        return 0
    fi

    if $cr_exists && ! $topic_exists; then
        warn "Ghost CR detected for '$name': CR exists but broker topic missing. Force-recreating..."
        $CMD delete kafkatopics.platform.confluent.io "$cr_name" -n "$NAMESPACE" --wait &>/dev/null 2>&1 || true
        sleep 3
        cr_exists=false
    fi

    if $cr_exists; then
        warn "Topic '$name' (CR: $cr_name) CR already exists and broker topic present — skipping."
        return 0
    fi

    info "Creating topic '$name' (partitions=$partitions, replication=$REPLICATION_FACTOR, cleanup=$cleanup, retention=${retention}ms) ..."

    $CMD apply -n "$NAMESPACE" -f - <<EOF
apiVersion: platform.confluent.io/v1beta1
kind: KafkaTopic
metadata:
  name: ${cr_name}
  namespace: ${NAMESPACE}
  labels:
    app: networkrail-gap-engine
spec:
  name: ${name}
  replicas: ${REPLICATION_FACTOR}
  partitionCount: ${partitions}
  configs:
    min.insync.replicas: "${MIN_ISR}"
    cleanup.policy: "${cleanup}"
    retention.ms: "${retention}"
EOF

    success "Topic '$name' created."
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Network Rail Gap Engine — Confluent Topic Provisioner"
echo "  Namespace          : $NAMESPACE"
echo "  Kafka Cluster      : $KAFKA_CLUSTER"
echo "  Replication Factor : $REPLICATION_FACTOR"
echo "  Min ISR            : $MIN_ISR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CREATED=0
SKIPPED=0

for entry in "${TOPICS[@]}"; do
    IFS=':' read -r topic parts cleanup retention <<< "$entry"
    create_topic "$topic" "$parts" "$cleanup" "$retention" && (( CREATED++ )) || true
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Done. Created: $CREATED  Skipped (already existed): $SKIPPED"
echo ""

# ── Wait for topics to become Ready ──────────────────────────────────────────
if [[ "$CREATED" -gt 0 ]]; then
    info "Waiting up to 90s for new topics to reach CREATED state..."
    TIMEOUT=90
    START=$(date +%s)

    while true; do
        READY=0
        NOT_READY=()

        for entry in "${TOPICS[@]}"; do
            topic="${entry%%:*}"
            cr_name=$(echo "$topic" | tr '[:upper:]_' '[:lower:]-')
            state=$($CMD get kafkatopics.platform.confluent.io "$cr_name" -n "$NAMESPACE" \
                -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
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
            warn "Timed out. Not yet ready: ${NOT_READY[*]}"
            warn "Topics may still reconcile — check with:"
            warn "  $CMD get kafkatopics.platform.confluent.io -n $NAMESPACE"
            break
        fi

        sleep 5
    done
fi

echo ""
info "Current topic status:"
$CMD get kafkatopics.platform.confluent.io -n "$NAMESPACE" \
    -o custom-columns="CR-NAME:.metadata.name,TOPIC:.spec.name,PARTITIONS:.spec.partitionCount,REPLICAS:.spec.replicas,STATE:.status.phase" \
    2>/dev/null || warn "Could not list KafkaTopics — check permissions."
echo ""
