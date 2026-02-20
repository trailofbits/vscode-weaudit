import * as vscode from "vscode";

import { detectClaudeBinary, runDocumentationAgent } from "./agentRunner";
import { buildDocDecorations, createDocOverlayDecorationType } from "./decorations";
import { DocStore } from "./docStore";
import { DocOverlayPanel, type LogEntry, type LogEntryType } from "./docOverlayPanel";
import { DocOverlayHoverProvider } from "./hoverProvider";
import type { DocEntry } from "./types";

/**
 * Manages the documentation overlay feature: generation, persistence, decorations, and hover tooltips.
 * Registers the three weAudit.generateDocOverlay / toggleDocOverlay / clearDocOverlay commands
 * and keeps all visible editors in sync with the current set of loaded doc entries.
 *
 * Owns all panel state (skillName, pluginDir, targetDir, log) and supplies it to
 * DocOverlayPanel via a getState callback so the panel can reconstruct its UI on every reopen.
 */
export class DocOverlayManager {
    private entries: DocEntry[] = [];
    private visible: boolean;
    private readonly docDecorationType: vscode.TextEditorDecorationType;
    private readonly docStore: DocStore;
    private readonly workspaceRoot: string;

    // Panel state — owned here so it survives panel close/reopen cycles.
    private _claudeBinaryPath = "";
    private _skillName = "";
    private _pluginDir = "";
    private _targetDir = "";
    private _log: LogEntry[] = [];
    private _panel?: DocOverlayPanel;

    /** @param context The extension context used for registering disposables. */
    constructor(context: vscode.ExtensionContext) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            // No workspace open; nothing to do.
            this.visible = false;
            this.workspaceRoot = "";
            this.docDecorationType = vscode.window.createTextEditorDecorationType({});
            this.docStore = new DocStore("");
            return;
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.docStore = new DocStore(this.workspaceRoot);
        this._claudeBinaryPath = detectClaudeBinary();

        const config = vscode.workspace.getConfiguration("weAudit");
        this.visible = config.get<boolean>("docOverlay.visibleOnLoad", true);

        this.docDecorationType = createDocOverlayDecorationType();
        context.subscriptions.push(this.docDecorationType);

        // Hover provider: supplies fullDoc markdown on cursor hover.
        const hoverProvider = new DocOverlayHoverProvider(() => this.entries, this.workspaceRoot);
        const hoverDisposable = vscode.languages.registerHoverProvider({ scheme: "file" }, hoverProvider);
        context.subscriptions.push(hoverDisposable);

        // Sidebar panel: stateless renderer — all state is owned by this manager.
        const panel = new DocOverlayPanel(
            context.extensionUri,
            (skillName, pluginDir, targetDir) => void this.runGeneration(skillName, pluginDir, targetDir),
            (field, value) => {
                if (field === "claudeBinaryPath") {
                    this._claudeBinaryPath = value;
                } else if (field === "skillName") {
                    this._skillName = value;
                } else if (field === "pluginDir") {
                    this._pluginDir = value;
                } else if (field === "targetDir") {
                    this._targetDir = value;
                }
            },
            () => ({
                claudeBinaryPath: this._claudeBinaryPath,
                skillName: this._skillName,
                pluginDir: this._pluginDir,
                targetDir: this._targetDir,
                log: this._log,
                overlayVisible: this.visible,
                hasDocs: this.entries.length > 0,
            }),
            this.workspaceRoot,
        );
        this._panel = panel;
        context.subscriptions.push(vscode.window.registerWebviewViewProvider("docsOverlay", panel));

        // Command registrations.
        context.subscriptions.push(
            vscode.commands.registerCommand("weAudit.generateDocOverlay", () => {
                void vscode.commands.executeCommand("docsOverlay.focus");
            }),
            vscode.commands.registerCommand("weAudit.toggleDocOverlay", () => this.toggleDocOverlay()),
            vscode.commands.registerCommand("weAudit.clearDocOverlay", () => this.clearDocOverlay()),
        );

