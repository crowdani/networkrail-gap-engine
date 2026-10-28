import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/debug
 *
 * Runs a step-by-step connectivity probe against the Kafka REST Proxy
 * and returns full details of what succeeds or fails.
 * Browse to http://localhost:3001/api/debug to diagnose connection issues.
 */
export async function GET() {
  const REST_URL = (
    process.env.KAFKA_REST_URL ??
    'https://kafkarestproxy.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com'
  ).replace(/\/$/, '');

  const result: Record<string, unknown> = {
    REST_URL,
    NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    NODE_VERSION: process.version,
    steps: [] as unknown[],
  };

  const steps = result.steps as Array<Record<string, unknown>>;

  // Step 1 — hit /v3/clusters
  try {
    const res = await fetch(`${REST_URL}/v3/clusters`, { cache: 'no-store' });
    const body = await res.text();
    steps.push({
      step: 'GET /v3/clusters',
      status: res.status,
      ok: res.ok,
      body: body.slice(0, 500),
    });

    if (res.ok) {
      const data = JSON.parse(body);
      const clusterId = data?.data?.[0]?.cluster_id ?? null;
      result.clusterId = clusterId;

      // Step 2 — list topics
      if (clusterId) {
        try {
          const tRes = await fetch(`${REST_URL}/v3/clusters/${clusterId}/topics`, { cache: 'no-store' });
          const tBody = await tRes.text();
          steps.push({
            step: 'GET /v3/clusters/{id}/topics',
            status: tRes.status,
            ok: tRes.ok,
            topicCount: tRes.ok ? (JSON.parse(tBody)?.data?.length ?? 'unknown') : null,
            sample: tBody.slice(0, 300),
          });

          // Step 3 — check COMPLETED_JOURNEYS exists
          const cjRes = await fetch(
            `${REST_URL}/v3/clusters/${clusterId}/topics/COMPLETED_JOURNEYS`,
            { cache: 'no-store' }
          );
          steps.push({
            step: 'GET /v3/clusters/{id}/topics/COMPLETED_JOURNEYS',
            status: cjRes.status,
            ok: cjRes.ok,
            body: (await cjRes.text()).slice(0, 300),
          });

          // Step 4 — check LIVE_JOURNEY_STATE exists
          const ljRes = await fetch(
            `${REST_URL}/v3/clusters/${clusterId}/topics/LIVE_JOURNEY_STATE`,
            { cache: 'no-store' }
          );
          steps.push({
            step: 'GET /v3/clusters/{id}/topics/LIVE_JOURNEY_STATE',
            status: ljRes.status,
            ok: ljRes.ok,
            body: (await ljRes.text()).slice(0, 300),
          });
        } catch (e) {
          steps.push({ step: 'topic checks', error: String(e) });
        }
      }
    }
  } catch (err) {
    steps.push({
      step: 'GET /v3/clusters',
      error: String(err),
      errorType: err instanceof Error ? err.constructor.name : typeof err,
      // Surface the underlying cause (e.g. UNABLE_TO_VERIFY_LEAF_SIGNATURE, ECONNREFUSED)
      cause: err instanceof Error && 'cause' in err
        ? String((err as NodeJS.ErrnoException & { cause?: unknown }).cause)
        : undefined,
    });
  }

  return NextResponse.json(result, { status: 200 });
}
