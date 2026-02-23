import * as vscode from "vscode";
import * as path from "path";

import { FullEntry, EntryType, EntryResolution, FindingSeverity } from "./types";

/**
 * Returns a short status badge for a resolved entry.
 * @param entry The resolved entry to label.
 * @returns A short status badge string.
 */
function getResolutionBadge(entry: FullEntry): string {
    if (entry.entryType === EntryType.Note) {
        return "RESOLVED";
    }

    if (entry.details?.resolution === EntryResolution.TruePositive) {
        return "TP";
    }
    const resolutionValue = String(entry.details?.resolution);
    if (resolutionValue === "False Positive" || resolutionValue === "False Negative") {
        return "FP";
    }
    if (entry.details?.resolution === EntryResolution.Unclassified) {
        return "UNCLASSIFIED";
    }

    return "UNCLASSIFIED";
}

/**
 * Returns an emoji that reflects the resolution status for resolved findings.
 * @param entry The resolved entry to label.
 * @returns An emoji for the resolution, or an empty string when not applicable.
 */
function getResolutionEmoji(entry: FullEntry): string {
    if (entry.entryType !== EntryType.Finding) {
        return "";
    }

    if (entry.details?.resolution === EntryResolution.TruePositive) {
        return "✅";
    }

    const resolutionValue = String(entry.details?.resolution);
    if (entry.details?.resolution === EntryResolution.FalsePositive || resolutionValue === "False Positive" || resolutionValue === "False Negative") {
        return "❌";
    }

    return "";
}

/**
 * Returns a theme color used to tint finding icons by severity.
 * @param severity The severity value to map to a theme color.
 * @returns A theme color for the icon, or undefined to use the default color.
 */
function getSeverityColor(severity: FindingSeverity | undefined): vscode.ThemeColor | undefined {
    switch (severity) {
        case FindingSeverity.High:
            return new vscode.ThemeColor("problemsErrorIcon.foreground");
        case FindingSeverity.Medium:
            return new vscode.ThemeColor("problemsWarningIcon.foreground");
        case FindingSeverity.Low:
            return new vscode.ThemeColor("problemsInfoIcon.foreground");
        case FindingSeverity.Informational:
            return new vscode.ThemeColor("descriptionForeground");
        case FindingSeverity.Undetermined:
        case FindingSeverity.Undefined:
        default:
            return undefined;
    }
}

/**
 * Tree data provider for the resolved findings view, displaying entries that have
 * been marked as true positive, false positive, or resolved.
 */
export class ResolvedEntriesTree implements vscode.TreeDataProvider<FullEntry> {
    private resolvedEntries: FullEntry[];

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<FullEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    /** Fires a tree-data-changed event to refresh the resolved findings view. */
    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * @param resolvedEntries The initial list of resolved entries to display.
     */
    constructor(resolvedEntries: FullEntry[]) {
        this.resolvedEntries = resolvedEntries;
    }

    /**
     * Replaces the resolved entries list and refreshes the view.
     * @param entries The new set of resolved entries.
     */
    setResolvedEntries(entries: FullEntry[]): void {
        this.resolvedEntries = entries;
        this.refresh();
    }

    /** Returns the resolved entries at the tree root, or an empty array for child elements. */
    getChildren(element?: FullEntry): FullEntry[] {
        if (element === undefined) {
            return this.resolvedEntries;
        }
        return [];
    }

    /** Returns undefined since the resolved entries tree is flat. */
    getParent(_element: FullEntry): undefined {
        return undefined;
    }

    /**
     * Builds a tree item for a resolved entry, including resolution badge and severity icon.
     * @param entry The resolved entry to render.
     */
    getTreeItem(entry: FullEntry): vscode.TreeItem {
        const resolutionEmoji = getResolutionEmoji(entry);
        const label = resolutionEmoji ? `${resolutionEmoji} ${entry.label}` : entry.label;
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        if (entry.entryType === EntryType.Note) {
            treeItem.iconPath = new vscode.ThemeIcon("bookmark");
        } else {
            treeItem.iconPath = new vscode.ThemeIcon("bug", getSeverityColor(entry.details?.severity));
        }
        const badge = getResolutionBadge(entry);
        const mainLocation = entry.locations[0];
        if (mainLocation !== undefined) {
            treeItem.command = {
                command: "weAudit.openFileLines",
                title: "Open File",
                arguments: [vscode.Uri.file(path.join(mainLocation.rootPath, mainLocation.path)), mainLocation.startLine, mainLocation.endLine],
            };
            treeItem.description = `${path.basename(mainLocation.path)} [${badge}]`;
            treeItem.tooltip = `${entry.author}'s ${entry.entryType === EntryType.Note ? "note" : "finding"} (${badge})`;
        } else {
            treeItem.description = `No location [${badge}]`;
            treeItem.tooltip = `${entry.author}'s ${entry.entryType === EntryType.Note ? "note" : "finding"} (${badge}, no location)`;
        }
        treeItem.contextValue = entry.entryType === EntryType.Note ? "resolvedNote" : "resolvedFinding";

        return treeItem;
    }
}

/**
 * Manages the resolved findings tree view lifecycle, including creation and refresh.
 */
export class ResolvedEntries {
    private treeDataProvider: ResolvedEntriesTree;

    /**
     * Creates the resolved entries tree view and registers it with the extension context.
     * @param context The extension context for subscriptions.
     * @param resolvedEntries The initial set of resolved entries.
     */
    constructor(context: vscode.ExtensionContext, resolvedEntries: FullEntry[]) {
        this.treeDataProvider = new ResolvedEntriesTree(resolvedEntries);

        vscode.window.onDidChangeActiveColorTheme(() => this.treeDataProvider.refresh());

        const treeView = vscode.window.createTreeView("resolvedFindings", { treeDataProvider: this.treeDataProvider });
        context.subscriptions.push(treeView);
    }

    /** Refreshes the resolved findings tree view. */
    public refresh(): void {
        this.treeDataProvider.refresh();
    }

    /**
     * Replaces the resolved entries and refreshes the tree view.
     * @param entries The new set of resolved entries.
     */
    public setResolvedEntries(entries: FullEntry[]): void {
        this.treeDataProvider.setResolvedEntries(entries);
        this.refresh();
    }
}
