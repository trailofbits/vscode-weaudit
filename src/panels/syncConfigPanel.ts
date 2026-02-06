import * as vscode from "vscode";
import * as crypto from "crypto";

import { getUri } from "../utilities/getUri";
import { WebviewMessage, UpdateSyncConfigMessage, SetSyncConfigMessage } from "../webview/webviewMessageTypes";
import htmlBody from "./syncConfig.html";

const DEFAULT_BRANCH_NAME = "weaudit-sync";
const DEFAULT_REMOTE_NAME = "origin";
const DEFAULT_POLL_MINUTES = 1;
const DEFAULT_DEBOUNCE_MS = 1000;
const DEFAULT_SYNC_MODE = "central-repo";
const DEFAULT_CENTRAL_BRANCH = "weaudit-sync";

/**
 * Register the sync configuration webview view.
 */
export function activateSyncConfigWebview(context: vscode.ExtensionContext): void {
    const provider = new SyncConfigProvider(context.extensionUri, context.workspaceState);

    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SyncConfigProvider.viewType, provider));
}

/**
 * Webview provider for configuring git auto sync settings.
 */
class SyncConfigProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "syncConfig";
    private _disposables: vscode.Disposable[] = [];
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _workspaceState: vscode.Memento,
    ) {
        vscode.workspace.onDidChangeConfiguration(
            (event) => {
                if (event.affectsConfiguration("weAudit.sync")) {
                    this.pushCurrentConfig();
                }
            },
            undefined,
            this._disposables,
        );

        this._disposables.push(
            vscode.commands.registerCommand("weAudit.refreshSyncConfigStatus", () => {
                this.pushCurrentConfig();
            }),
        );
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this._setWebviewMessageListener(webviewView.webview);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.pushCurrentConfig();
            }
        });
    }

    /**
     * Send the current sync configuration to the webview.
     */
    private pushCurrentConfig(): void {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration("weAudit");
        const lastSuccessAt = this._workspaceState.get<string>("weAudit.sync.lastSuccessAt");
        const centralRepoUrl = readGlobalSetting(config, "sync.centralRepoUrl", "");
        const mode = config.get<"repo-branch" | "central-repo">("sync.mode", DEFAULT_SYNC_MODE);
        const message: SetSyncConfigMessage = {
            command: "set-sync-config",
            enabled: config.get<boolean>("sync.enabled", false),
            mode,
            remoteName: config.get<string>("sync.remoteName", DEFAULT_REMOTE_NAME),
            branchName: config.get<string>("sync.branchName", DEFAULT_BRANCH_NAME),
            pollMinutes: config.get<number>("sync.pollMinutes", DEFAULT_POLL_MINUTES),
            debounceMs: config.get<number>("sync.debounceMs", DEFAULT_DEBOUNCE_MS),
            centralRepoUrl: centralRepoUrl,
            centralBranch: readGlobalSetting(config, "sync.centralBranch", DEFAULT_CENTRAL_BRANCH),
            repoKeyOverride: readGlobalSetting(config, "sync.repoKeyOverride", ""),
            lastSuccessAt,
        };
        this._view.webview.postMessage(message);
    }

    /**
     * Build HTML for the sync configuration webview.
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = getUri(webview, this._extensionUri, ["media", "style.css"]);
        const webviewUri = getUri(webview, this._extensionUri, ["out", "syncConfigWebview.js"]);
        const nonce = getNonce();

        return /*html*/ `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">
              <link rel="stylesheet" href="${styleUri.toString()}">
              <title>Sync Configuration</title>
            </head>
            <body>
              <section class="component-row">
                ${htmlBody}
              </section>
              <script type="module" nonce="${nonce}" src="${webviewUri.toString()}"></script>
            </body>
          </html>
        `;
    }

    /**
     * Handle messages coming from the sync configuration webview.
     */
    private _setWebviewMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                switch (message.command) {
                    case "update-sync-config":
                        void this.updateSyncConfig(message);
                        return;
                    case "sync-now":
                        vscode.commands.executeCommand("weAudit.syncNow");
                        return;
                    case "webview-ready":
                        this.pushCurrentConfig();
                        return;
                }
            },
            undefined,
            this._disposables,
        );
    }

    /**
     * Update the workspace sync configuration based on webview input.
     */
    private async updateSyncConfig(message: UpdateSyncConfigMessage): Promise<void> {
        const config = vscode.workspace.getConfiguration("weAudit");
        const mode = message.mode === "repo-branch" ? "repo-branch" : DEFAULT_SYNC_MODE;
        const isCentral = mode === "central-repo";
        const pollMinutes = normalizeNumber(message.pollMinutes, DEFAULT_POLL_MINUTES, 1);
        const debounceMs = normalizeNumber(message.debounceMs, DEFAULT_DEBOUNCE_MS, 0);
        const currentCentralRepoUrl = readGlobalSetting(config, "sync.centralRepoUrl", "");
        const currentCentralBranch = readGlobalSetting(config, "sync.centralBranch", DEFAULT_CENTRAL_BRANCH);
        const currentRepoKeyOverride = readGlobalSetting(config, "sync.repoKeyOverride", "");
        const shouldUpdateCentralRepo = isCentral || message.centralRepoUrl.trim().length > 0 || currentCentralRepoUrl.trim().length === 0;
        const shouldUpdateCentralBranch = isCentral || message.centralBranch.trim().length > 0 || currentCentralBranch.trim().length === 0;
        const shouldUpdateRepoKeyOverride = isCentral || message.repoKeyOverride.trim().length > 0 || currentRepoKeyOverride.trim().length === 0;

        await config.update("sync.mode", mode, vscode.ConfigurationTarget.Workspace);

        const target = isCentral ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
        await config.update("sync.enabled", message.enabled, target);
        await config.update("sync.pollMinutes", pollMinutes, target);
        await config.update("sync.debounceMs", debounceMs, target);

        if (shouldUpdateCentralRepo) {
            await config.update("sync.centralRepoUrl", message.centralRepoUrl, vscode.ConfigurationTarget.Global);
        }
        if (shouldUpdateCentralBranch) {
            await config.update("sync.centralBranch", message.centralBranch || DEFAULT_CENTRAL_BRANCH, vscode.ConfigurationTarget.Global);
        }
        if (shouldUpdateRepoKeyOverride) {
            await config.update("sync.repoKeyOverride", message.repoKeyOverride || "", vscode.ConfigurationTarget.Global);
        }

        if (!isCentral) {
            await config.update("sync.remoteName", message.remoteName || DEFAULT_REMOTE_NAME, vscode.ConfigurationTarget.Workspace);
            await config.update("sync.branchName", message.branchName || DEFAULT_BRANCH_NAME, vscode.ConfigurationTarget.Workspace);
        }
    }
}

/**
 * Clamp numeric settings and fall back to defaults for invalid input.
 */
function normalizeNumber(value: number, fallback: number, minValue: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(minValue, Math.floor(value));
}

/**
 * Read a global setting and ignore workspace overrides.
 */
function readGlobalSetting<T>(config: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
    const inspected = config.inspect<T>(key);
    if (!inspected) {
        return fallback;
    }
    if (inspected.globalValue !== undefined) {
        return inspected.globalValue as T;
    }
    return fallback;
}

/**
 * Generate a nonce for the webview Content Security Policy.
 */
function getNonce(): string {
    return crypto.randomBytes(16).toString("base64");
}
