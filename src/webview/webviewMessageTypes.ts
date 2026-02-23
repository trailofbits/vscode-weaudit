/** Union of all messages that webview panels can send to the extension host. */
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

/** Message sent when a single entry detail field is updated from the finding details panel. */
export interface UpdateEntryMessage {
    command: "update-entry";
    field: string;
    value: string;
    isPersistent: boolean;
}

/** Message sent when a resolution or issue action button is clicked in the finding details panel. */
export interface DetailsActionMessage {
    command: "details-action";
    action: "mark-true-positive" | "mark-false-positive" | "resolve-note" | "open-github-issue";
}

/** Message sent when the git configuration panel updates repository URLs or commit hash. */
export interface UpdateRepositoryMessage {
    command: "update-repository-config";
    rootLabel: string;
    clientURL: string;
    auditURL: string;
    commitHash: string;
}

/** Message sent when the user selects a different workspace root in the git config panel. */
export interface ChooseWorkspaceRootMessage {
    command: "choose-workspace-root";
    rootLabel: string;
}

/** Message sent from the extension to populate the workspace root selector in the git config panel. */
export interface SetWorkspaceRootsMessage {
    command: "set-workspace-roots";
    rootLabels: string[];
}

/** Message sent by a webview after its DOM is ready, prompting the extension to push initial data. */
export interface WebviewIsReadyMessage {
    command: "webview-ready";
}

/** Message sent when the user saves sync configuration changes from the sync config panel. */
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

/** Message sent from the extension to populate the sync config panel with current settings. */
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

/** Message sent when the user clicks the "Sync Now" button in the sync config panel. */
export interface SyncNowMessage {
    command: "sync-now";
}
