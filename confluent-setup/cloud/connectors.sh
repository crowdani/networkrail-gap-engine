#!/usr/bin/env bash
# =============================================================================
# cloud/connectors.sh — Confluent Cloud Connector Registration
#
# Registers the Network Rail Gap Engine connectors in Confluent Cloud using
# the Confluent Cloud Connect REST API (fully-managed connectors).
#
# Connectors registered:
#   SOURCE — networkrail-activemq-source   (ActiveMQ → NR_TRAIN_MESSAGES)
#   SOURCE — jdbc-tiploc-reference         (PostgreSQL → NR_TIPLOC_REFERENCE)
#   SOURCE — jdbc-active-schedule          (PostgreSQL → NR_ACTIVE_SCHEDULE)
#   SINK   — predicted-gaps-postgresql-sink (PREDICTED_GAPS_FLAT → PostgreSQL)
#   SINK   — journey-stations-postgresql-sink (ALL_STATIONS_FLAT → PostgreSQL)
#
# Prerequisites — set these environment variables before running:
#
#   Required:
#     CONFLUENT_CLOUD_ENV_ID          Confluent Cloud environment ID   (e.g. env-abc123)
#     CONFLUENT_CLOUD_CLUSTER_ID      Kafka cluster ID                 (e.g. lkc-abc123)
#     CONFLUENT_CLOUD_API_KEY         Confluent Cloud API key          (cluster-level)
#     CONFLUENT_CLOUD_API_SECRET      Confluent Cloud API secret
#
#   Source connector — PostgreSQL connection (your DB must be reachable from Cloud):
#     PG_HOST                         PostgreSQL host  (e.g. my-pg.example.com)
#     PG_PORT                         PostgreSQL port  (default: 5432)
#     PG_DATABASE                     Database name    (default: network_rail)
#     PG_USER                         DB user          (default: postgres)
#     PG_PASSWORD                     DB password
#
#   Source connector — Network Rail ActiveMQ:
#     NR_ACTIVEMQ_URL                 ActiveMQ URL (default: datafeeds.networkrail.co.uk:61619)
#     NR_ACTIVEMQ_USERNAME            Network Rail datafeed username
#     NR_ACTIVEMQ_PASSWORD            Network Rail datafeed password
#
#   Sink connector — Schema Registry (needed for JSON_SR topics):
#     CONFLUENT_SCHEMA_REGISTRY_URL   Schema Registry URL
#     CONFLUENT_SCHEMA_REGISTRY_KEY   Schema Registry API key
#     CONFLUENT_SCHEMA_REGISTRY_SECRET Schema Registry API secret
#
# Usage:
#   export CONFLUENT_CLOUD_ENV_ID=env-abc123
#   export CONFLUENT_CLOUD_CLUSTER_ID=lkc-abc123
#   export CONFLUENT_CLOUD_API_KEY=...
#   export CONFLUENT_CLOUD_API_SECRET=...
#   export PG_HOST=my-pg.example.com
#   export PG_PASSWORD=...
#   export NR_ACTIVEMQ_USERNAME=you@example.com
#   export NR_ACTIVEMQ_PASSWORD=...
#   ./confluent-setup/cloud/connectors.sh
# =============================================================================

set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Preflight ──────────────────────────────────────────────────────────────────
for var in CONFLUENT_CLOUD_ENV_ID CONFLUENT_CLOUD_CLUSTER_ID CONFLUENT_CLOUD_API_KEY CONFLUENT_CLOUD_API_SECRET; do
    if [[ -z "${!var:-}" ]]; then
        error "Required environment variable '$var' is not set."
        exit 1
    fi
done

for var in PG_HOST PG_PASSWORD NR_ACTIVEMQ_USERNAME NR_ACTIVEMQ_PASSWORD; do
    if [[ -z "${!var:-}" ]]; then
        error "Required environment variable '$var' is not set."
        exit 1
    fi
done

