import * as vscode from "vscode";
import * as path from "path";
import { FullEntry, FullLocation, FullLocationEntry, isEntry, isLocationEntry } from "./types";

/**
 * Represents an active boundary editing session for a specific location within a finding.
 */
interface BoundaryEditSession {
    /** The entry being edited */
    entry: FullEntry;
    /** Index of the location within entry.locations being edited */
    locationIndex: number;
    /** The file URI where editing is happening */
    uri: vscode.Uri;
}

const BOUNDARY_COMMANDS = {
    /* eslint-disable @typescript-eslint/naming-convention */
    "weAudit.boundaryExpandUp": {
        title: "$(arrow-up) Expand",
        tooltip: "Expand finding boundary up by one line",
    },
    "weAudit.boundaryShrinkTop": {
        title: "$(arrow-down) Shrink",
        tooltip: "Shrink finding boundary from top by one line",
    },
    "weAudit.boundaryMoveUp": {
        title: "$(triangle-up) Move",
        tooltip: "Move entire finding up by one line",
    },
    "weAudit.boundaryShrinkBottom": {
        title: "$(arrow-up) Shrink",
        tooltip: "Shrink finding boundary from bottom by one line",
    },
    "weAudit.boundaryExpandDown": {
        title: "$(arrow-down) Expand",
        tooltip: "Expand finding boundary down by one line",
    },
    "weAudit.boundaryMoveDown": {
        title: "$(triangle-down) Move",
        tooltip: "Move entire finding down by one line",
    },
    "weAudit.stopEditingBoundary": {
        title: "$(check) Done",
        tooltip: "Finish editing finding boundary",
    },
    /* eslint-enable @typescript-eslint/naming-convention */
} as const;

type BoundaryCommandId = keyof typeof BOUNDARY_COMMANDS;
type BoundaryCommandMetadata = (typeof BOUNDARY_COMMANDS)[BoundaryCommandId];

/** The four decoration style keys used for boundary highlighting. */
type DecorationStyleKey = "single" | "top" | "middle" | "bottom";

/**
 * CodeLens provider that displays boundary adjustment controls for findings.
 * This provider is only active when a user explicitly enters boundary editing mode
 * via the "weAudit.editFindingBoundary" command. Controls appear at the start and
 * end lines of the finding, allowing users to expand or shrink the highlighted region.
 */
