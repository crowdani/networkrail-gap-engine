"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/Header";
import {
  Tile,
  Button,
  Modal,
  Loading,
  InlineNotification,
  ProgressIndicator,
  ProgressStep,
} from "@carbon/react";
import { Download, Checkmark, Error as ErrorIcon, TrashCan } from "@carbon/icons-react";
import { useRefresh } from "@/contexts/RefreshContext";

interface StepStatus {
  status: "not-started" | "in-progress" | "complete" | "error";
  message?: string;
  details?: string;
}

interface ScheduleMetadata {
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: string | null;
  last_message: string | null;
  updated_at: string | null;
}

export default function SettingsPage() {
  const { startRefresh, updateStep, completeRefresh } = useRefresh();
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Journey export state ───────────────────────────────────────────────────
  const [exportApproval, setExportApproval] = useState<'all' | 'PENDING' | 'APPROVED' | 'REJECTED'>('all');
  const [exportDays, setExportDays] = useState<number>(7);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{ journey_count: number; exported_at: string } | null>(null);

  const handleExportJourneys = async () => {
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      const params = new URLSearchParams({ approval: exportApproval, days: String(exportDays) });
      const res = await fetch(`/api/export/journeys?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
        throw new globalThis.Error(String(d['error'] ?? `HTTP ${res.status}`));
      }
      const data = await res.json();
      // Trigger browser download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `journeys-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportResult({ journey_count: data.journey_count, exported_at: data.exported_at });
    } catch (e: unknown) {
      setExportError(e instanceof globalThis.Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<StepStatus[]>([
    { status: "not-started" },
    { status: "not-started" },
    { status: "not-started" },
  ]);
  const [consoleOutput, setConsoleOutput] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [scheduleMetadata, setScheduleMetadata] =
    useState<ScheduleMetadata | null>(null);
  const [externalVerificationEnabled, setExternalVerificationEnabled] = useState<boolean>(false);

  const stepLabels = [
    "Download Schedule Data",
    "Decompress Data",
    "Load into Database",
  ];

  const formatScheduleTime = (value: string | null) => {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const loadScheduleMetadata = async () => {
    try {
      const response = await fetch("/api/refresh-schedules");
      const data = await response.json();
      setScheduleMetadata(data.metadata || null);
    } catch (error) {
      console.error("Failed to load schedule metadata:", error);
    }
  };

  const loadFeatureFlags = async () => {
    try {
      const response = await fetch("/api/feature-flags");
      const data = await response.json();
      if (data.success) {
        setExternalVerificationEnabled(data.flags.externalVerificationEnabled);
      }
    } catch (error) {
      console.error("Failed to load feature flags:", error);
    }
  };

  useEffect(() => {
    loadScheduleMetadata();
    loadFeatureFlags();
  }, []);

  const parseOutput = (output: string) => {
    const lines = output.split("\n");
    let newSteps = [...steps];
    let newCurrentStep = currentStep;
    let newConsole = consoleOutput;

    lines.forEach((line) => {
      // Add to console
      if (!line.startsWith("STEP:") && !line.startsWith("PROGRESS:")) {
        newConsole += line + "\n";
      }

      // Parse step markers
      if (line.startsWith("STEP:1:STARTED")) {
        newCurrentStep = 0;
        newSteps[0] = { status: "in-progress", message: "Downloading..." };
        updateStep(0);
      } else if (line.startsWith("STEP:1:PROGRESS:")) {
        const msg = line.replace("STEP:1:PROGRESS:", "");
        newSteps[0] = { status: "in-progress", message: msg };
      } else if (line.startsWith("STEP:1:COMPLETE:")) {
        const details = line.replace("STEP:1:COMPLETE:", "");
        newSteps[0] = {
          status: "complete",
          message: "Download complete",
          details,
        };
      } else if (line.startsWith("STEP:1:FAILED")) {
        newSteps[0] = { status: "error", message: "Download failed" };
      } else if (line.startsWith("STEP:2:STARTED")) {
        newCurrentStep = 1;
        newSteps[1] = { status: "in-progress", message: "Decompressing..." };
        updateStep(1);
      } else if (line.startsWith("STEP:2:PROGRESS:")) {
        const msg = line.replace("STEP:2:PROGRESS:", "");
        newSteps[1] = { status: "in-progress", message: msg };
      } else if (line.startsWith("STEP:2:COMPLETE:")) {
        const details = line.replace("STEP:2:COMPLETE:", "");
        newSteps[1] = {
          status: "complete",
          message: "Decompression complete",
          details,
        };
      } else if (line.startsWith("STEP:2:FAILED")) {
        newSteps[1] = { status: "error", message: "Decompression failed" };
      } else if (line.startsWith("STEP:3:STARTED")) {
        newCurrentStep = 2;
        newSteps[2] = {
          status: "in-progress",
          message: "Loading schedules...",
        };
        updateStep(2);
      } else if (line.startsWith("STEP:3:PROGRESS:")) {
        const msg = line.replace("STEP:3:PROGRESS:", "");
        newSteps[2] = { status: "in-progress", message: msg };
      } else if (line.startsWith("STEP:3:COMPLETE")) {
        newSteps[2] = { status: "complete", message: "Database load complete" };
      } else if (line.startsWith("STEP:3:FAILED")) {
        newSteps[2] = { status: "error", message: "Database load failed" };
      } else if (line.startsWith("PROGRESS:")) {
        const progress = line.replace("PROGRESS:", "");
        if (newSteps[newCurrentStep]) {
          newSteps[newCurrentStep] = {
            ...newSteps[newCurrentStep],
            details: progress,
          };
        }
      }
    });

    setSteps(newSteps);
    setCurrentStep(newCurrentStep);
    setConsoleOutput(newConsole);
  };

  const handleRefreshSchedules = async () => {
    setRefreshing(true);
    startRefresh();
    setConsoleOutput("Starting schedule refresh...\n\n");
    setRefreshError(null);
    setCurrentStep(0);
    setSteps([
      { status: "not-started" },
      { status: "not-started" },
      { status: "not-started" },
    ]);

    try {
      const response = await fetch("/api/refresh-schedules", {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        parseOutput(data.output || "");
        const infoMsg = data.message || "Schedule refresh completed successfully!";
        const details = data.info?.note ? `\n${data.info.note}` : "";
        const countMsg = data.currentSchedules?.count !== undefined
          ? `\nSchedules in DB: ${data.currentSchedules.count} (${data.currentSchedules.dataAge || "unknown age"})`
          : "";
        setConsoleOutput(
          (prev) => prev + `\n\n${infoMsg}${details}${countMsg}\n`,
        );
        await loadScheduleMetadata();
        completeRefresh();
      } else {
        setRefreshError(data.error);
        parseOutput(data.output || "");
        setConsoleOutput((prev) => prev + "\n\nERROR: " + data.error + "\n");
        completeRefresh();
      }
    } catch (err: any) {
      setRefreshError(err?.message || "Unknown error");
      setConsoleOutput(
        (prev) => prev + "\n\nERROR: " + (err?.message || "Unknown error"),
      );
      completeRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleResetData = async () => {
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch("/api/admin/reset-data", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setResetResult({ ok: true, msg: "Pipeline data cleared. New data will flow in from Confluent." });
      } else {
        setResetResult({ ok: false, msg: data.error || "Reset failed" });
      }
    } catch (err: any) {
      setResetResult({ ok: false, msg: err?.message || "Unknown error" });
    } finally {
      setResetting(false);
    }
  };

  const resetModal = () => {
    setRefreshModalOpen(false);
    setRefreshError(null);
    setCurrentStep(0);
    setSteps([
      { status: "not-started" },
      { status: "not-started" },
      { status: "not-started" },
    ]);
    setConsoleOutput("");
  };

  return (
    <>
      <style jsx global>{`
        .settings-container {
          max-width: 1200px;
          margin: 0 auto;
        }

        .settings-header {
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #e0e0e0;
        }

        .settings-section {
          margin-bottom: 2rem;
        }

        .settings-section-title {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 1rem;
          color: #161616;
        }

        .settings-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem;
        }

        .settings-item-info {
          flex: 1;
          margin-right: 2rem;
        }

        .settings-item-title {
          font-size: 0.875rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #161616;
        }

        .settings-item-description {
          font-size: 0.875rem;
          color: #525252;
          line-height: 1.5;
        }

        .progress-section {
          margin: 2rem 0;
        }

        .step-details {
          margin-top: 1rem;
          padding: 1rem;
          background: #f4f4f4;
          border-radius: 4px;
          font-size: 0.875rem;
          color: #161616;
        }

        .step-message {
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .step-info {
          color: #525252;
          font-size: 0.8125rem;
        }

        .output-console {
          background: #262626;
          color: #f4f4f4;
          padding: 1rem;
          border-radius: 4px;
          font-family:
            "IBM Plex Mono", "Menlo", "Monaco", "Courier New", monospace;
          font-size: 0.75rem;
          max-height: 300px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.6;
          margin-top: 1rem;
        }

        .output-console::-webkit-scrollbar {
          width: 8px;
        }

        .output-console::-webkit-scrollbar-track {
          background: #393939;
        }

        .output-console::-webkit-scrollbar-thumb {
          background: #525252;
          border-radius: 4px;
        }

        .output-console::-webkit-scrollbar-thumb:hover {
          background: #6f6f6f;
        }
      `}</style>

      <AppHeader />
      <main style={{ marginTop: "48px", padding: "2rem" }}>
        <div className="settings-container">
          <div className="settings-header">
            <h1
              style={{
                marginBottom: "0.5rem",
                fontSize: "2rem",
                fontWeight: 400,
              }}
            >
              Settings
            </h1>
            <p style={{ color: "#525252", fontSize: "0.875rem" }}>
              System configuration and maintenance
            </p>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Schedule Management</h2>

            <Tile>
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-title">
                    Update Train Schedules
                  </div>
                  <div className="settings-item-description">
                    Download the latest train schedule data from Network Rail
                    and update the database. This process downloads fresh
                    timetable data, clears old schedules, and imports new ones.
                    The update typically takes 5-10 minutes to complete.
                  </div>
                  <div
                    style={{
                      marginTop: "0.75rem",
                      fontSize: "0.8125rem",
                      color: "#525252",
                      lineHeight: 1.5,
                    }}
                  >
                    <div>
                      <strong>Last successful update:</strong>{" "}
                      {formatScheduleTime(
                        scheduleMetadata?.last_completed_at ?? null,
                      )}
                    </div>
                    <div>
                      <strong>Last run started:</strong>{" "}
                      {formatScheduleTime(
                        scheduleMetadata?.last_started_at ?? null,
                      )}
                    </div>
                    <div>
                      <strong>Status:</strong>{" "}
                      {scheduleMetadata?.last_status || "Unknown"}
                    </div>
                  </div>
                </div>
                <Button
                  kind="primary"
                  renderIcon={Download}
                  onClick={() => setRefreshModalOpen(true)}
                >
                  Update Schedules
                </Button>
              </div>
            </Tile>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Automation</h2>

            <Tile>
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-title">
                    Automatic Schedule Refresh
                  </div>
                  <div className="settings-item-description">
                    Configure a server-side cron job to run the schedule refresh
                    at 1am daily. Recommended cron entry:
                    <code
                      style={{
                        display: "block",
                        marginTop: "0.5rem",
                        padding: "0.5rem",
                        background: "#f4f4f4",
                        color: "#161616",
                      }}
                    >
                      0 1 * * * cd /Users/solly/Desktop/Client\
                      Projects/2026/Network\
                      Rail/NetworkRailGapDetection/timetable &&
                      ./refresh_schedules.sh
                    </code>
                  </div>
                </div>
              </div>
            </Tile>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Feature Configuration</h2>

            <Tile>
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-title">
                    External Verification Links
                  </div>
                  <div className="settings-item-description">
                    External verification links for journey validation.
                    <strong style={{ display: 'block', marginTop: '0.5rem', color: externalVerificationEnabled ? '#24a148' : '#da1e28' }}>
                      Status: {externalVerificationEnabled ? 'Enabled' : 'Disabled'}
                    </strong>
                    <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f4f4f4', borderRadius: '4px', fontSize: '0.8125rem' }}>
                      <strong>Production Note:</strong> This setting is controlled in the code file{' '}
                      <code style={{ background: '#e0e0e0', padding: '0.125rem 0.25rem', borderRadius: '2px' }}>
                        src/lib/feature-flags.ts
                      </code>
                      <br />
                      Set <code style={{ background: '#e0e0e0', padding: '0.125rem 0.25rem', borderRadius: '2px' }}>
                        ENABLE_EXTERNAL_VERIFICATION_LINKS
                      </code> to <code style={{ background: '#e0e0e0', padding: '0.125rem 0.25rem', borderRadius: '2px' }}>
                        false
                      </code> for production deployment.
                    </div>
                  </div>
                </div>
              </div>
            </Tile>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Data Export</h2>

            <Tile>
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-title">Export Journeys with Predicted Corrections</div>
                  <div className="settings-item-description">
                    Downloads a JSON file containing every journey that has at least one predicted infill correction,
                    including the full stop timeline, scheduled and actual times, predicted times, delay minutes,
                    prediction method, confidence, and approval status.
                  </div>
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#525252', marginBottom: '0.375rem' }}>
                        Approval filter
                      </label>
                      <select
                        value={exportApproval}
                        onChange={e => setExportApproval(e.target.value as typeof exportApproval)}
                        disabled={exporting}
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem', border: '1px solid #8d8d8d', background: '#fff', cursor: 'pointer' }}
                      >
                        <option value="all">All statuses</option>
                        <option value="PENDING">Pending only</option>
                        <option value="APPROVED">Approved only</option>
                        <option value="REJECTED">Rejected only</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#525252', marginBottom: '0.375rem' }}>
                        Look-back window
                      </label>
                      <select
                        value={exportDays}
                        onChange={e => setExportDays(Number(e.target.value))}
                        disabled={exporting}
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.875rem', border: '1px solid #8d8d8d', background: '#fff', cursor: 'pointer' }}
                      >
                        {[1, 3, 7, 14, 30].map(d => (
                          <option key={d} value={d}>{d} day{d !== 1 ? 's' : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {exportError && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#da1e28', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <ErrorIcon size={16} /> {exportError}
                    </div>
                  )}
                  {exportResult && !exporting && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#24a148', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Checkmark size={16} />
                      Downloaded {exportResult.journey_count.toLocaleString()} journey{exportResult.journey_count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
                <Button
                  kind="secondary"
                  renderIcon={exporting ? undefined : Download}
                  onClick={handleExportJourneys}
                  disabled={exporting}
                  style={{ minWidth: 160, whiteSpace: 'nowrap' }}
                >
                  {exporting ? 'Exporting…' : 'Export JSON'}
                </Button>
              </div>
            </Tile>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">Data Management</h2>

            <Tile>
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-title">Reset Pipeline Data</div>
                  <div className="settings-item-description">
                    Truncates the <code style={{ background: "#e0e0e0", padding: "0.125rem 0.25rem", borderRadius: "2px" }}>predicted_gaps</code> and{" "}
                    <code style={{ background: "#e0e0e0", padding: "0.125rem 0.25rem", borderRadius: "2px" }}>journey_stations</code> tables so that only
                    new data flowing through the Confluent pipeline is visible. Use this when you want to start fresh —
                    for example after a schema migration or a bad data load.
                    <strong style={{ display: "block", marginTop: "0.5rem", color: "#da1e28" }}>
                      ⚠ This is irreversible. All existing gap predictions will be deleted.
                    </strong>
                  </div>
                </div>
                <Button
                  kind="danger"
                  renderIcon={TrashCan}
                  onClick={() => { setResetModalOpen(true); setResetResult(null); }}
                >
                  Reset Data
                </Button>
              </div>
            </Tile>
          </div>

          <div className="settings-section">
            <h2 className="settings-section-title">System Information</h2>

            <Tile>
              <div className="settings-item">
                <div className="settings-item-info">
                  <div className="settings-item-title">Database Connection</div>
                  <div className="settings-item-description">
                    IBM database at localhost:5432
                  </div>
                </div>
              </div>
            </Tile>
          </div>
        </div>
      </main>

      <Modal
        open={refreshModalOpen}
        onRequestClose={() => !refreshing && resetModal()}
        modalHeading="Update Train Schedules"
        primaryButtonText={
          refreshing
            ? "Updating..."
            : steps.some((s) => s.status === "complete")
              ? "Done"
              : "Start Update"
        }
        secondaryButtonText="Close"
        onRequestSubmit={() => {
          if (refreshing) return;
          if (steps.some((s) => s.status === "complete")) {
            resetModal();
          } else {
            handleRefreshSchedules();
          }
        }}
        primaryButtonDisabled={refreshing}
        preventCloseOnClickOutside={refreshing}
        size="lg"
      >
        {!refreshing && steps.every((s) => s.status === "not-started") && (
          <p style={{ marginBottom: "1rem" }}>
            This will download the latest train schedule data from Network Rail
            and update the database. The process may take several minutes.
            You'll see real-time progress below.
          </p>
        )}

        {refreshError && (
          <InlineNotification
            kind="error"
            title="Update Failed"
            subtitle={refreshError}
            style={{ marginBottom: "1rem" }}
            lowContrast
          />
        )}

        {(refreshing || steps.some((s) => s.status !== "not-started")) && (
          <div className="progress-section">
            <ProgressIndicator currentIndex={currentStep} spaceEqually>
              {stepLabels.map((label, index) => (
                <ProgressStep
                  key={index}
                  label={label}
                  description={steps[index].message || ""}
                  complete={steps[index].status === "complete"}
                  invalid={steps[index].status === "error"}
                  current={
                    currentStep === index &&
                    steps[index].status === "in-progress"
                  }
                />
              ))}
            </ProgressIndicator>

            {steps[currentStep] && steps[currentStep].details && (
              <div className="step-details">
                <div className="step-message">{steps[currentStep].message}</div>
                <div className="step-info">{steps[currentStep].details}</div>
              </div>
            )}
          </div>
        )}

        {consoleOutput && (
          <div>
            <h4
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
              }}
            >
              Console Output
            </h4>
            <div className="output-console">{consoleOutput}</div>
          </div>
        )}

        {refreshing && (
          <div style={{ marginTop: "1rem" }}>
            <Loading description="Processing..." withOverlay={false} small />
          </div>
        )}
      </Modal>

      {/* ── Reset Data Modal ── */}
      <Modal
        open={resetModalOpen}
        onRequestClose={() => !resetting && setResetModalOpen(false)}
        modalHeading="Reset Pipeline Data"
        primaryButtonText={resetting ? "Resetting…" : resetResult?.ok ? "Done" : "Yes, Delete All Data"}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={resetting}
        danger={!resetResult?.ok}
        preventCloseOnClickOutside={resetting}
        onRequestSubmit={() => {
          if (resetting) return;
          if (resetResult?.ok) { setResetModalOpen(false); setResetResult(null); return; }
          handleResetData();
        }}
        size="sm"
      >
        {!resetting && !resetResult && (
          <p style={{ marginBottom: "1rem", fontSize: "0.875rem", lineHeight: 1.5 }}>
            This will permanently delete all rows from <strong>predicted_gaps</strong> and{" "}
            <strong>journey_stations</strong>. The Confluent JDBC Sink connectors will
            continue running and new data will repopulate the tables automatically.
            <br /><br />
            <strong style={{ color: "#da1e28" }}>This action cannot be undone.</strong>
          </p>
        )}
        {resetting && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem 0" }}>
            <Loading description="Clearing data…" withOverlay={false} small />
            <span style={{ fontSize: "0.875rem", color: "#525252" }}>Truncating tables…</span>
          </div>
        )}
        {resetResult && (
          <InlineNotification
            kind={resetResult.ok ? "success" : "error"}
            title={resetResult.ok ? "Data cleared" : "Reset failed"}
            subtitle={resetResult.msg}
            lowContrast
          />
        )}
      </Modal>
    </>
  );
}
