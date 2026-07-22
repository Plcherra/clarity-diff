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

/** A plain-language definition of a technical or project-specific term. */
export interface GlossaryTerm {
  term: string;
  definition: string;
}

/** Structured explanation returned by the model and rendered in the panel. */
export interface Explanation {
  summary: string;
  intentMatch: IntentMatch;
  structureFit: string;
  safety: SafetyAssessment;
  nextSteps: string[];
  glossary: GlossaryTerm[];
}

/** How much surrounding code context to gather for an analysis. */
export type ContextLevel = "diffOnly" | "changedFiles" | "neighbors" | "repo" | "retrieval";

/** A single file (or excerpt) included as context for the model. */
export interface ContextFile {
  /** Workspace-relative path. */
  path: string;
  /** Redacted, possibly truncated content. */
  content: string;
  truncated: boolean;
  reason: "changed" | "neighbor" | "manifest" | "retrieved";
}

/** A best-effort overview of the project's shape. */
export interface ProjectMap {
  /** Indented file tree (gitignore-respecting). */
  tree: string;
  /** Key manifest files (package.json, README, tsconfig, etc.). */
  manifests: ContextFile[];
}

/** Surrounding code context gathered alongside the diff. */
export interface CodeContext {
  files: ContextFile[];
  projectMap?: ProjectMap;
  totalBytes: number;
  /** The context byte budget was hit. */
  truncated: boolean;
  /** Redaction masked one or more potential secrets in the context. */
  redacted: boolean;
  /** Which context level actually ran. */
  level: ContextLevel;
}

/** Everything the panel needs to render a completed analysis. */
export interface AnalysisResult {
  explanation: Explanation;
  files: ChangedFile[];
  truncated: boolean;
  redacted: boolean;
  /** Short note describing the code context that was sent (e.g. "Context: 3 files + project map"). */
  contextNote?: string;
}
