import * as vscode from "vscode";
import { ChangedFile, CodeContext, ContextFile, ContextLevel, ProjectMap } from "../types";
import { GitDiffService } from "../git/gitDiffService";
import { ContextBudget, isDenied } from "./contextBudget";
import { renderFileTree } from "../util/fileTree";
import { detectLanguage, extractImports, resolveImport } from "./importParser";

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

/** Extensions treated as "source" for small-repo packing. */
const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "cts", "mts",
  "py", "pyi", "go", "rs", "java", "rb", "php", "c", "h",
  "cpp", "hpp", "cc", "cs", "swift", "kt", "kts", "scala",
  "vue", "svelte", "astro", "sql",
]);

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

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
    const tracked = await this.git.listFiles();
    const trackedSet = new Set(tracked);

    // Cache of file contents we've already read, keyed by workspace-relative path.
    const contentCache = new Map<string, string | undefined>();
    const readCached = async (relPath: string): Promise<string | undefined> => {
      if (!contentCache.has(relPath)) {
        contentCache.set(relPath, await this.readFile(root, relPath));
      }
      return contentCache.get(relPath);
    };

    const files: ContextFile[] = [];
    const includedPaths = new Set<string>();
    const take = (path: string, content: string, reason: ContextFile["reason"]): void => {
      if (includedPaths.has(path)) {
        return;
      }
      const taken = budget.take(path, content, reason);
      if (taken) {
        files.push(taken);
        includedPaths.add(taken.path);
      }
    };

    // 1. Full contents of changed files (skip deletions).
    const changedPaths: string[] = [];
    for (const changed of changedFiles) {
      if (changed.status === "deleted") {
        continue;
      }
      const content = await readCached(changed.path);
      if (content === undefined) {
        continue;
      }
      changedPaths.push(changed.path);
      take(changed.path, content, "changed");
    }

    // 2. Project map: key manifests + a file tree.
    const manifests: ContextFile[] = [];
    for (const name of MANIFEST_CANDIDATES) {
      if (includedPaths.has(name)) {
        continue;
      }
      const content = await readCached(name);
      if (content === undefined) {
        continue;
      }
      const taken = budget.take(name, content, "manifest");
      if (taken) {
        manifests.push(taken);
        includedPaths.add(taken.path);
      }
    }

    // 3. Tier 2: related files (import neighbors, optionally the whole small repo).
    if (level === "neighbors" || level === "repo") {
      const related = this.buildRelatedList(
        level,
        changedPaths,
        contentCache,
        trackedSet,
        includedPaths,
        extraGlobs,
      );
      for (const relPath of related) {
        const content = await readCached(relPath);
        if (content === undefined) {
          continue;
        }
        take(relPath, content, "neighbor");
      }
    }

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

  /**
   * Ordered list of related files to consider, highest priority first: import
   * neighbors of the changed files, then (for "repo") remaining source files.
   * Excludes already-included and denied paths. Content already read for
   * changed files is reused from the cache.
   */
  private buildRelatedList(
    level: ContextLevel,
    changedPaths: string[],
    contentCache: Map<string, string | undefined>,
    trackedSet: Set<string>,
    includedPaths: Set<string>,
    extraGlobs: string[],
  ): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const add = (path: string): void => {
      if (seen.has(path) || includedPaths.has(path) || isDenied(path, extraGlobs)) {
        return;
      }
      seen.add(path);
      ordered.push(path);
    };

    // Import neighbors of changed files.
    for (const changedPath of changedPaths) {
      const content = contentCache.get(changedPath);
      if (content === undefined) {
        continue;
      }
      const lang = detectLanguage(changedPath);
      if (lang === "other") {
        continue;
      }
      for (const specifier of extractImports(content, lang)) {
        const candidates = resolveImport(changedPath, specifier, lang);
        const resolved = candidates.find((candidate) => trackedSet.has(candidate));
        if (resolved) {
          add(resolved);
        }
      }
    }

    // Small-repo packing: append remaining source files.
    if (level === "repo") {
      for (const trackedPath of trackedSet) {
        if (SOURCE_EXTENSIONS.has(extensionOf(trackedPath))) {
          add(trackedPath);
        }
      }
    }

    return ordered;
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
