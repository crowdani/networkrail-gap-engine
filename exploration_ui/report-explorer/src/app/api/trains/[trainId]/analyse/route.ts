import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/trains/[trainId]/analyse
 *
 * Builds a compact prompt from the train's journey_stations / predicted_gaps
 * data and calls watsonx.ai to classify the root cause of the delay.
 *
 * Returns:
 *   { cause, category, confidence, detail, model_id, generated_at }
 *
 * The caller selects the model via the optional `model_id` body field.
 * Supported env vars (injected by the frontend deployment):
 *   WATSONX_API_KEY, WATSONX_PROJECT_ID, WATSONX_URL, WATSONX_MODEL_ID
 */

const WATSONX_URL        = process.env.WATSONX_URL        ?? 'https://eu-de.ml.cloud.ibm.com';
const DEFAULT_MODEL      = process.env.WATSONX_MODEL_ID   ?? 'meta-llama/llama-3-3-70b-instruct';
const WATSONX_API_KEY    = process.env.WATSONX_API_KEY;
const WATSONX_PROJECT_ID = process.env.WATSONX_PROJECT_ID;

const AVAILABLE_MODELS = [
  { id: 'meta-llama/llama-3-3-70b-instruct',  label: 'Llama 3.3 70B'      },
  { id: 'ibm/granite-3-8b-instruct',           label: 'Granite 3 8B'       },
  { id: 'ibm/granite-4-h-small',               label: 'Granite 4 H Small'  },
  { id: 'mistralai/mistral-large',             label: 'Mistral Large'       },
];

const VALID_CATEGORIES = new Set([
  'INFRASTRUCTURE', 'TIMETABLING', 'OPERATIONAL',
  'EXTERNAL', 'ROLLING_STOCK', 'UNKNOWN',
]);

const MAX_STOP_CHARS = 2_500;

// ---------------------------------------------------------------------------
// Prompt builder — mirrors delay_cause_analyser.py logic
// ---------------------------------------------------------------------------

interface StopRow {
  station_name: string | null;
  tiploc: string | null;
  stanox: string | null;
  scheduled_time: string | null;
  actual_time: string | null;
  predicted_time: string | null;
  predicted_delay_minutes: number | null;
  prediction_method: string | null;
  visited: boolean | null;
  delay_minutes?: number | null;
}

function buildPrompt(
  trainId: string,
  trainUid: string | null,
  schedDate: string | null,
  severity: string | null,
  total: number,
  found: number,
  missed: number,
  stops: StopRow[],
): string {
  const visitedLines: string[] = [];
  const missedLines: string[]  = [];

  for (const s of stops) {
    const name = s.station_name || s.tiploc || s.stanox || '?';
    if (s.visited) {
      const delay = s.delay_minutes ?? s.predicted_delay_minutes;
      const ds = delay != null ? `${delay > 0 ? '+' : ''}${delay}min` : '';
      visitedLines.push(
        `  VISITED  ${name.padEnd(35)} sched=${s.scheduled_time ?? '?'}  actual=${s.actual_time ?? '?'}  ${ds}`,
      );
    } else {
      const method = s.prediction_method ?? '';
      const delay  = s.predicted_delay_minutes;
      const ds     = delay != null ? `${delay > 0 ? '+' : ''}${Math.round(delay)}min` : '?';
      missedLines.push(
        `  MISSED   ${name.padEnd(35)} sched=${s.scheduled_time ?? '?'}  predicted=${s.predicted_time ?? '?'} (${ds}) [${method}]`,
      );
    }
  }

  let stopDetail = [...visitedLines, ...missedLines].join('\n') || '  (no stop data)';
  if (stopDetail.length > MAX_STOP_CHARS) {
    stopDetail = stopDetail.slice(0, MAX_STOP_CHARS) + '\n  ... (truncated)';
  }

  const focus = missed > 0
    ? 'identify the most likely cause of the missed stops and any running delays'
    : 'identify the most likely cause of the running delays, as all stops were reported';

  return `You are a UK rail operations analyst. Analyse the following train journey report and ${focus}.

Journey summary:
  Train ID        : ${trainId}
  Train UID       : ${trainUid ?? 'unknown'}
  Date            : ${schedDate ?? 'unknown'}
  Severity        : ${severity ?? 'UNKNOWN'}
  Scheduled stops : ${total}
  Visited stops   : ${found}
  Missed stops    : ${missed}

Stop detail (VISITED = reporting point received, MISSED = no report received):
${stopDetail}

Instructions:
1. Identify the most likely cause based on the pattern of delays and/or missed reporting points.
2. Assign one category: INFRASTRUCTURE, TIMETABLING, OPERATIONAL, EXTERNAL, ROLLING_STOCK, or UNKNOWN.
3. Give a confidence score between 0.0 and 1.0.
4. Be concise. Base your answer only on the data above.
5. Use your knowledge of the railways to concluede was this a network rail issue or a Train company issue
6. Output ONLY the JSON object below — no commentary, no markdown, no code fences.

{"cause":"<one sentence cause statement>","category":"<CATEGORY>","confidence":<0.0-1.0>,"detail":"<2-3 sentence explanation>"}`;
}

// ---------------------------------------------------------------------------
// watsonx REST call — avoids importing the heavy ibm-watsonx-ai SDK
// ---------------------------------------------------------------------------