# ── Defaults ───────────────────────────────────────────────────────────────────
PG_PORT="${PG_PORT:-5432}"
PG_DATABASE="${PG_DATABASE:-network_rail}"
PG_USER="${PG_USER:-postgres}"
NR_ACTIVEMQ_URL="${NR_ACTIVEMQ_URL:-datafeeds.networkrail.co.uk:61619}"
SR_URL="${CONFLUENT_SCHEMA_REGISTRY_URL:-}"
SR_KEY="${CONFLUENT_SCHEMA_REGISTRY_KEY:-}"
SR_SECRET="${CONFLUENT_SCHEMA_REGISTRY_SECRET:-}"
PG_JDBC_URL="jdbc:postgresql://${PG_HOST}:${PG_PORT}/${PG_DATABASE}"

# ── Confluent Cloud Connect REST base URL ──────────────────────────────────────
# The Connect REST endpoint for Confluent Cloud is:
#   https://api.confluent.cloud/connect/v1/environments/<env>/clusters/<cluster>/connectors
BASE_URL="https://api.confluent.cloud/connect/v1/environments/${CONFLUENT_CLOUD_ENV_ID}/clusters/${CONFLUENT_CLOUD_CLUSTER_ID}/connectors"

# ── Helper: register or update a connector ────────────────────────────────────
register_connector() {
    local name="$1"
    local payload="$2"

    info "Registering connector: $name ..."

    # Check if it already exists
    local http_status
    http_status=$(curl -s -o /dev/null -w "%{http_code}" \
        -u "${CONFLUENT_CLOUD_API_KEY}:${CONFLUENT_CLOUD_API_SECRET}" \
        "${BASE_URL}/${name}")

    if [[ "$http_status" == "200" ]]; then
        warn "Connector '$name' already exists — updating config..."
        local response
        response=$(curl -s -w "\n%{http_code}" -X PUT \
            -H "Content-Type: application/json" \
            -u "${CONFLUENT_CLOUD_API_KEY}:${CONFLUENT_CLOUD_API_SECRET}" \
            "${BASE_URL}/${name}/config" \
            -d "$payload")
        local body code
        body=$(echo "$response" | head -n -1)
        code=$(echo "$response" | tail -n 1)
        if [[ "$code" =~ ^2 ]]; then
            success "Connector '$name' updated."
        else
            error "Failed to update '$name' (HTTP $code): $body"
            return 1
        fi
    else
        local response
        response=$(curl -s -w "\n%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -u "${CONFLUENT_CLOUD_API_KEY}:${CONFLUENT_CLOUD_API_SECRET}" \
            "${BASE_URL}" \
            -d "{\"name\":\"${name}\",\"config\":${payload}}")
        local body code
        body=$(echo "$response" | head -n -1)
        code=$(echo "$response" | tail -n 1)
        if [[ "$code" =~ ^2 ]]; then
            success "Connector '$name' registered."
        else
            error "Failed to register '$name' (HTTP $code): $body"
            return 1
        fi
    fi
}

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Network Rail Gap Engine — Confluent Cloud Connector Registration"
echo "  Environment : $CONFLUENT_CLOUD_ENV_ID"
echo "  Cluster     : $CONFLUENT_CLOUD_CLUSTER_ID"
echo "  DB Host     : $PG_HOST:$PG_PORT/$PG_DATABASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. ActiveMQ Source ─────────────────────────────────────────────────────────
register_connector "networkrail-activemq-source" "$(cat <<EOF
{
  "connector.class": "ActiveMQSource",
  "kafka.api.key": "${CONFLUENT_CLOUD_API_KEY}",
  "kafka.api.secret": "${CONFLUENT_CLOUD_API_SECRET}",
  "activemq.url": "failover:(tcp://${NR_ACTIVEMQ_URL})?randomize=false",
  "activemq.username": "${NR_ACTIVEMQ_USERNAME}",
  "activemq.password": "${NR_ACTIVEMQ_PASSWORD}",
  "jms.destination.type": "topic",
  "jms.destination.name": "TRAIN_MVT_ALL_TOC",
  "kafka.topic": "NR_TRAIN_MESSAGES",
  "output.data.format": "JSON",
  "tasks.max": "1"
}
EOF
)"

