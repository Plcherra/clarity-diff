import * as vscode from "vscode";
import { ChangedFile, CodeContext, ContextFile, ContextLevel, ProjectMap } from "../types";
import { GitDiffService } from "../git/gitDiffService";
import { ContextBudget } from "./contextBudget";
import { renderFileTree } from "../util/fileTree";

/** Root-level files worth including as a lightweight "architecture overview". */
const MANIFEST_CANDIDATES = [
  "package.json",
  "tsconfig.json",
  "README.md",
  "README",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "astro.config.mjs",
  "svelte.config.js",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
];

const MAX_TREE_ENTRIES = 200;
const BINARY_SNIFF_BYTES = 8000;

/**
 * Gathers surrounding code context for an analysis. Tier 1 sends the full
 * contents of changed files plus a project map (file tree + key manifests).
 * Everything is redacted and size-limited by the shared ContextBudget.
 */
export class ContextCollector {
  constructor(private readonly git: GitDiffService) {}

  async collect(
    level: ContextLevel,
    changedFiles: ChangedFile[],
    maxContextBytes: number,
    extraGlobs: string[],
  ): Promise<CodeContext | undefined> {
    if (level === "diffOnly" || maxContextBytes <= 0) {
      return undefined;
    }
    const repo = await this.git.getPrimaryRepository();
    if (!repo) {
      return undefined;
    }
    const root = repo.rootUri;
    const budget = new ContextBudget(maxContextBytes, extraGlobs);

    // 1. Full contents of changed files (skip deletions).
    const files: ContextFile[] = [];
    for (const changed of changedFiles) {
      if (changed.status === "deleted") {
        continue;
      }
      const content = await this.readFile(root, changed.path);
      if (content === undefined) {
        continue;
      }
      const taken = budget.take(changed.path, content, "changed");
      if (taken) {
        files.push(taken);
      }
    }

    // 2. Project map: key manifests + a file tree.
    const manifests: ContextFile[] = [];
    for (const name of MANIFEST_CANDIDATES) {
      if (files.some((f) => f.path === name)) {
        continue;
      }
      const content = await this.readFile(root, name);
      if (content === undefined) {
        continue;
      }
      const taken = budget.take(name, content, "manifest");
      if (taken) {
        manifests.push(taken);
      }
    }

    const tracked = await this.git.listFiles();
    const { tree } = renderFileTree(tracked, MAX_TREE_ENTRIES);
    const projectMap: ProjectMap = { tree, manifests };

    return {
      files,
      projectMap,
      totalBytes: budget.used,
      truncated: budget.truncatedAny,
      redacted: budget.redactedAny,
      level,
    };
  }

  private async readFile(root: vscode.Uri, relativePath: string): Promise<string | undefined> {
    try {
      const uri = vscode.Uri.joinPath(root, relativePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (looksBinary(bytes)) {
        return undefined;
      }
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return undefined;
    }
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}
