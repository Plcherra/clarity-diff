export interface ChangedFile {
  /** Workspace-relative path of the changed file. */
  path: string;
  /** High-level change kind for display and prompting. */
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  /** First changed line (1-based) if known, for jump-to-line. */
  firstChangedLine?: number;
}

export interface CollectedDiff {
  /** Unified diff text (already redacted and possibly truncated). */
  diffText: string;
  /** Files touched by this diff. */
  files: ChangedFile[];
  /** Stable fingerprint of the raw diff, used for de-duping analysis runs. */
  fingerprint: string;
  /** Whether the diff was truncated to fit the size budget. */
  truncated: boolean;
  /** True when redaction masked one or more potential secrets. */
  redacted: boolean;
}

export type FlagStatus = "green" | "red" | "unknown";
export type RiskLevel = "low" | "medium" | "high";

export interface IntentMatch {
  status: FlagStatus;
  reason: string;
}

export interface SafetyAssessment {
  risk: RiskLevel;
  reasons: string[];
}

/** Structured explanation returned by the model and rendered in the panel. */
export interface Explanation {
  summary: string;
  intentMatch: IntentMatch;
  structureFit: string;
  safety: SafetyAssessment;
  nextSteps: string[];
}

/** Everything the panel needs to render a completed analysis. */
export interface AnalysisResult {
  explanation: Explanation;
  files: ChangedFile[];
  truncated: boolean;
  redacted: boolean;
}
