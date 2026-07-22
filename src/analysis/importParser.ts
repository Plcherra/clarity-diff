export type SourceLang = "js" | "python" | "other";

const JS_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "cts", "mts"];
const PY_EXTENSIONS = ["py", "pyi"];

/** Candidate extensions tried when resolving an extensionless JS/TS import. */
const JS_RESOLVE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json"];

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function detectLanguage(path: string): SourceLang {
  const ext = extensionOf(path);
  if (JS_EXTENSIONS.includes(ext)) {
    return "js";
  }
  if (PY_EXTENSIONS.includes(ext)) {
    return "python";
  }
  return "other";
}

const JS_IMPORT_PATTERNS: RegExp[] = [
  /import[^;'"]*?from\s*['"]([^'"]+)['"]/g, // import x from "y" / import {a} from "y"
  /export[^;'"]*?from\s*['"]([^'"]+)['"]/g, // export {a} from "y"
  /import\s*['"]([^'"]+)['"]/g, // import "y" (side effect)
  /require\(\s*['"]([^'"]+)['"]\s*\)/g, // require("y")
  /import\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import("y")
];

const PY_FROM_PATTERN = /^\s*from\s+(\.*[\w.]*)\s+import\s+/gm;
const PY_IMPORT_PATTERN = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;

/** Extract raw module specifiers from source content (order-preserving, deduped). */
export function extractImports(content: string, lang: SourceLang): string[] {
  const found: string[] = [];
  const push = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed && !found.includes(trimmed)) {
      found.push(trimmed);
    }
  };

  if (lang === "js") {
    for (const pattern of JS_IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        push(match[1]);
      }
    }
  } else if (lang === "python") {
    PY_FROM_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PY_FROM_PATTERN.exec(content)) !== null) {
      push(match[1]);
    }
    PY_IMPORT_PATTERN.lastIndex = 0;
    while ((match = PY_IMPORT_PATTERN.exec(content)) !== null) {
      for (const part of match[1].split(",")) {
        push(part.trim());
      }
    }
  }

  return found;
}

/** Join a POSIX directory with a relative path, resolving "." and "..". */
function joinPosix(dir: string, rel: string): string {
  const stack = dir.split("/").filter((p) => p.length > 0);
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

/**
 * Resolve an import specifier to candidate workspace-relative paths (POSIX),
 * in priority order. Only relative imports are resolved; bare/package imports
 * return an empty list (they can't be mapped to repo files reliably). Callers
 * pick the first candidate that exists in the repo's tracked file set.
 */
export function resolveImport(fromPath: string, specifier: string, lang: SourceLang): string[] {
  if (lang === "js") {
    return resolveJsImport(fromPath, specifier);
  }
  if (lang === "python") {
    return resolvePythonImport(fromPath, specifier);
  }
  return [];
}

function resolveJsImport(fromPath: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) {
    return [];
  }
  const base = joinPosix(dirOf(fromPath), specifier);
  const hasExt = JS_RESOLVE_EXTENSIONS.includes(extensionOf(specifier));
  if (hasExt) {
    return [base];
  }
  const candidates: string[] = [];
  for (const ext of JS_RESOLVE_EXTENSIONS) {
    candidates.push(`${base}.${ext}`);
  }
  for (const ext of JS_RESOLVE_EXTENSIONS) {
    candidates.push(`${base}/index.${ext}`);
  }
  return candidates;
}

function resolvePythonImport(fromPath: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) {
    return [];
  }
  let level = 0;
  while (level < specifier.length && specifier[level] === ".") {
    level += 1;
  }
  const remainder = specifier.slice(level).replace(/\./g, "/");

  // A single leading dot means "current package"; each extra dot goes up one.
  let dir = dirOf(fromPath);
  for (let i = 1; i < level; i += 1) {
    dir = dirOf(dir);
  }
  const base = remainder.length > 0 ? joinPosix(dir, remainder) : dir;
  if (base.length === 0) {
    return [];
  }
  return [`${base}.py`, `${base}/__init__.py`];
}
