"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppHeader from "@/components/Header";
import {
  Loading,
  InlineNotification,
  Link,
  Button,
  Breadcrumb,
  BreadcrumbItem,
  Tag,
  Select,
  SelectItem,
  InlineLoading,
} from "@carbon/react";
import { ArrowLeft, Launch, CheckmarkFilled, WarningFilled, Time, Ai } from "@carbon/icons-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row shape from predicted_gaps (new pipeline) */
interface PredictedGapStop {
  id:                      string;
  train_id:                string;
  train_uid:               string;
  schedule_start_date:     string;
  severity:                string;
  total_scheduled_stops:   number;
  found_stops_count:       number;
  missed_stops_count:      number;
  station_index:           number;
  station_name:            string | null;
  crs:                     string | null;
  tiploc:                  string | null;
  stanox:                  string | null;
  scheduled_time:          string | null;
  scheduled_arrival:       string | null;
  scheduled_departure:     string | null;
  actual_time:             string | null;
  actual_arrival:          string | null;
  actual_departure:        string | null;
  event?:                  string | null;
  predicted_arrival:       string | null;
  predicted_departure:     string | null;
  predicted_time:          string | null;
  predicted_time_ms:       number | null;
  predicted_delay_minutes: number | null;
  prediction_confidence:   number | null;
  prediction_method:       string | null;
  prediction_basis:        string | null;
  approval_status:         string;
  approved_time?:          string | null;
  visited?:                boolean;
  /** Number of calendar days after schedule_start_date this stop occurs on (0 = same day, 1 = next day). */
  day_offset?:             number;
}

/** Row shape from gap_detection_results (legacy) */
interface LegacyGapStop {
  msg_type:              string;
  train_id:              string;
  train_uid:             string;
  actual_ts:             string | null;
  loc_stanox:            string;
  loc_tiploc_code:       string | null;
  position_in_schedule:  number;
  total_stops:           number;
  prev_stanox:           string | null;
  expected_prev_stanox:  string | null;
  prev_tiploc_code:      string | null;
  expected_tiploc_code:  string | null;
  is_gap:                boolean;
}

interface TrainDetailsResponse {
  trainId:               string;
  source:                "journey_stations" | "predicted_gaps" | "gap_detection_results";
  train_uid?:            string;
  schedule_start_date?:  string;
  severity?:             string;
  total_scheduled_stops?: number;
  found_stops_count?:    number;
  missed_stops_count?:   number;
  records:               PredictedGapStop[] | LegacyGapStop[];
  totalRecords:          number;
}

// ---------------------------------------------------------------------------
// Analysis types
// ---------------------------------------------------------------------------

interface AnalysisResult {
  cause:        string;
  category:     string;
  confidence:   number;
  detail:       string;
  model_id:     string;
  generated_at: string;
}

interface ModelOption {
  id:    string;
  label: string;
}

