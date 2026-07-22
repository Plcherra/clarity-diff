import * as vscode from "vscode";
import { ClarityViewProvider } from "./panel/ClarityViewProvider";
import { PanelView, WebviewToHost } from "./panel/messages";
import { ApiKeyStore } from "./secrets/apiKeyStore";
import { GitDiffService } from "./git/gitDiffService";
import { ChangeWatcher } from "./git/changeWatcher";
import { DiffCollector } from "./analysis/diffCollector";
import { ContextCollector } from "./analysis/contextCollector";
import { GrokClient, GrokError } from "./llm/grokClient";
import { getSettings, setAutoDetect, onSettingsChanged } from "./config/settings";
import { registerExplainLatestChange } from "./commands/explainLatestChange";
import { registerToggleAutoDetect } from "./commands/toggleAutoDetect";
import { registerManageApiKey } from "./commands/manageApiKey";
import { logger } from "./util/logger";
import { AnalysisResult, CodeContext } from "./types";

/**
 * Central orchestrator. Owns the automatic pipeline
 * (changeWatcher -> diffCollector -> grokClient -> panel) and the fallbacks.
 */
export class ClarityController {
  private lastFingerprint: string | undefined;
  private lastIntent = "";
  private lastResult: AnalysisResult | undefined;
  private activeRun: AbortController | undefined;

  constructor(
    private readonly provider: ClarityViewProvider,
    private readonly apiKeys: ApiKeyStore,
    private readonly git: GitDiffService,
    private readonly collector: DiffCollector,
    private readonly contextCollector: ContextCollector,
    private readonly grok: GrokClient,
  ) {}

  handleMessage(message: WebviewToHost): void {
    switch (message.type) {
      case "ready":
        void this.refreshView();
        break;
      case "saveApiKey":
        void this.saveApiKey(message.key);
        break;
      case "giveConsent":
        void this.giveConsent();
        break;
      case "rerun":
        void this.rerun();
        break;
      case "setIntent":
        this.lastIntent = message.intent;
        break;
      case "toggleAutoDetect":
        void this.toggleAutoDetect();
        break;
      case "openFile":
        void this.openFile(message.path, message.line);
        break;
      default:
        break;
    }
  }

  /** Decide and push the correct view for the current readiness state. */
  async refreshView(): Promise<void> {
    if (!(await this.apiKeys.hasApiKey())) {
      this.provider.postView({ kind: "onboarding" });
      return;
    }
    if (!this.apiKeys.hasConsented()) {
      this.provider.postView({ kind: "consent" });
      return;
    }
    if (!(await this.git.isGitRepo())) {
      this.provider.postView({ kind: "noRepo" });
      return;
    }
    if (this.lastResult) {
      this.provider.postView(this.resultView(this.lastResult));
      return;
    }
    this.provider.postView(this.idleView());
  }

  /** Automatic settle handler: gated, de-duped analysis. */
  async onSettle(): Promise<void> {
    const settings = getSettings();
    if (!settings.autoDetect) {
      return;
    }
    if (!(await this.isReady())) {
      return;
    }
    await this.runAnalysis(false);
  }

  /** Manual re-run (fallback). Always analyzes, bypassing de-dupe. */
  async rerun(): Promise<void> {
    if (!(await this.ensureReadyInteractive())) {
      return;
    }
    await this.runAnalysis(true);
  }

  private async runAnalysis(force: boolean): Promise<void> {
    const settings = getSettings();

    const diff = await this.collector.collect(settings.maxDiffBytes);
    if (!diff) {
      this.provider.postView({ kind: "noRepo" });
      return;
    }
    if (diff.diffText.trim().length === 0) {
      this.lastResult = undefined;
      this.provider.postView(this.idleView());
      return;
    }
    if (!force && diff.fingerprint === this.lastFingerprint) {
      return;
    }

    // Concurrency guard: supersede any in-flight request.
    this.activeRun?.abort();
    const run = new AbortController();
    this.activeRun = run;

    const apiKey = await this.apiKeys.getApiKey();
    if (!apiKey) {
      await this.refreshView();
      return;
    }

    this.provider.postView({ kind: "analyzing" });

    let context: CodeContext | undefined;
    try {
      context = await this.contextCollector.collect(
        settings.contextLevel,
        diff.files,
        settings.maxContextBytes,
        settings.contextExcludeGlobs,
      );
    } catch (err) {
      // Context is best-effort; never let it break analysis.
      logger.error("Context collection failed; continuing with diff only", err);
      context = undefined;
    }

    try {
      const explanation = await this.grok.explain(this.lastIntent, diff, context, {
        apiKey,
        model: settings.model,
        signal: run.signal,
      });
      if (this.activeRun !== run) {
        return; // superseded
      }
      this.lastFingerprint = diff.fingerprint;
      this.lastResult = {
        explanation,
        files: diff.files,
        truncated: diff.truncated || (context?.truncated ?? false),
        redacted: diff.redacted || (context?.redacted ?? false),
        contextNote: formatContextNote(context),
      };
      this.provider.postView(this.resultView(this.lastResult));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const message =
        err instanceof GrokError
          ? err.message
          : "Could not analyze the change. See the Clarity Diff output for details.";
      logger.error("Analysis failed", err);
      this.provider.postView({
        kind: "error",
        message,
        autoDetect: settings.autoDetect,
        lastIntent: this.lastIntent,
      });
    } finally {
      if (this.activeRun === run) {
        this.activeRun = undefined;
      }
    }
  }

