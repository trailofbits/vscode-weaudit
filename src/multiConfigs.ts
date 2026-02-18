import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SERIALIZED_FILE_EXTENSION } from "./codeMarker";
import {
    ConfigurationEntry,
    WorkspaceRootEntry,
    ConfigTreeEntry,
    isConfigurationEntry,
    isWorkspaceRootEntry,
    configEntryEquals,
    RootPathAndLabel,
} from "./types";

let lightEyePath: vscode.Uri;
let darkEyePath: vscode.Uri;

/**
 * Tree data provider that discovers and lists saved weAudit configuration files
 * across workspace roots, allowing users to toggle visibility of other users' findings.
 */
export class MultipleSavedFindingsTree implements vscode.TreeDataProvider<ConfigTreeEntry> {
    private configurationEntries: ConfigurationEntry[];
    private rootEntries: WorkspaceRootEntry[];
    private rootPathsAndLabels: RootPathAndLabel[];
    private activeConfigs: ConfigurationEntry[];

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConfigTreeEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    /** Fires the tree data change event to refresh the tree view. */
    refresh(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    constructor() {
        this.rootPathsAndLabels = [];

        this.configurationEntries = [];
        this.rootEntries = [];
        this.activeConfigs = [];

        // register a command that sets the root paths and labels
        vscode.commands.registerCommand("weAudit.setMultiConfigRoots", (rootPathsAndLabels: RootPathAndLabel[]) => {
            this.rootPathsAndLabels = rootPathsAndLabels;
        });

        // register a command that refreshes the tree
        vscode.commands.registerCommand("weAudit.refreshSavedFindings", (configs: ConfigurationEntry[]) => {
            this.activeConfigs = configs;
            this.refresh();
        });

        // register a command that calls findAndLoadConfigurationFiles
        vscode.commands.registerCommand("weAudit.findAndLoadConfigurationFiles", async () => {
            await vscode.commands.executeCommand("weAudit.getMultiConfigRoots");
            this.findAndLoadConfigurationFiles();
            this.refresh();
        });
    }

    /**
     * Scans all workspace root .vscode directories for weAudit configuration files
     * and populates the tree entries.
     */
    findAndLoadConfigurationFiles(): void {
        this.configurationEntries = [];
        this.rootEntries = [];
        for (const rootPathAndLabel of this.rootPathsAndLabels) {
            const vscodeFolder = path.join(rootPathAndLabel.rootPath, ".vscode");
            if (!fs.existsSync(vscodeFolder)) {
                continue;
            }

            const rootEntry = { label: rootPathAndLabel.rootLabel } as WorkspaceRootEntry;
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

    /** Returns child elements for the tree view. Root-level returns workspace roots or config entries. */
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

    /** Returns the parent element for a config tree entry, or undefined for root entries. */
    getParent(element: ConfigTreeEntry): ConfigTreeEntry | undefined {
        if (this.rootPathsAndLabels.length > 1 && isConfigurationEntry(element)) {
            // For multiple roots, the parent of a configuration file is its root entry
            return element.root;
        }
        // Otherwise no parent
        return undefined;
    }

    /** Converts a config tree entry into a VS Code TreeItem for display. */
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

/**
 * Registers the "Saved Findings" tree view and its data provider,
 * enabling users to browse and toggle saved finding configurations.
 */
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
