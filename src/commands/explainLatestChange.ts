import * as vscode from "vscode";
import type { ClarityController } from "../extension";

/** Manual "Re-run" — the only fallback trigger for analysis. */
export function registerExplainLatestChange(controller: ClarityController): vscode.Disposable {
  return vscode.commands.registerCommand("clarityDiff.explainLatestChange", () => {
    void controller.rerun();
  });
}
