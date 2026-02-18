/**
 * Union of all message types exchanged between webview panels and the extension host.
 */
export type WebviewMessage =
    | UpdateEntryMessage
    | DetailsActionMessage
    | UpdateRepositoryMessage
    | UpdateSyncConfigMessage
    | SyncNowMessage
    | SetSyncConfigMessage
    | WebviewIsReadyMessage
    | ChooseWorkspaceRootMessage
    | SetWorkspaceRootsMessage;

/** Message sent from the Finding Details webview to update a single entry field. */
export interface UpdateEntryMessage {
    command: "update-entry";
    field: string;
    value: string;
    isPersistent: boolean;
}

/** Message sent from the Finding Details webview to trigger a resolution or issue action. */
export interface DetailsActionMessage {
    command: "details-action";
    action: "mark-true-positive" | "mark-false-positive" | "resolve-note" | "open-github-issue";
}

/** Message sent from the Git Config webview to update repository URLs and commit hash. */
export interface UpdateRepositoryMessage {
    command: "update-repository-config";
    rootLabel: string;
    clientURL: string;
    auditURL: string;
    commitHash: string;
}

/** Message sent from the Git Config webview when the user selects a different workspace root. */
export interface ChooseWorkspaceRootMessage {
    command: "choose-workspace-root";
    rootLabel: string;
}

/** Message sent from the extension host to populate the workspace root dropdown. */
export interface SetWorkspaceRootsMessage {
    command: "set-workspace-roots";
    rootLabels: string[];
}

/** Message sent from a webview when its DOM is fully loaded and ready to receive data. */
export interface WebviewIsReadyMessage {
    command: "webview-ready";
}

/** Message sent from the Sync Config webview to update sync settings. */
export interface UpdateSyncConfigMessage {
    command: "update-sync-config";
    enabled: boolean;
    mode: "repo-branch" | "central-repo";
    remoteName: string;
    branchName: string;
    pollMinutes: number;
    debounceMs: number;
    centralRepoUrl: string;
    centralBranch: string;
    repoKeyOverride: string;
}

/** Message sent from the extension host to populate the Sync Config webview with current settings. */
export interface SetSyncConfigMessage {
    command: "set-sync-config";
    enabled: boolean;
    mode: "repo-branch" | "central-repo";
    remoteName: string;
    branchName: string;
    pollMinutes: number;
    debounceMs: number;
    centralRepoUrl: string;
    centralBranch: string;
    repoKeyOverride: string;
    lastSuccessAt?: string;
}

/** Message sent from the Sync Config webview to trigger an immediate sync. */
export interface SyncNowMessage {
    command: "sync-now";
}
