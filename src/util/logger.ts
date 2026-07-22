import * as vscode from "vscode";

/**
 * Single shared OutputChannel logger. Never log secrets or raw diff contents
 * that may contain secrets — pass already-redacted text only.
 */
class Logger {
  private channel: vscode.OutputChannel | undefined;

  init(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("Clarity Diff");
    }
    return this.channel;
  }

  private write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    this.init().appendLine(line);
  }

  info(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.message}` : err ? String(err) : "";
    this.write("error", detail ? `${message}: ${detail}` : message);
  }
}

export const logger = new Logger();
