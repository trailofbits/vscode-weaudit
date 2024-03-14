import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";
import { SERIALIZED_FILE_EXTENSION } from "./codeMarker";

interface ConfigurationEntry {
    path: string;
    username: string;
}

let lightEyePath: vscode.Uri;
let darkEyePath: vscode.Uri;

export class MultipleSavedFindingsTree implements vscode.TreeDataProvider<ConfigurationEntry> {
    private configurationEntries: ConfigurationEntry[];
    private workspacePath: string;
    private currentUsernames: string[];
    private username: string;

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConfigurationEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    constructor() {
        this.workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath;

        this.configurationEntries = [];
        this.findAndLoadConfigurationFiles();

        this.currentUsernames = [];
        this.username = userInfo().username;

        // register a command that refreshes the tree
        vscode.commands.registerCommand("weAudit.refreshSavedFindings", (usernames: string[]) => {
            this.currentUsernames = usernames;
            this.refresh();
        });

        // register a command that calls findAndLoadConfigurationFiles
        vscode.commands.registerCommand("weAudit.findAndLoadConfigurationFiles", () => {
            this.findAndLoadConfigurationFiles();
            this.refresh();
        });
    }

    findAndLoadConfigurationFiles() {
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }

        this.configurationEntries = [];
        fs.readdirSync(vscodeFolder).forEach((file) => {
            if (path.extname(file) === SERIALIZED_FILE_EXTENSION) {
                const parsedPath = path.parse(file);
                const entry = { path: path.join(vscodeFolder, file), username: parsedPath.name };
                this.configurationEntries.push(entry);
                if (parsedPath.name === this.username && this.currentUsernames.length === 0) {
                    this.currentUsernames.push(this.username);
                }
            }
        });
    }

    // tree data provider
    getChildren(element?: ConfigurationEntry): ConfigurationEntry[] {
        if (element === undefined) {
            return this.configurationEntries;
        }
        return [];
    }

    getParent(_element: ConfigurationEntry): undefined {
        return undefined;
    }

    getTreeItem(element: ConfigurationEntry): vscode.TreeItem {
        const label = element.username;
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

        treeItem.command = {
            command: "weAudit.loadSavedFindings",
            title: "Load saved findings from file",
            arguments: [element.path, element.username],
        };
        treeItem.description = path.basename(element.path);
        treeItem.tooltip = element.username + "'s findings";

        if (this.currentUsernames.includes(element.username)) {
            treeItem.iconPath = { light: lightEyePath, dark: darkEyePath };
        }

        return treeItem;
    }
}

export class MultipleSavedFindings {
    constructor(context: vscode.ExtensionContext) {
        // icons
        lightEyePath = vscode.Uri.file(context.asAbsolutePath("media/eye.svg"));
        darkEyePath = vscode.Uri.file(context.asAbsolutePath("media/whiteeye.svg"));

        const treeDataProvider = new MultipleSavedFindingsTree();

        vscode.window.onDidChangeActiveColorTheme(() => treeDataProvider.refresh());
        const treeView = vscode.window.createTreeView("savedFindings", { treeDataProvider });
        context.subscriptions.push(treeView);
    }
}
