import * as vscode from "vscode";

const SECTION = "clarityDiff";

export interface ClarityDiffSettings {
  autoDetect: boolean;
  debounceMs: number;
  model: string;
  maxDiffBytes: number;
}

export function getSettings(): ClarityDiffSettings {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    autoDetect: cfg.get<boolean>("autoDetect", true),
    debounceMs: cfg.get<number>("debounceMs", 1500),
    model: cfg.get<string>("model", "grok-4.5"),
    maxDiffBytes: cfg.get<number>("maxDiffBytes", 60000),
  };
}

export async function setAutoDetect(value: boolean): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update("autoDetect", value, vscode.ConfigurationTarget.Global);
}

/** Fires when any clarityDiff.* setting changes. */
export function onSettingsChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      listener();
    }
  });
}
