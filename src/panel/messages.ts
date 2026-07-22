import { AnalysisResult } from "../types";

/**
 * The only shared surface between the extension host and the webview. Both sides
 * import these types so postMessage payloads stay in sync.
 */

export type PanelView =
  | { kind: "onboarding" }
  | { kind: "consent" }
  | { kind: "noRepo" }
  | { kind: "idle"; autoDetect: boolean; lastIntent: string }
  | { kind: "analyzing" }
  | { kind: "result"; result: AnalysisResult; autoDetect: boolean; lastIntent: string }
  | { kind: "error"; message: string; autoDetect: boolean; lastIntent: string };

/** Messages sent from the host to the webview. */
export type HostToWebview = { type: "view"; view: PanelView };

/** Messages sent from the webview to the host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "saveApiKey"; key: string }
  | { type: "giveConsent" }
  | { type: "rerun" }
  | { type: "setIntent"; intent: string }
  | { type: "toggleAutoDetect" }
  | { type: "openFile"; path: string; line?: number };
