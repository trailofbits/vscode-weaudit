/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { provideVSCodeDesignSystem, vsCodeDropdown, vsCodeTextArea, vsCodeOption, vsCodeTextField, vsCodeButton } from "@vscode/webview-ui-toolkit";
import { TextArea, Dropdown, TextField, Button } from "@vscode/webview-ui-toolkit";
import { DetailsActionMessage, UpdateEntryMessage } from "./webviewMessageTypes";

// In order to use all the Webview UI Toolkit web components they
// must be registered with the browser (i.e. webview) using the
// syntax below.
// provideVSCodeDesignSystem().register(allComponents);
provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeTextArea(), vsCodeOption(), vsCodeTextField(), vsCodeButton());

const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener("load", () => {
    main();
    // Notify the extension that the webview is ready
    vscode.postMessage({ command: "webview-ready" });
});

function main(): void {
    const titleField = document.getElementById("label-area") as TextField;
    titleField?.addEventListener("change", handlePersistentFieldChange);

    const provenanceValue = document.getElementById("provenance-value") as HTMLSpanElement;
    const commitWarning = document.getElementById("commit-warning") as HTMLDivElement;

    const findingActionsRow = document.getElementById("finding-actions") as HTMLDivElement;
    const noteActionsRow = document.getElementById("note-actions") as HTMLDivElement;
    const markTruePositiveButton = document.getElementById("action-mark-true-positive") as Button | null;
    const markFalsePositiveButton = document.getElementById("action-mark-false-positive") as Button | null;
    const resolveNoteButton = document.getElementById("action-resolve-note") as Button | null;

    registerActionButton(markTruePositiveButton, "mark-true-positive");
    registerActionButton(markFalsePositiveButton, "mark-false-positive");
    registerActionButton(resolveNoteButton, "resolve-note");

    const severityDropdown = document.getElementById("severity-dropdown") as Dropdown;
    severityDropdown?.addEventListener("input", handlePersistentFieldChange);

    const difficultyDropdown = document.getElementById("difficulty-dropdown") as Dropdown;
    difficultyDropdown?.addEventListener("input", handlePersistentFieldChange);

    const typeDropdown = document.getElementById("type-dropdown") as Dropdown;
    typeDropdown?.addEventListener("input", handlePersistentFieldChange);

    // for the text areas, we listen to to both the change and input events
    // on change events we persist the data into disk
    // on input events we just update the data in memory
    // this is to avoid writing to disk on every keystroke
    // and to keep the state updated in case we open a gh issue before the change event fires
    const descriptionArea = document.getElementById("description-area") as TextArea;
    registerAutoResizingTextArea(descriptionArea, handleNonPersistentFieldChange);

    const exploitArea = document.getElementById("exploit-area") as TextArea;
    registerAutoResizingTextArea(exploitArea, handleNonPersistentFieldChange);

    const recommendationArea = document.getElementById("recommendation-area") as TextArea;
    registerAutoResizingTextArea(recommendationArea, handleNonPersistentFieldChange);

    // container div with all the elements
    const containerDiv = document.getElementById("container-div") as HTMLDivElement;

    // start with the container hidden
    containerDiv.style.display = "none";
    findingActionsRow.style.display = "none";
    noteActionsRow.style.display = "none";

    // handle the message inside the webview
    window.addEventListener("message", (event) => {
        const message = event.data;

        switch (message.command) {
            case "set-finding-details": {
                containerDiv.style.display = "block";
                titleField.value = message.title;
                const provenance = (message.provenance ?? "human") as string;
                const campaign = String(message.campaign ?? "");
                const author: string | undefined = typeof message.author === "string" ? message.author : undefined;
                provenanceValue.textContent = formatProvenanceValue(provenance, author, campaign);
                const entryCommitHash = String(message.entryCommitHash ?? "");
                const currentCommitHash = String(message.currentCommitHash ?? "");
                if (isCommitMismatch(entryCommitHash, currentCommitHash)) {
                    const entryShort = formatCommitHash(entryCommitHash);
                    const currentShort = formatCommitHash(currentCommitHash);
                    commitWarning.textContent = `Commit hash mismatch: entry ${entryShort} vs current ${currentShort}.`;
                    commitWarning.style.display = "block";
                } else {
                    commitWarning.textContent = "";
                    commitWarning.style.display = "none";
                }
                const isFinding = message.entryType === "finding";
                const isNote = message.entryType === "note";
                findingActionsRow.style.display = isFinding ? "flex" : "none";
                noteActionsRow.style.display = isNote ? "flex" : "none";
                severityDropdown.value = message.severity;
                difficultyDropdown.value = message.difficulty;
                typeDropdown.value = message.type;

                descriptionArea.value = message.description;
                exploitArea.value = message.exploit;
                recommendationArea.value = message.recommendation;
                scheduleTextAreaResize(descriptionArea);
                scheduleTextAreaResize(exploitArea);
                scheduleTextAreaResize(recommendationArea);
                break;
            }

            case "hide-finding-details":
                containerDiv.style.display = "none";
                provenanceValue.textContent = "";
                commitWarning.textContent = "";
                commitWarning.style.display = "none";
                findingActionsRow.style.display = "none";
                noteActionsRow.style.display = "none";
                break;
        }
    });
}

