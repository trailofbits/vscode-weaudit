import * as vscode from "vscode";
import * as crypto from "crypto";

import { getUri } from "../utilities/getUri";
import { EntryDetails } from "../types";
import { WebviewMessage } from "../webview/webviewMessageTypes";
import htmlBody from "./findingDetails.html";

export function activateFindingDetailsWebview(context: vscode.ExtensionContext): void {
    const provider = new FindingDetailsProvider(context.extensionUri);

    // Register the provider
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(FindingDetailsProvider.viewType, provider));

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("weAudit.setWebviewFindingDetails", (entry: EntryDetails, title: string) => {
            provider.setFindingDetails(entry, title);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("weAudit.hideFindingDetails", () => {
            provider.hideFindingDetails();
        }),
    );
}

class FindingDetailsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "findingDetails";
    private _disposables: vscode.Disposable[] = [];

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this._setWebviewMessageListener(this._view.webview);

        // Register for visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Refresh the webview HTML to ensure resources are loaded correctly
                vscode.commands.executeCommand("weAudit.showSelectedEntryInFindingDetails");
            }
        });
    }

    /**
     * Set finding details in the webview
     */
    public setFindingDetails(entry: EntryDetails, title: string): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: "set-finding-details",
                severity: entry.severity,
                difficulty: entry.difficulty,
                type: entry.type,
                description: entry.description,
                exploit: entry.exploit,
                recommendation: entry.recommendation,
                title: title,
            });

            // Set context to show the "Open Remote Issue" button in the view title
            // https://code.visualstudio.com/api/references/when-clause-contexts#add-a-custom-when-clause-context
            vscode.commands.executeCommand("setContext", "weAudit.findingDetailsHasEntry", true);
        }
    }

    /**
     * Hide finding details in the webview
     */
    public hideFindingDetails(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: "hide-finding-details",
            });

            // Set context to show the "Open Remote Issue" button in the view title
            // https://code.visualstudio.com/api/references/when-clause-contexts#add-a-custom-when-clause-context
            vscode.commands.executeCommand("setContext", "weAudit.findingDetailsHasEntry", false);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const styleUri = getUri(webview, this._extensionUri, ["media", "style.css"]);
        const webviewUri = getUri(webview, this._extensionUri, ["out", "findingDetailsWebview.js"]);

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
              <title>Finding Details</title>
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

    private _setWebviewMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                const command = message.command;

                switch (command) {
                    case "update-entry":
                        vscode.commands.executeCommand("weAudit.updateCurrentSelectedEntry", message.field, message.value, message.isPersistent);
                        return;
                    case "webview-ready":
                        // When the webview reports it's ready, update with current data
                        vscode.commands.executeCommand("weAudit.showSelectedEntryInFindingDetails");
                        return;
                }
            },
            undefined,
            this._disposables,
        );
    }
}

function getNonce(): string {
    return crypto.randomBytes(16).toString("base64");
}
