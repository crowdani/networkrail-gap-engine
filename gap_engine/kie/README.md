# Gap Approval — IBM BAMOE 8 Workflow

BPMN process that manages predicted gap approvals in parallel with the existing approvals UI.
Both the workflow and the UI read/write the same `predicted_gaps` table — they are fully decoupled and safe to run simultaneously.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  predicted_gaps (PostgreSQL)                                     │
│  approval_status: PENDING → APPROVED | REJECTED                 │
└───────────┬──────────────────────────────────┬──────────────────┘
            │  PATCH /api/predicted-gaps/{id}  │  PATCH (same)
            │                                  │
  ┌─────────▼──────────────┐       ┌───────────▼──────────────┐
  │  Existing Approvals UI │       │  BAMOE Workflow          │
  │  /approvals (Next.js)  │       │  GapApprovalProcess      │
  │  Manual, per-stop      │       │  Bulk + SLA escalation   │
  └────────────────────────┘       └──────────────────────────┘
                                            ▲
                                   ┌────────┴───────────┐
                                   │  gap-approval-      │
                                   │  starter.js         │
                                   │  Polls /api/        │
                                   │  predicted-gaps     │
                                   │  → starts one       │
                                   │  process per        │
                                   │  PENDING journey    │
                                   └────────────────────┘
```

## Process Flow

```
Start ──▶ Fetch Stop IDs ──▶ Review Journey (User Task, 4h SLA)
                                      │
                          ┌──────────►├─ APPROVE_ALL ──▶ Approve All Stops ──▶ End
          SLA Timer (4h) ─┘           ├─ REJECT_ALL  ──▶ Reject All Stops  ──▶ End
          Auto-Approve ◄──────────────┘  PARTIAL     ──▶ Per-Stop Review   ──▶ Apply ──▶ End
```

| Node | Type | Description |
|---|---|---|
| Fetch Stop IDs | Service Task (REST) | `GET /api/predicted-gaps/journey/{trainId}` → extracts numeric IDs of all PENDING stops |
| Review Journey Gaps | User Task | Operator decides: `APPROVE_ALL`, `REJECT_ALL`, or `PARTIAL` |
| SLA Timer | Boundary Event | Fires after **4 hours** of inaction; routes to Auto-Approve |
| Approve All Stops | Script Task | Calls `PATCH /api/predicted-gaps/{id}` with `action=approve` for each stop |
| Reject All Stops | Script Task | Calls `PATCH /api/predicted-gaps/{id}` with `action=reject` for each stop |
| Per-Stop Review | User Task | Operator provides JSON array of individual stop decisions |
| Apply Per-Stop Decisions | Script Task | Parses JSON array and PATCHes each stop accordingly |
| Auto-Approve | Script Task | Bulk-approves all stops with `approved_by=bamoe-sla-auto` |

## Local Setup (Docker / Podman)

### 1. Prerequisites

```bash
# Log in to Red Hat registry (BAMOE images require a Red Hat subscription)
podman login registry.redhat.io

# Build the kjar — use the project-local settings.xml so Maven resolves
# kie-maven-plugin from the Red Hat GA repo (not Maven Central)
cd gap_engine/kie
mvn -s settings.xml clean install -DskipTests
```

### 2. Start BAMOE stack

```bash
cd gap_engine/kie
docker-compose up -d

# Business Central  →  http://localhost:8080/business-central  (admin / admin)
# KIE Server        →  http://localhost:8090/kie-server/services/rest/server
```

### 3. Deploy the kjar in Business Central

1. Open **Business Central** → Menu → **Deploy** → **Execution Servers**
2. Click the `gap-approval-server` server
3. Click **+** → **Deploy Unit**
4. GroupId: `com.networkrail`, ArtifactId: `gap-approval-process`, Version: `1.0.0`
5. Click **Deploy** — the container ID becomes `gap-approval-process_1.0.0`

### 4. Create the `gap-approvers` group

1. Business Central → **Admin** → **Groups** → **New Group** → `gap-approvers`
2. Assign the `admin` user (or create a dedicated user) to the group

### 5. Start the worker

The starter polls the live predicted-gaps API and fires one BAMOE process instance per PENDING journey.

```bash
# Against the OpenShift frontend (production data, parallel test)
FRONTEND_URL=https://frontend-networkrail-gap-engine.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com \
KIE_URL=http://localhost:8090/kie-server/services/rest/server \
node gap-approval-starter.js

# Against a local frontend
FRONTEND_URL=http://localhost:3000 \
node gap-approval-starter.js
```

## Using the Task Inbox

1. Open **Business Central** → **Menu** → **Track** → **Task Inbox**
2. Tasks assigned to `gap-approvers` appear here
3. For **Review Journey Gaps**: set `approvalDecision` to `APPROVE_ALL`, `REJECT_ALL`, or `PARTIAL`
4. Optionally set `approvedTime` (HH:MM) and `rejectionReason`
5. Click **Complete**

The process immediately calls `PATCH /api/predicted-gaps/{id}` for every stop and the changes appear in the existing Approvals UI.

## Process Variables

| Variable | Type | Direction | Description |
|---|---|---|---|
| `trainId` | String | in | e.g. `871B26MKINGX` |
| `trainUid` | String | in | e.g. `C12345` |
| `scheduleDate` | String | in | `YYYY-MM-DD` |
| `severity` | String | in | `HIGH`, `MEDIUM`, `LOW` |
| `missedStops` | Integer | in | Count of MISSED stops |
| `totalStops` | Integer | in | Total scheduled stops |
| `pendingStopIds` | String | in | Comma-separated numeric `predicted_gaps.id` values |
| `journeyUrl` | String | in | Deep-link to the approvals UI for this journey |
| `apiBaseUrl` | String | in | Base URL of the Next.js API |
| `approvalDecision` | String | out (user task) | `APPROVE_ALL` \| `REJECT_ALL` \| `PARTIAL` |
| `approvedTime` | String | out (user task) | Optional amended time HH:MM |
| `rejectionReason` | String | out (user task) | Optional rejection note |

## Per-Stop Decision JSON Format (PARTIAL path)

When the operator selects `PARTIAL`, a second task opens. Enter a JSON array:

```json
[
  {"id":"123","action":"approve"},
  {"id":"124","action":"approve","approved_time":"14:32"},
  {"id":"125","action":"reject","reason":"Prediction looks incorrect"}
]
```

Stop IDs are shown in the task description alongside the `journeyUrl` link.

## OpenShift Deployment (future)

The BAMOE operator is available on OperatorHub. To deploy on the same cluster:

```bash
# Install BAMOE operator
oc apply -f https://github.com/kiegroup/bamoe/releases/latest/download/bamoe-operator.yaml -n networkrail-gap-engine

# Create a KieApp CR pointing at the kjar in an accessible Maven repo
# (upload the kjar to Nexus or the cluster's internal registry first)
```

See the [BAMOE 8 documentation](https://access.redhat.com/documentation/en-us/red_hat_build_of_kogito_and_optaplanner/8.0) for full operator configuration.