function handleNonPersistentFieldChange(e: Event): void {
    handleFieldChange(e, false);
}

function handlePersistentFieldChange(e: Event): void {
    handleFieldChange(e, true);
}

function handleFieldChange(e: Event, isPersistent: boolean): void {
    const element = e.target! as HTMLInputElement;
    const value = element.value;
    const field = element.id.split("-")[0];

    const message: UpdateEntryMessage = {
        command: "update-entry",
        field: field,
        value: value,
        isPersistent: isPersistent,
    };
    vscode.postMessage(message);
}

/**
 * Resizes a VS Code webview text area to fit its content while keeping its initial height as a minimum.
 * The description, exploit, and recommendation fields cap their growth and show a scrollbar after hitting the max height.
 */
function resizeTextAreaToContent(textArea: TextArea): boolean {
    const control = textArea.shadowRoot?.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!control) {
        return false;
    }

    const currentHeight = control.offsetHeight;
    if ((!textArea.dataset.minHeight || textArea.dataset.minHeight === "0") && currentHeight > 0) {
        textArea.dataset.minHeight = `${currentHeight}`;
    }

    const minHeight = Number(textArea.dataset.minHeight ?? "0");
    const cappedTextAreaIds = new Set(["description-area", "exploit-area", "recommendation-area"]);
    const maxHeight = cappedTextAreaIds.has(textArea.id) ? Math.max(Math.floor(window.innerHeight * 0.5), minHeight) : Number.POSITIVE_INFINITY;
    control.style.height = "auto";
    const desiredHeight = Math.max(control.scrollHeight, minHeight);
    control.style.height = `${Math.min(desiredHeight, maxHeight)}px`;
    if (cappedTextAreaIds.has(textArea.id)) {
        control.style.overflowY = desiredHeight > maxHeight ? "auto" : "hidden";
    } else {
        control.style.overflowY = "";
    }
    return true;
}

/**
 * Attempts to resize a text area on the next frame, retrying briefly if the shadow DOM isn't ready yet.
 */
function scheduleTextAreaResize(textArea: TextArea, attempt = 0): void {
    requestAnimationFrame(() => {
        if (resizeTextAreaToContent(textArea)) {
            return;
        }
        if (attempt < 3) {
            setTimeout(() => scheduleTextAreaResize(textArea, attempt + 1), 50);
        }
    });
}

/**
 * Registers input/change handlers to auto-resize a webview text area as the user types.
 */
function registerAutoResizingTextArea(textArea: TextArea | null, onInput: (event: Event) => void): void {
    if (!textArea) {
        return;
    }
    textArea.addEventListener("change", handlePersistentFieldChange);
    textArea.addEventListener("input", (event) => {
        resizeTextAreaToContent(textArea);
        onInput(event);
    });
    window.addEventListener("resize", () => resizeTextAreaToContent(textArea));
}

/**
 * Formats the provenance display string with optional author and campaign metadata.
 */
function formatProvenanceValue(source: string, author: string | undefined, campaign: string): string {
    const authorSuffix = author ? ` (${author})` : "";
    const trimmedCampaign = campaign.trim();
    const campaignSuffix = trimmedCampaign ? ` · campaign: ${trimmedCampaign}` : "";
    return `${source}${authorSuffix}${campaignSuffix}`;
}

/**
 * Returns true when both commit hashes exist and do not match.
 */
function isCommitMismatch(entryCommitHash: string, currentCommitHash: string): boolean {
    return entryCommitHash !== "" && currentCommitHash !== "" && entryCommitHash !== currentCommitHash;
}

/**
 * Format a commit hash for display, shortening long values.
 */
function formatCommitHash(hash: string): string {
    const trimmed = hash.trim();
    if (trimmed.length <= 12) {
        return trimmed;
    }
    return trimmed.slice(0, 12);
}
/**
 * Registers a button click listener that posts a details action message.
 */
function registerActionButton(button: Button | null, action: DetailsActionMessage["action"]): void {
    if (!button) {
        return;
    }
    button.addEventListener("click", () => {
        postDetailsAction(action);
    });
}

/**
 * Posts a details action message to the extension host.
 */
function postDetailsAction(action: DetailsActionMessage["action"]): void {
    const message: DetailsActionMessage = {
        command: "details-action",
        action: action,
    };
    vscode.postMessage(message);
}
