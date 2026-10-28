/**
 * kafka-rest.ts
 *
 * Thin wrapper around the Confluent REST Proxy v3 API.
 * Reads the last N messages from a topic by seeking to the end offset and
 * consuming backwards via a temporary consumer group.
 *
 * Environment variables:
 *   KAFKA_REST_URL   — base URL of the REST proxy
 *                      default: https://kafkarestproxy.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com
 *   KAFKA_CLUSTER_ID — Kafka cluster ID (default: auto-discovered on first call)
 */

const REST_URL = (
  process.env.KAFKA_REST_URL ??
  'https://kafkarestproxy.apps.itz-klvg6u.infra01-lb.lon04.techzone.ibm.com'
).replace(/\/$/, '');

let _clusterId: string | null = null;

async function kfetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  return res;
}

async function clusterId(): Promise<string> {
  if (_clusterId) return _clusterId;
  const res = await kfetch(`${REST_URL}/v3/clusters`);
  if (!res.ok) throw new Error(`REST proxy /v3/clusters → HTTP ${res.status}`);
  const data = await res.json();
  _clusterId = data.data[0].cluster_id as string;
  return _clusterId;
}

export interface KafkaMessage {
  offset: number;
  timestamp: number;
  key: unknown;
  value: unknown;
}

/**
 * Fetch the latest `limit` records from a topic, reading ALL partitions.
 *
 * `LIVE_JOURNEY_STATE` has 3 partitions (keyed by TRAIN_ID hash). Reading only
 * partition 0 means the other two thirds of active trains are invisible and the
 * newest records may be on a different partition.  This function spins up one
 * consumer, assigns all three partitions, seeks each to `end - perPartitionLimit`,
 * polls once, then merges and sorts by Kafka timestamp so the caller always gets
 * the globally newest messages.
 */
export async function fetchLatest(topic: string, limit = 50, partitions = 3): Promise<KafkaMessage[]> {
  const cid = await clusterId();
  const groupId   = `report-explorer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const instanceId = 're-1';

  const createRes = await kfetch(`${REST_URL}/consumers/${groupId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
    body: JSON.stringify({ name: instanceId, format: 'binary', 'auto.offset.reset': 'earliest' }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Create consumer → ${createRes.status}: ${body}`);
  }
  const { base_uri: raw_base_uri } = await createRes.json() as { base_uri: string };
  const base_uri = raw_base_uri.replace(/^https?:\/\/[^/]+/, REST_URL);

  try {
    // Assign all partitions in one call
    const partitionList = Array.from({ length: partitions }, (_, i) => ({ topic, partition: i }));
    const assignRes = await kfetch(`${base_uri}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
      body: JSON.stringify({ partitions: partitionList }),
    });
    if (!assignRes.ok) {
      const body = await assignRes.text();
      throw new Error(`Assign → ${assignRes.status}: ${body}`);
    }

    // Fetch end offsets for every partition in parallel
    const topicEnc = encodeURIComponent(topic);
    const perPartition = Math.ceil(limit / partitions);
    const offsetData = await Promise.all(
      Array.from({ length: partitions }, async (_, p) => {
        const [begRes, endRes] = await Promise.all([
          kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${p}/beginning-offset`),
          kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${p}/end-offset`),
        ]);
        const beginning = begRes.ok ? ((await begRes.json()).beginning_offset as number) : 0;
        const end       = endRes.ok ? ((await endRes.json()).end_offset       as number) : 0;
        return { partition: p, startOffset: Math.max(beginning, end - perPartition) };
      })
    );

    // Seek all partitions at once
    const seekRes = await kfetch(`${base_uri}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
      body: JSON.stringify({
        offsets: offsetData.map(({ partition, startOffset }) => ({ topic, partition, offset: startOffset })),
      }),
    });
    if (!seekRes.ok) {
      const body = await seekRes.text();
      throw new Error(`Seek → ${seekRes.status}: ${body}`);
    }

    // A single poll drains all assigned partitions up to max_bytes
    const pollRes = await kfetch(`${base_uri}/records?max_bytes=10485760`, {
      headers: { Accept: 'application/vnd.kafka.binary.v2+json' },
    });
    if (!pollRes.ok) {
      const body = await pollRes.text();
      throw new Error(`Poll → ${pollRes.status}: ${body}`);
    }
    const rawRecords = await pollRes.json() as Array<{
      offset: number; timestamp: number; partition?: number;
      key: string | null; value: string | null;
    }>;

    const decoded: KafkaMessage[] = rawRecords.map(r => {
      const keyStr   = r.key   ? Buffer.from(r.key,   'base64').toString('utf8') : null;
      const valueStr = r.value ? Buffer.from(r.value, 'base64').toString('utf8') : null;
      let parsedValue: unknown = valueStr;
      if (valueStr) { try { parsedValue = JSON.parse(valueStr); } catch { parsedValue = valueStr; } }
      return { offset: r.offset, timestamp: r.timestamp, key: keyStr, value: parsedValue };
    });

    // Sort globally by Kafka timestamp descending, keep the newest `limit` records
    decoded.sort((a, b) => b.timestamp - a.timestamp);
    return decoded.slice(0, limit);
  } finally {
    kfetch(base_uri, { method: 'DELETE', headers: { 'Content-Type': 'application/vnd.kafka.v2+json' } })
      .catch(() => {});
  }
}

export async function topicOffsets(topic: string, partition = 0) {
  const cid = await clusterId();
  const topicEnc = encodeURIComponent(topic);
  const [begRes, endRes] = await Promise.all([
    kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${partition}/beginning-offset`),
    kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${partition}/end-offset`),
  ]);
  const beginning = begRes.ok ? ((await begRes.json()).beginning_offset as number) : 0;
  const end       = endRes.ok ? ((await endRes.json()).end_offset       as number) : 0;
  return { beginning, end, count: Math.max(0, end - beginning) };
}