        // Decorate newly opened/activated editors.
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.decorateEditor(editor);
                }
            }),
        );

        // Reload when weaudit-docs/ changes on disk (e.g. session copied in externally).
        const watcher = this.docStore.watchForChanges(() => this.reloadAndRedecorate());
        context.subscriptions.push(watcher);

        // Load any sessions that were persisted from a previous run.
        this.reloadAndRedecorate();
    }

    /**
     * Appends an entry to the in-memory log and forwards it to the panel if open.
     * @param text Message text (may contain newlines).
     * @param type Visual style: "info", or "error".
     */
    private _appendLog(text: string, type: LogEntryType = "info"): void {
        this._log.push({ type, text });
        this._panel?.appendLog(text, type);
    }

    /** Pushes current overlay visibility and docs availability to the live panel. */
    private _syncPanelState(): void {
        this._panel?.syncState(this.visible, this.entries.length > 0);
    }

    /**
     * Runs the documentation agent with the values provided by the sidebar panel.
     * Reports progress via panel log messages and VS Code progress notifications.
     * @param skillName Name of the skill to invoke.
     * @param pluginDir Absolute path to the plugin directory.
     * @param targetDir Absolute path to the directory to document.
     */
    private async runGeneration(skillName: string, pluginDir: string, targetDir: string): Promise<void> {
        const config = vscode.workspace.getConfiguration("weAudit");
        const apiKey = config.get<string>("docOverlay.anthropicApiKey", "").trim();
        if (!apiKey) {
            this._appendLog("Error: set weAudit › Doc Overlay › Anthropic API Key in settings.", "error");
            return;
        }
        if (!this.workspaceRoot) {
            this._appendLog("Error: no workspace open.", "error");
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "weAudit: Generating documentation for overlay",
                cancellable: true,
            },
            async (progress, token) => {
                let entries: DocEntry[];
                try {
                    entries = await runDocumentationAgent(
                        {
                            skillPluginPath: pluginDir,
                            skillName,
                            targetDir,
                            workspaceRoot: this.workspaceRoot,
                            claudeBinaryPath: this._claudeBinaryPath,
                            apiKey,
                            onProgress: (msg, truncate) => {
                                const progressMsg = truncate ? (msg.split("\n")[0] ?? msg) + " …" : msg;
                                progress.report({ message: `${progressMsg}` });
                                this._appendLog(msg, "info");
                            },
                        },
                        token,
                    );
                } catch (err) {
                    const msg = `Error: ${String(err)}`;
                    this._appendLog(msg, "error");
                    void vscode.window.showErrorMessage(`weAudit: ${msg}`);
                    return;
                }

                if (token.isCancellationRequested) {
                    this._appendLog("Cancelled.", "info");
                    return;
                }

                const relativeTarget = vscode.workspace.asRelativePath(targetDir, false);
                this.docStore.persistSession({
                    version: 1,
                    skill: skillName,
                    targetDirectory: relativeTarget,
                    generatedAt: new Date().toISOString(),
                    workspaceRoot: this.workspaceRoot,
                    entries,
                });
                this.reloadAndRedecorate();
                this._appendLog(`Done — ${entries.length} entries generated.`, "info");
            },
        );
    }

    /** Flips overlay visibility and redecorates all visible editors. */
    private toggleDocOverlay(): void {
        this.visible = !this.visible;
        this.redecorateAllEditors();
        this._syncPanelState();
    }

    /** Deletes all persisted sessions, clears in-memory entries, and removes decorations. */
    private clearDocOverlay(): void {
        this.docStore.clearAllSessions();
        this.entries = [];
        this.redecorateAllEditors();
        this._syncPanelState();
    }

    /** Reads all persisted sessions from disk and redecorates all visible editors. */
    private reloadAndRedecorate(): void {
        const sessions = this.docStore.loadAllSessions();
        this.entries = sessions.flatMap((s) => s.entries);
        this.redecorateAllEditors();
        this._syncPanelState();
    }

    /** Applies or clears decorations on every currently visible text editor. */
    private redecorateAllEditors(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.decorateEditor(editor);
        }
    }

    /**
     * Applies doc overlay decorations to a single editor, or clears them when hidden.
     * @param editor The text editor to decorate.
     */
    private decorateEditor(editor: vscode.TextEditor): void {
        if (!this.visible) {
            editor.setDecorations(this.docDecorationType, []);
            return;
        }
        const decorations = buildDocDecorations(this.entries, editor.document.uri.fsPath, this.workspaceRoot);
        editor.setDecorations(this.docDecorationType, decorations);
    }
}
