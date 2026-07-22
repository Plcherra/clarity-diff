import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChangedFile } from "../types";
import { logger } from "../util/logger";

const execFileAsync = promisify(execFile);

// --- Minimal typings for the built-in vscode.git extension API (v1). ---

interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: number;
}

interface GitRepositoryState {
  readonly workingTreeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  readonly onDidChange: vscode.Event<void>;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
}

interface GitAPI {
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitAPI;
}

// Git extension Status enum values we care about (see vscode.git.d.ts).
const enum GitStatus {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
}

export interface RawDiff {
  diffText: string;
  files: ChangedFile[];
  rootPath: string;
}

function mapStatus(status: number): ChangedFile["status"] {
  switch (status) {
    case GitStatus.INDEX_ADDED:
      return "added";
    case GitStatus.INDEX_DELETED:
    case GitStatus.DELETED:
      return "deleted";
    case GitStatus.INDEX_RENAMED:
      return "renamed";
    case GitStatus.UNTRACKED:
      return "untracked";
    default:
      return "modified";
  }
}

export class GitDiffService {
  private api: GitAPI | undefined;

  /** Resolve (and cache) the built-in Git extension API, activating it if needed. */
  async getApi(): Promise<GitAPI | undefined> {
    if (this.api) {
      return this.api;
    }
    const ext = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!ext) {
      logger.warn("Built-in Git extension not found.");
      return undefined;
    }
    const exports = ext.isActive ? ext.exports : await ext.activate();
    this.api = exports.getAPI(1);
    return this.api;
  }

  async getPrimaryRepository(): Promise<GitRepository | undefined> {
    const api = await this.getApi();
    return api?.repositories[0];
  }

  async isGitRepo(): Promise<boolean> {
    return Boolean(await this.getPrimaryRepository());
  }

  /** Subscribe to working-tree/index changes on all known repositories. */
  async onDidChange(listener: () => void): Promise<vscode.Disposable> {
    const api = await this.getApi();
    const disposables: vscode.Disposable[] = [];
    if (!api) {
      return new vscode.Disposable(() => undefined);
    }

    const subscribe = (repo: GitRepository): void => {
      disposables.push(repo.state.onDidChange(listener));
    };
    api.repositories.forEach(subscribe);
    disposables.push(api.onDidOpenRepository(subscribe));

    return new vscode.Disposable(() => disposables.forEach((d) => d.dispose()));
  }

  /**
   * Collect the working-tree diff (staged + unstaged, vs HEAD) and the list of
   * changed files. Diff text is produced by spawning git; the file list comes from
   * the Git API state so untracked files are represented too.
   */
  async getWorkingTreeDiff(): Promise<RawDiff | undefined> {
    const repo = await this.getPrimaryRepository();
    if (!repo) {
      return undefined;
    }

    const rootPath = repo.rootUri.fsPath;
    const files = this.collectChangedFiles(repo, rootPath);
    const diffText = await this.runGitDiff(rootPath);

    return { diffText, files, rootPath };
  }

  private collectChangedFiles(repo: GitRepository, rootPath: string): ChangedFile[] {
    const seen = new Map<string, ChangedFile>();
    const add = (change: GitChange): void => {
      const relative = this.toRelative(change.uri.fsPath, rootPath);
      if (!seen.has(relative)) {
        seen.set(relative, { path: relative, status: mapStatus(change.status) });
      }
    };
    repo.state.indexChanges.forEach(add);
    repo.state.workingTreeChanges.forEach(add);
    return [...seen.values()];
  }

  private async runGitDiff(rootPath: string): Promise<string> {
    try {
      // Prefer diff vs HEAD to capture both staged and unstaged tracked changes.
      const { stdout } = await execFileAsync("git", ["diff", "HEAD"], {
        cwd: rootPath,
        maxBuffer: 20 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      // Fresh repo without commits: fall back to the index diff.
      logger.warn("git diff HEAD failed; falling back to plain git diff.");
      try {
        const { stdout } = await execFileAsync("git", ["diff"], {
          cwd: rootPath,
          maxBuffer: 20 * 1024 * 1024,
        });
        return stdout;
      } catch (fallbackErr) {
        logger.error("git diff fallback failed", fallbackErr);
        return "";
      }
    }
  }

  private toRelative(fsPath: string, rootPath: string): string {
    const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
    if (fsPath.startsWith(normalizedRoot)) {
      return fsPath.slice(normalizedRoot.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
    }
    return fsPath.replace(/\\/g, "/");
  }
}
