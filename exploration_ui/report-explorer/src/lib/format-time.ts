/**
 * formatTime — normalise the many time string formats produced by the
 * ksqlDB/Confluent pipeline and movement tables into a clean HH:MM display.
 *
 * Formats handled:
 *   "HH:MM:SS"          — plain time string from ksqlDB VARCHAR (most common)
 *   "HH:MM:SS.sss"      — with milliseconds
 *   "HH:MM"             — already clean
 *   ISO 8601 datetime   — e.g. "2024-01-15T14:32:00Z" or with offset
 *   Unix epoch ms       — numeric string or number (predicted_time_ms)
 *   null / undefined    — returns null
 *
 * Always returns 24-hour format (hourCycle: 'h23') regardless of the Node.js
 * ICU build or locale defaults on the host OS.
 */
export function formatTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;

  const str = String(value).trim();

  // ── Numeric epoch ms ───────────────────────────────────────────────────────
  if (/^\d{10,}$/.test(str)) {
    const ms = Number(str);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  // ── HH:MM or HH:MM:SS or HH:MM:SS.sss ────────────────────────────────────
  const hms = str.match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (hms) {
    return `${hms[1]}:${hms[2]}`;
  }

  // ── ISO 8601 / full datetime string ───────────────────────────────────────
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  // Unrecognised — return as-is so nothing silently disappears
  return str;
}

/**
 * formatDateTime — like formatTime but returns "DD Mon HH:MM" for values
 * that include a date component. Falls back to formatTime for pure time strings.
 * Always 24-hour format.
 */
export function formatDateTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;

  const str = String(value).trim();

  // Pure time string — delegate
  if (/^\d{2}:\d{2}/.test(str)) return formatTime(str);

  // Numeric epoch
  if (/^\d{10,}$/.test(str)) {
    const ms = Number(str);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return d.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }

  return str;
}
