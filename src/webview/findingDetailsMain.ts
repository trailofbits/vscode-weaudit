/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { provideVSCodeDesignSystem, vsCodeDropdown, vsCodeTextArea, vsCodeOption, vsCodeTextField } from "@vscode/webview-ui-toolkit";
import { TextArea, Dropdown, TextField } from "@vscode/webview-ui-toolkit";
import { UpdateEntryMessage } from "./webviewMessageTypes";

// In order to use all the Webview UI Toolkit web components they
// must be registered with the browser (i.e. webview) using the
// syntax below.
// provideVSCodeDesignSystem().register(allComponents);
provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeTextArea(), vsCodeOption(), vsCodeTextField());

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

    const severityDropdown = document.getElementById("severity-dropdown") as Dropdown;
    severityDropdown?.addEventListener("change", handlePersistentFieldChange);

    const difficultyDropdown = document.getElementById("difficulty-dropdown") as Dropdown;
    difficultyDropdown?.addEventListener("change", handlePersistentFieldChange);

    const typeDropdown = document.getElementById("type-dropdown") as Dropdown;
    typeDropdown?.addEventListener("change", handlePersistentFieldChange);

    // for the text areas, we listen to to both the change and input events
    // on change events we persist the data into disk
    // on input events we just update the data in memory
    // this is to avoid writing to disk on every keystroke
    // and to keep the state updated in case we open a gh issue before the change event fires
    const descriptionArea = document.getElementById("description-area") as TextArea;
    descriptionArea?.addEventListener("change", handlePersistentFieldChange);
    descriptionArea?.addEventListener("input", handleNonPersistentFieldChange);

    const exploitArea = document.getElementById("exploit-area") as TextArea;
    exploitArea?.addEventListener("change", handlePersistentFieldChange);
    exploitArea?.addEventListener("input", handleNonPersistentFieldChange);

    const recommendationArea = document.getElementById("recommendation-area") as TextArea;
    recommendationArea?.addEventListener("change", handlePersistentFieldChange);
    recommendationArea?.addEventListener("input", handleNonPersistentFieldChange);

    // container div with all the elements
    const containerDiv = document.getElementById("container-div") as HTMLDivElement;

    // start with the container hidden
    containerDiv.style.display = "none";

    // handle the message inside the webview
    window.addEventListener("message", (event) => {
        const message = event.data;

        switch (message.command) {
            case "set-finding-details":
                containerDiv.style.display = "block";
                titleField.value = message.title;
                severityDropdown.value = message.severity;
                difficultyDropdown.value = message.difficulty;
                typeDropdown.value = message.type;

                descriptionArea.value = message.description;
                exploitArea.value = message.exploit;
                recommendationArea.value = message.recommendation;
                break;

            case "hide-finding-details":
                containerDiv.style.display = "none";
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