# ── 2. JDBC Source — tiploc_reference ─────────────────────────────────────────
register_connector "jdbc-tiploc-reference" "$(cat <<EOF
{
  "connector.class": "PostgresSource",
  "kafka.api.key": "${CONFLUENT_CLOUD_API_KEY}",
  "kafka.api.secret": "${CONFLUENT_CLOUD_API_SECRET}",
  "connection.host": "${PG_HOST}",
  "connection.port": "${PG_PORT}",
  "connection.user": "${PG_USER}",
  "connection.password": "${PG_PASSWORD}",
  "db.name": "${PG_DATABASE}",
  "query": "SELECT stanox, tiploc, three_alpha, COALESCE(nlc_desc_16, nlc_desc, tiploc, stanox) AS station_name FROM tiploc_reference WHERE stanox IS NOT NULL AND stanox != '' AND tiploc IS NOT NULL AND tiploc != ''",
  "mode": "bulk",
  "poll.interval.ms": "86400000",
  "topic.prefix": "NR_TIPLOC_REFERENCE",
  "numeric.mapping": "best_fit",
  "transforms": "createKey,extractKey",
  "transforms.createKey.type": "org.apache.kafka.connect.transforms.ValueToKey",
  "transforms.createKey.fields": "stanox",
  "transforms.extractKey.type": "org.apache.kafka.connect.transforms.ExtractField\$Key",
  "transforms.extractKey.field": "stanox",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "key.converter.schemas.enable": "false",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": "false",
  "output.data.format": "JSON",
  "tasks.max": "1"
}
EOF
)"

# ── 3. JDBC Source — active_schedule ──────────────────────────────────────────
register_connector "jdbc-active-schedule" "$(cat <<EOF
{
  "connector.class": "PostgresSource",
  "kafka.api.key": "${CONFLUENT_CLOUD_API_KEY}",
  "kafka.api.secret": "${CONFLUENT_CLOUD_API_SECRET}",
  "connection.host": "${PG_HOST}",
  "connection.port": "${PG_PORT}",
  "connection.user": "${PG_USER}",
  "connection.password": "${PG_PASSWORD}",
  "db.name": "${PG_DATABASE}",
  "query": "SELECT id, cif_train_uid, cif_stp_indicator, schedule_start_date, schedule_end_date, schedule_days_runs, atoc_code, service_code, array_to_json(tiploc_array)::text AS tiploc_array, array_to_json(stanox_array)::text AS stanox_array, timing_data::text AS timing_data FROM active_schedule WHERE schedule_start_date <= CURRENT_DATE AND schedule_end_date >= CURRENT_DATE AND SUBSTRING(schedule_days_runs, EXTRACT(ISODOW FROM CURRENT_DATE)::int, 1) = '1' ORDER BY CASE cif_stp_indicator WHEN 'P' THEN 0 WHEN 'N' THEN 1 WHEN 'O' THEN 2 WHEN 'C' THEN 3 ELSE 0 END ASC",
  "mode": "bulk",
  "poll.interval.ms": "3600000",
  "numeric.mapping": "best_fit",
  "transforms": "createKey,extractKey",
  "transforms.createKey.type": "org.apache.kafka.connect.transforms.ValueToKey",
  "transforms.createKey.fields": "service_code",
  "transforms.extractKey.type": "org.apache.kafka.connect.transforms.ExtractField\$Key",
  "transforms.extractKey.field": "service_code",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "key.converter.schemas.enable": "false",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": "false",
  "output.data.format": "JSON",
  "tasks.max": "1"
}
EOF
)"

# ── 4. JDBC Sink — predicted_gaps ─────────────────────────────────────────────
register_connector "predicted-gaps-postgresql-sink" "$(cat <<EOF
{
  "connector.class": "PostgresSink",
  "kafka.api.key": "${CONFLUENT_CLOUD_API_KEY}",
  "kafka.api.secret": "${CONFLUENT_CLOUD_API_SECRET}",
  "topics": "PREDICTED_GAPS_FLAT",
  "connection.host": "${PG_HOST}",
  "connection.port": "${PG_PORT}",
  "connection.user": "${PG_USER}",
  "connection.password": "${PG_PASSWORD}",
  "db.name": "${PG_DATABASE}",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "value.converter": "io.confluent.connect.json.JsonSchemaConverter",
  "value.converter.schema.registry.url": "${SR_URL}",
  "value.converter.basic.auth.credentials.source": "USER_INFO",
  "value.converter.basic.auth.user.info": "${SR_KEY}:${SR_SECRET}",
  "insert.mode": "upsert",
  "pk.mode": "record_value",
  "pk.fields": "train_id,station_index,schedule_start_date",
  "table.name.format": "predicted_gaps",
  "auto.create": "false",
  "auto.evolve": "false",
  "transforms": "castScheduleDate",
  "transforms.castScheduleDate.type": "org.apache.kafka.connect.transforms.Cast\$Value",
  "transforms.castScheduleDate.spec": "schedule_start_date:string",
  "errors.tolerance": "all",
  "errors.deadletterqueue.topic.name": "PREDICTED_GAPS_FLAT_DLQ",
  "errors.deadletterqueue.topic.replication.factor": "3",
  "errors.deadletterqueue.context.headers.enable": "true",
  "errors.log.enable": "true",
  "errors.log.include.messages": "true",
  "input.data.format": "JSON_SR",
  "tasks.max": "1"
}
EOF
)"

