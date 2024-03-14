import * as vscode from "vscode";
import * as path from "path";

import { Entry, EntryType } from "./types";

export class ResolvedEntriesTree implements vscode.TreeDataProvider<Entry> {
    private resolvedEntries: Entry[];
    private workspacePath: string;

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<Entry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    constructor(resolvedEntries: Entry[]) {
        this.resolvedEntries = resolvedEntries;
        this.workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath;
    }

    setResolvedEntries(entries: Entry[]): void {
        this.resolvedEntries = entries;
        this.refresh();
    }

    // tree data provider
    getChildren(element?: Entry): Entry[] {
        if (element === undefined) {
            return this.resolvedEntries;
        }
        return [];
    }

    getParent(_element: Entry): undefined {
        return undefined;
    }

    getTreeItem(entry: Entry): vscode.TreeItem {
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
            arguments: [vscode.Uri.file(path.join(this.workspacePath, mainLocation.path)), mainLocation.startLine, mainLocation.endLine],
        };

        treeItem.description = path.basename(mainLocation.path);
        treeItem.tooltip = entry.author + "'s findings";

        return treeItem;
    }
}

export class ResolvedEntries {
    private treeDataProvider: ResolvedEntriesTree;

    constructor(context: vscode.ExtensionContext, resolvedEntries: Entry[]) {
        this.treeDataProvider = new ResolvedEntriesTree(resolvedEntries);

        vscode.window.onDidChangeActiveColorTheme(() => this.treeDataProvider.refresh());

        const treeView = vscode.window.createTreeView("resolvedFindings", { treeDataProvider: this.treeDataProvider });
        context.subscriptions.push(treeView);
    }

    public refresh(): void {
        this.treeDataProvider.refresh();
    }

    public setResolvedEntries(entries: Entry[]): void {
        this.treeDataProvider.setResolvedEntries(entries);
        this.refresh();
    }
}
