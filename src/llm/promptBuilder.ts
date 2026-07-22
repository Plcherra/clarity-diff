import { CodeContext, CollectedDiff, ContextFile } from "../types";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT = [
  "You are Clarity Diff, an assistant that explains AI-generated code changes to",
  '"vibe coders" — people who build with AI but do NOT read code and may not know',
  "basic programming concepts.",
  "",
  "HOW TO EXPLAIN (very important):",
  "- Write like you are talking to a smart friend who has never coded.",
  "- NEVER use a technical or project-specific term without immediately explaining it",
  "  in plain words. This includes code words (function, boolean, flag, API, test,",
  "  variable, config) AND project jargon found in the diff (e.g. 'Off mode',",
  "  'open thread', 'explicit: true').",
  "- Prefer short everyday analogies (a switch, a label, an intern, a checklist).",
  "- Always explain the WHY: why the change was made and why the code works this way,",
  "  not just what changed.",
  "- Short sentences. Encouraging, calm tone. No shaming, no lecturing.",
  "",
  "You will receive the user's original intent (what they asked the AI to do) and a",
  "unified git diff of what actually changed. Respond with ONLY a JSON object matching",
  "this exact shape (no markdown, no prose outside the JSON):",
  "{",
  '  "summary": string,               // 2-4 plain sentences: what changed AND why it matters, no jargon',
  '  "intentMatch": {',
  '    "status": "green" | "red",     // green = matches intent, red = did something different',
  '    "reason": string               // one short sentence explaining the status',
  "  },",
  '  "structureFit": string,          // how the change fits the project, in plain language',
  '  "safety": {',
  '    "risk": "low" | "medium" | "high",',
  '    "reasons": string[]            // short, concrete things that could break, in plain words',
  "  },",
  '  "nextSteps": string[],           // 1-3 clear, plain-language next steps',
  '  "glossary": [                     // define EVERY technical or project term used above or in the diff',
  '    { "term": string, "definition": string }  // definition = 1-2 plain sentences, with a why/analogy if helpful',
  "  ]",
  "}",
  "",
  "If there are no technical terms worth defining, return an empty glossary array.",
  "Aim for 2-6 glossary entries covering the terms a non-coder would stumble on.",
].join("\n");

export function buildMessages(
  intent: string,
  diff: CollectedDiff,
  context?: CodeContext,
): ChatMessage[] {
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

  const parts: string[] = [
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
  ];

  if (context) {
    parts.push("", ...renderContextSections(context));
  }

  parts.push("", "Respond with ONLY the JSON object described in the system message.");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n") },
  ];
}

function renderContextSections(context: CodeContext): string[] {
  const sections: string[] = [
    "The following context is provided to help you explain the change accurately.",
    "Use it to explain how the change fits the project and to define jargon. Do not",
    "review it as if it were part of the change.",
  ];

  if (context.projectMap && context.projectMap.tree.trim().length > 0) {
    sections.push("", "PROJECT MAP (file tree):", "```", context.projectMap.tree, "```");
  }

  const manifests = context.projectMap?.manifests ?? [];
  if (manifests.length > 0) {
    sections.push("", "KEY FILES:");
    manifests.forEach((f) => sections.push(...renderContextFile(f)));
  }

  const changed = context.files.filter((f) => f.reason === "changed");
  if (changed.length > 0) {
    sections.push("", "CHANGED FILES (full current contents):");
    changed.forEach((f) => sections.push(...renderContextFile(f)));
  }

  const neighbors = context.files.filter((f) => f.reason === "neighbor" || f.reason === "retrieved");
  if (neighbors.length > 0) {
    sections.push("", "RELATED FILES:");
    neighbors.forEach((f) => sections.push(...renderContextFile(f)));
  }

  return sections;
}

function renderContextFile(file: ContextFile): string[] {
  const header = file.truncated ? `${file.path} (truncated)` : file.path;
  return ["", `--- ${header} ---`, "```", file.content, "```"];
}

/** Reminder appended on a retry when the first response was not valid JSON. */
export const JSON_RETRY_REMINDER: ChatMessage = {
  role: "system",
  content: "Your previous response was not valid JSON. Respond with ONLY the JSON object, nothing else.",
};
