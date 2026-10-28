#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Network Rail Gap Engine · Confluent Deployment Entrypoint
#
# Prompts you to choose a deployment target and then runs the correct
# provisioning steps for that environment.
#
# Targets
#   1) Confluent Platform on OpenShift  (existing — uses oc/kubectl + CRDs)
#   2) Confluent Cloud                  (new  — uses Confluent CLI + Cloud REST)
#
# Usage:
#   ./confluent-setup/deploy.sh
#
#   Or skip the prompt by pre-setting TARGET:
#     TARGET=openshift ./confluent-setup/deploy.sh
#     TARGET=cloud     ./confluent-setup/deploy.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colour helpers ─────────────────────────────────────────────────────────────
BOLD='\033[1m'; RESET='\033[0m'
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'

info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Network Rail Gap Engine — Confluent Deployment${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Target selection ───────────────────────────────────────────────────────────
if [[ -z "${TARGET:-}" ]]; then
    echo -e "  Where would you like to deploy the Confluent components?\n"
    echo -e "  ${BOLD}1)${RESET} Confluent Platform on OpenShift  ${YELLOW}(self-managed, uses oc/kubectl + CRDs)${RESET}"
    echo -e "  ${BOLD}2)${RESET} Confluent Cloud                  ${CYAN}(managed SaaS, uses Confluent CLI + REST)${RESET}"
    echo ""
    read -rp "  Enter choice [1/2]: " choice
    echo ""

    case "$choice" in
        1) TARGET=openshift ;;
        2) TARGET=cloud ;;
        *)
            error "Invalid choice '$choice'. Please enter 1 or 2."
            exit 1
            ;;
    esac
fi

# ── Dispatch ───────────────────────────────────────────────────────────────────
case "$TARGET" in
    openshift|platform)
        header "▶  Deploying to Confluent Platform on OpenShift"
        echo ""

        # ── Preflight: oc/kubectl ──────────────────────────────────────────────
        if ! command -v oc &>/dev/null && ! command -v kubectl &>/dev/null; then
            error "Neither 'oc' nor 'kubectl' found in PATH."
            error "Log in to your OpenShift cluster before running this script."
            exit 1
        fi

        # ── Step 1: Topics ────────────────────────────────────────────────────
        header "Step 1 / 4 — Pre-create Kafka topics (KafkaTopic CRs)"
        bash "$SCRIPT_DIR/04-create-topics.sh"

        # ── Step 2: Connectors ────────────────────────────────────────────────
        header "Step 2 / 4 — Deploy source connectors"
        CMD=$(command -v oc 2>/dev/null || command -v kubectl)
        NAMESPACE="${CONFLUENT_NAMESPACE:-confluent}"
        $CMD apply -f "$SCRIPT_DIR/02-connectors-cr.yaml" -n "$NAMESPACE"
        info "Waiting for connectors to become RUNNING..."
        sleep 10
        $CMD get connectors -n "$NAMESPACE" 2>/dev/null || warn "Could not list connectors — check permissions."

        # ── Step 3: ksqlDB ────────────────────────────────────────────────────
        header "Step 3 / 4 — Apply ksqlDB DDL"
        warn "ksqlDB DDL must be applied manually via Confluent Control Center."
        warn "  1. Open Control Center → ksqlDB → Editor"
        warn "  2. Execute: $SCRIPT_DIR/03-ksqldb-streams-and-tables.sql"
        warn "  3. Execute: $SCRIPT_DIR/05-predicted-gaps-sink-pipeline.sql"

        # ── Step 4: JDBC Sink connector ───────────────────────────────────────
        header "Step 4 / 4 — Register JDBC Sink connectors"
        warn "Register the sink connectors via the Connect REST API:"
        warn "  curl -X POST http://connect.confluent.svc:8083/connectors \\"
        warn "       -H 'Content-Type: application/json' \\"
        warn "       -d @$SCRIPT_DIR/06-connector-predicted-gaps-sink.json"
        warn "  curl -X POST http://connect.confluent.svc:8083/connectors \\"
        warn "       -H 'Content-Type: application/json' \\"
        warn "       -d @$SCRIPT_DIR/07-connector-journey-stations-sink.json"

        echo ""
        info "OpenShift deployment steps complete. See confluent-setup/README.md for full details."
        ;;

    cloud)
        header "▶  Deploying to Confluent Cloud"
        echo ""

        # ── Preflight: confluent CLI ───────────────────────────────────────────
        if ! command -v confluent &>/dev/null; then
            error "'confluent' CLI not found in PATH."
            error "Install it from: https://docs.confluent.io/confluent-cli/current/install.html"
            exit 1
        fi

        # ── Preflight: logged in ───────────────────────────────────────────────
        if ! confluent kafka cluster list &>/dev/null 2>&1; then
            error "Not logged in to Confluent Cloud."
            error "Run: confluent login"
            exit 1
        fi

        # ── Step 1: Topics ────────────────────────────────────────────────────
        header "Step 1 / 3 — Create Kafka topics"
        bash "$SCRIPT_DIR/cloud/topics.sh"

        # ── Step 2: ksqlDB DDL ────────────────────────────────────────────────
        header "Step 2 / 3 — Apply ksqlDB DDL"
        bash "$SCRIPT_DIR/cloud/ksqldb.sh"

        # ── Step 3: Connectors ────────────────────────────────────────────────
        header "Step 3 / 3 — Register connectors"
        bash "$SCRIPT_DIR/cloud/connectors.sh"

        echo ""
        info "Confluent Cloud deployment steps complete. See confluent-setup/README.md for full details."
        ;;

    *)
        error "Unknown TARGET '$TARGET'. Valid values: openshift, cloud"
        exit 1
        ;;
esac

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}  Deployment complete.${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
