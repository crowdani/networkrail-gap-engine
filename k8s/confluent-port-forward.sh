#!/usr/bin/env bash
# =============================================================================
# confluent-port-forward.sh
#
# Forwards Confluent Kafka bootstrap + all broker ports to localhost so that
# native Kafka clients (kafka-python, confluent-kafka, kcat, etc.) can connect
# directly from your machine.
#
# OpenShift Routes only handle HTTP/HTTPS.  Raw TCP (Kafka protocol :9092) must
# use port-forwarding.
#
# Usage:
#   ./k8s/confluent-port-forward.sh          # forward everything (background)
#   ./k8s/confluent-port-forward.sh stop     # kill all forwarded processes
#   ./k8s/confluent-port-forward.sh status   # show running forwards
#
# After running, set your bootstrap in client config / .env to:
#   localhost:9092
#
# Services forwarded:
#   localhost:9092  →  kafka-0 :9092   (Kafka bootstrap / broker 0)
#   localhost:9093  →  kafka-1 :9092   (broker 1)
#   localhost:9094  →  kafka-2 :9092   (broker 2)
#   localhost:8090  →  kafka   :8090   (Kafka HTTP REST API)
# =============================================================================

set -euo pipefail

NAMESPACE="${CONFLUENT_NAMESPACE:-confluent}"
PID_DIR="${XDG_RUNTIME_DIR:-/tmp}/confluent-pf"
mkdir -p "$PID_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

CMD=$(command -v oc 2>/dev/null || command -v kubectl 2>/dev/null || { error "oc/kubectl not found"; exit 1; })

# ── stop ──────────────────────────────────────────────────────────────────────
stop_all() {
    local stopped=0
    for pidfile in "$PID_DIR"/*.pid; do
        [[ -f "$pidfile" ]] || continue
        local pid; pid=$(cat "$pidfile")
        local name; name=$(basename "$pidfile" .pid)
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null && success "Stopped $name (pid $pid)"
            (( stopped++ )) || true
        fi
        rm -f "$pidfile"
    done
    [[ $stopped -gt 0 ]] || info "No active port-forwards found."
}

# ── status ────────────────────────────────────────────────────────────────────
show_status() {
    local any=false
    for pidfile in "$PID_DIR"/*.pid; do
        [[ -f "$pidfile" ]] || continue
        any=true
        local pid; pid=$(cat "$pidfile")
        local name; name=$(basename "$pidfile" .pid)
        if kill -0 "$pid" 2>/dev/null; then
            success "RUNNING  $name (pid $pid)"
        else
            warn "DEAD     $name (pid $pid) — stale pidfile removed"
            rm -f "$pidfile"
        fi
    done
    $any || info "No port-forwards registered."
}

# ── forward one port ──────────────────────────────────────────────────────────
# forward <name> <resource-type/name> <local-port>:<remote-port>
forward() {
    local name="$1" resource="$2" ports="$3"
    local pidfile="$PID_DIR/${name}.pid"

    # Kill stale forward for same name
    if [[ -f "$pidfile" ]]; then
        local old; old=$(cat "$pidfile")
        kill -0 "$old" 2>/dev/null && kill "$old" 2>/dev/null
        rm -f "$pidfile"
    fi

    info "Forwarding $name  $ports  (${resource})"
    $CMD port-forward "$resource" "$ports" -n "$NAMESPACE" \
        >/dev/null 2>&1 &
    echo $! > "$pidfile"
    sleep 0.5

    local pid; pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
        success "$name  localhost:${ports%%:*}  →  cluster:${ports##*:}"
    else
        error "port-forward for $name failed to start."
        rm -f "$pidfile"
    fi
}

# ── main ──────────────────────────────────────────────────────────────────────
case "${1:-start}" in
    stop)    stop_all;    exit 0 ;;
    status)  show_status; exit 0 ;;
    start|"") ;;
    *) echo "Usage: $0 [start|stop|status]"; exit 1 ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Confluent Platform — Port Forwarder"
echo "  Namespace: $NAMESPACE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Kafka brokers — one pod each, forwarded to successive local ports
forward "kafka-broker-0"  "pod/kafka-0"  "9092:9092"
forward "kafka-broker-1"  "pod/kafka-1"  "9093:9092"
forward "kafka-broker-2"  "pod/kafka-2"  "9094:9092"

# Kafka HTTP REST API (advertised in /kafka/v3 endpoints)
forward "kafka-http"      "pod/kafka-0"  "8090:8090"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Use these settings in your local .env / client config:"
echo ""
echo "  KAFKA_BOOTSTRAP_SERVERS=localhost:9092"
echo "  KAFKA_BROKER=localhost:9092"
echo ""
info "Stop all forwards with:  $0 stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
