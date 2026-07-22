import * as vscode from "vscode";
import { GitDiffService } from "./gitDiffService";
import { logger } from "../util/logger";

const IGNORED_PATH = /[\\/](node_modules|\.git|dist|out|\.next|build)[\\/]/;

/**
 * Detects "the AI just finished a change" by watching git working-tree activity
 * and debouncing the burst of edits into a single settle event.
 *
 * Primary signal: the Git extension's repository.state.onDidChange.
 * Fallback signal: a FileSystemWatcher, used only when the Git API is unavailable.
 *
 * Diff-fingerprint de-dupe and the in-flight concurrency guard live in the
 * pipeline that consumes the settle event, since they need the collected diff.
 */
export class ChangeWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  constructor(
    private readonly git: GitDiffService,
    private readonly getDebounceMs: () => number,
    private readonly onSettle: () => void,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const api = await this.git.getApi();
    if (api) {
      const gitSub = await this.git.onDidChange(() => this.schedule());
      this.disposables.push(gitSub);
      logger.info("Change watcher active (git working-tree signal).");
    } else {
      this.startFileSystemFallback();
      logger.info("Change watcher active (file-system fallback signal).");
    }
  }

  private startFileSystemFallback(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const handle = (uri: vscode.Uri): void => {
      if (!IGNORED_PATH.test(uri.fsPath)) {
        this.schedule();
      }
    };
    watcher.onDidChange(handle);
    watcher.onDidCreate(handle);
    watcher.onDidDelete(handle);
    this.disposables.push(watcher);
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onSettle();
    }, this.getDebounceMs());
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
