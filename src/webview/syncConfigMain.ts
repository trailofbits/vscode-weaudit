import { provideVSCodeDesignSystem, vsCodeTextField, vsCodeCheckbox, vsCodeButton, vsCodeDropdown, vsCodeOption, Dropdown } from "@vscode/webview-ui-toolkit";
import { TextField } from "@vscode/webview-ui-toolkit";
import { WebviewIsReadyMessage, UpdateSyncConfigMessage, SyncNowMessage, SetSyncConfigMessage } from "./webviewMessageTypes";

// Register the webview UI toolkit components for use in this webview.
provideVSCodeDesignSystem().register(vsCodeTextField(), vsCodeCheckbox(), vsCodeButton(), vsCodeDropdown(), vsCodeOption());

const vscode = acquireVsCodeApi();
let hasLoadedConfig = false;

// Wait for DOM content before wiring up the form.
window.addEventListener("load", main);

/**
 * Wire up the sync configuration inputs and post initial ready signal.
 */
function main(): void {
    const enabledCheckbox = document.getElementById("sync-enabled") as HTMLInputElement;
    const modeDropdown = document.getElementById("sync-mode") as Dropdown;
    const remoteField = document.getElementById("sync-remote") as TextField;
    const branchField = document.getElementById("sync-branch") as TextField;
    const pollField = document.getElementById("sync-poll") as TextField;
    const debounceField = document.getElementById("sync-debounce") as TextField;
    const centralRepoUrlField = document.getElementById("sync-central-url") as TextField;
    const centralBranchField = document.getElementById("sync-central-branch") as TextField;
    const repoKeyOverrideField = document.getElementById("sync-repo-key-override") as TextField;
    const lastSuccessValue = document.getElementById("sync-last-success") as HTMLSpanElement;
    const syncNowButton = document.getElementById("sync-now") as HTMLButtonElement;

    enabledCheckbox?.addEventListener("change", handleConfigChange);
    modeDropdown?.addEventListener("change", handleConfigChange);
    remoteField?.addEventListener("change", handleConfigChange);
    branchField?.addEventListener("change", handleConfigChange);
    pollField?.addEventListener("change", handleConfigChange);
    debounceField?.addEventListener("change", handleConfigChange);
    centralRepoUrlField?.addEventListener("change", handleConfigChange);
    centralBranchField?.addEventListener("change", handleConfigChange);
    repoKeyOverrideField?.addEventListener("change", handleConfigChange);
    syncNowButton?.addEventListener("click", handleSyncNow);

    window.addEventListener("message", (event) => {
        if (event.origin !== window.origin) {
            return;
        }
        const message = event.data as SetSyncConfigMessage;
        if (message.command !== "set-sync-config") {
            return;
        }

        enabledCheckbox.checked = message.enabled;
        modeDropdown.value = message.mode;
        remoteField.value = message.remoteName;
        branchField.value = message.branchName;
        pollField.value = message.pollMinutes.toString();
        debounceField.value = message.debounceMs.toString();
        centralRepoUrlField.value = message.centralRepoUrl;
        centralBranchField.value = message.centralBranch;
        repoKeyOverrideField.value = message.repoKeyOverride;
        lastSuccessValue.textContent = formatLastSuccess(message.lastSuccessAt);
        updateModeVisibility(message.mode);
        hasLoadedConfig = true;
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
    const modeDropdown = document.getElementById("sync-mode") as Dropdown;
    const remoteField = document.getElementById("sync-remote") as TextField;
    const branchField = document.getElementById("sync-branch") as TextField;
    const pollField = document.getElementById("sync-poll") as TextField;
    const debounceField = document.getElementById("sync-debounce") as TextField;
    const centralRepoUrlField = document.getElementById("sync-central-url") as TextField;
    const centralBranchField = document.getElementById("sync-central-branch") as TextField;
    const repoKeyOverrideField = document.getElementById("sync-repo-key-override") as TextField;
    updateModeVisibility(modeDropdown.value as "repo-branch" | "central-repo");
    if (!hasLoadedConfig) {
        return;
    }

    const message: UpdateSyncConfigMessage = {
        command: "update-sync-config",
        enabled: enabledCheckbox.checked,
        mode: modeDropdown.value as "repo-branch" | "central-repo",
        remoteName: remoteField.value,
        branchName: branchField.value,
        pollMinutes: Number.parseInt(pollField.value, 10),
        debounceMs: Number.parseInt(debounceField.value, 10),
        centralRepoUrl: centralRepoUrlField.value,
        centralBranch: centralBranchField.value,
        repoKeyOverride: repoKeyOverrideField.value,
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
 * Toggle visibility of sync fields based on the selected mode.
 */
function updateModeVisibility(mode: "repo-branch" | "central-repo"): void {
    const repoFields = document.getElementById("sync-repo-fields");
    const centralFields = document.getElementById("sync-central-fields");

    if (!repoFields || !centralFields) {
        return;
    }

    const showCentral = mode === "central-repo";
    repoFields.style.display = showCentral ? "none" : "block";
    centralFields.style.display = showCentral ? "block" : "none";
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
