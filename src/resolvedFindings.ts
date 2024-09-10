import * as vscode from "vscode";
import * as path from "path";

import { Entry, FullEntry, EntryType } from "./types";

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
        const label = entry.label;
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

        treeItem.description = path.basename(mainLocation.path);
        treeItem.tooltip = entry.author + "'s findings";

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