# ── 5. JDBC Sink — journey_stations ───────────────────────────────────────────
register_connector "journey-stations-postgresql-sink" "$(cat <<EOF
{
  "connector.class": "PostgresSink",
  "kafka.api.key": "${CONFLUENT_CLOUD_API_KEY}",
  "kafka.api.secret": "${CONFLUENT_CLOUD_API_SECRET}",
  "topics": "ALL_STATIONS_FLAT",
  "connection.host": "${PG_HOST}",
  "connection.port": "${PG_PORT}",
  "connection.user": "${PG_USER}",
  "connection.password": "${PG_PASSWORD}",
  "db.name": "${PG_DATABASE}",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "value.converter": "io.confluent.connect.json.JsonSchemaConverter",
  "value.converter.schema.registry.url": "${SR_URL}",
  "value.converter.basic.auth.credentials.source": "USER_INFO",
  "value.converter.basic.auth.user.info": "${SR_KEY}:${SR_SECRET}",
  "insert.mode": "upsert",
  "pk.mode": "record_value",
  "pk.fields": "train_id,station_index,schedule_start_date",
  "table.name.format": "journey_stations",
  "auto.create": "false",
  "auto.evolve": "false",
  "quote.sql.identifiers": "never",
  "transforms": "lowerFields",
  "transforms.lowerFields.type": "org.apache.kafka.connect.transforms.ReplaceField\$Value",
  "transforms.lowerFields.renames": "TRAIN_ID_VAL:train_id,TRAIN_UID:train_uid,SCHEDULE_START_DATE:schedule_start_date,COMPLETION_TIME:completion_time,TOTAL_SCHEDULED_STOPS:total_scheduled_stops,FOUND_STOPS_COUNT:found_stops_count,MISSED_STOPS_COUNT:missed_stops_count,SEVERITY:severity,STATION_INDEX:station_index,STATION_NAME:station_name,TIPLOC:tiploc,STANOX:stanox,STATUS:status,VISITED:visited,SCHEDULED_TIME:scheduled_time,SCHEDULED_ARRIVAL:scheduled_arrival,SCHEDULED_DEPARTURE:scheduled_departure,ACTUAL_TIME:actual_time,ACTUAL_ARRIVAL:actual_arrival,ACTUAL_DEPARTURE:actual_departure,EVENT:event,PREDICTED_ARRIVAL:predicted_arrival,PREDICTED_ARRIVAL_MS:predicted_arrival_ms,PREDICTED_DEPARTURE:predicted_departure,PREDICTED_DEPARTURE_MS:predicted_departure_ms,PREDICTED_TIME:predicted_time,PREDICTED_TIME_MS:predicted_time_ms,PREDICTED_DELAY_MINUTES:predicted_delay_minutes,PREDICTION_CONFIDENCE:prediction_confidence,PREDICTION_METHOD:prediction_method,PREDICTION_BASIS:prediction_basis",
  "errors.tolerance": "all",
  "errors.deadletterqueue.topic.name": "ALL_STATIONS_FLAT_DLQ",
  "errors.deadletterqueue.topic.replication.factor": "3",
  "errors.deadletterqueue.context.headers.enable": "true",
  "errors.log.enable": "true",
  "errors.log.include.messages": "true",
  "input.data.format": "JSON_SR",
  "tasks.max": "1"
}
EOF
)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "All connectors registered. Verify status in Confluent Cloud UI"
info "or via: confluent connect cluster list --environment $CONFLUENT_CLOUD_ENV_ID"
echo ""
