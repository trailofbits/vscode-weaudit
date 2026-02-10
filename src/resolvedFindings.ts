import * as vscode from "vscode";
import * as path from "path";

import { FullEntry, EntryType, EntryResolution } from "./types";

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

export class ResolvedEntriesTree implements vscode.TreeDataProvider<FullEntry> {
    private resolvedEntries: FullEntry[];

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<FullEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    constructor(resolvedEntries: FullEntry[]) {
        this.resolvedEntries = resolvedEntries;
    }

    setResolvedEntries(entries: FullEntry[]): void {
        this.resolvedEntries = entries;
        this.refresh();
    }

    // tree data provider
    getChildren(element?: FullEntry): FullEntry[] {
        if (element === undefined) {
            return this.resolvedEntries;
        }
        return [];
    }

    getParent(_element: FullEntry): undefined {
        return undefined;
    }

    getTreeItem(entry: FullEntry): vscode.TreeItem {
        const resolutionEmoji = getResolutionEmoji(entry);
        const label = resolutionEmoji ? `${resolutionEmoji} ${entry.label}` : entry.label;
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        if (entry.entryType === EntryType.Note) {
            treeItem.iconPath = new vscode.ThemeIcon("bookmark");
        } else {
            treeItem.iconPath = new vscode.ThemeIcon("bug");
        }
        const mainLocation = entry.locations[0];
        treeItem.command = {
            command: "weAudit.openFileLines",
            title: "Open File",
            arguments: [vscode.Uri.file(path.join(mainLocation.rootPath, mainLocation.path)), mainLocation.startLine, mainLocation.endLine],
        };

        const badge = getResolutionBadge(entry);
        treeItem.description = `${path.basename(mainLocation.path)} [${badge}]`;
        treeItem.tooltip = `${entry.author}'s ${entry.entryType === EntryType.Note ? "note" : "finding"} (${badge})`;
        treeItem.contextValue = entry.entryType === EntryType.Note ? "resolvedNote" : "resolvedFinding";

        return treeItem;
    }
}

export class ResolvedEntries {
    private treeDataProvider: ResolvedEntriesTree;

    constructor(context: vscode.ExtensionContext, resolvedEntries: FullEntry[]) {
        this.treeDataProvider = new ResolvedEntriesTree(resolvedEntries);

        vscode.window.onDidChangeActiveColorTheme(() => this.treeDataProvider.refresh());

        const treeView = vscode.window.createTreeView("resolvedFindings", { treeDataProvider: this.treeDataProvider });
        context.subscriptions.push(treeView);
    }

    public refresh(): void {
        this.treeDataProvider.refresh();
    }

    public setResolvedEntries(entries: FullEntry[]): void {
        this.treeDataProvider.setResolvedEntries(entries);
        this.refresh();
    }
}