const CATEGORY_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  INFRASTRUCTURE: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  TIMETABLING:    { bg: "#faf5ff", color: "#7e22ce", border: "#e9d5ff" },
  OPERATIONAL:    { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  EXTERNAL:       { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  ROLLING_STOCK:  { bg: "#fef9c3", color: "#854d0e", border: "#fef08a" },
  UNKNOWN:        { bg: "#f9fafb", color: "#374151", border: "#e5e7eb" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METHOD_LABEL: Record<string, string> = {
  ON_TIME_INTERPOLATION:        "On-time",
  LINEAR_INTERPOLATION:         "Linear",
  SINGLE_STATION_EXTRAPOLATION: "Extrapolated",
  SCHEDULE_ONLY:                "Schedule",
  INSUFFICIENT_DATA:            "No data",
};

const METHOD_TAG: Record<string, "green" | "teal" | "blue" | "gray" | "warm-gray"> = {
  ON_TIME_INTERPOLATION:        "green",
  LINEAR_INTERPOLATION:         "teal",
  SINGLE_STATION_EXTRAPOLATION: "blue",
  SCHEDULE_ONLY:                "gray",
  INSUFFICIENT_DATA:            "warm-gray",
};

const SEV_COLORS: Record<string, { bg: string; color: string }> = {
  HIGH:   { bg: "#fee2e2", color: "#991b1b" },
  MEDIUM: { bg: "#fef3c7", color: "#92400e" },
  LOW:    { bg: "#dcfce7", color: "#166534" },
  NONE:   { bg: "#f3f4f6", color: "#374151" },
};

function delayLabel(min: number | null | undefined): string | null {
  if (min == null) return null;
  if (min === 0)   return "on time";
  return `${min > 0 ? "+" : ""}${min} min`;
}

/** Small muted badge shown next to a time that falls on the next calendar day. */
function NextDayBadge() {
  return (
    <span style={{
      display: "inline-block",
      marginLeft: "0.25rem",
      padding: "0.05rem 0.3rem",
      fontSize: "0.6rem",
      fontWeight: 700,
      letterSpacing: "0.04em",
      background: "#ede9fe",
      color: "#6d28d9",
      border: "1px solid #c4b5fd",
      borderRadius: "3px",
      verticalAlign: "middle",
      lineHeight: 1.4,
    }}>
      +1d
    </span>
  );
}

function confidencePct(c: number | null | undefined): string {
  if (c == null) return "";
  return `${Math.round(c * 100)}%`;
}

function getRealtimeTrainsUrl(trainUid: string | undefined, dateStr: string | undefined): string | null {
  if (!trainUid || !dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
    return `https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${dateStr}/detailed`;
  // Try parsing epoch
  const ts = Number(dateStr);
  if (!isNaN(ts)) {
    const d = new Date(ts);
    if (!isNaN(d.getTime()))
      return `https://www.realtimetrains.co.uk/service/gb-nr:${trainUid}/${d.toISOString().slice(0, 10)}/detailed`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Delay-cause analysis panel rendered below the stat row */
function DelayAnalysisPanel({ result, onClear }: { result: AnalysisResult; onClear: () => void }) {
  const style = CATEGORY_STYLE[result.category] ?? CATEGORY_STYLE.UNKNOWN;
  const pct   = Math.round(result.confidence * 100);
  return (
    <div style={{
      border: `1px solid ${style.border}`,
      background: style.bg,
      borderRadius: "8px",
      padding: "1.25rem 1.5rem",
      marginBottom: "1.5rem",
      position: "relative",
    }}>
      <button
        onClick={onClear}
        aria-label="dismiss"
        style={{
          position: "absolute", top: "0.75rem", right: "0.75rem",
          background: "none", border: "none", cursor: "pointer",
          color: "#9ca3af", fontSize: "1rem", lineHeight: 1,
        }}
      >✕</button>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <Ai size={20} style={{ color: style.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: style.color }}>
          {result.cause || "Analysis complete"}
        </span>
        <span style={{
          padding: "0.15rem 0.6rem", borderRadius: "9999px",
          background: style.color, color: "#fff",
          fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em",
        }}>
          {result.category}
        </span>
      </div>

      {/* Confidence bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.72rem", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>
          Confidence {pct}%
        </span>
        <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: style.color, borderRadius: 3, transition: "width 0.4s ease" }} />
        </div>
      </div>

      {result.detail && (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "#374151", lineHeight: 1.6 }}>
          {result.detail}
        </p>
      )}

      <div style={{ marginTop: "0.75rem", fontSize: "0.7rem", color: "#9ca3af" }}>
        Model: <code style={{ background: "#e5e7eb", padding: "1px 4px", borderRadius: 2 }}>{result.model_id}</code>
        &nbsp;· Generated {new Date(result.generated_at).toLocaleTimeString("en-GB")}
      </div>
    </div>
  );
}

/** Analyse button + model picker */
function AnalyseButton({
  trainId,
  models,
  defaultModel,
  onResult,
}: {
  trainId:      string;
  models:       ModelOption[];
  defaultModel: string;
  onResult:     (r: AnalysisResult) => void;
}) {
  const [modelId,   setModelId]   = useState(defaultModel);
  const [loading,   setLoading]   = useState(false);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const res = await fetch(`/api/trains/${trainId}/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onResult(data as AnalysisResult);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 220 }}>
        <Select
          id="model-select"
          labelText="watsonx model"
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          size="sm"
          disabled={loading}
        >
          {models.map(m => (
            <SelectItem key={m.id} value={m.id} text={m.label} />
          ))}
        </Select>
      </div>

      {loading ? (
        <InlineLoading description="Analysing…" style={{ height: 32 }} />
      ) : (
        <Button
          kind="primary"
          size="sm"
          renderIcon={Ai}
          onClick={run}
        >
          Analyse Delay
        </Button>
      )}

      {errMsg && (
        <span style={{ fontSize: "0.8rem", color: "#dc2626", alignSelf: "center" }}>
          ⚠ {errMsg}
        </span>
      )}
    </div>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      <span style={{ fontSize: "0.72rem", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.5rem", fontWeight: 700, color: color ?? "#111827", lineHeight: 1 }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Predicted-gaps table
// ---------------------------------------------------------------------------

// Approval status pill
function ApprovalPill({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const cfg =
    s === "APPROVED" ? { bg: "#dcfce7", color: "#15803d", label: "Approved" } :
    s === "REJECTED" ? { bg: "#fee2e2", color: "#dc2626", label: "Rejected" } :
                       { bg: "#fef9c3", color: "#854d0e", label: "Pending"  };
  return (
    <span style={{
      display: "inline-block",
      padding: "0.15rem 0.5rem",
      borderRadius: "9999px",
      fontSize: "0.68rem",
      fontWeight: 700,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function PredictedGapsTable({
  stops,
  onApprovalChange,
}: {
  stops: PredictedGapStop[];
  onApprovalChange?: () => void;
}) {
  const [showAll,      setShowAll]      = useState(false);
  const [actioning,    setActioning]    = useState<string | null>(null);
  const [actionError,  setActionError]  = useState<string | null>(null);
  // Local approval status override so the row updates instantly without a full reload
  const [localStatus,  setLocalStatus]  = useState<Record<string, string>>({});

  const doApprove = async (s: PredictedGapStop) => {
    setActioning(s.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/predicted-gaps/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setLocalStatus(prev => ({ ...prev, [s.id]: "APPROVED" }));
      onApprovalChange?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActioning(null);
    }
  };

  const doReject = async (s: PredictedGapStop) => {
    setActioning(s.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/predicted-gaps/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setLocalStatus(prev => ({ ...prev, [s.id]: "REJECTED" }));
      onApprovalChange?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActioning(null);
    }
  };

  // Filter: by default show only late (>3 min) or missed stops.
  // A stop is considered visited if visited flag is set OR any actual time exists.
  const visible = showAll
    ? stops
    : stops.filter(s => {
        const visited = s.visited ?? (s.actual_arrival != null || s.actual_departure != null || s.actual_time != null);
        const delay   = s.predicted_delay_minutes ?? 0;
        return !visited || delay > 3;
      });

  const hiddenCount = stops.length - visible.length;

  return (
    <div>
      {/* Filter toggle bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.6rem 1rem",
        background: "#f9fafb",
        borderBottom: "1px solid #e5e7eb",
        fontSize: "0.78rem",
        flexWrap: "wrap",
        gap: "0.5rem",
      }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "#6b7280" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fee2e2", border: "1.5px solid #dc2626", display: "inline-block" }} />
            Missed stop
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "#6b7280" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fffbeb", border: "1.5px solid #f59e0b", display: "inline-block" }} />
            ≥10 min late
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "#6b7280" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fefce8", border: "1.5px solid #fbbf24", display: "inline-block" }} />
            3–9 min late
          </span>
        </div>
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            background: "none", border: "1px solid #d1d5db", borderRadius: 4,
            padding: "0.2rem 0.7rem", cursor: "pointer", fontSize: "0.75rem", color: "#374151",
          }}
        >
          {showAll
            ? `Show issues only (${stops.length - hiddenCount} of ${stops.length})`
            : `Show all ${stops.length} stops`}
        </button>
      </div>

      {actionError && (
        <div style={{ padding: "0.5rem 1rem", background: "#fef2f2", color: "#dc2626", fontSize: "0.78rem" }}>
          ⚠ Approval error: {actionError}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                {["#", "Station", "CRS", "Sched Arr", "Sched Dep", "Act Arr", "Act Dep", "Pred Arr", "Pred Dep", "Delay", "Method", "Approval", ""].map(h => (
                  <th key={h} style={{ padding: "0.6rem 0.75rem", textAlign: "left", fontWeight: 600, fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>
                  No late or missed stops — all on time
                </td>
              </tr>
            ) : visible.map((s, i) => {
              const visited    = s.visited ?? (s.actual_arrival != null || s.actual_departure != null || s.actual_time != null);
              const isMissed   = !visited;
              const delay      = s.predicted_delay_minutes;
              const isLate     = delay != null && delay > 3;
              const isEarly    = delay != null && delay < -1;
              const isSeverely = delay != null && delay >= 10;
              const approvalStatus = localStatus[s.id] ?? s.approval_status ?? "PENDING";
              const isActioning    = actioning === s.id;

              const rowBg = isMissed
                ? "#fff7f7"
                : isSeverely && visited ? "#fffbeb"
                : isLate     && visited ? "#fefce8"
                : i % 2 === 0 ? "#fff" : "#fafafa";

              const leftBorder = isMissed
                ? "3px solid #dc2626"
                : isSeverely && visited ? "3px solid #f59e0b"
                : isLate     && visited ? "3px solid #fbbf24"
                : "3px solid transparent";

              return (
                <tr key={s.id ?? i} style={{ borderBottom: "1px solid #f3f4f6", background: rowBg, borderLeft: leftBorder }}>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#9ca3af", fontFamily: "monospace", textAlign: "right" }}>
                    {s.station_index ?? i + 1}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", minWidth: 160 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      {visited
                        ? <CheckmarkFilled size={14} style={{ color: "#16a34a", flexShrink: 0 }} />
                        : <WarningFilled   size={14} style={{ color: "#dc2626", flexShrink: 0 }} />
                      }
                      <span style={{ fontWeight: 600, color: "#111827" }}>
                        {s.station_name || s.tiploc || s.stanox || "—"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", color: "#374151" }}>
                    {s.crs || "—"}
                  </td>
                  {/* Scheduled Arrival */}
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", color: "#6b7280", whiteSpace: "nowrap" }}>
                    {s.scheduled_arrival || "—"}
                    {s.day_offset ? <NextDayBadge /> : null}
                  </td>
                  {/* Scheduled Departure */}
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", color: "#6b7280", whiteSpace: "nowrap" }}>
                    {s.scheduled_departure || "—"}
                    {s.day_offset && !s.scheduled_arrival ? <NextDayBadge /> : null}
                  </td>
                  {/* Actual Arrival */}
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {visited ? (
                      <span style={{ color: "#111827" }}>
                        {s.actual_arrival || "—"}
                        {s.day_offset ? <NextDayBadge /> : null}
                      </span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  {/* Actual Departure */}
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {visited ? (
                      <span style={{ color: "#111827" }}>
                        {s.actual_departure || "—"}
                        {s.day_offset && s.actual_departure ? <NextDayBadge /> : null}
                      </span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  {/* Predicted Arrival */}
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {!visited && s.predicted_arrival ? (
                      <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "#2563eb" }}>
                        <Time size={12} style={{ flexShrink: 0 }} />
                        {s.predicted_arrival}
                        {s.day_offset ? <NextDayBadge /> : null}
                      </span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  {/* Predicted Departure */}
                  <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {!visited && s.predicted_departure ? (
                      <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "#7c3aed" }}>
                        <Time size={12} style={{ flexShrink: 0 }} />
                        {s.predicted_departure}
                        {s.day_offset ? <NextDayBadge /> : null}
                      </span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                    {delay != null ? (
                      <span style={{
                        fontFamily: "monospace", fontWeight: 600, fontSize: "0.78rem",
                        color: isLate ? "#dc2626" : isEarly ? "#1d4ed8" : "#16a34a",
                      }}>
                        {delayLabel(delay)}
                      </span>
                    ) : <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    {s.prediction_method ? (
                      <Tag type={METHOD_TAG[s.prediction_method] ?? "gray"} size="sm">
                        {METHOD_LABEL[s.prediction_method] ?? s.prediction_method}
                      </Tag>
                    ) : <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  {/* Approval status */}
                  <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      <ApprovalPill status={approvalStatus} />
                      {approvalStatus === "APPROVED" && s.approved_time && (
                        <span style={{ fontSize: "0.68rem", color: "#6b7280" }}>
                          @ {s.approved_time}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* Approve / Reject actions — only shown for missed stops (those with a predicted_gaps row) */}
                  <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                    {isMissed && !isActioning && approvalStatus !== "APPROVED" && (
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button
                          onClick={() => doApprove(s)}
                          style={{
                            padding: "0.2rem 0.55rem", fontSize: "0.7rem", fontWeight: 600,
                            background: "#dcfce7", color: "#15803d",
                            border: "1px solid #86efac", borderRadius: 4, cursor: "pointer",
                          }}
                        >
                          ✓ Approve
                        </button>
                        {approvalStatus !== "REJECTED" && (
                          <button
                            onClick={() => doReject(s)}
                            style={{
                              padding: "0.2rem 0.55rem", fontSize: "0.7rem", fontWeight: 600,
                              background: "#fee2e2", color: "#dc2626",
                              border: "1px solid #fca5a5", borderRadius: 4, cursor: "pointer",
                            }}
                          >
                            ✕ Reject
                          </button>
                        )}
                      </div>
                    )}
                    {isActioning && (
                      <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>Saving…</span>
                    )}
                    {isMissed && approvalStatus === "APPROVED" && !isActioning && (
                      <button
                        onClick={() => doReject(s)}
                        style={{
                          padding: "0.2rem 0.55rem", fontSize: "0.7rem",
                          background: "none", color: "#9ca3af",
                          border: "1px solid #e5e7eb", borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy table (gap_detection_results)
// ---------------------------------------------------------------------------

function LegacyTable({ stops }: { stops: LegacyGapStop[] }) {
  const fmt = (ts: string | null | undefined) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const stanoxTiploc = (stanox: string | null, tiploc: string | null) => {
    if (!stanox) return "—";
    return tiploc ? `${stanox} / ${tiploc}` : stanox;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
            {["Actual Time", "Location", "Position", "Previous", "Expected", "Gap Detected", "Message Type"].map(h => (
              <th key={h} style={{ padding: "0.6rem 0.75rem", textAlign: "left", fontWeight: 600, fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stops.map((s, i) => (
            <tr key={i} style={{
              borderBottom: "1px solid #f3f4f6",
              background: s.is_gap ? "#fff7f7" : i % 2 === 0 ? "#fff" : "#fafafa",
            }}>
              <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{fmt(s.actual_ts)}</td>
              <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{stanoxTiploc(s.loc_stanox, s.loc_tiploc_code)}</td>
              <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{s.position_in_schedule ?? "—"} / {s.total_stops ?? "—"}</td>
              <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{stanoxTiploc(s.prev_stanox ?? null, s.prev_tiploc_code)}</td>
              <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace" }}>{stanoxTiploc(s.expected_prev_stanox ?? null, s.expected_tiploc_code)}</td>
              <td style={{ padding: "0.5rem 0.75rem" }}>
                {s.is_gap
                  ? <strong style={{ color: "#dc2626" }}>Yes</strong>
                  : <span style={{ color: "#16a34a" }}>No</span>
                }
              </td>
              <td style={{ padding: "0.5rem 0.75rem", fontFamily: "monospace", color: "#6b7280" }}>{s.msg_type || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TrainDetailsPage() {
  const params  = useParams();
  const router  = useRouter();
  const trainId = params.trainId as string;

  const [data,           setData]           = useState<TrainDetailsResponse | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [models,         setModels]         = useState<ModelOption[]>([]);
  const [defaultModel,   setDefaultModel]   = useState("meta-llama/llama-3-3-70b-instruct");

  useEffect(() => {
    if (!trainId) return;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/trains/${trainId}`);
        if (!res.ok) throw new Error(res.status === 404 ? "Train not found" : "Failed to fetch train details");
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [trainId]);

  // Load available models from the analyse endpoint
  useEffect(() => {
    fetch(`/api/trains/${trainId}/analyse`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.models) setModels(d.models);
        if (d?.default) setDefaultModel(d.default);
      })
      .catch(() => {});
  }, [trainId]);

  const isPredicted = data?.source === "predicted_gaps" || data?.source === "journey_stations";
  const stops       = data?.records ?? [];
  const first       = stops[0] as PredictedGapStop | undefined;
  const trainUid    = data?.train_uid ?? (first as LegacyGapStop | undefined)?.train_uid;
  const schedDate   = data?.schedule_start_date;
  const rttUrl      = getRealtimeTrainsUrl(trainUid, schedDate);
  const sevStyle    = SEV_COLORS[data?.severity ?? "NONE"] ?? SEV_COLORS.NONE;

  // Extract predicted reason for delay from any missed stop with prediction_basis or prediction_method
  const predictedReason = (() => {
    if (!isPredicted) return null;
    for (const stop of stops as PredictedGapStop[]) {
      if (stop.prediction_basis) {
        try {
          const parsed = typeof stop.prediction_basis === "string" ? JSON.parse(stop.prediction_basis) : stop.prediction_basis;
          if (parsed?.reasoning) return String(parsed.reasoning);
          if (parsed?.reason) return String(parsed.reason);
        } catch {
          // ignore
        }
      }
      if (stop.prediction_method) {
        return METHOD_LABEL[stop.prediction_method] ?? stop.prediction_method;
      }
    }
    return null;
  })();

  return (
    <>
      <AppHeader />
      <main style={{ marginTop: "48px", padding: "2rem", background: "#f9fafb", minHeight: "calc(100vh - 48px)" }}>
        <div style={{ maxWidth: "1300px", margin: "0 auto" }}>

          <Breadcrumb noTrailingSlash style={{ marginBottom: "1rem" }}>
            <BreadcrumbItem href="/delayed-trains">Delayed Trains</BreadcrumbItem>
          </Breadcrumb>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" }}>
            <Button kind="ghost" size="sm" renderIcon={ArrowLeft} onClick={() => router.push("/delayed-trains")}>
              Back
            </Button>
          </div>

          {/* Title */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#111827", margin: "0 0 0.25rem" }}>
                Train {trainId}
              </h1>
              {trainUid && (
                <p style={{ margin: "0 0 0.5rem", color: "#6b7280", fontSize: "0.875rem" }}>
                  UID: <code style={{ background: "#e5e7eb", padding: "1px 5px", borderRadius: 3 }}>{trainUid}</code>
                  {schedDate && <span style={{ marginLeft: "0.75rem" }}>· {schedDate}</span>}
                  {rttUrl && (
                    <a href={rttUrl} target="_blank" rel="noreferrer"
                      style={{ marginLeft: "0.75rem", color: "#2563eb", display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.8rem" }}>
                      Realtime Trains <Launch size={12} />
                    </a>
                  )}
                </p>
              )}
              {predictedReason && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Predicted reason for delay:
                  </span>
                  <Tag type="red" size="md">
                    {predictedReason}
                  </Tag>
                </div>
              )}
            </div>
            {data?.severity && (
              <span style={{ padding: "0.3rem 0.9rem", borderRadius: "9999px", fontWeight: 700, fontSize: "0.85rem", background: sevStyle.bg, color: sevStyle.color }}>
                {data.severity}
              </span>
            )}
          </div>

          {/* Stat row + Analyse button */}
          {isPredicted && data && (
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "1.25rem 1.5rem", marginBottom: "1.5rem", alignItems: "flex-end" }}>
              <StatBadge label="Total stops"  value={data.total_scheduled_stops ?? "—"} />
              <StatBadge label="Visited"      value={data.found_stops_count ?? "—"} color="#16a34a" />
              <StatBadge label="Missed"       value={data.missed_stops_count ?? "—"} color={data.missed_stops_count ? "#dc2626" : undefined} />
              <StatBadge label="Records"      value={data.totalRecords} />
              <StatBadge label="Source"       value={data.source} color="#6b7280" />
              <div style={{ marginLeft: "auto" }}>
                <AnalyseButton
                  trainId={trainId}
                  models={models.length ? models : [{ id: defaultModel, label: defaultModel }]}
                  defaultModel={defaultModel}
                  onResult={r => { setAnalysisResult(r); }}
                />
              </div>
            </div>
          )}

          {/* Analysis result panel */}
          {analysisResult && (
            <DelayAnalysisPanel
              result={analysisResult}
              onClear={() => setAnalysisResult(null)}
            />
          )}

          {loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
              <Loading description="Loading train details…" withOverlay={false} />
            </div>
          )}

          {error && <InlineNotification kind="error" title="Error" subtitle={error} style={{ marginBottom: "1rem" }} />}

          {data && !loading && (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e5e7eb" }}>
                <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#111827" }}>
                  Train Journey Records
                </h2>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
                  {isPredicted
                    ? "All scheduled stops with visited / predicted status, ordered by schedule position"
                    : "All recorded movement events, ordered chronologically"
                  }
                  &nbsp;· {data.totalRecords} record{data.totalRecords !== 1 ? "s" : ""}
                </p>
              </div>

              {isPredicted
                ? <PredictedGapsTable
                    stops={stops as PredictedGapStop[]}
                    onApprovalChange={() => {
                      // Reload train data so summary counts and approval_status stay in sync
                      fetch(`/api/trains/${trainId}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(d => { if (d) setData(d); })
                        .catch(() => {});
                    }}
                  />
                : <LegacyTable stops={stops as LegacyGapStop[]} />
              }
            </div>
          )}
        </div>
      </main>
    </>
  );
}
