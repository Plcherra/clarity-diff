import { createHash } from "node:crypto";
import { CollectedDiff } from "../types";
import { GitDiffService } from "../git/gitDiffService";
import { sanitizeDiff } from "./safetyScanner";

function fingerprintOf(diffText: string): string {
  return createHash("sha256").update(diffText).digest("hex");
}

/**
 * Assembles a redacted, size-limited, fingerprinted diff ready for prompting.
 * Returns undefined when there is no git repo, and a diff with an empty
 * fingerprint semantics is left to the caller (empty diffText => nothing to do).
 */
export class DiffCollector {
  constructor(private readonly git: GitDiffService) {}

  async collect(maxDiffBytes: number): Promise<CollectedDiff | undefined> {
    const raw = await this.git.getWorkingTreeDiff();
    if (!raw) {
      return undefined;
    }

    // Fingerprint the raw (pre-redaction) diff so de-dupe is stable across runs.
    const fingerprint = fingerprintOf(raw.diffText);
    const { text, truncated, redacted } = sanitizeDiff(raw.diffText, maxDiffBytes);

    return {
      diffText: text,
      files: raw.files,
      fingerprint,
      truncated,
      redacted,
    };
  }
}
