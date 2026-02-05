export type WebviewMessage =
    | UpdateEntryMessage
    | UpdateRepositoryMessage
    | UpdateSyncConfigMessage
    | SyncNowMessage
    | SetSyncConfigMessage
    | WebviewIsReadyMessage
    | ChooseWorkspaceRootMessage
    | SetWorkspaceRootsMessage;

export interface UpdateEntryMessage {
    command: "update-entry";
    field: string;
    value: string;
    isPersistent: boolean;
}

export interface UpdateRepositoryMessage {
    command: "update-repository-config";
    rootLabel: string;
    clientURL: string;
    auditURL: string;
    commitHash: string;
}

export interface ChooseWorkspaceRootMessage {
    command: "choose-workspace-root";
    rootLabel: string;
}

export interface SetWorkspaceRootsMessage {
    command: "set-workspace-roots";
    rootLabels: string[];
}

export interface WebviewIsReadyMessage {
    command: "webview-ready";
}

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

export interface SyncNowMessage {
    command: "sync-now";
}
