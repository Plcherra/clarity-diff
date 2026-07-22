import { Explanation, FlagStatus, GlossaryTerm, RiskLevel } from "../types";

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function asFlagStatus(value: unknown): FlagStatus {
  return value === "green" || value === "red" ? value : "unknown";
}

function asRiskLevel(value: unknown): RiskLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asGlossary(value: unknown): GlossaryTerm[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const terms: GlossaryTerm[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const term = asString(entry.term).trim();
    const definition = asString(entry.definition).trim();
    if (term.length > 0 && definition.length > 0) {
      terms.push({ term, definition });
    }
  }
  return terms;
}

/**
 * Parse and validate a model response string into an Explanation. Tolerant of
 * fenced code blocks and minor omissions; throws only when no JSON object can be
 * recovered at all (so the caller can retry).
 */
export function parseExplanation(raw: string): Explanation {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new SchemaValidationError("No JSON object found in model response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new SchemaValidationError(
      `Model response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new SchemaValidationError("Model response was not a JSON object.");
  }

  const intentMatch = isRecord(parsed.intentMatch) ? parsed.intentMatch : {};
  const safety = isRecord(parsed.safety) ? parsed.safety : {};

  return {
    summary: asString(parsed.summary, "No summary was provided."),
    intentMatch: {
      status: asFlagStatus(intentMatch.status),
      reason: asString(intentMatch.reason),
    },
    structureFit: asString(parsed.structureFit),
    safety: {
      risk: asRiskLevel(safety.risk),
      reasons: asStringArray(safety.reasons),
    },
    nextSteps: asStringArray(parsed.nextSteps),
    glossary: asGlossary(parsed.glossary),
  };
}

/** Extract the first balanced top-level JSON object from arbitrary text. */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}
