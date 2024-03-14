export type WebviewMessage = UpdateEntryMessage | UpdateRepositoryMessage | WebviewIsReadyMessage;

export interface UpdateEntryMessage {
    command: "update-entry";
    field: string;
    value: string;
    isPersistent: boolean;
}

export interface UpdateRepositoryMessage {
    command: "update-repository-config";
    clientURL: string;
    auditURL: string;
    commitHash: string;
}

export interface WebviewIsReadyMessage {
    command: "webview-ready";
}
