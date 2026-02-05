import { provideVSCodeDesignSystem, vsCodeTextField, vsCodeCheckbox, vsCodeButton } from "@vscode/webview-ui-toolkit";
import { TextField } from "@vscode/webview-ui-toolkit";
import { WebviewIsReadyMessage, UpdateSyncConfigMessage, SyncNowMessage, SetSyncConfigMessage } from "./webviewMessageTypes";

// Register the webview UI toolkit components for use in this webview.
provideVSCodeDesignSystem().register(vsCodeTextField(), vsCodeCheckbox(), vsCodeButton());

const vscode = acquireVsCodeApi();

// Wait for DOM content before wiring up the form.
window.addEventListener("load", main);

/**
 * Wire up the sync configuration inputs and post initial ready signal.
 */
function main(): void {
    const enabledCheckbox = document.getElementById("sync-enabled") as HTMLInputElement;
    const remoteField = document.getElementById("sync-remote") as TextField;
    const branchField = document.getElementById("sync-branch") as TextField;
    const pollField = document.getElementById("sync-poll") as TextField;
    const debounceField = document.getElementById("sync-debounce") as TextField;
    const lastSuccessValue = document.getElementById("sync-last-success") as HTMLSpanElement;
    const syncNowButton = document.getElementById("sync-now") as HTMLButtonElement;

    enabledCheckbox?.addEventListener("change", handleConfigChange);
    remoteField?.addEventListener("change", handleConfigChange);
    branchField?.addEventListener("change", handleConfigChange);
    pollField?.addEventListener("change", handleConfigChange);
    debounceField?.addEventListener("change", handleConfigChange);
    syncNowButton?.addEventListener("click", handleSyncNow);

    window.addEventListener("message", (event) => {
        const message = event.data as SetSyncConfigMessage;
        if (message.command !== "set-sync-config") {
            return;
        }

        enabledCheckbox.checked = message.enabled;
        remoteField.value = message.remoteName;
        branchField.value = message.branchName;
        pollField.value = message.pollMinutes.toString();
        debounceField.value = message.debounceMs.toString();
        lastSuccessValue.textContent = formatLastSuccess(message.lastSuccessAt);
    });

    const webviewIsReadyMessage: WebviewIsReadyMessage = {
        command: "webview-ready",
    };
    vscode.postMessage(webviewIsReadyMessage);
}

/**
 * Post updated sync configuration values to the extension host.
 */
function handleConfigChange(): void {
    const enabledCheckbox = document.getElementById("sync-enabled") as HTMLInputElement;
    const remoteField = document.getElementById("sync-remote") as TextField;
    const branchField = document.getElementById("sync-branch") as TextField;
    const pollField = document.getElementById("sync-poll") as TextField;
    const debounceField = document.getElementById("sync-debounce") as TextField;

    const message: UpdateSyncConfigMessage = {
        command: "update-sync-config",
        enabled: enabledCheckbox.checked,
        remoteName: remoteField.value,
        branchName: branchField.value,
        pollMinutes: Number.parseInt(pollField.value, 10),
        debounceMs: Number.parseInt(debounceField.value, 10),
    };
    vscode.postMessage(message);
}

/**
 * Request an immediate sync from the extension host.
 */
function handleSyncNow(): void {
    const message: SyncNowMessage = {
        command: "sync-now",
    };
    vscode.postMessage(message);
}

/**
 * Format the last successful sync timestamp for display.
 */
function formatLastSuccess(lastSuccessAt?: string): string {
    if (!lastSuccessAt) {
        return "Never";
    }
    const parsed = new Date(lastSuccessAt);
    if (Number.isNaN(parsed.getTime())) {
        return "Unknown";
    }
    return parsed.toLocaleString();
}
