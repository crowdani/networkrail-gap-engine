#!/usr/bin/env bash
# =============================================================================
# cloud/ksqldb.sh — Confluent Cloud ksqlDB DDL Runner
#
# Executes the Network Rail Gap Engine ksqlDB DDL files against a Confluent
# Cloud ksqlDB cluster using the ksqlDB REST API.
#
# DDL files executed (in order):
#   1. confluent-setup/03-ksqldb-streams-and-tables.sql  — main pipeline
#   2. confluent-setup/05-predicted-gaps-sink-pipeline.sql — sink flattening
#
# Prerequisites — set these environment variables before running:
#
#   KSQLDB_ENDPOINT          Full ksqlDB REST URL
#                            (e.g. https://abc123.us-east-1.aws.confluent.cloud:443)
#   KSQLDB_API_KEY           ksqlDB API key
#   KSQLDB_API_SECRET        ksqlDB API secret
#
# Optional:
#   KSQLDB_DRY_RUN           Set to "true" to print statements without executing
#
# The script splits each SQL file into individual statements (split on ";")
# and POSTs them one by one to /ksql.  This matches how the Confluent Control
# Center editor works and avoids multi-statement parse errors.
#
# Usage:
#   export KSQLDB_ENDPOINT=https://abc123.us-east-1.aws.confluent.cloud:443
#   export KSQLDB_API_KEY=...
#   export KSQLDB_API_SECRET=...
#   ./confluent-setup/cloud/ksqldb.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFLUENT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

DRY_RUN="${KSQLDB_DRY_RUN:-false}"

# ── Preflight ──────────────────────────────────────────────────────────────────
for var in KSQLDB_ENDPOINT KSQLDB_API_KEY KSQLDB_API_SECRET; do
    if [[ -z "${!var:-}" ]]; then
        error "Required environment variable '$var' is not set."
        exit 1
    fi
done

if ! command -v curl &>/dev/null; then
    error "'curl' not found in PATH."
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    error "'python3' not found in PATH (needed for JSON escaping)."
    exit 1
fi

# Strip trailing slash from endpoint
ENDPOINT="${KSQLDB_ENDPOINT%/}"

# ── Test connectivity ──────────────────────────────────────────────────────────
info "Testing ksqlDB connectivity at $ENDPOINT ..."
http_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${KSQLDB_API_KEY}:${KSQLDB_API_SECRET}" \
    "${ENDPOINT}/info")
if [[ "$http_status" != "200" ]]; then
    error "Could not reach ksqlDB at $ENDPOINT (HTTP $http_status)."
    error "Check KSQLDB_ENDPOINT, KSQLDB_API_KEY and KSQLDB_API_SECRET."
    exit 1
fi
success "ksqlDB reachable."

# ── Statement executor ─────────────────────────────────────────────────────────
# Accepts a single ksqlDB statement string, JSON-escapes it, and POSTs to /ksql.
execute_statement() {
    local stmt="$1"
    local trimmed
    trimmed=$(echo "$stmt" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

    # Skip blank lines and pure comment blocks
    if [[ -z "$trimmed" ]] || [[ "$trimmed" =~ ^--.*$ ]]; then
        return 0
    fi

    # Short preview for logging (first 80 chars)
    local preview="${trimmed:0:80}"
    [[ "${#trimmed}" -gt 80 ]] && preview="${preview}..."

    if [[ "$DRY_RUN" == "true" ]]; then
        warn "[DRY RUN] Would execute: $preview"
        return 0
    fi

    info "Executing: $preview"

    # JSON-escape the statement via python3
    local escaped_stmt
    escaped_stmt=$(python3 -c "
import sys, json
stmt = sys.stdin.read()
print(json.dumps(stmt))
" <<< "$trimmed")

    local payload="{\"ksql\": ${escaped_stmt}, \"streamsProperties\": {\"ksql.streams.auto.offset.reset\": \"earliest\"}}"

    local response
    response=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/vnd.ksql.v1+json" \
        -H "Accept: application/vnd.ksql.v1+json" \
        -u "${KSQLDB_API_KEY}:${KSQLDB_API_SECRET}" \
        "${ENDPOINT}/ksql" \
        -d "$payload")

    local body code
    body=$(echo "$response" | head -n -1)
    code=$(echo "$response" | tail -n 1)

    if [[ "$code" =~ ^2 ]]; then
        success "OK (HTTP $code)"
    else
        # Extract error message if present
        local msg
        msg=$(python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('message', d.get('@type', 'Unknown error')))
except:
    print('Unknown error')
" <<< "$body" 2>/dev/null || echo "$body")
        error "Statement failed (HTTP $code): $msg"
        error "Statement was: $trimmed"
        return 1
    fi
}

# ── SQL file executor ──────────────────────────────────────────────────────────
# Splits a .sql file into individual statements on ";" boundaries and executes
# each one.  Handles multi-line statements and inline comments.
execute_sql_file() {
    local filepath="$1"
    local filename
    filename=$(basename "$filepath")

    if [[ ! -f "$filepath" ]]; then
        error "SQL file not found: $filepath"
        exit 1
    fi

    info "Processing: $filename"

    local stmt=""
    local stmt_count=0
    local ok_count=0

    while IFS= read -r line || [[ -n "$line" ]]; do
        # Strip inline comments (-- ...) but preserve content before them
        local stripped_line
        stripped_line=$(echo "$line" | sed "s/--.*$//")

        stmt+=" $stripped_line"

        # When we hit a semicolon the statement is complete
        if [[ "$stripped_line" == *";"* ]]; then
            # Extract everything up to and including the first ";"
            local complete_stmt="${stmt%%;*};"
            stmt=""
            (( stmt_count++ )) || true

            if execute_statement "$complete_stmt"; then
                (( ok_count++ )) || true
            fi
        fi
    done < "$filepath"

    info "File '$filename': $ok_count/$stmt_count statements succeeded."
}

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Network Rail Gap Engine — Confluent Cloud ksqlDB DDL Runner"
echo "  Endpoint : $ENDPOINT"
[[ "$DRY_RUN" == "true" ]] && echo "  Mode     : DRY RUN (no statements will be executed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Execute DDL files in order ─────────────────────────────────────────────────
execute_sql_file "$CONFLUENT_DIR/03-ksqldb-streams-and-tables.sql"
echo ""
execute_sql_file "$CONFLUENT_DIR/05-predicted-gaps-sink-pipeline.sql"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "ksqlDB DDL execution complete."
info "Verify stream/table status at: ${ENDPOINT}/ksql (POST {\"ksql\":\"SHOW STREAMS;\"})"
echo ""
