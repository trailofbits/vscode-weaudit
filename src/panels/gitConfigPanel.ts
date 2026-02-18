import * as vscode from "vscode";
import * as crypto from "crypto";

import { getUri } from "../utilities/getUri";
import { WebviewMessage, UpdateRepositoryMessage, SetWorkspaceRootsMessage } from "../webview/webviewMessageTypes";
import { RootPathAndLabel } from "../types";
import htmlBody from "./gitConfig.html";

/**
 * Registers the Git Config webview view provider and its associated navigation commands.
 * @param context The extension context for managing subscriptions.
 */
export function activateGitConfigWebview(context: vscode.ExtensionContext): void {
    const provider = new GitConfigProvider(context.extensionUri);

    context.subscriptions.push(vscode.window.registerWebviewViewProvider(GitConfigProvider.viewType, provider));
}

/**
 * Webview provider for the Git Config sidebar panel, which displays
 * and edits client/audit repository URLs and commit hashes per workspace root.
 */
class GitConfigProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "gitConfig";
    private _disposables: vscode.Disposable[] = [];
    private currentRootPathAndLabel: RootPathAndLabel;
    private dirToPathMap: Map<string, string>;

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.currentRootPathAndLabel = { rootPath: "", rootLabel: "" } as RootPathAndLabel;
        this.dirToPathMap = new Map<string, string>();

        vscode.commands.registerCommand(
            "weAudit.setGitConfigView",
            (rootPathAndLabel: RootPathAndLabel, clientRepo: string, auditRepo: string, commitHash: string) => {
                this.currentRootPathAndLabel = rootPathAndLabel;
                const msg: UpdateRepositoryMessage = {
                    command: "update-repository-config",
                    rootLabel: rootPathAndLabel.rootLabel,
                    clientURL: clientRepo,
                    auditURL: auditRepo,
                    commitHash,
                };
                this._view?.webview.postMessage(msg);
            },
        );

        vscode.commands.registerCommand("weAudit.setGitConfigRoots", (rootPathsAndLabels: RootPathAndLabel[]) => {
            const idx = rootPathsAndLabels.findIndex((rootPathAndLabel) => {
                return (
                    rootPathAndLabel.rootPath === this.currentRootPathAndLabel.rootPath && rootPathAndLabel.rootLabel === this.currentRootPathAndLabel.rootLabel
                );
            });

            if (idx === -1) {
                if (rootPathsAndLabels.length > 0) {
                    this.currentRootPathAndLabel = rootPathsAndLabels[0];
                }
            }
            this.dirToPathMap.clear();
            for (const rootPathAndLabel of rootPathsAndLabels) {
                this.dirToPathMap.set(rootPathAndLabel.rootLabel, rootPathAndLabel.rootPath);
            }

            const msg: SetWorkspaceRootsMessage = {
                command: "set-workspace-roots",
                rootLabels: rootPathsAndLabels.map((rootPathAndLabel) => rootPathAndLabel.rootLabel),
            };
            this._view?.webview.postMessage(msg);
        });

        vscode.commands.registerCommand("weAudit.nextGitConfig", async () => {
            const nextRootPath = await vscode.commands.executeCommand("weAudit.nextRoot", this.currentRootPathAndLabel.rootPath, true);
            vscode.commands.executeCommand("weAudit.pushGitConfigView", nextRootPath);
        });

        vscode.commands.registerCommand("weAudit.prevGitConfig", async () => {
            const prevRootPath = await vscode.commands.executeCommand("weAudit.nextRoot", this.currentRootPathAndLabel.rootPath, false);
            vscode.commands.executeCommand("weAudit.pushGitConfigView", prevRootPath);
        });

        vscode.commands.registerCommand("weAudit.setupRepositoriesCurrent", () => {
            vscode.commands.executeCommand("weAudit.setupRepositoriesOne", this.currentRootPathAndLabel.rootPath);
        });
    }

    /** Initializes the webview with HTML, scripts, and message listeners when the view becomes visible. */
    public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this._setWebviewMessageListener(this._view.webview);

        // the webview does not save the context so we
        // need to re-push the data when the webview is hidden and then shown again
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                vscode.commands.executeCommand("weAudit.getGitConfigRoots");
                vscode.commands.executeCommand("weAudit.pushGitConfigView", this.currentRootPathAndLabel.rootPath);
            }
        });
    }

    /** Generates the HTML content for the Git Config webview, including CSP and script references. */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const styleUri = getUri(webview, this._extensionUri, ["media", "style.css"]);
        const webviewUri = getUri(webview, this._extensionUri, ["out", "gitConfigWebview.js"]);

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return /*html*/ `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">
              <link rel="stylesheet" href="${styleUri.toString()}">
              <title>Component Gallery</title>
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

    /** Listens for messages from the webview and dispatches them to the appropriate extension commands. */
    private _setWebviewMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                const command = message.command;
                let rootPath;
                switch (command) {
                    case "update-repository-config":
                        rootPath = this.dirToPathMap.get(message.rootLabel);
                        if (rootPath === undefined) {
                            vscode.window.showErrorMessage(
                                `weAudit: Error updating repository config. Directory: ${message.rootLabel} is not a workspace root.`,
                            );
                            return;
                        }
                        vscode.commands.executeCommand("weAudit.updateGitConfig", rootPath, message.clientURL, message.auditURL, message.commitHash);
                        return;
                    case "choose-workspace-root":
                        rootPath = this.dirToPathMap.get(message.rootLabel);
                        if (rootPath === undefined) {
                            vscode.window.showErrorMessage(`weAudit: Error choosing workspace root. Directory: ${message.rootLabel} is not a workspace root.`);
                            return;
                        }
                        vscode.commands.executeCommand("weAudit.pushGitConfigView", rootPath);
                        return;
                    case "webview-ready":
                        vscode.commands.executeCommand("weAudit.getGitConfigRoots");
                        vscode.commands.executeCommand(
                            "weAudit.pushGitConfigView",
                            this.currentRootPathAndLabel.rootPath ? this.currentRootPathAndLabel.rootPath : null,
                        );
                        return;
                }
            },
            undefined,
            this._disposables,
        );
    }
}

/** Generates a cryptographic nonce for the webview Content Security Policy. */
function getNonce(): string {
    return crypto.randomBytes(16).toString("base64");
}