  async toggleAutoDetect(): Promise<void> {
    const next = !getSettings().autoDetect;
    await setAutoDetect(next);
    await this.refreshView();
  }

  async promptForApiKey(): Promise<void> {
    const key = await vscode.window.showInputBox({
      title: "Grok API key",
      prompt: "Paste your xAI (Grok) API key. It is stored securely and never logged.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "xai-...",
    });
    if (key && key.trim().length > 0) {
      await this.saveApiKey(key);
    }
  }

  async clearApiKey(): Promise<void> {
    await this.apiKeys.clearApiKey();
    this.lastResult = undefined;
    this.lastFingerprint = undefined;
    await this.refreshView();
  }

  private async saveApiKey(key: string): Promise<void> {
    await this.apiKeys.setApiKey(key);
    await this.refreshView();
  }

  private async giveConsent(): Promise<void> {
    await this.apiKeys.setConsent(true);
    await this.refreshView();
    // Kick off an initial analysis if the working tree already has changes.
    void this.onSettle();
  }

  private async openFile(relativePath: string, line?: number): Promise<void> {
    const repo = await this.git.getPrimaryRepository();
    const root = repo?.rootUri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return;
    }
    const target = vscode.Uri.joinPath(root, relativePath);
    try {
      const doc = await vscode.workspace.openTextDocument(target);
      const editor = await vscode.window.showTextDocument(doc);
      if (typeof line === "number" && line > 0) {
        const pos = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    } catch (err) {
      logger.error(`Could not open ${relativePath}`, err);
    }
  }

  private async isReady(): Promise<boolean> {
    return (
      (await this.apiKeys.hasApiKey()) &&
      this.apiKeys.hasConsented() &&
      (await this.git.isGitRepo())
    );
  }

  private async ensureReadyInteractive(): Promise<boolean> {
    if (!(await this.apiKeys.hasApiKey())) {
      this.provider.postView({ kind: "onboarding" });
      return false;
    }
    if (!this.apiKeys.hasConsented()) {
      this.provider.postView({ kind: "consent" });
      return false;
    }
    if (!(await this.git.isGitRepo())) {
      this.provider.postView({ kind: "noRepo" });
      return false;
    }
    return true;
  }

  private idleView(): PanelView {
    return {
      kind: "idle",
      autoDetect: getSettings().autoDetect,
      lastIntent: this.lastIntent,
    };
  }

  private resultView(result: AnalysisResult): PanelView {
    return {
      kind: "result",
      result,
      autoDetect: getSettings().autoDetect,
      lastIntent: this.lastIntent,
    };
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.init();
  logger.info("Clarity Diff activating.");

  const apiKeys = new ApiKeyStore(context);
  const git = new GitDiffService();
  const collector = new DiffCollector(git);
  const contextCollector = new ContextCollector(git);
  const grok = new GrokClient();
  const provider = new ClarityViewProvider(context.extensionUri);

  const controller = new ClarityController(provider, apiKeys, git, collector, contextCollector, grok);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ClarityViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider.onDidReceiveMessage((msg) => controller.handleMessage(msg)),
    registerExplainLatestChange(controller),
    registerToggleAutoDetect(controller),
    ...registerManageApiKey(controller),
    apiKeys.onDidChange(() => void controller.refreshView()),
    onSettingsChanged(() => void controller.refreshView()),
  );

  const watcher = new ChangeWatcher(
    git,
    () => getSettings().debounceMs,
    () => void controller.onSettle(),
  );
  await watcher.start();
  context.subscriptions.push(watcher);

  logger.info("Clarity Diff activated.");
}

export function deactivate(): void {
  logger.info("Clarity Diff deactivated.");
}

/** Build the short "context used" note shown in the panel. */
function formatContextNote(context: CodeContext | undefined): string | undefined {
  if (!context) {
    return undefined;
  }
  const fileCount = context.files.length;
  const parts: string[] = [];
  parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  if (context.projectMap) {
    parts.push("project map");
  }
  return `Context: ${parts.join(" + ")}`;
}
