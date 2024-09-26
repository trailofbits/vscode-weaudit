import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";
import { SERIALIZED_FILE_EXTENSION } from "./codeMarker";
import { ConfigurationEntry, WorkspaceRootEntry, ConfigTreeEntry, isConfigurationEntry, isWorkspaceRootEntry, configEntryEquals } from "./types";

let lightEyePath: vscode.Uri;
let darkEyePath: vscode.Uri;

export class MultipleSavedFindingsTree implements vscode.TreeDataProvider<ConfigTreeEntry> {
    private configurationEntries: ConfigurationEntry[];
    private rootEntries: WorkspaceRootEntry[];
    private rootPathsAndLabels: [string, string][];
    private activeConfigs: ConfigurationEntry[];
    private username: string;

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConfigTreeEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    constructor() {
        this.rootPathsAndLabels = [];

        this.configurationEntries = [];
        this.rootEntries = [];
        this.activeConfigs = [];

        this.username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;

        // register a command that sets the root paths and labels
        vscode.commands.registerCommand("weAudit.setMultiConfigRoots", (rootPathsAndLabels: [string, string][]) => {
            this.rootPathsAndLabels = rootPathsAndLabels;
        });

        // register a command that refreshes the tree
        vscode.commands.registerCommand("weAudit.refreshSavedFindings", (configs: ConfigurationEntry[]) => {
            this.activeConfigs = configs;
            this.refresh();
        });

        // register a command that calls findAndLoadConfigurationFiles
        vscode.commands.registerCommand("weAudit.findAndLoadConfigurationFiles", () => {
            this.findAndLoadConfigurationFiles();
            this.refresh();
        });
    }

    findAndLoadConfigurationFiles() {
        this.configurationEntries = [];
        this.rootEntries = [];
        for (const [rootPath, rootLabel] of this.rootPathsAndLabels) {
            const vscodeFolder = path.join(rootPath, ".vscode");
            if (!fs.existsSync(vscodeFolder)) {
                continue;
            }

            const rootEntry = { label: rootLabel } as WorkspaceRootEntry;
            this.rootEntries.push(rootEntry);

            fs.readdirSync(vscodeFolder).forEach((file) => {
                if (path.extname(file) === SERIALIZED_FILE_EXTENSION) {
                    const parsedPath = path.parse(file);
                    const entry = { path: path.join(vscodeFolder, file), username: parsedPath.name, root: rootEntry };
                    this.configurationEntries.push(entry);
                }
            });
        }
    }

    // tree data provider
    getChildren(element?: ConfigTreeEntry): ConfigTreeEntry[] {
        if (this.rootPathsAndLabels.length > 1) {
            // For multiple roots, the tree root entries are the basenames of the workspace roots
            if (element === undefined) {
                return this.rootEntries;
            } else if (isWorkspaceRootEntry(element)) {
                return this.configurationEntries.filter((entry) => entry.root.label === element.label);
            }
        } else {
            // For a single root, the tree root entries are the configuration files
            if (element === undefined) {
                return this.configurationEntries;
            }
        }
        return [];
    }

    getParent(element: ConfigTreeEntry): ConfigTreeEntry | undefined {
        if (this.rootPathsAndLabels.length > 1 && isConfigurationEntry(element)) {
            // For multiple roots, the parent of a configuration file is its root entry
            return element.root;
        }
        // Otherwise no parent
        return undefined;
    }

    getTreeItem(element: ConfigTreeEntry): vscode.TreeItem {
        if (isWorkspaceRootEntry(element)) {
            // Workspace root entries are collapsible but have no command
            return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        } else {
            const label = element.username;
            const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

            treeItem.command = {
                command: "weAudit.toggleSavedFindings",
                title: "Load saved findings from file",
                arguments: [element],
            };
            treeItem.description = path.basename(element.path);
            treeItem.tooltip = element.username + "'s findings";

            if (this.activeConfigs.findIndex((entry) => configEntryEquals(entry, element)) !== -1) {
                treeItem.iconPath = { light: lightEyePath, dark: darkEyePath };
            }

            return treeItem;
        }
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
