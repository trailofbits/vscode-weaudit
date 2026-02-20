import * as crypto from "crypto";

import * as vscode from "vscode";

/** Discriminates log entry display style. */
export type LogEntryType = "assistant" | "info" | "error";

/** A single entry in the activity log. */
export interface LogEntry {
    type: LogEntryType;
    text: string;
}

/** Complete state the panel needs to render itself. Owned by DocOverlayManager. */
export interface PanelState {
    claudeBinaryPath: string;
    skillName: string;
    pluginDir: string;
    targetDir: string;
    log: ReadonlyArray<LogEntry>;
    overlayVisible: boolean;
    hasDocs: boolean;
}

/** Messages sent from the webview to the extension host. */
type WebviewToExtMsg =
    | { command: "browse"; field: "pluginDir" | "targetDir" }
    | { command: "generate"; claudeBinaryPath: string; pluginDir: string; skillName: string; targetDir: string }
    | { command: "toggle-overlay" }
    | { command: "clear-docs" };

/** Messages sent from the extension host to the webview. */
type ExtToWebviewMsg =
    | { command: "set-field"; field: "pluginDir" | "targetDir"; value: string }
    | { command: "append-log"; logType: LogEntryType; text: string }
    | { command: "sync-state"; overlayVisible: boolean; hasDocs: boolean };

/**
 * Sidebar WebviewViewProvider for the "Docs Overlay" panel.
 * Stateless presentation layer: all state is owned by DocOverlayManager and
 * supplied via getState. Field changes are reported back via onFieldUpdate.
 */
