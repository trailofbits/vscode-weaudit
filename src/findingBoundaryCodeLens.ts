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

    private readonly decorationStyles = {
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

    constructor() {
        void vscode.commands.executeCommand("setContext", "weAudit.boundaryEditing", false);
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

        vscode.commands.executeCommand("setContext", "weAudit.boundaryEditing", true);

        // Force refresh of CodeLenses in all visible editors
        this._onDidChangeCodeLenses.fire();
        this.refreshEditingDecorations();

        // Also focus the editor on the finding location to ensure it's visible
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
        this._onDidChangeCodeLenses.fire();
        this.refreshEditingDecorations();
    }

    /**
     * Updates the active session's entry reference (called after boundary modifications).
     * @param entry the updated entry
     */
    updateEntry(entry: FullEntry): void {
        if (this.activeSession) {
            this.activeSession.entry = entry;
            this._onDidChangeCodeLenses.fire();
            this.refreshEditingDecorations();
        }
    }

    public updateDecorationsForVisibleEditors(): void {
        this.refreshEditingDecorations();
    }
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
            editor.setDecorations(this.decorationStyles.single, decorations.single);
            editor.setDecorations(this.decorationStyles.top, decorations.top);
            editor.setDecorations(this.decorationStyles.middle, decorations.middle);
            editor.setDecorations(this.decorationStyles.bottom, decorations.bottom);
        }
    }

    private buildDecorationRanges(location: FullLocation): Record<"single" | "top" | "middle" | "bottom", vscode.Range[]> {
        const ranges = {
            single: [] as vscode.Range[],
            top: [] as vscode.Range[],
            middle: [] as vscode.Range[],
            bottom: [] as vscode.Range[],
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

    private clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.decorationStyles.single, []);
        editor.setDecorations(this.decorationStyles.top, []);
        editor.setDecorations(this.decorationStyles.middle, []);
        editor.setDecorations(this.decorationStyles.bottom, []);
    }

    private isSessionDocument(uri: vscode.Uri): boolean {
        if (!this.activeSession) {
            return false;
        }
        return path.normalize(uri.fsPath) === path.normalize(this.activeSession.uri.fsPath);
    }

    /**
     * Provides CodeLens items for the document.
     * Only returns lenses when boundary editing mode is active and the document matches.
     */
    provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        if (!this.activeSession) {
            return [];
        }

        // Compare paths - normalize both to handle any path format differences
        const docPath = document.uri.fsPath;
        const sessionPath = this.activeSession.uri.fsPath;

        // Only show lenses for the file being edited
        if (path.normalize(docPath) !== path.normalize(sessionPath)) {
            return [];
        }

        const location = this.activeSession.entry.locations[this.activeSession.locationIndex];
        if (!location) {
            return [];
        }
        const lenses: vscode.CodeLens[] = [];

        // Create a unique identifier for the location
        const locationId = `${this.activeSession.entry.label}:${this.activeSession.locationIndex}`;

        // === TOP BOUNDARY CONTROLS (at startLine) ===
        const topRange = new vscode.Range(location.startLine, 0, location.startLine, 0);

        // Expand up (move startLine up by 1)
        if (location.startLine > 0) {
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: "$(arrow-up) Expand",
                    command: "weAudit.boundaryExpandUp",
                    tooltip: "Expand finding boundary up by one line",
                    arguments: [locationId],
                }),
            );
        }

        // Shrink from top (move startLine down by 1)
        if (location.startLine < location.endLine) {
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: "$(arrow-down) Shrink",
                    command: "weAudit.boundaryShrinkTop",
                    tooltip: "Shrink finding boundary from top by one line",
                    arguments: [locationId],
                }),
            );
        }

        // Move up (shift entire region up by 1)
        if (location.startLine > 0) {
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: "$(triangle-up) Move",
                    command: "weAudit.boundaryMoveUp",
                    tooltip: "Move entire finding up by one line",
                    arguments: [locationId],
                }),
            );
        }

        // Done button at the top
        lenses.push(
            new vscode.CodeLens(topRange, {
                title: "$(check) Done",
                command: "weAudit.stopEditingBoundary",
                tooltip: "Finish editing finding boundary",
                arguments: [],
            }),
        );

        // === BOTTOM BOUNDARY CONTROLS (at endLine) ===
        // Only show bottom controls if endLine is different from startLine
        if (location.endLine !== location.startLine) {
            const bottomLine = Math.min(location.endLine + 1, document.lineCount - 1);
            const bottomRange = new vscode.Range(bottomLine, 0, bottomLine, 0);

            // Shrink from bottom (move endLine up by 1)
            if (location.endLine > location.startLine) {
                lenses.push(
                    new vscode.CodeLens(bottomRange, {
                        title: "$(arrow-up) Shrink",
                        command: "weAudit.boundaryShrinkBottom",
                        tooltip: "Shrink finding boundary from bottom by one line",
                        arguments: [locationId],
                    }),
                );
            }

            // Expand down (move endLine down by 1)
            lenses.push(
                new vscode.CodeLens(bottomRange, {
                    title: "$(arrow-down) Expand",
                    command: "weAudit.boundaryExpandDown",
                    tooltip: "Expand finding boundary down by one line",
                    arguments: [locationId],
                }),
            );

            // Move down (shift entire region down by 1)
            lenses.push(
                new vscode.CodeLens(bottomRange, {
                    title: "$(triangle-down) Move",
                    command: "weAudit.boundaryMoveDown",
                    tooltip: "Move entire finding down by one line",
                    arguments: [locationId],
                }),
            );
        } else {
            // Single-line finding: show expand down on the same line
            lenses.push(
                new vscode.CodeLens(topRange, {
                    title: "$(arrow-down) Expand Down",
                    command: "weAudit.boundaryExpandDown",
                    tooltip: "Expand finding boundary down by one line",
                    arguments: [locationId],
                }),
            );
        }

        return lenses;
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

    // Register the CodeLens provider for all text documents (file + untitled)
    // Use a glob pattern so the provider also works in remote scenarios (where the scheme isn't "file")
    const selector: vscode.DocumentSelector = [{ pattern: "**/*" }, { scheme: "untitled" }];
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, provider));

    // Command: Start editing finding boundary
    context.subscriptions.push(
        vscode.commands.registerCommand("weAudit.editFindingBoundary", () => {
            const locationOrEntry = getLocationUnderCursor();
            if (!locationOrEntry) {
                return;
            }

            let entry: FullEntry;
            let locationIndex: number;

            if (isLocationEntry(locationOrEntry)) {
                entry = locationOrEntry.parentEntry;
                // Find the index of this location in the parent entry
                locationIndex = entry.locations.indexOf(locationOrEntry.location);
                if (locationIndex === -1) {
                    vscode.window.showErrorMessage("weAudit: Could not find location in entry.");
                    return;
                }
            } else if (isEntry(locationOrEntry)) {
                entry = locationOrEntry;
                // For a FullEntry, we edit the first location by default
                // But we need to find which location the cursor is actually in
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return;
                }
                const cursorLine = editor.selection.active.line;
                locationIndex = entry.locations.findIndex((loc) => cursorLine >= loc.startLine && cursorLine <= loc.endLine);
                if (locationIndex === -1) {
                    locationIndex = 0; // Default to first location
                }
            } else {
                return;
            }

            provider.startEditing(entry, locationIndex);
        }),
    );

    // Command: Stop editing finding boundary
    context.subscriptions.push(
        vscode.commands.registerCommand("weAudit.stopEditingBoundary", () => {
            provider.stopEditing();
        }),
    );

    // Helper to get the active editor's document
    const getActiveDocument = (): vscode.TextDocument | undefined => {
        return vscode.window.activeTextEditor?.document;
    };

    const registerBoundaryCommand = (commandId: string, startDelta: number, endDelta: number): void => {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, () => {
                const session = provider.getActiveSession();
                const document = getActiveDocument();
                if (!session || !document) {
                    return;
                }
                if (modifyLocationBoundary(session.entry, session.locationIndex, startDelta, endDelta, document)) {
                    provider.updateEntry(session.entry);
                }
            }),
        );
    };

    registerBoundaryCommand("weAudit.boundaryExpandUp", -1, 0);
    registerBoundaryCommand("weAudit.boundaryShrinkTop", 1, 0);
    registerBoundaryCommand("weAudit.boundaryExpandDown", 0, 1);
    registerBoundaryCommand("weAudit.boundaryShrinkBottom", 0, -1);
    registerBoundaryCommand("weAudit.boundaryMoveUp", -1, -1);
    registerBoundaryCommand("weAudit.boundaryMoveDown", 1, 1);

    // Stop editing when switching to a different file
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!provider.isEditing()) {
                return;
            }
            const session = provider.getActiveSession();
            if (session && editor && editor.document.uri.fsPath !== session.uri.fsPath) {
                provider.stopEditing();
            }
        }),
    );

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(() => {
            if (provider.isEditing()) {
                provider.updateDecorationsForVisibleEditors();
            }
        }),
    );
}
