export type WebviewMessage = UpdateEntryMessage | UpdateRepositoryMessage | WebviewIsReadyMessage | ChooseWorkspaceRootMessage | SetWorkspaceRootsMessage;

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