export class DocOverlayPanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    /**
     * @param extensionUri Root URI of the extension (for CSP).
     * @param onGenerate Called when the user clicks "Generate Docs".
     * @param onFieldUpdate Called whenever a single field value changes (browse or generate).
     * @param getState Returns current state from the manager to render on (re)open.
     * @param workspaceRoot Absolute workspace root used as the default browse directory.
     */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly onGenerate: (skillName: string, pluginDir: string, targetDir: string) => void,
        private readonly onFieldUpdate: (field: "claudeBinaryPath" | "skillName" | "pluginDir" | "targetDir", value: string) => void,
        private readonly getState: () => PanelState,
        private readonly workspaceRoot: string,
    ) {}

    /** Called by VS Code when the view becomes visible for the first time or after disposal. */
    public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void {
        this._view = webviewView;
        webviewView.onDidDispose(() => {
            this._view = undefined;
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        // Rebuild HTML with current state whenever the panel becomes visible.
        // VS Code retains the webview when collapsed (resolveWebviewView is not re-called),
        // so onDidChangeVisibility is the only reliable hook for syncing retained views.
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                webviewView.webview.html = this._buildHtml();
            }
        });

        // Full history is baked into the HTML so it's visible immediately on first open.
        webviewView.webview.html = this._buildHtml();
        webviewView.webview.onDidReceiveMessage((msg: WebviewToExtMsg) => this._handleMessage(msg));
    }

    /**
     * Forwards a log entry to the live webview. Storage is the manager's responsibility.
     * @param text Message text (may contain newlines).
     * @param type Visual style: "assistant" (LLM output), "info" (progress), or "error".
     */
    public appendLog(text: string, type: LogEntryType = "info"): void {
        this._post({ command: "append-log", logType: type, text });
    }

    /**
     * Pushes overlay visibility and docs availability to the live webview so
     * button colours and disabled state stay in sync without a full HTML rebuild.
     * @param overlayVisible Whether the doc overlay is currently shown.
     * @param hasDocs Whether any doc entries exist.
     */
    public syncState(overlayVisible: boolean, hasDocs: boolean): void {
        this._post({ command: "sync-state", overlayVisible, hasDocs });
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private _post(msg: ExtToWebviewMsg): void {
        this._view?.webview.postMessage(msg);
    }

    private async _handleMessage(msg: WebviewToExtMsg): Promise<void> {
        if (msg.command === "browse") {
            const defaultUri = this.workspaceRoot ? vscode.Uri.file(this.workspaceRoot) : undefined;

            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri,
                title: msg.field === "pluginDir" ? "Select plugin directory" : "Select target directory",
            });

            const chosen = uris?.[0]?.fsPath;
            if (chosen) {
                this.onFieldUpdate(msg.field, chosen);
                this._post({ command: "set-field", field: msg.field, value: chosen });
            }
            return;
        }

        if (msg.command === "generate") {
            this.onFieldUpdate("claudeBinaryPath", msg.claudeBinaryPath);
            this.onFieldUpdate("skillName", msg.skillName);
            this.onFieldUpdate("pluginDir", msg.pluginDir);
            this.onFieldUpdate("targetDir", msg.targetDir);
            this.onGenerate(msg.skillName, msg.pluginDir, msg.targetDir);
            return;
        }

        if (msg.command === "toggle-overlay") {
            void vscode.commands.executeCommand("weAudit.toggleDocOverlay");
            return;
        }

        if (msg.command === "clear-docs") {
            const answer = await vscode.window.showWarningMessage(
                "Clear all generated docs? This will delete all overlay entries and cannot be undone.",
                { modal: true },
                "Clear",
            );
            if (answer === "Clear") {
                void vscode.commands.executeCommand("weAudit.clearDocOverlay");
            }
        }
    }

    private _buildHtml(): string {
        const state = this.getState();
        const nonce = crypto.randomBytes(16).toString("base64");
        const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join("; ");

        const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

        // Bake the full log history into the initial HTML so it's visible immediately on reopen.
        const logHtml = state.log.map((e) => `<div class="log-entry log-${e.type}">${esc(e.text)}</div>`).join("");

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Docs Overlay</title>
  <style>
    body {
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    label {
      display: block;
      margin-top: 10px;
      margin-bottom: 2px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
    }
    .row {
      display: flex;
      gap: 4px;
    }
    input[type="text"] {
      flex: 1;
      min-width: 0;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 3px 6px;
      font-family: inherit;
      font-size: inherit;
      outline: none;
    }
    input[type="text"]:focus {
      border-color: var(--vscode-focusBorder);
    }
    button {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none;
      padding: 6px 8px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      box-sizing: border-box;
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    #generate {
      display: block;
      width: 100%;
      margin-top: 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #generate:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .actions button {
      flex: 1;
    }
    #toggle-overlay.overlay-visible:not(:disabled) {
      background: #1a9c7a;
      color: #ffffff;
    }
    #toggle-overlay.overlay-visible:not(:disabled):hover {
      background: #1db88f;
    }
    #toggle-overlay.overlay-hidden:not(:disabled) {
      background: #4a5057;
      color: #9a9da2;
    }
    #toggle-overlay.overlay-hidden:not(:disabled):hover {
      background: #565c64;
    }
    #clear-docs:not(:disabled) {
      background: #a42b1c;
      color: #ffffff;
    }
    #clear-docs:not(:disabled):hover {
      background: #c0321f;
    }
    #clear-docs:disabled:hover,
    #toggle-overlay:disabled:hover {
      background: #4a5057;
    }
    #clear-docs:disabled,
    #toggle-overlay:disabled {
      background: #4a5057;
      color: #9a9da2;
      cursor: not-allowed;
    }
    #log {
      margin-top: 12px;
      max-height: 340px;
      overflow-y: auto;
      border: 1px solid var(--vscode-widget-border, transparent);
      background: var(--vscode-editor-background);
      padding: 6px 8px;
      box-sizing: border-box;
    }
    #log:empty {
      display: none;
    }
    .log-entry {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 11px;
      line-height: 1.5;
      padding: 3px 0;
      border-bottom: 1px solid var(--vscode-widget-border, transparent);
    }
    .log-entry:last-child {
      border-bottom: none;
    }
    .log-info {
      color: var(--vscode-descriptionForeground);
    }
    .log-assistant {
      color: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .log-error {
      color: var(--vscode-errorForeground, #f44);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <label for="claudeBinaryPath">Claude Binary</label>
  <div class="row">
    <input id="claudeBinaryPath" type="text" placeholder="/path/to/claude" value="${esc(state.claudeBinaryPath)}">
  </div>

  <label for="skillName">Skill Name</label>
  <div class="row">
    <input id="skillName" type="text" placeholder="my-skill" value="${esc(state.skillName)}">
  </div>

  <label for="pluginDir">Plugin Directory</label>
  <div class="row">
    <input id="pluginDir" type="text" placeholder="/path/to/plugin" value="${esc(state.pluginDir)}">
    <button data-field="pluginDir">…</button>
  </div>

  <label for="targetDir">Target Directory</label>
  <div class="row">
    <input id="targetDir" type="text" placeholder="/path/to/target" value="${esc(state.targetDir)}">
    <button data-field="targetDir">…</button>
  </div>

  <button id="generate">Generate Docs</button>
  <div class="actions">
    <button id="toggle-overlay" class="${state.overlayVisible ? "overlay-visible" : "overlay-hidden"}" ${state.hasDocs ? "" : "disabled"}>Toggle Overlay</button>
    <button id="clear-docs" ${state.hasDocs ? "" : "disabled"}>Clear Docs</button>
  </div>
  <div id="log">${logHtml}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');

    function appendEntry(type, text) {
      const el = document.createElement('div');
      el.className = 'log-entry log-' + type;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    }

    // Scroll to bottom on initial load so the latest entry is visible.
    log.scrollTop = log.scrollHeight;

    document.querySelectorAll('button[data-field]').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: 'browse', field: btn.dataset.field });
      });
    });

    document.getElementById('generate').addEventListener('click', () => {
      vscode.postMessage({
        command: 'generate',
        claudeBinaryPath: document.getElementById('claudeBinaryPath').value.trim(),
        pluginDir: document.getElementById('pluginDir').value.trim(),
        skillName: document.getElementById('skillName').value.trim(),
        targetDir: document.getElementById('targetDir').value.trim(),
      });
    });

    document.getElementById('toggle-overlay').addEventListener('click', () => {
      vscode.postMessage({ command: 'toggle-overlay' });
    });

    document.getElementById('clear-docs').addEventListener('click', () => {
      vscode.postMessage({ command: 'clear-docs' });
    });

    window.addEventListener('message', ({ data }) => {
      if (data.command === 'set-field') {
        document.getElementById(data.field).value = data.value;
      } else if (data.command === 'append-log') {
        appendEntry(data.logType, data.text);
      } else if (data.command === 'sync-state') {
        const toggleBtn = document.getElementById('toggle-overlay');
        toggleBtn.className = data.overlayVisible ? 'overlay-visible' : 'overlay-hidden';
        toggleBtn.disabled = !data.hasDocs;
        const clearBtn = document.getElementById('clear-docs');
        clearBtn.disabled = !data.hasDocs;
      }
    });
  </script>
</body>
</html>`;
    }
}
