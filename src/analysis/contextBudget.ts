import { ContextFile } from "../types";
import { redactSecrets } from "../util/redact";
import { truncateToBytes } from "../util/truncate";

/** Maximum bytes taken from any single file, before the overall budget. */
const PER_FILE_CAP = 64 * 1024;

/** Paths that must never be sent as context, regardless of tier. */
const DENY_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out|coverage|\.next|\.turbo)\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i,
  /\.(pem|key|pfx|p12|crt|cer)$/i,
  /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|exe|dll|so|dylib|class|jar|woff2?|ttf|eot|otf|mp4|mp3|wav|mov|bin|wasm|lock)$/i,
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Convert a simple glob (supporting * and **) to a RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`(^|/)${escaped}($|/)`);
}

export function isDenied(path: string, extraGlobs: string[] = []): boolean {
  const normalized = normalizePath(path);
  if (DENY_PATTERNS.some((re) => re.test(normalized))) {
    return true;
  }
  return extraGlobs.some((glob) => {
    try {
      return globToRegExp(glob).test(normalized);
    } catch {
      return false;
    }
  });
}

/**
 * Allocates a shared byte budget across context files. Each file is redacted,
 * then truncated to the smaller of the per-file cap and the remaining budget.
 * Tracks whether anything was redacted or truncated for the UI notice.
 */
export class ContextBudget {
  private remaining: number;
  private usedBytes = 0;
  private readonly encoder = new TextEncoder();

  public redactedAny = false;
  public truncatedAny = false;

  constructor(
    maxBytes: number,
    private readonly extraGlobs: string[] = [],
  ) {
    this.remaining = Math.max(0, maxBytes);
  }

  get used(): number {
    return this.usedBytes;
  }

  /**
   * Try to admit a file into the budget. Returns the redacted/truncated
   * ContextFile, or undefined if the path is denied or the budget is exhausted.
   */
  take(path: string, rawContent: string, reason: ContextFile["reason"]): ContextFile | undefined {
    if (isDenied(path, this.extraGlobs)) {
      return undefined;
    }
    if (this.remaining <= 0) {
      this.truncatedAny = true;
      return undefined;
    }

    const { text: redacted, redactedCount } = redactSecrets(rawContent);
    if (redactedCount > 0) {
      this.redactedAny = true;
    }

    const cap = Math.min(PER_FILE_CAP, this.remaining);
    const { text, truncated } = truncateToBytes(redacted, cap);
    if (truncated) {
      this.truncatedAny = true;
    }

    const bytes = this.encoder.encode(text).length;
    this.remaining -= bytes;
    this.usedBytes += bytes;

    return { path: normalizePath(path), content: text, truncated, reason };
  }
}
