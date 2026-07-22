import * as vscode from "vscode";
import { HostToWebview, PanelView, WebviewToHost } from "./messages";

export class ClarityViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "clarityDiff.panel";

  private view: vscode.WebviewView | undefined;
  private lastView: PanelView | undefined;
  private readonly messageEmitter = new vscode.EventEmitter<WebviewToHost>();

  /** Fires for every message received from the webview. */
  public readonly onDidReceiveMessage = this.messageEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      this.messageEmitter.fire(msg);
    });

    // Re-send the latest view when the panel becomes visible again.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.lastView) {
        this.postView(this.lastView);
      }
    });
  }

  /** Push a view state to the webview, remembering it for re-hydration. */
  postView(view: PanelView): void {
    this.lastView = view;
    const message: HostToWebview = { type: "view", view };
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "style.css"),
    );
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Clarity Diff</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