export class FindingBoundaryCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    /** Currently active editing session, or undefined if not editing */
    private activeSession: BoundaryEditSession | undefined;

    /** Common decoration properties for all boundary styles */
    private readonly commonDecorationProps = {
        isWholeLine: true,
        borderStyle: "solid" as const,
        light: { borderColor: "#f0ad4e" },
        dark: { borderColor: "#ffcf70" },
    };

    private readonly decorationStyles: Record<DecorationStyleKey, vscode.TextEditorDecorationType> = {
        single: vscode.window.createTextEditorDecorationType({
            ...this.commonDecorationProps,
            borderWidth: "2px",
        }),
        top: vscode.window.createTextEditorDecorationType({
            ...this.commonDecorationProps,
            borderWidth: "2px 2px 0px 2px",
        }),
        middle: vscode.window.createTextEditorDecorationType({
            ...this.commonDecorationProps,
            borderWidth: "0px 2px 0px 2px",
        }),
        bottom: vscode.window.createTextEditorDecorationType({
            ...this.commonDecorationProps,
            borderWidth: "0px 2px 2px 2px",
        }),
    };

    /** Ordered keys for iterating over decoration styles consistently. */
    private readonly decorationStyleKeys: DecorationStyleKey[] = ["single", "top", "middle", "bottom"];

    constructor() {
        void vscode.commands.executeCommand("setContext", "weAudit.boundaryEditing", false);
    }

    /**
     * Disposes all decoration types and the event emitter.
     */
    dispose(): void {
        for (const key of this.decorationStyleKeys) {
            this.decorationStyles[key].dispose();
        }
        this._onDidChangeCodeLenses.dispose();
    }

    /**
     * Checks if boundary editing mode is currently active.
     * @returns true if a boundary editing session is in progress
     */
    isEditing(): boolean {
        return this.activeSession !== undefined;
    }

    /**
     * Gets the currently active editing session.
     * @returns the active session or undefined
     */
    getActiveSession(): BoundaryEditSession | undefined {
        return this.activeSession;
    }

    /**
     * Starts boundary editing mode for a specific entry and location.
     * @param entry the finding/note entry to edit
     * @param locationIndex the index of the location within the entry to edit
     */
    startEditing(entry: FullEntry, locationIndex: number): void {
        if (locationIndex < 0 || locationIndex >= entry.locations.length) {
            return;
        }

        const location = entry.locations[locationIndex];
        const filePath = path.join(location.rootPath, location.path);
        this.activeSession = {
            entry,
            locationIndex,
            uri: vscode.Uri.file(filePath),
        };

        void vscode.commands.executeCommand("setContext", "weAudit.boundaryEditing", true);
        this.refreshSession();

        // Focus the editor on the finding location to ensure it is visible
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.fsPath === filePath) {
            const range = new vscode.Range(location.startLine, 0, location.endLine, 0);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    /**
     * Stops boundary editing mode and clears the active session.
     */
    stopEditing(): void {
        this.activeSession = undefined;
        void vscode.commands.executeCommand("setContext", "weAudit.boundaryEditing", false);
        this.refreshSession();
    }

    /**
     * Updates the active session's entry reference (called after boundary modifications).
     * @param entry the updated entry
     */
    updateEntry(entry: FullEntry): void {
        if (this.activeSession) {
            this.activeSession.entry = entry;
            this.refreshSession();
        }
    }

    /**
     * Re-applies boundary decorations to all visible editors.
     * Called when the set of visible editors changes while editing.
     */
    updateDecorationsForVisibleEditors(): void {
        this.refreshEditingDecorations();
    }

    /**
     * Provides CodeLens items for the document.
     * Only returns lenses when boundary editing mode is active and the document matches.
     */
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        if (!this.activeSession || !this.isSessionDocument(document.uri)) {
            return [];
        }

        const location = this.activeSession.entry.locations[this.activeSession.locationIndex];
        if (!location) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        const canMoveDownOrExpandDown = location.endLine < document.lineCount - 1;

        const locationId = `${this.activeSession.entry.label}:${this.activeSession.locationIndex}`;
        const locationArgs: readonly [string] = [locationId];

        // === TOP BOUNDARY CONTROLS (at startLine) ===
        const topRange = new vscode.Range(location.startLine, 0, location.startLine, 0);

        const topControls: Array<{ condition: boolean; commandId: BoundaryCommandId }> = [
            { condition: location.startLine > 0, commandId: "weAudit.boundaryExpandUp" },
            { condition: location.startLine < location.endLine, commandId: "weAudit.boundaryShrinkTop" },
            { condition: location.startLine > 0, commandId: "weAudit.boundaryMoveUp" },
        ];

        for (const control of topControls) {
            if (control.condition) {
                lenses.push(this.createBoundaryCommandLens(topRange, control.commandId, locationArgs));
            }
        }

        lenses.push(this.createBoundaryCommandLens(topRange, "weAudit.stopEditingBoundary"));

        // === BOTTOM BOUNDARY CONTROLS (at endLine) ===
        if (location.endLine !== location.startLine) {
            const bottomLine = Math.min(location.endLine + 1, document.lineCount - 1);
            const bottomRange = new vscode.Range(bottomLine, 0, bottomLine, 0);

            const bottomControls: Array<{ condition: boolean; commandId: BoundaryCommandId }> = [
                { condition: location.endLine > location.startLine, commandId: "weAudit.boundaryShrinkBottom" },
                { condition: canMoveDownOrExpandDown, commandId: "weAudit.boundaryExpandDown" },
                { condition: canMoveDownOrExpandDown, commandId: "weAudit.boundaryMoveDown" },
            ];

            for (const control of bottomControls) {
                if (control.condition) {
                    lenses.push(this.createBoundaryCommandLens(bottomRange, control.commandId, locationArgs));
                }
            }
        } else {
            // Single-line finding: show expand down on the same line
            if (canMoveDownOrExpandDown) {
                lenses.push(
                    this.createBoundaryCommandLens(topRange, "weAudit.boundaryExpandDown", locationArgs, {
                        title: "$(arrow-down) Expand",
                    }),
                );
            }
        }

        return lenses;
    }

    /**
     * Creates a CodeLens for the provided boundary command, reusing shared metadata.
     * @param range the document range where the CodeLens should appear
     * @param commandId the VS Code command to invoke
     * @param args arguments forwarded to the command
     * @param overrides optional overrides for the command title or tooltip
     */
    private createBoundaryCommandLens(
        range: vscode.Range,
        commandId: BoundaryCommandId,
        args: readonly unknown[] = [],
        overrides?: Partial<BoundaryCommandMetadata>,
    ): vscode.CodeLens {
        const commandMeta = BOUNDARY_COMMANDS[commandId];
        return new vscode.CodeLens(range, {
            title: overrides?.title ?? commandMeta.title,
            tooltip: overrides?.tooltip ?? commandMeta.tooltip,
            command: commandId,
            arguments: [...args],
        });
    }

    /**
     * Fires the CodeLens change event and refreshes boundary decorations.
     * This is the common update path used after any session state change.
     */
    private refreshSession(): void {
        this._onDidChangeCodeLenses.fire();
        this.refreshEditingDecorations();
    }

    /**
     * Applies or clears boundary decorations on all visible editors based on the active session.
     */
    private refreshEditingDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (!this.activeSession || !this.isSessionDocument(editor.document.uri)) {
                this.clearDecorations(editor);
                continue;
            }

            const location = this.activeSession.entry.locations[this.activeSession.locationIndex];
            if (!location) {
                this.clearDecorations(editor);
                continue;
            }

            const decorations = this.buildDecorationRanges(location);
            for (const key of this.decorationStyleKeys) {
                editor.setDecorations(this.decorationStyles[key], decorations[key]);
            }
        }
    }

    /**
     * Builds per-style decoration ranges for the given location.
     * Single-line locations use the "single" style; multi-line locations use top/middle/bottom.
     */
    private buildDecorationRanges(location: FullLocation): Record<DecorationStyleKey, vscode.Range[]> {
        const ranges: Record<DecorationStyleKey, vscode.Range[]> = {
            single: [],
            top: [],
            middle: [],
            bottom: [],
        };

        if (location.startLine === location.endLine) {
            ranges.single.push(new vscode.Range(location.startLine, 0, location.startLine, 0));
            return ranges;
        }

        ranges.top.push(new vscode.Range(location.startLine, 0, location.startLine, 0));
        for (let line = location.startLine + 1; line < location.endLine; line++) {
            ranges.middle.push(new vscode.Range(line, 0, line, 0));
        }
        ranges.bottom.push(new vscode.Range(location.endLine, 0, location.endLine, 0));

        return ranges;
    }

    /**
     * Removes all boundary decorations from the given editor.
     */
    private clearDecorations(editor: vscode.TextEditor): void {
        for (const key of this.decorationStyleKeys) {
            editor.setDecorations(this.decorationStyles[key], []);
        }
    }

    /**
     * Checks whether the given URI matches the file for the active editing session.
     */
    private isSessionDocument(uri: vscode.Uri): boolean {
        if (!this.activeSession) {
            return false;
        }
        return path.normalize(uri.fsPath) === path.normalize(this.activeSession.uri.fsPath);
    }
}

