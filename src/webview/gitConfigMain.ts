import { provideVSCodeDesignSystem, vsCodeTextField, vsCodeDropdown, vsCodeOption, Dropdown } from "@vscode/webview-ui-toolkit";
import { TextField } from "@vscode/webview-ui-toolkit";
import { WebviewIsReadyMessage, UpdateRepositoryMessage, ChooseWorkspaceRootMessage } from "./webviewMessageTypes";

// In order to use all the Webview UI Toolkit web components they
// must be registered with the browser (i.e. webview) using the
// syntax below.
provideVSCodeDesignSystem().register(vsCodeTextField(), vsCodeDropdown(), vsCodeOption());

const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener("load", main);

function main() {
    const rootDropdown = document.getElementById("workspace-root-list-dropdown") as Dropdown;
    rootDropdown?.addEventListener("change", handleDropdownChange);

    const clientURL = document.getElementById("client-url") as TextField;
    clientURL?.addEventListener("change", handleFieldChange);

    const auditURL = document.getElementById("audit-url") as TextField;
    auditURL?.addEventListener("change", handleFieldChange);

    const commitHash = document.getElementById("commit-hash") as TextField;
    commitHash?.addEventListener("change", handleFieldChange);

    // handle the message inside the webview
    window.addEventListener("message", (event) => {
        const message = event.data;
        let rootList;

        switch (message.command) {
            case "update-repository-config":
                rootDropdown.value = message.rootDir;
                clientURL.value = message.clientURL;
                auditURL.value = message.auditURL;
                commitHash.value = message.commitHash;
                break;

            case "set-workspace-roots":
                rootList = document.getElementById("workspace-root-list-dropdown");
                if (rootList === null) {
                    break;
                }
                // clear the list
                rootList.textContent = "";
                for (let i = 0; i < message.rootDirs.length; i++) {
                    const option = document.createElement("vscode-option");
                    option.innerText = message.rootDirs[i];
                    rootList.appendChild(option);
                }
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
    const rootDropdown = document.getElementById("workspace-root-list-dropdown") as Dropdown;

    const message: UpdateRepositoryMessage = {
        command: "update-repository-config",
        rootDir: rootDropdown.currentValue,
        clientURL: clientURL.value,
        auditURL: auditURL.value,
        commitHash: commitHash.value,
    };
    vscode.postMessage(message);
}

function handleDropdownChange(_e: Event): void {
    const rootDropdown = document.getElementById("workspace-root-list-dropdown") as Dropdown;

    const message: ChooseWorkspaceRootMessage = {
        command: "choose-workspace-root",
        rootDir: rootDropdown.value,
    };
    vscode.postMessage(message);
}
