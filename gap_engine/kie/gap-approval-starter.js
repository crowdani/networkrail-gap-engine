#!/usr/bin/env node
/**
 * gap-approval-starter.js
 * =======================
 * Polls /api/predicted-gaps for PENDING journeys and starts one
 * GapApprovalProcess instance in KIE Server per journey.
 *
 * Runs in parallel with the existing approvals UI — both read/write the same
 * predicted_gaps table. The BAMOE workflow calls PATCH /api/predicted-gaps/{id}
 * directly; the UI reflects those changes immediately.
 *
 * Environment variables:
 *   FRONTEND_URL   Base URL of the Next.js app  (default: http://localhost:3000)
 *   KIE_URL        KIE Server REST base          (default: http://localhost:8090/kie-server/services/rest/server)
 *   KIE_USER       KIE Server user               (default: kieserver)
 *   KIE_PASS       KIE Server password           (default: kieserver1!)
 *   KIE_CONTAINER  KIE container/deployment ID   (default: gap-approval-process_1.0.0)
 *   POLL_INTERVAL  Seconds between polls         (default: 60)
 *
 * Usage:
 *   npm install node-fetch   # only needed for Node < 18
 *   node gap-approval-starter.js
 *
 *   # Or with environment overrides:
 *   FRONTEND_URL=https://frontend-networkrail-gap-engine.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com \
 *   KIE_URL=http://localhost:8090/kie-server/services/rest/server \
 *   node gap-approval-starter.js
 */

const FRONTEND_URL  = process.env.FRONTEND_URL  || 'http://localhost:3000';
const KIE_URL       = process.env.KIE_URL       || 'http://localhost:8080/kie-server/services/rest/server';
const KIE_USER      = process.env.KIE_USER      || 'kieserver';
const KIE_PASS      = process.env.KIE_PASS      || 'kieserver1!';
const KIE_CONTAINER = process.env.KIE_CONTAINER || 'gap-approval-process_1.0.0';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '60', 10) * 1000;

// Track which (trainId + scheduleDate) combos we've already started a process for,
// so we don't create duplicates between polls.
const startedJourneys = new Set();

const kieAuth = 'Basic ' + Buffer.from(`${KIE_USER}:${KIE_PASS}`).toString('base64');

/** Fetch PENDING journeys from the predicted-gaps API */
async function fetchPendingJourneys() {
  const url = `${FRONTEND_URL}/api/predicted-gaps?status=PENDING&pageSize=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`predicted-gaps API returned ${res.status}`);
  const data = await res.json();
  return data.journeys || [];
}

/** Extract numeric predicted_gaps IDs for PENDING stops in a journey */
function pendingStopIds(journey) {
  return (journey.predictions || [])
    .filter(p => (p.approval_status || 'PENDING') === 'PENDING')
    .map(p => String(p.id))
    .filter(Boolean)
    .join(',');
}

/** Start a GapApprovalProcess instance in KIE Server for one journey */
async function startProcess(journey) {
  const stopIds = pendingStopIds(journey);
  if (!stopIds) return; // nothing pending

  const journeyUrl = `${FRONTEND_URL}/approvals`
    + `?trainId=${encodeURIComponent(journey.train_id)}`
    + (journey.schedule_start_date ? `&date=${encodeURIComponent(journey.schedule_start_date)}` : '');

  const variables = {
    trainId:      { value: journey.train_id,              type: 'String'  },
    trainUid:     { value: journey.train_uid || '',        type: 'String'  },
    scheduleDate: { value: journey.schedule_start_date || '', type: 'String' },
    severity:     { value: journey.severity || 'UNKNOWN', type: 'String'  },
    missedStops:  { value: journey.missed_stops_count ?? 0, type: 'Integer' },
    totalStops:   { value: journey.total_scheduled_stops ?? 0, type: 'Integer' },
    pendingStopIds: { value: stopIds,                     type: 'String'  },
    journeyUrl:   { value: journeyUrl,                    type: 'String'  },
    apiBaseUrl:   { value: FRONTEND_URL,                  type: 'String'  },
  };

  const url = `${KIE_URL}/containers/${KIE_CONTAINER}/processes/GapApprovalProcess/instances`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': kieAuth,
    },
    body: JSON.stringify({ variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KIE Server ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data['process-instance-id'];
}

/** One poll cycle */
async function poll() {
  console.log(`[${new Date().toISOString()}] Polling for PENDING journeys…`);
  try {
    const journeys = await fetchPendingJourneys();
    console.log(`  Found ${journeys.length} PENDING journey(s)`);

    for (const journey of journeys) {
      const key = `${journey.train_id}|${journey.schedule_start_date || ''}`;
      if (startedJourneys.has(key)) {
        console.log(`  Skipping ${key} — process already started this session`);
        continue;
      }

      try {
        const instanceId = await startProcess(journey);
        startedJourneys.add(key);
        console.log(`  ✓ Started process instance ${instanceId} for ${key}`
          + ` (${journey.missed_stops_count ?? '?'} missed stops, severity: ${journey.severity})`);
      } catch (err) {
        console.error(`  ✗ Failed to start process for ${key}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`  Poll error: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Gap Approval Starter');
console.log(`  Frontend : ${FRONTEND_URL}`);
console.log(`  KIE      : ${KIE_URL}`);
console.log(`  Container: ${KIE_CONTAINER}`);
console.log(`  Interval : ${POLL_INTERVAL / 1000}s`);
console.log('');

poll(); // run immediately on start
setInterval(poll, POLL_INTERVAL);
