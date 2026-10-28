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
).replace(/\/$/, ''); // strip trailing slash

// Log the URL once at module load so it appears in the Next.js server console
console.log('[kafka-rest] REST_URL =', REST_URL);

let _clusterId: string | null = null;

/** Shared fetch wrapper that logs every request + response status without consuming the body */
async function kfetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  console.log(`[kafka-rest] ${method} ${url}`);
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch (err) {
    console.error(`[kafka-rest] fetch FAILED ${method} ${url}:`, err);
    throw err;
  }
  // Log status only — never read the body here so callers can still consume it
  if (!res.ok) {
    console.error(`[kafka-rest] HTTP ${res.status} ${method} ${url}`);
  } else {
    console.log(`[kafka-rest] HTTP ${res.status} ${method} ${url}`);
  }
  return res;
}

async function clusterId(): Promise<string> {
  if (_clusterId) return _clusterId;
  const res = await kfetch(`${REST_URL}/v3/clusters`);
  if (!res.ok) throw new Error(`REST proxy /v3/clusters → HTTP ${res.status}`);
  const data = await res.json();
  _clusterId = data.data[0].cluster_id as string;
  console.log('[kafka-rest] cluster_id =', _clusterId);
  return _clusterId;
}

export interface KafkaMessage {
  offset: number;
  timestamp: number;
  key: unknown;
  value: unknown;
}

/**
 * Fetch the last `limit` messages from `topic` across ALL partitions.
 *
 * Strategy per partition:
 *   - Discover beginning + end offsets via the v3 API.
 *   - Seek to max(beginning, end - limit) so we fetch at most `limit` records
 *     per partition (generous — we trim to `limit` total at the end).
 *   - After collecting from all partitions, sort by Kafka timestamp (ms) and
 *     return the newest `limit` records.  Timestamp is the broker log-append
 *     time and is cross-partition comparable.
 */