/** Singleton instance of the CodeLens provider */
let codeLensProvider: FindingBoundaryCodeLensProvider | undefined;

/**
 * Gets or creates the singleton CodeLens provider instance.
 * @returns the FindingBoundaryCodeLensProvider instance
 */
export function getCodeLensProvider(): FindingBoundaryCodeLensProvider {
    if (!codeLensProvider) {
        codeLensProvider = new FindingBoundaryCodeLensProvider();
    }
    return codeLensProvider;
}

/**
 * Activates the finding boundary CodeLens feature.
 * Registers the CodeLens provider and all related commands.
 * @param context the extension context
 * @param getLocationUnderCursor function to get the current finding under cursor
 * @param modifyLocationBoundary function to modify a location's boundaries
 */
export function activateFindingBoundaryCodeLens(
    context: vscode.ExtensionContext,
    getLocationUnderCursor: () => FullEntry | FullLocationEntry | undefined,
    modifyLocationBoundary: (entry: FullEntry, locationIndex: number, startLineDelta: number, endLineDelta: number, document: vscode.TextDocument) => boolean,
): void {
    const provider = getCodeLensProvider();

    /**
     * Resolves the entry and location index from the provided tree item.
     * @param locationOrEntry the entry or specific location entry under the cursor
     * @returns the concrete entry and the index of the location being edited
     */
    function resolveEntrySelection(locationOrEntry: FullEntry | FullLocationEntry | undefined): { entry: FullEntry; locationIndex: number } | undefined {
        if (!locationOrEntry) {
            return undefined;
        }

        if (isLocationEntry(locationOrEntry)) {
            const entry = locationOrEntry.parentEntry;
            const locationIndex = entry.locations.indexOf(locationOrEntry.location);
            if (locationIndex === -1) {
                vscode.window.showErrorMessage("weAudit: Could not find location in entry.");
                return undefined;
            }
            return { entry, locationIndex };
        }

        if (isEntry(locationOrEntry)) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return undefined;
            }
            const cursorLine = editor.selection.active.line;
            const locationIndex = locationOrEntry.locations.findIndex((loc) => cursorLine >= loc.startLine && cursorLine <= loc.endLine);
            return { entry: locationOrEntry, locationIndex: locationIndex === -1 ? 0 : locationIndex };
        }

        return undefined;
    }

    /**
     * Ensures there is an active boundary editing session, creating one from the cursor location if needed.
     * @returns the active boundary edit session, or undefined if none could be established
     */
    function ensureActiveBoundarySession(): BoundaryEditSession | undefined {
        const existingSession = provider.getActiveSession();
        if (existingSession) {
            return existingSession;
        }

        const selection = resolveEntrySelection(getLocationUnderCursor());
        if (!selection) {
            return undefined;
        }
        provider.startEditing(selection.entry, selection.locationIndex);
        return provider.getActiveSession();
    }

    /**
     * Registers a boundary adjustment command that modifies the start/end lines by the given deltas.
     */
    function registerBoundaryCommand(commandId: string, startDelta: number, endDelta: number): void {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, () => {
                const document = vscode.window.activeTextEditor?.document;
                if (!document) {
                    return;
                }

                const session = ensureActiveBoundarySession();
                if (!session) {
                    return;
                }
                if (modifyLocationBoundary(session.entry, session.locationIndex, startDelta, endDelta, document)) {
                    provider.updateEntry(session.entry);
                }
            }),
        );
    }

    // Register the CodeLens provider for all text documents (file + untitled).
    // Use a glob pattern so the provider also works in remote scenarios (where the scheme is not "file").
    const selector: vscode.DocumentSelector = [{ pattern: "**/*" }, { scheme: "untitled" }];
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, provider));
    context.subscriptions.push(provider);

    // Command: Start editing finding boundary
    context.subscriptions.push(
        vscode.commands.registerCommand("weAudit.editFindingBoundary", () => {
            const selection = resolveEntrySelection(getLocationUnderCursor());
            if (!selection) {
                return;
            }
            provider.startEditing(selection.entry, selection.locationIndex);
        }),
    );

    // Command: Stop editing finding boundary
    context.subscriptions.push(
        vscode.commands.registerCommand("weAudit.stopEditingBoundary", () => {
            provider.stopEditing();
        }),
    );

    // Boundary adjustment commands
    registerBoundaryCommand("weAudit.boundaryExpandUp", -1, 0);
    registerBoundaryCommand("weAudit.boundaryShrinkTop", 1, 0);
    registerBoundaryCommand("weAudit.boundaryExpandDown", 0, 1);
    registerBoundaryCommand("weAudit.boundaryShrinkBottom", 0, -1);
    registerBoundaryCommand("weAudit.boundaryMoveUp", -1, -1);
    registerBoundaryCommand("weAudit.boundaryMoveDown", 1, 1);

    // Stop editing when switching to a different file
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const session = provider.getActiveSession();
            if (session && (!editor || editor.document.uri.fsPath !== session.uri.fsPath)) {
                provider.stopEditing();
            }
        }),
    );

    // Refresh decorations when the set of visible editors changes
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(() => {
            if (provider.isEditing()) {
                provider.updateDecorationsForVisibleEditors();
            }
        }),
    );
}
