import * as vscode from "vscode";

const API_KEY_SECRET = "clarityDiff.grokApiKey";
const CONSENT_KEY = "clarityDiff.hasConsented";

/**
 * Stores the Grok API key in VS Code SecretStorage and tracks one-time consent
 * for sending code to the xAI API. The key is never written to settings or logs.
 */
export class ApiKeyStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(API_KEY_SECRET);
  }

  async hasApiKey(): Promise<boolean> {
    return Boolean(await this.getApiKey());
  }

  async setApiKey(key: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET, key.trim());
  }

  async clearApiKey(): Promise<void> {
    await this.context.secrets.delete(API_KEY_SECRET);
  }

  hasConsented(): boolean {
    return this.context.globalState.get<boolean>(CONSENT_KEY, false);
  }

  async setConsent(value: boolean): Promise<void> {
    await this.context.globalState.update(CONSENT_KEY, value);
  }

  /** Fires whenever the stored API key changes. */
  onDidChange(listener: () => void): vscode.Disposable {
    return this.context.secrets.onDidChange((e) => {
      if (e.key === API_KEY_SECRET) {
        listener();
      }
    });
  }
}