export async function fetchLatest(topic: string, limit = 50): Promise<KafkaMessage[]> {
  const cid = await clusterId();
  const topicEnc = encodeURIComponent(topic);

  // Discover partition count
  const metaRes = await kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions`);
  if (!metaRes.ok) throw new Error(`Partition list → HTTP ${metaRes.status}`);
  const metaData = await metaRes.json() as { data: Array<{ partition_id: number }> };
  const partitions = metaData.data.map(p => p.partition_id);
  console.log(`[kafka-rest] topic=${topic} partitions=${partitions}`);

  // Resolve start offsets for every partition in parallel
  const partitionOffsets = await Promise.all(
    partitions.map(async (p) => {
      const [bRes, eRes] = await Promise.all([
        kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${p}/beginning-offset`),
        kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${p}/end-offset`),
      ]);
      const beginning = bRes.ok ? ((await bRes.json()).beginning_offset as number) : 0;
      const end       = eRes.ok ? ((await eRes.json()).end_offset       as number) : 0;
      const startOffset = Math.max(beginning, end - limit);
      console.log(`[kafka-rest] topic=${topic} p=${p} beginning=${beginning} end=${end} startOffset=${startOffset}`);
      return { partition: p, beginning, end, startOffset };
    })
  );

  // Use a random suffix to guarantee uniqueness — Date.now() alone can collide
  // on concurrent requests and cause 409 "consumer group already exists".
  const groupId = `flink-explorer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const instanceId = 'fe-1';

  // Create consumer group + instance.
  // Use format=binary — the message key is a plain string (TRAIN_ID), not JSON,
  // so format=json causes the REST proxy to fail parsing it (error 408 JsonParseException).
  // binary returns both key and value as base64; we decode the value ourselves.
  const createRes = await kfetch(`${REST_URL}/consumers/${groupId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
    body: JSON.stringify({
      name: instanceId,
      format: 'binary',
      'auto.offset.reset': 'earliest',
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Create consumer → ${createRes.status}: ${body}`);
  }
  const { base_uri: raw_base_uri } = await createRes.json() as { base_uri: string };
  // The REST proxy returns an internal cluster hostname in base_uri — rewrite to REST_URL.
  const base_uri = raw_base_uri.replace(/^https?:\/\/[^/]+/, REST_URL);
  console.log('[kafka-rest] consumer base_uri (rewritten) =', base_uri);

  try {
    // Assign ALL partitions at once — gives immediate synchronous assignment,
    // unlike subscribe() which assigns lazily on the first poll call.
    const assignRes = await kfetch(`${base_uri}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
      body: JSON.stringify({
        partitions: partitions.map(p => ({ topic, partition: p })),
      }),
    });
    if (!assignRes.ok) {
      const body = await assignRes.text();
      throw new Error(`Assign → ${assignRes.status}: ${body}`);
    }

    // Seek all partitions to their calculated start offsets
    const seekRes = await kfetch(`${base_uri}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
      body: JSON.stringify({
        offsets: partitionOffsets.map(({ partition, startOffset }) => ({
          topic, partition, offset: startOffset,
        })),
      }),
    });
    if (!seekRes.ok) {
      const body = await seekRes.text();
      throw new Error(`Seek → ${seekRes.status}: ${body}`);
    }

    // Poll — with format=binary the Accept header must be application/vnd.kafka.binary.v2+json.
    // key and value arrive as base64-encoded strings; decode value to UTF-8 then parse JSON.
    // Request enough bytes to cover limit records across all partitions.
    const pollRes = await kfetch(`${base_uri}/records?max_bytes=31457280`, {
      headers: { Accept: 'application/vnd.kafka.binary.v2+json' },
    });
    if (!pollRes.ok) {
      const body = await pollRes.text();
      throw new Error(`Poll → ${pollRes.status}: ${body}`);
    }
    const rawRecords = await pollRes.json() as Array<{
      offset: number; timestamp: number; partition: number;
      key: string | null; value: string | null;  // base64
    }>;
    console.log(`[kafka-rest] polled ${rawRecords.length} records from ${topic} (all partitions)`);

    const decoded: KafkaMessage[] = rawRecords.map(r => {
      const keyStr   = r.key   ? Buffer.from(r.key,   'base64').toString('utf8') : null;
      const valueStr = r.value ? Buffer.from(r.value, 'base64').toString('utf8') : null;
      let parsedValue: unknown = valueStr;
      if (valueStr) {
        try { parsedValue = JSON.parse(valueStr); } catch { parsedValue = valueStr; }
      }
      return {
        offset:    r.offset,
        timestamp: r.timestamp,
        key:       keyStr,
        value:     parsedValue,
      };
    });

    // Sort by Kafka broker timestamp ascending, then take the newest `limit`
    decoded.sort((a, b) => a.timestamp - b.timestamp);
    return decoded.slice(-limit);

  } finally {
    // Always delete the consumer — fire and forget
    kfetch(base_uri, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
    }).catch(e => console.warn('[kafka-rest] consumer DELETE failed:', e));
  }
}

/**
 * Return beginning + end offsets summed across ALL partitions of a topic.
 *
 * Using only partition 0 gives wrong results for:
 *   - Topics with 3 partitions (two-thirds of messages ignored)
 *   - Compacted/retention-truncated topics where beginning > 0
 *     (raw end offset looks huge but most messages are gone)
 *
 * By summing (end - beginning) per partition we get the true live message count.
 */
export async function topicOffsets(topic: string) {
  const cid      = await clusterId();
  const topicEnc = encodeURIComponent(topic);

  // Discover all partitions
  const metaRes = await kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions`);
  if (!metaRes.ok) {
    console.warn(`[kafka-rest] topicOffsets: partition list failed for ${topic} → HTTP ${metaRes.status}`);
    return { beginning: 0, end: 0, count: 0 };
  }
  const metaData = await metaRes.json() as { data: Array<{ partition_id: number }> };
  const partitions = metaData.data.map(p => p.partition_id);

  // Fetch beginning + end for every partition in parallel
  const perPartition = await Promise.all(
    partitions.map(async (p) => {
      const [bRes, eRes] = await Promise.all([
        kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${p}/beginning-offset`),
        kfetch(`${REST_URL}/v3/clusters/${cid}/topics/${topicEnc}/partitions/${p}/end-offset`),
      ]);
      const beginning = bRes.ok ? ((await bRes.json()).beginning_offset as number) : 0;
      const end       = eRes.ok ? ((await eRes.json()).end_offset       as number) : 0;
      return { beginning, end };
    })
  );

  const totalBeginning = perPartition.reduce((s, p) => s + p.beginning, 0);
  const totalEnd       = perPartition.reduce((s, p) => s + p.end,       0);
  return {
    beginning: totalBeginning,
    end:       totalEnd,
    count:     Math.max(0, totalEnd - totalBeginning),
  };
}
