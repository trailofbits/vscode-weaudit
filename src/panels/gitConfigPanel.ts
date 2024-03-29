import * as vscode from "vscode";
import * as crypto from "crypto";

import { getUri } from "../utilities/getUri";
import { WebviewMessage, UpdateRepositoryMessage } from "../webview/webviewMessageTypes";

export function activateGitConfigWebview(context: vscode.ExtensionContext) {
    const provider = new GitConfigProvider(context.extensionUri);

    context.subscriptions.push(vscode.window.registerWebviewViewProvider(GitConfigProvider.viewType, provider));
}

class GitConfigProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "gitConfig";
    private _disposables: vscode.Disposable[] = [];

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this._setWebviewMessageListener(this._view.webview);

        vscode.commands.registerCommand("weAudit.setGitConfigView", (clientRepo: string, auditRepo: string, commitHash: string) => {
            const msg: UpdateRepositoryMessage = {
                command: "update-repository-config",
                clientURL: clientRepo,
                auditURL: auditRepo,
                commitHash,
            };
            this._view?.webview.postMessage(msg);
        });

        // the webview does not save the context so we
        // need to re-push the data when the webview is hidden and then shown again
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                vscode.commands.executeCommand("weAudit.pushGitConfigView");
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const styleUri = getUri(webview, this._extensionUri, ["media", "style.css"]);
        const webviewUri = getUri(webview, this._extensionUri, ["out", "gitConfigWebview.js"]);

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const htmlBody = require("./gitConfig.html");

        return /*html*/ `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
              <link rel="stylesheet" href="${styleUri}">
              <title>Component Gallery</title>
            </head>
            <body>
              <section class="component-row">
                ${htmlBody}
              </section>
              <script type="module" nonce="${nonce}" src="${webviewUri}"></script>
            </body>
          </html>
        `;
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                const command = message.command;

                switch (command) {
                    case "update-repository-config":
                        vscode.commands.executeCommand("weAudit.updateGitConfig", message.clientURL, message.auditURL, message.commitHash);
                        return;
                    case "webview-ready":
                        vscode.commands.executeCommand("weAudit.pushGitConfigView");
                        return;
                }
            },
            undefined,
            this._disposables,
        );
    }
}

function getNonce() {
    return crypto.randomBytes(16).toString("base64");
}
