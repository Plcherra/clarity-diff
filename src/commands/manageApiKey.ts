import * as vscode from "vscode";
import type { ClarityController } from "../extension";

export function registerManageApiKey(controller: ClarityController): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("clarityDiff.setApiKey", () => {
      void controller.promptForApiKey();
    }),
    vscode.commands.registerCommand("clarityDiff.clearApiKey", () => {
      void controller.clearApiKey();
    }),
  ];
}
