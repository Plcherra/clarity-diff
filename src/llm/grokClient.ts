import { CollectedDiff, Explanation } from "../types";
import { buildMessages, ChatMessage, JSON_RETRY_REMINDER } from "./promptBuilder";
import { parseExplanation, SchemaValidationError } from "./responseSchema";
import { logger } from "../util/logger";

const GROK_ENDPOINT = "https://api.x.ai/v1/chat/completions";

export class GrokError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokError";
  }
}

export interface ExplainOptions {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class GrokClient {
  /**
   * Build the prompt, call Grok, and validate the response. On malformed JSON,
   * retries once with an explicit "JSON only" reminder before failing.
   */
  async explain(
    intent: string,
    diff: CollectedDiff,
    options: ExplainOptions,
  ): Promise<Explanation> {
    const messages = buildMessages(intent, diff);

    const firstRaw = await this.complete(messages, options);
    try {
      return parseExplanation(firstRaw);
    } catch (err) {
      if (!(err instanceof SchemaValidationError)) {
        throw err;
      }
      logger.warn("Model returned malformed JSON; retrying once.");
    }

    const retryMessages: ChatMessage[] = [
      ...messages,
      JSON_RETRY_REMINDER,
    ];
    const secondRaw = await this.complete(retryMessages, options);
    return parseExplanation(secondRaw);
  }

  private async complete(messages: ChatMessage[], options: ExplainOptions): Promise<string> {
    let response: Response;
    try {
      response = await fetch(GROK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }
      throw new GrokError(
        `Could not reach the Grok API. Check your connection. (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      if (response.status === 401 || response.status === 403) {
        throw new GrokError("Grok rejected your API key. Please check it in Clarity Diff settings.");
      }
      throw new GrokError(`Grok API error (${response.status}). ${detail}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new GrokError(data.error?.message ?? "Grok returned an empty response.");
    }
    return content;
  }

  private async readErrorDetail(response: Response): Promise<string> {
    try {
      const data = (await response.json()) as ChatCompletionResponse;
      return data.error?.message ?? "";
    } catch {
      return "";
    }
  }
}
