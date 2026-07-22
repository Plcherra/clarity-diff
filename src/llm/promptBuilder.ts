import { CollectedDiff } from "../types";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT = [
  "You are Clarity Diff, an assistant that explains AI-generated code changes to",
  '"vibe coders" — people who build with AI but do not read code fluently.',
  "Explain in plain, friendly, non-technical language. Be honest about risk.",
  "",
  "You will receive the user's original intent (what they asked the AI to do) and a",
  "unified git diff of what actually changed. Respond with ONLY a JSON object matching",
  "this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "summary": string,               // 1-3 short sentences: what changed, plainly',
  '  "intentMatch": {',
  '    "status": "green" | "red",     // green = matches intent, red = did something different',
  '    "reason": string               // one short sentence explaining the status',
  "  },",
  '  "structureFit": string,          // how the change fits the project (best-effort, plain language)',
  '  "safety": {',
  '    "risk": "low" | "medium" | "high",',
  '    "reasons": string[]            // short, concrete things that could break',
  "  },",
  '  "nextSteps": string[]            // 1-3 clear, plain-language next steps',
  "}",
].join("\n");

export function buildMessages(intent: string, diff: CollectedDiff): ChatMessage[] {
  const intentText = intent.trim().length > 0 ? intent.trim() : "(The user did not describe their intent.)";

  const fileList = diff.files
    .map((f) => `- ${f.path} (${f.status})`)
    .join("\n");

  const notices: string[] = [];
  if (diff.redacted) {
    notices.push("Note: some secrets in the diff were masked as «redacted».");
  }
  if (diff.truncated) {
    notices.push("Note: the diff was truncated because it was large.");
  }

  const userContent = [
    "ORIGINAL INTENT:",
    intentText,
    "",
    "CHANGED FILES:",
    fileList || "(no file list available)",
    "",
    notices.length > 0 ? notices.join("\n") + "\n" : "",
    "UNIFIED DIFF:",
    "```diff",
    diff.diffText || "(empty diff)",
    "```",
    "",
    "Respond with ONLY the JSON object described in the system message.",
  ].join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

/** Reminder appended on a retry when the first response was not valid JSON. */
export const JSON_RETRY_REMINDER: ChatMessage = {
  role: "system",
  content: "Your previous response was not valid JSON. Respond with ONLY the JSON object, nothing else.",
};