async function callWatsonx(prompt: string, modelId: string): Promise<string> {
  // 1. Get IAM token
  const iamRes = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${WATSONX_API_KEY}`,
  });
  if (!iamRes.ok) {
    const t = await iamRes.text();
    throw new Error(`IAM token error ${iamRes.status}: ${t.slice(0, 200)}`);
  }
  const { access_token } = await iamRes.json() as { access_token: string };

  // 2. Call watsonx generate
  const base = WATSONX_URL.replace(/\/$/, '');
  const genRes = await fetch(`${base}/ml/v1/text/generation?version=2023-05-29`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({
      model_id:   modelId,
      project_id: WATSONX_PROJECT_ID,
      input:      prompt,
      parameters: {
        max_new_tokens: 400,
        temperature:    0.2,
        top_p:          0.85,
      },
    }),
  });
  if (!genRes.ok) {
    const t = await genRes.text();
    throw new Error(`watsonx generate error ${genRes.status}: ${t.slice(0, 300)}`);
  }
  const genData = await genRes.json() as {
    results?: Array<{ generated_text?: string }>;
  };
  return genData.results?.[0]?.generated_text?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Parse / extract JSON from model output
// ---------------------------------------------------------------------------

function extractJson(text: string): string {
  if (text.includes('```')) {
    for (const part of text.split('```')) {
      const s = part.replace(/^json\s*/i, '').trim();
      if (s.startsWith('{')) return s;
    }
  }
  if (text.includes('{')) {
    const start = text.indexOf('{');
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ trainId: string }> },
) {
  if (!WATSONX_API_KEY || !WATSONX_PROJECT_ID) {
    return NextResponse.json(
      { error: 'watsonx credentials not configured on the server. Add WATSONX_API_KEY and WATSONX_PROJECT_ID to the frontend deployment.' },
      { status: 503 },
    );
  }

  const { trainId } = await params;
  const body = await request.json().catch(() => ({})) as { model_id?: string };
  const modelId = body.model_id ?? DEFAULT_MODEL;

  // Load stop data from DB
  const dbResult = await pool.query(
    `SELECT
       js.station_name, js.tiploc, js.stanox,
       js.scheduled_time, js.actual_time, js.predicted_time,
       js.predicted_delay_minutes, js.prediction_method,
       js.visited,
       js.train_uid, js.schedule_start_date,
       js.severity, js.total_scheduled_stops,
       js.found_stops_count, js.missed_stops_count
     FROM journey_stations js
     WHERE js.train_id = $1
     ORDER BY js.station_index ASC`,
    [trainId],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

  let rows = dbResult.rows as StopRow[];
  let meta: { train_uid?: string | null; schedule_start_date?: string | null; severity?: string | null; total?: number; found?: number; missed?: number } = {};

  if (rows.length === 0) {
    // Fallback to predicted_gaps
    const pg = await pool.query(
      `SELECT station_name, tiploc, stanox, scheduled_time, NULL AS actual_time,
              predicted_time, predicted_delay_minutes, prediction_method,
              false AS visited, train_uid, schedule_start_date,
              severity, total_scheduled_stops, found_stops_count, missed_stops_count
       FROM predicted_gaps WHERE train_id = $1 ORDER BY station_index ASC`,
      [trainId],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    rows = pg.rows as StopRow[];
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Train not found' }, { status: 404 });
  }

  const first = rows[0] as unknown as Record<string, unknown>;
  meta = {
    train_uid:           first.train_uid           as string | null,
    schedule_start_date: first.schedule_start_date as string | null,
    severity:            first.severity            as string | null,
    total:               Number(first.total_scheduled_stops ?? rows.length),
    found:               Number(first.found_stops_count     ?? rows.filter(r => r.visited).length),
    missed:              Number(first.missed_stops_count    ?? rows.filter(r => !r.visited).length),
  };

  const prompt = buildPrompt(
    trainId,
    meta.train_uid ?? null,
    meta.schedule_start_date ?? null,
    meta.severity ?? null,
    meta.total ?? 0,
    meta.found ?? 0,
    meta.missed ?? 0,
    rows,
  );

  let rawText = '';
  try {
    rawText = await callWatsonx(prompt, modelId);

    if (!rawText) {
      // Retry with a shorter prompt (first 5 visited + all missed only)
      const shorterRows = [
        ...rows.filter(r => r.visited).slice(0, 5),
        ...rows.filter(r => !r.visited),
      ];
      const shortPrompt = buildPrompt(
        trainId, meta.train_uid ?? null, meta.schedule_start_date ?? null,
        meta.severity ?? null, meta.total ?? 0, meta.found ?? 0, meta.missed ?? 0,
        shorterRows,
      );
      rawText = await callWatsonx(shortPrompt, modelId);
    }

    if (!rawText) {
      throw new Error('Model returned an empty response');
    }

    const json    = extractJson(rawText);
    const parsed  = JSON.parse(json) as Record<string, unknown>;
    const category = String(parsed.category ?? 'UNKNOWN').toUpperCase();

    return NextResponse.json({
      cause:        String(parsed.cause ?? '').trim(),
      category:     VALID_CATEGORIES.has(category) ? category : 'UNKNOWN',
      confidence:   Number(parsed.confidence ?? 0.5),
      detail:       String(parsed.detail ?? '').trim(),
      model_id:     modelId,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[analyse] trainId=${trainId} model=${modelId} error:`, msg);
    return NextResponse.json(
      { error: msg, raw: rawText.slice(0, 300) || undefined },
      { status: 502 },
    );
  }
}

// Expose available models list for the UI model selector
export async function GET() {
  return NextResponse.json({ models: AVAILABLE_MODELS, default: DEFAULT_MODEL });
}
