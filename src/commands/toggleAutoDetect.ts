import * as vscode from "vscode";
import type { ClarityController } from "../extension";

export function registerToggleAutoDetect(controller: ClarityController): vscode.Disposable {
  return vscode.commands.registerCommand("clarityDiff.toggleAutoDetect", () => {
    void controller.toggleAutoDetect();
  });
}
