import { provideVSCodeDesignSystem, vsCodeTextField } from "@vscode/webview-ui-toolkit";
import { TextField } from "@vscode/webview-ui-toolkit";
import { WebviewIsReadyMessage, UpdateRepositoryMessage } from "./webviewMessageTypes";

// In order to use all the Webview UI Toolkit web components they
// must be registered with the browser (i.e. webview) using the
// syntax below.
provideVSCodeDesignSystem().register(vsCodeTextField());

const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener("load", main);

function main() {
    const clientURL = document.getElementById("client-url") as TextField;
    clientURL?.addEventListener("change", handleFieldChange);

    const auditURL = document.getElementById("audit-url") as TextField;
    auditURL?.addEventListener("change", handleFieldChange);

    const commitHash = document.getElementById("commit-hash") as TextField;
    commitHash?.addEventListener("change", handleFieldChange);

    // handle the message inside the webview
    window.addEventListener("message", (event) => {
        const message = event.data;

        switch (message.command) {
            case "update-repository-config":
                clientURL.value = message.clientURL;
                auditURL.value = message.auditURL;
                commitHash.value = message.commitHash;
                break;
        }
    });

    const webviewIsReadyMessage: WebviewIsReadyMessage = {
        command: "webview-ready",
    };
    vscode.postMessage(webviewIsReadyMessage);
}

function handleFieldChange(_e: Event): void {
    const clientURL = document.getElementById("client-url") as TextField;
    const auditURL = document.getElementById("audit-url") as TextField;
    const commitHash = document.getElementById("commit-hash") as TextField;

    const message: UpdateRepositoryMessage = {
        command: "update-repository-config",
        clientURL: clientURL.value,
        auditURL: auditURL.value,
        commitHash: commitHash.value,
    };
    vscode.postMessage(message);
}
