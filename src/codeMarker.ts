import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { FromLocationResponse } from "./externalTypes";
import { userInfo } from "os";
import { spawnSync } from "child_process";
import { plot } from "asciichart";

import { ResolvedEntries } from "./resolvedFindings";
import { labelAfterFirstLineTextDecoration, hoverOnLabel, DecorationManager } from "./decorationManager";
import {
    Entry,
    SerializedData,
    TreeEntry,
    AuditedFile,
    TreeViewMode,
    Location,
    LocationEntry,
    isLocationEntry,
    isEntry,
    Repository,
    PathOrganizerEntry,
    createDefaultEntryDetails,
    createDefaultSerializedData,
    createLocationEntry,
    isPathOrganizerEntry,
    FindingDifficulty,
    FindingSeverity,
    FindingType,
    EntryType,
    RemoteAndPermalink,
    validateSerializedData,
    createPathOrganizer,
    getEntryIndexFromArray,
    treeViewModeLabel,
    mergeTwoEntryArrays,
    mergeTwoAuditedFileArrays,
} from "./types";

export const SERIALIZED_FILE_EXTENSION = ".weaudit";
const DAY_LOG_FILENAME = ".weauditdaylog";

export class CodeMarker implements vscode.TreeDataProvider<TreeEntry> {
    // treeEntries contains the currently active entries: findings and notes
    private treeEntries: Entry[];

    // resolvedEntries contains all entries that have been resolved
    private resolvedEntries: Entry[];

    // auditedFiles contains all files that have been audited
    private auditedFiles: AuditedFile[];
    private workspacePath: string;
    private username: string;
    private currentlySelectedUsernames: string[];
    private gitRemote: string;
    private gitSha: string;
    private clientRemote: string;

    // locationEntries contains a map associating a file path to an array of additional locations
    private pathToEntryMap: Map<string, TreeEntry[]>;

    // markedFilesDayLog contains a map associating a string representing a date to a file path.
    private markedFilesDayLog: Map<string, string[]>;

    private treeViewMode: TreeViewMode;

    private _onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorationsEmitter.event;

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<Entry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    private resolvedEntriesTree: ResolvedEntries;

    // firstTimeRequestingClientRemote is used to prevent repeatedly asking for the client remote
    private firstTimeRequestingClientRemote = true;

    private decorationManager: DecorationManager;

    constructor(context: vscode.ExtensionContext, decorationManager: DecorationManager) {
        this.treeEntries = [];
        this.resolvedEntries = [];
        this.auditedFiles = [];
        this.workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath;
        this.clientRemote = "";
        this.gitRemote = "";
        this.gitSha = "";

        this.decorationManager = decorationManager;

        this.pathToEntryMap = new Map<string, TreeEntry[]>();

        this.markedFilesDayLog = new Map<string, string[]>();
        this.loadDayLogFromFile();

        this.treeViewMode = TreeViewMode.List;
        this.loadTreeViewModeConfiguration();

        this.username = userInfo().username;
        this.currentlySelectedUsernames = [];
        this.findAndLoadConfigurationUsernames();
        this.resolvedEntriesTree = new ResolvedEntries(context, this.resolvedEntries);

        vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.currentlySelectedUsernames);

        // Fill the Git configuration webview with the current git configuration
        vscode.commands.registerCommand(
            "weAudit.pushGitConfigView",
            () => {
                vscode.commands.executeCommand("weAudit.setGitConfigView", this.clientRemote, this.gitRemote, this.gitSha);
            },
            this,
        );

        this.decorate();

        vscode.commands.registerCommand("weAudit.toggleAudited", () => {
            this.toggleAudited();
        });

        vscode.commands.registerCommand("weAudit.toggleTreeViewMode", () => {
            this.toggleTreeViewMode();
        });

        vscode.commands.registerCommand("weAudit.addFinding", () => {
            this.addFinding();
        });

        vscode.commands.registerCommand("weAudit.addNote", () => {
            this.addNote();
        });

        vscode.commands.registerCommand("weAudit.resolveFinding", (node: Entry) => {
            this.resolveFinding(node);
        });

        vscode.commands.registerCommand("weAudit.deleteFinding", (node: Entry) => {
            this.deleteFinding(node);
        });

        vscode.commands.registerCommand("weAudit.editEntryTitle", (node: Entry) => {
            this.editEntryTitle(node);
        });

        vscode.commands.registerCommand("weAudit.editLocationEntry", (node: LocationEntry) => {
            this.editLocationEntryDescription(node);
        });

        vscode.commands.registerCommand("weAudit.restoreFinding", (node: Entry) => {
            this.restoreFinding(node);
        });

        vscode.commands.registerCommand("weAudit.deleteResolvedFinding", (node: Entry) => {
            this.deleteResolvedFinding(node);
        });

        vscode.commands.registerCommand("weAudit.deleteAllResolvedFinding", () => {
            this.deleteAllResolvedFindings();
        });

        vscode.commands.registerCommand("weAudit.restoreAllResolvedFindings", () => {
            this.restoreAllResolvedFindings();
        });

        vscode.commands.registerCommand("weAudit.editEntryUnderCursor", () => {
            const entry = this.getLocationUnderCursor();
            if (entry) {
                const toEdit = isLocationEntry(entry) ? entry.parentEntry : entry;
                this.editEntryTitle(toEdit);
            }
        });

        vscode.commands.registerCommand("weAudit.deleteLocationUnderCursor", () => {
            const entry = this.getLocationUnderCursor();
            if (entry) {
                const toDelete = isEntry(entry) ? createLocationEntry(entry.locations[0], entry) : entry;
                this.deleteLocation(toDelete);
            }
        });

        vscode.commands.registerCommand("weAudit.copyEntryPermalink", (entry: Entry | LocationEntry) => {
            this.copyEntryPermalink(entry);
        });

        vscode.commands.registerTextEditorCommand("weAudit.copySelectedCodePermalink", () => {
            this.copySelectedCodePermalink(Repository.Audit);
        });

        vscode.commands.registerTextEditorCommand("weAudit.copySelectedCodeClientPermalink", () => {
            this.copySelectedCodePermalink(Repository.Client);
        });

        vscode.commands.registerCommand("weAudit.editClientRemote", () => {
            this.editClientRemote();
        });

        vscode.commands.registerCommand("weAudit.editAuditRemote", () => {
            this.editAuditRemote();
        });

        vscode.commands.registerCommand("weAudit.editGitHash", () => {
            this.editGitHash();
        });

        vscode.commands.registerCommand("weAudit.setupRepositories", () => {
            this.setupRepositories();
        });

        vscode.commands.registerCommand("weAudit.openGithubIssue", (entry: Entry | LocationEntry) => {
            // transform absolute paths to relative paths to the workspace path
            const actualEntry: Entry = isLocationEntry(entry) ? entry.parentEntry : entry;

            for (const location of actualEntry.locations) {
                try {
                    location.path = this.relativizePath(location.path);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to open GitHub issue. The file ${location.path} is not in the workspace (${this.workspacePath}).`);
                    return;
                }
            }
            this.openGithubIssue(actualEntry);
        });

        vscode.commands.registerCommand("weAudit.loadSavedFindings", (filename: string, username: string) => {
            // Push username if not already in list, remove otherwise.
            const idx = this.currentlySelectedUsernames.indexOf(username);
            const savedData = this.loadSavedDataFromFile(filename, true, idx === -1, username);
            if (idx === -1) {
                this.currentlySelectedUsernames.push(username);
            } else {
                this.currentlySelectedUsernames.splice(idx, 1);
            }

            // refresh the currently selected files, findings tree and file decorations
            vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.currentlySelectedUsernames);
            this.resolvedEntriesTree.setResolvedEntries(this.resolvedEntries);
            this.refreshTree();
            this.decorate();
            if (!savedData) {
                return;
            }
            // trigger the file decoration event so that the file decorations are updated
            for (const entry of savedData.treeEntries) {
                for (const loc of entry.locations) {
                    const uri = vscode.Uri.file(path.join(this.workspacePath, loc.path));
                    this._onDidChangeFileDecorationsEmitter.fire(uri);
                }
            }
        });

        vscode.commands.registerCommand("weAudit.updateCurrentSelectedEntry", (field: string, value: string, isPersistent: boolean) => {
            this.updateCurrentlySelectedEntry(field, value, isPersistent);
        });

        vscode.commands.registerCommand("weAudit.updateGitConfig", (clientRemote: string, auditRemote: string, gitSha: string) => {
            this.updateGitConfig(clientRemote, auditRemote, gitSha);
        });

        vscode.commands.registerCommand("weAudit.externallyLoadFindings", (results: Entry[]) => {
            // transform absolute paths to relative paths to the workspace path
            for (const result of results) {
                for (const loc of result.locations) {
                    try {
                        loc.path = this.relativizePath(loc.path);
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Failed to load external findings. The file ${loc.path} is not in the workspace (${this.workspacePath}).`,
                        );
                        return;
                    }
                }
            }
            this.externallyLoadFindings(results);
        });

        vscode.commands.registerCommand("weAudit.showMarkedFilesDayLog", () => {
            this.showMarkedFilesDayLog();
        });

        vscode.commands.registerCommand("weAudit.getClientPermalink", (location: Location) => {
            // transform absolute paths to relative paths to the workspace path
            try {
                location.path = this.relativizePath(location.path);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to get permalink. The file ${location.path} is not in the workspace (${this.workspacePath}).`);
                return;
            }

            return this.getClientPermalink(location);
        });

        vscode.commands.registerCommand("weAudit.addRegionToAnEntry", () => {
            this.addRegionToAnEntry();
        });

        vscode.commands.registerCommand("weAudit.deleteLocation", (entry: LocationEntry) => {
            this.deleteLocation(entry);
        });

        // ======== PUBLIC INTERFACE ========
        vscode.commands.registerCommand("weAudit.getCodeToCopyFromLocation", (entry: Entry | LocationEntry) => {
            return this.getCodeToCopyFromLocation(entry);
        });

        vscode.commands.registerCommand("weAudit.getSelectedClientCodeAndPermalink", () => {
            return this.getSelectedClientCodeAndPermalink();
        });
    }

    private updateGitConfig(clientRemote: string, auditRemote: string, gitSha: string) {
        this.clientRemote = clientRemote;
        this.gitRemote = auditRemote;
        this.gitSha = gitSha;
    }

    async getSelectedClientCodeAndPermalink(): Promise<FromLocationResponse | void> {
        const location = this.getActiveSelectionLocation();
        const editor = vscode.window.activeTextEditor!;

        const remoteAndPermalink = await this.getRemoteAndPermalink(Repository.Client, location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        // we don't use editor.document.getText(selection) because we want to copy full lines
        const range = new vscode.Range(
            new vscode.Position(location.startLine, 0),
            new vscode.Position(location.endLine, editor.document.lineAt(location.endLine).text.length),
        );
        const codeToCopy = editor.document.getText(range);

        return { codeToCopy: codeToCopy, permalink: remoteAndPermalink.permalink };
    }

    async getCodeToCopyFromLocation(entry: Entry | LocationEntry): Promise<FromLocationResponse | void> {
        const location = isLocationEntry(entry) ? entry.location : entry.locations[0];
        const permalink = await this.getClientPermalink(location);
        if (permalink === undefined) {
            return;
        }
        const codeToCopy = await this.getLocationCode(location);
        return { codeToCopy, permalink };
    }

    /**
     * Transforms a relative or absolute path in a normalized path relative to the current workspace
     * @param _path the path to transform
     * @returns the normalized path relative to the current workspace
     * @throws an error if the path is not in the workspace
     */
    private relativizePath(_path: string): string {
        _path = path.normalize(_path);

        if (path.isAbsolute(_path)) {
            _path = path.relative(this.workspacePath, _path);
        }

        if (_path.startsWith("..")) {
            throw new Error(`The file ${_path} is not in the workspace (${this.workspacePath}).`);
        }

        return _path;
    }

    externallyLoadFindings(entries: Entry[]) {
        const authors = new Set<string>();

        for (const entry of entries) {
            // If we have the exact same entry in resolved entries, don't do anything
            const idxResolved = getEntryIndexFromArray(entry, this.resolvedEntries);
            if (idxResolved !== -1) {
                continue;
            }

            // If we have the exact same entry in tree entries, don't do anything
            const idx = getEntryIndexFromArray(entry, this.treeEntries);
            if (idx !== -1) {
                continue;
            }

            // If we have a similar entry (same author and title) in tree entries, modify the existing entry
            let foundSimilarEntry = false;
            for (const e of this.treeEntries) {
                if (e.author === entry.author && e.label === entry.label) {
                    // We do not update the details because these may have been modified by the user
                    // We do not remove locations; we only add the ones that are missing
                    for (const loc of entry.locations) {
                        const idx = e.locations.findIndex((l) => l.path === loc.path && l.startLine === loc.startLine && l.endLine === loc.endLine);
                        if (idx === -1) {
                            e.locations.push(loc);
                        }
                    }
                    this.refreshAndDecorateEntry(e);
                    authors.add(e.author);
                    foundSimilarEntry = true;
                    break;
                }
            }

            // If we did not find a similar entry, add the entry to the tree entries
            if (!foundSimilarEntry) {
                this.treeEntries.push(entry);
                this.refreshAndDecorateEntry(entry);
                authors.add(entry.author);
                continue;
            }
        }

        if (authors.size > 0) {
            for (const author of authors) {
                this.updateSavedData(author);
            }
            // call findAndLoadConfigurationFiles to refresh the Saved Finding Files list
            vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
        }
    }

    updateCurrentlySelectedEntry(field: string, value: string, isPersistent: boolean): void {
        if (treeView.selection.length === 0) {
            return;
        }

        let entry = treeView.selection[0];

        if (isPathOrganizerEntry(entry)) {
            return;
        }

        // Determine if it is an additional location;
        // if so, we need to find it's parent entry and update that instead
        if (isLocationEntry(entry)) {
            entry = entry.parentEntry;
        }

        // TODO: determine how to update the entry from the field string
        switch (field) {
            case "severity":
                entry.details.severity = value as FindingSeverity;
                break;
            case "difficulty":
                entry.details.difficulty = value as FindingDifficulty;
                break;
            case "type":
                entry.details.type = value as FindingType;
                break;
            case "description":
                entry.details.description = value;
                break;
            case "exploit":
                entry.details.exploit = value;
                break;
            case "recommendation":
                entry.details.recommendation = value;
                break;
            case "label": {
                entry.label = value;
                this.refreshTree();
                this.refreshAndDecorateEntry(entry);
                treeView.reveal(entry);
                break;
            }
        }
        if (isPersistent) {
            this.updateSavedData(entry.author);
        }
    }

    /**
     * Loads the tree view mode from the configuration and updates the tree view mode,
     * refreshing the tree.
     */
    loadTreeViewModeConfiguration(): void {
        const mode: string = vscode.workspace.getConfiguration("weAudit").get("general.treeViewMode")!;
        if (mode === "list") {
            this.treeViewMode = TreeViewMode.List;
        } else {
            this.treeViewMode = TreeViewMode.GroupByFile;
        }
        this.refreshTree();
    }

    /**
     * Toggles the tree view mode between linear and organized per file,
     * updates the configuration and
     * refreshes the tree.
     */
    toggleTreeViewMode(): void {
        if (this.treeViewMode === TreeViewMode.List) {
            this.treeViewMode = TreeViewMode.GroupByFile;
        } else {
            this.treeViewMode = TreeViewMode.List;
        }
        const label = treeViewModeLabel(this.treeViewMode);
        vscode.workspace.getConfiguration("weAudit").update("general.treeViewMode", label, true)!;
        this.refreshTree();
    }

    /**
     * Finds all serialized files in the .vscode folder and loads the data from them.
     * Also updates the currently selected usernames.
     */
    findAndLoadConfigurationUsernames(): void {
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }

        this.currentlySelectedUsernames = [];
        fs.readdirSync(vscodeFolder).forEach((file) => {
            if (path.extname(file) === SERIALIZED_FILE_EXTENSION) {
                const parsedPath = path.parse(file);
                this.currentlySelectedUsernames.push(parsedPath.name);
                this.loadSavedDataFromFile(path.join(vscodeFolder, file), true, true, parsedPath.name);
            }
        });
    }

    /**
     * Toggles the current active file as audited or not audited.
     */
    toggleAudited(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;
        // get path relative to workspace
        const relativePath = path.relative(this.workspacePath, uri.fsPath);

        let relevantUsername;
        // check if file is already in list
        const index = this.auditedFiles.findIndex((file) => file.path === relativePath);
        if (index > -1) {
            // if it exists, remove it
            const auditedEntry = this.auditedFiles.splice(index, 1);
            relevantUsername = auditedEntry[0].author;
            this.checkIfAllSiblingFilesAreAudited(uri);
        } else {
            // if it doesn't exist, add it
            this.auditedFiles.push({ path: relativePath, author: this.username });
            relevantUsername = this.username;
            this.checkIfAllSiblingFilesAreAudited(uri);
        }
        // update day log structure
        const isAdd = index === -1;
        this.updateDayLog(relativePath, isAdd);

        // update decorations
        this.decorateWithUri(uri);
        this.updateSavedData(relevantUsername);
        this.refresh(uri);
    }

    /**
     * Updates the daily log with the marked/unmarked file
     * for today's date.
     * @param relativePath the relative path of the file
     * @param add whether to add or remove the file from the list
     */
    updateDayLog(relativePath: string, add: boolean): void {
        const today = new Date();
        const todayString = today.toDateString();
        const todayFiles = this.markedFilesDayLog.get(todayString);
        if (todayFiles === undefined) {
            this.markedFilesDayLog.set(todayString, [relativePath]);
        } else {
            // check if file is already in list
            const index = todayFiles.findIndex((file) => file === relativePath);
            if (index > -1 && !add) {
                // if it exists, remove it
                todayFiles.splice(index, 1);
            } else if (index === -1 && add) {
                todayFiles.push(relativePath);
            }
        }
        this.persistDayLog();
    }

    /**
     * Persist the day log to a file.
     */
    persistDayLog() {
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }
        const dayLogPath = path.join(vscodeFolder, DAY_LOG_FILENAME);
        fs.writeFileSync(dayLogPath, JSON.stringify(Array.from(this.markedFilesDayLog), null, 2));
    }

    /**
     * Loads the day log from storage.
     */
    loadDayLogFromFile() {
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }
        if (!fs.existsSync(path.join(vscodeFolder, DAY_LOG_FILENAME))) {
            return;
        }

        const dayLogPath = path.join(vscodeFolder, DAY_LOG_FILENAME);
        this.markedFilesDayLog = new Map(JSON.parse(fs.readFileSync(dayLogPath, "utf8")));
    }

    /**
     * Creates and shows a representation of
     * the marked files by daily log, in markdown format.
     */
    showMarkedFilesDayLog(): void {
        // sort the keys of the map by date
        const sortedDates = new Map(Array.from(this.markedFilesDayLog).sort(([a], [b]) => Date.parse(a) - Date.parse(b)));

        const asciiArrayData = new Array(sortedDates.keys.length);
        let idxDataArray = 0;

        let logString = "";
        let totalLOC = 0;

        for (const [date, files] of sortedDates) {
            if (files && files.length > 0) {
                let filesString = `## ${date}\n - `;
                filesString += files.join("\n - ");
                logString += `${filesString}\n\n`;

                // count the LOC per day
                const fullPaths = files.map((file) => path.join(this.workspacePath, file));
                const wcProc = spawnSync("wc", ["-l", ...fullPaths]);
                const output = wcProc.output[1]!;
                // wc outputs a final total line.
                // We get the LOC from that line by finding the first newline from the end.
                const idx = output.length - " total\n".length;
                let i = idx;
                for (i = idx; i >= 0; --i) {
                    // 10 is the ascii code for newline
                    if (output[i] === 10) {
                        break;
                    }
                }
                const loc = parseInt(output.slice(i + 1, idx).toString());
                totalLOC += loc;
                logString += `Daily LOC: ${loc}\n\n`;

                // add a separator
                logString += "---\n\n";

                // add to the graph
                asciiArrayData[idxDataArray] = loc;

                idxDataArray++;
            }
        }

        // exit if no files have been marked yet
        if (logString === "") {
            vscode.window.showInformationMessage("No files have been marked as reviewed.");
            return;
        }

        // add the total LOC to the log
        logString += `Total LOC: ${totalLOC}\n\n`;

        logString += plot(asciiArrayData, { height: 8 });
        vscode.workspace
            .openTextDocument({
                language: "markdown",
                content: logString,
            })
            .then((doc) => {
                vscode.window.showTextDocument(doc).then((editor) => {
                    // reveal the last line of the document
                    const lastLine = doc.lineAt(doc.lineCount - 1);
                    editor.revealRange(lastLine.range);
                });
            });
    }

    /**
     * Checks if all sibling files of the file that was audit-toggle are audited.
     * If they are, the containing folder is added to the list of audited files.
     * If they are not, the containing folder is removed from the list of audited files.
     * Fires the onDidChangeFileDecorationsEmitter in case the folder decoration needs to be updated.
     * TODO: too many findIndex calls, maybe use a map instead of an array
     * @param uri The uri of the file that was audit-toggle
     */
    checkIfAllSiblingFilesAreAudited(uri: vscode.Uri) {
        // iterate over all the files in the same folder as the file that was audited
        const folder = path.dirname(uri.fsPath);
        const files = fs.readdirSync(folder);
        let allFilesAudited = true;
        for (const file of files) {
            // if any file is not audited, set allFilesAudited to false
            const relativePath = path.relative(this.workspacePath, path.join(folder, file));
            if (this.auditedFiles.findIndex((file) => file.path === relativePath) === -1) {
                allFilesAudited = false;
                break;
            }
        }
        const folderUri = vscode.Uri.file(folder);

        // if all files are audited, add the folder to the list of audited files
        if (allFilesAudited) {
            this.auditedFiles.push({ path: path.relative(this.workspacePath, folder), author: this.username });
            this._onDidChangeFileDecorationsEmitter.fire(folderUri);
            // additionally, call checkIfAllSiblingFilesAreAudited on the parent folder
            this.checkIfAllSiblingFilesAreAudited(folderUri);
        } else {
            // if not all files are audited, remove the folder from the list of audited files
            const index = this.auditedFiles.findIndex((file) => file.path === path.relative(this.workspacePath, folder));
            if (index > -1) {
                this.auditedFiles.splice(index, 1);
                this._onDidChangeFileDecorationsEmitter.fire(folderUri);
                // additionally, call checkIfAllSiblingFilesAreAudited on the parent folder for recursive removal
                this.checkIfAllSiblingFilesAreAudited(folderUri);
            }
        }
    }

    /**
     * Edit the label of a marked code region
     * @param entry The entry to edit
     */
    async editEntryTitle(entry: Entry): Promise<void> {
        const entryTypeLabel = entry.entryType === EntryType.Finding ? "finding" : "note";
        const label = await vscode.window.showInputBox({
            title: `Edit ${entryTypeLabel} title`,
            value: entry.label,
            ignoreFocusOut: true,
        });
        if (label === undefined) {
            return;
        }
        entry.label = label;
        treeView.reveal(entry);
        this.refreshTree();
        this.decorate();
        this.updateSavedData(entry.author);
    }

    async editLocationEntryDescription(locationEntry: LocationEntry): Promise<void> {
        const label = await vscode.window.showInputBox({
            title: `Edit location label`,
            value: locationEntry.location.label,
            ignoreFocusOut: true,
        });
        if (label === undefined) {
            return;
        }
        locationEntry.location.label = label;

        this.refreshTree();
        this.decorate();
        this.updateSavedData(locationEntry.parentEntry.author);
    }

    /**
     * Get the git remote and the permalink for the given code region
     * @param repository If the repository is the Audit repository or the Client repository
     * @param startLine The start line of the code region
     * @param endLine The end line of the code region
     * @param path The path of the file
     * @returns The git remote and the permalink, or undefined if either could not be found
     */
    async getRemoteAndPermalink(repository: Repository, location: Location): Promise<RemoteAndPermalink | undefined> {
        let gitRemote;
        switch (repository) {
            case Repository.Audit:
                gitRemote = await this.findGitRemote();
                break;
            case Repository.Client:
                gitRemote = await this.findClientRemote();
                break;
        }

        if (!gitRemote) {
            vscode.window.showErrorMessage(`Could not determine the ${repository} Repository URL.`, `Configure ${repository} URL`).then((config) => {
                if (config === undefined) {
                    return;
                }
                switch (repository) {
                    case Repository.Audit:
                        this.editAuditRemote();
                        break;
                    case Repository.Client:
                        this.editClientRemote();
                        break;
                }
            });
            return;
        }

        const sha = this.findGitSha();
        if (!sha) {
            vscode.window.showErrorMessage("Could not determine the commit hash.", "Configure Commit Hash").then((config) => {
                if (config === undefined) {
                    return;
                }
                this.editGitHash();
            });
            return;
        }

        const issueLocation = `#L${location.startLine + 1}-L${location.endLine + 1}`;
        const permalink = gitRemote + "/blob/" + sha + "/" + location.path + issueLocation;
        return { remote: gitRemote, permalink };
    }

    /**
     * Get the git remote and the permalink for the given location, in the audit repository
     * @param location The location to get the remote and permalink for
     * @returns The git remote and the permalink, or undefined if either could not be found
     */
    async getEntryRemoteAndPermalink(location: Location): Promise<RemoteAndPermalink | undefined> {
        return this.getRemoteAndPermalink(Repository.Audit, location);
    }

    /**
     * Get the git remote and the permalink for the given entry, in the client repository
     * @param startLine The start line of the code region
     * @param endLine The end line of the code region
     * @param path The path of the file
     * @returns The permalink, or undefined if either could not be found
     */
    async getClientPermalink(location: Location): Promise<string | undefined> {
        const remoteAndPermalink = await this.getRemoteAndPermalink(Repository.Client, location);
        if (remoteAndPermalink) {
            return remoteAndPermalink.permalink;
        }
    }

    /**
     * Copy a permalink to the currently selected text to the clipboard
     * @param repository If the repository is the Audit repository or the Client repository
     */
    async copySelectedCodePermalink(repository: Repository): Promise<void> {
        const location = this.getActiveSelectionLocation();

        const remoteAndPermalink = await this.getRemoteAndPermalink(repository, location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        this.copyToClipboard(remoteAndPermalink.permalink);
    }

    /**
     * Edit the client's remote repository
     */
    async editClientRemote(): Promise<void> {
        const clientRemote = await vscode.window.showInputBox({ title: "Edit Client Repository:", value: this.clientRemote, ignoreFocusOut: true });
        if (clientRemote === undefined) {
            return;
        }
        this.clientRemote = clientRemote;
        this.persistClientRemote();
    }

    /**
     * Edit the audit repository
     */
    async editAuditRemote(): Promise<void> {
        const auditRemote = await vscode.window.showInputBox({ title: "Edit Audit Repository:", value: this.gitRemote, ignoreFocusOut: true });
        if (auditRemote === undefined) {
            return;
        }
        this.gitRemote = auditRemote;
        this.persistAuditRemote();
    }

    /**
     * Edit the git sha
     */
    async editGitHash(): Promise<void> {
        const gitSha = await vscode.window.showInputBox({ title: "Edit Git Commit Hash:", value: this.gitSha, ignoreFocusOut: true });
        if (gitSha === undefined) {
            return;
        }
        this.gitSha = gitSha;
        this.persistGitHash();
    }

    /**
     * Setup the client remote, audit remote and git hash
     */
    async setupRepositories(): Promise<void> {
        await this.findGitRemote();
        await this.editAuditRemote();

        await this.editClientRemote();

        this.findGitSha();
        await this.editGitHash();

        // persist the data
        this.updateSavedData(this.username);
    }

    /**
     * Copy the permalink of the given entry to the clipboard
     * @param entry The entry to copy the permalink of
     */
    async copyEntryPermalink(entry: Entry | LocationEntry): Promise<void> {
        const location = isLocationEntry(entry) ? entry.location : entry.locations[0];
        const remoteAndPermalink = await this.getEntryRemoteAndPermalink(location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        this.copyToClipboard(remoteAndPermalink.permalink);
    }

    /**
     * Copy the given text to the clipboard
     * @param txt The text to copy to the clipboard
     */
    copyToClipboard(text: string): void {
        vscode.env.clipboard.writeText(text);
    }

    /**
     * Gets the text corresponding to the given location
     * @param location the location to get the text for
     * @returns the text corresponding to the given entry
     */
    async getLocationCode(location: Location): Promise<string> {
        await vscode.commands.executeCommand(
            "weAudit.openFileLines",
            vscode.Uri.file(path.join(this.workspacePath, location.path)),
            location.startLine,
            location.endLine,
        );
        const document = vscode.window.activeTextEditor!.document;
        const startLine = location.startLine;
        const endLine = location.endLine;
        let code = "";
        for (let i = startLine; i <= endLine; i++) {
            code += document.lineAt(i).text + "\n";
        }
        return code;
    }

    /**
     * Open a prefilled github issue for the given entry
     * @param entry The entry to open an issue for
     */
    async openGithubIssue(entry: Entry): Promise<void> {
        const clientPermalinks = [];
        const auditPermalinks = [];
        let locationDescriptions = "";

        // Use .entries to iterate over entry.locations
        for (const [i, location] of entry.locations.entries()) {
            const clientRemoteAndPermalink = await this.getRemoteAndPermalink(Repository.Client, location);
            const auditRemoteAndPermalink = await this.getRemoteAndPermalink(Repository.Audit, location);
            if (auditRemoteAndPermalink === undefined) {
                return;
            }
            const clientPermalink = clientRemoteAndPermalink === undefined ? "" : clientRemoteAndPermalink.permalink;
            clientPermalinks.push(clientPermalink);
            auditPermalinks.push(auditRemoteAndPermalink.permalink);

            if (location.description !== "") {
                locationDescriptions += `\n\n---\n`;
                locationDescriptions += `#### Location ${i + 1} ${location.label}\n`;
                locationDescriptions += `${location.description}\n\n`;
                locationDescriptions += `${auditRemoteAndPermalink.permalink}`;
            }
        }

        // open github issue with the issue body with the finding text and permalink
        const title = encodeURIComponent(entry.label);

        const target = entry.locations.map((location) => location.path).join(", ");
        const permalinks = auditPermalinks.join("\n");
        const clientPermalinkString = clientPermalinks.join("\n");

        let issueBodyText = `### Title\n${entry.label}\n\n`;
        issueBodyText += `### Severity\n${entry.details.severity}\n\n`;
        issueBodyText += `### Difficulty\n${entry.details.difficulty}\n\n`;
        issueBodyText += `### Type\n${entry.details.type}\n\n`;
        issueBodyText += `### Target\n${target}\n\n`;
        issueBodyText += `## Description\n${entry.details.description}${locationDescriptions}\n\n`;
        issueBodyText += `## Exploit Scenario\n${entry.details.exploit}\n\n`;
        issueBodyText += `## Recommendations\n${entry.details.recommendation}\n\n\n`;

        issueBodyText += `Permalink:\n${permalinks}\n\n`;
        if (clientPermalinkString !== "" && this.clientRemote !== this.gitRemote) {
            issueBodyText += `Client PermaLink:\n${clientPermalinkString}\n`;
        }

        const issueBody = encodeURIComponent(issueBodyText);

        const issueUrl = this.gitRemote + "/issues/new?";
        const issueUrlWithBody = `${issueUrl}title=${title}&body=${issueBody}`;
        // GitHub's URL max size is about 8000 characters
        if (issueUrlWithBody.length < 8000) {
            // hack to get around the double encoding of openExternal.
            // We call it with a string even though it's expecting a Uri
            // https://github.com/microsoft/vscode/issues/85930
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            vscode.env.openExternal(issueUrlWithBody);
            return;
        }

        // Prompt the user to copy the issue body and open the empty issue page
        vscode.window.showErrorMessage("The issue body is too long to open automatically in the URL", "Copy issue to clipboard and open browser window").then((action) => {
            if (action === undefined) {
                return;
            }
            vscode.env.clipboard.writeText(issueBodyText);
            const pasteHere = encodeURIComponent("[Paste the issue body here]");
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            vscode.env.openExternal(`${issueUrl}title=${title}&body=${pasteHere}`);
        });
    }

    /**
     * Find the client's remote repository
     * @returns The client's remote repository, or undefined if it could not be found
     */
    async findClientRemote(): Promise<string | undefined> {
        if (this.firstTimeRequestingClientRemote && this.clientRemote === "") {
            await this.editClientRemote();
            this.firstTimeRequestingClientRemote = false;
        }
        return this.clientRemote;
    }

    /**
     * Find the git remote for the current workspace
     */
    async findGitRemote(): Promise<string | undefined> {
        if (this.gitRemote !== "") {
            return this.gitRemote;
        }

        if (!this.workspacePath) {
            return;
        }

        const gitPath = path.join(this.workspacePath, ".git");
        if (!fs.existsSync(gitPath)) {
            return;
        }
        const gitConfig = fs.readFileSync(gitPath + "/config", "utf8");
        if (!gitConfig) {
            return;
        }
        const remoteUrl = gitConfig.match(/url = (.*)/g);
        if (!remoteUrl) {
            return;
        }

        // try to find a githubOrganizationName remote
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const githubOrganizationName: string = vscode.workspace.getConfiguration("weAudit").get("general.githubOrganizationName")!;
        for (const remote of remoteUrl) {
            if (!remote.includes(githubOrganizationName)) {
                continue;
            }
            let remotePath = remote.split("=")[1].trim();
            if (remotePath.startsWith("git@github.com:")) {
                remotePath = remotePath.replace("git@github.com:", "https://github.com/");
            }
            if (!remotePath.includes(`github.com/${githubOrganizationName}/`)) {
                return;
            }
            if (remotePath.endsWith(".git")) {
                remotePath = remotePath.slice(0, -".git".length);
            }
            this.gitRemote = remotePath;
            this.persistAuditRemote();
            return remotePath;
        }

        if (remoteUrl.length === 0) {
            this.editAuditRemote();
            return this.gitRemote;
        }

        // if no githubOrganizationName remote was found, use the first remote
        let remotePath = remoteUrl[0].split("=")[1].trim();
        if (remotePath.startsWith("git@github.com:")) {
            remotePath = remotePath.replace("git@github.com:", "https://github.com/");
        }
        if (remotePath.endsWith(".git")) {
            remotePath = remotePath.slice(0, -".git".length);
        }
        this.gitRemote = remotePath;
        // confirm with the user if this is the repo they want to use
        await this.editAuditRemote();

        // if we don't have a githubOrganizationName remote,
        // it means that the client remote is probably the same as the git remote
        this.clientRemote = remotePath;
        this.updateSavedData(this.username);
        return this.gitRemote;
    }

    /**
     * Find the git sha for the current workspace
     * @returns The git sha or undefined if it could not be found
     */
    findGitSha(): string | undefined {
        if (this.gitSha !== "") {
            return this.gitSha;
        }

        const gitPath = path.join(this.workspacePath, ".git", "HEAD");
        if (!fs.existsSync(gitPath)) {
            return;
        }

        let gitHead = fs.readFileSync(gitPath, "utf8");
        if (!gitHead) {
            return;
        }

        const headPath = gitHead.match(/ref: (.*)/);
        if (!headPath) {
            // probably a detached head
            // check if gitHead has the correct hash length
            gitHead = gitHead.trim();
            if (gitHead.length !== 40) {
                console.error("[weAudit] Could not determine the git sha. Seemed to be a detached head but the hash length was not 40: " + gitHead);
                return;
            }
            this.gitSha = gitHead.trim();
            this.persistGitHash();
            return this.gitSha;
        }

        const shaPath = path.join(this.workspacePath, ".git", headPath[1]);
        if (!fs.existsSync(shaPath)) {
            return;
        }
        const shaCommit = fs.readFileSync(shaPath, "utf8");
        if (!shaCommit) {
            return;
        }
        this.gitSha = shaCommit.trim();
        this.persistGitHash();
        return this.gitSha;
    }

    /**
     * Gets the index of the tree entry that matches the given path and intersects the provided line range.
     * This does not use entryEquals because we use it to find which tree entry intersects
     * the cursor position.
     * @param location The location to check
     * @returns The index of the entry in the tree entries list or -1 if it was not found
     */
    getIntersectingTreeEntryIndex(location: Location, entryType: EntryType): number {
        const entryTree = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
        for (let i = 0; i < this.treeEntries.length; i++) {
            const entry = this.treeEntries[i];
            if (entry.entryType !== entryType) {
                continue;
            }
            for (const loc of entry.locations) {
                if (loc.path === location.path) {
                    const range = new vscode.Range(loc.startLine, 0, loc.endLine, 0);
                    if (entryTree.intersection(range) !== undefined) {
                        return i;
                    }
                }
            }
        }
        return -1;
    }

    /**
     * Removes the entry from the tree entries list and optionally adds
     * it to the resolved entries list.
     * @param entry the entry to remove from the tree entries list
     * @param resolve whether to add the entry to the resolved entries list
     */
    deleteAndResolveFinding(entry: Entry, resolve: boolean): void {
        const idx = getEntryIndexFromArray(entry, this.treeEntries);
        if (idx === -1) {
            console.log("error in deleteAndResolveFinding");
            return;
        }
        const removed = this.treeEntries.splice(idx, 1)[0];
        // depending on resolve, add the entry to the resolved entries list and refresh the resolved tree
        if (resolve) {
            if (entry.details === undefined) {
                entry.details = createDefaultEntryDetails();
            }
            this.resolvedEntries.push(removed);
            this.resolvedEntriesTree.refresh();
        }

        this.updateSavedData(removed.author);
        this.refreshAndDecorateEntry(removed);
    }

    /**
     * Deletes the entry from the tree entries list, but does not add it to the
     * resolved entries list.
     * @param entry the entry to remove from the tree entries list
     */
    deleteFinding(entry: Entry): void {
        this.deleteAndResolveFinding(entry, false);
    }

    /**
     * Deletes the entry from the tree entries list and adds it to the
     * resolved entries list.
     * @param entry the entry to resolve.
     */
    resolveFinding(entry: Entry): void {
        this.deleteAndResolveFinding(entry, true);
    }

    /**
     * Creates a new finding entry and adds it to the tree entries list,
     * or edits the entry if it already exists.
     *
     */
    addFinding() {
        this.createOrEditEntry(EntryType.Finding);
    }

    /**
     * Creates a new note entry and adds it to the tree entries list,
     * or edits the entry if it already exists.
     */
    addNote() {
        this.createOrEditEntry(EntryType.Note);
    }

    /**
     * Restores the entry to the tree entries list and removes it from the
     * resolved entries list.
     * @param entry the entry to restore
     */
    restoreFinding(entry: Entry): void {
        // consider the case of older entries without details
        if (entry.details === undefined) {
            entry.details = createDefaultEntryDetails();
        }

        this.treeEntries.push(entry);
        const idx = getEntryIndexFromArray(entry, this.resolvedEntries);
        if (idx === -1) {
            console.log("error in restoreFinding");
            return;
        }
        this.resolvedEntries.splice(idx, 1);
        this.resolvedEntriesTree.refresh();

        this.refreshAndDecorateEntry(entry);
        this.updateSavedData(entry.author);
    }

    /**
     * Deletes the entry from the resolved entries list.
     * @param entry the entry to delete
     */
    deleteResolvedFinding(entry: Entry): void {
        const idx = getEntryIndexFromArray(entry, this.resolvedEntries);
        if (idx === -1) {
            console.log("error in deleteResolvedFinding");
            return;
        }
        this.resolvedEntries.splice(idx, 1);
        this.resolvedEntriesTree.refresh();
        this.updateSavedData(entry.author);
    }

    /**
     * Deletes all resolved findings.
     */
    deleteAllResolvedFindings() {
        if (this.resolvedEntries.length === 0) {
            return;
        }

        // get the authors of the resolved findings without duplicates
        const authors = this.resolvedEntries.map((entry) => entry.author).filter((value, index, self) => self.indexOf(value) === index);

        this.resolvedEntries.splice(0, this.resolvedEntries.length);
        for (const author of authors) {
            this.updateSavedData(author);
        }
        this.resolvedEntriesTree.refresh();
    }

    /**
     * Restores all resolved findings.
     */
    restoreAllResolvedFindings() {
        if (this.resolvedEntries.length === 0) {
            return;
        }

        this.treeEntries = this.treeEntries.concat(this.resolvedEntries);

        // get authors and paths tuples of the resolved findings
        const authorSet: Set<string> = new Set();
        for (const entry of this.resolvedEntries) {
            authorSet.add(entry.author);
        }

        // we share the same array as the resolvedFindings array, so we can't do `this.resolvedEntries = []`
        const spliced = this.resolvedEntries.splice(0, this.resolvedEntries.length);
        for (const author of authorSet) {
            this.updateSavedData(author);
        }

        for (const entry of spliced) {
            this.refreshEntry(entry);
        }
        this.resolvedEntriesTree.refresh();
        this.decorate();
    }

    /**
     * Creates a new entry of the given type and adds it to the tree entries list,
     * or deletes an existing entry of the given type if the active selection
     * intersects with an existing entry of the given type.
     *
     * @param entryType the type of the entry to create
     */
    async createOrEditEntry(entryType: EntryType) {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;
        const location = this.getActiveSelectionLocation();

        const intersectedIdx = this.getIntersectingTreeEntryIndex(location, entryType);

        // if we found an entry, edit the description
        if (intersectedIdx !== -1) {
            const entry = this.treeEntries[intersectedIdx];
            // editEntryTitle calls updateSavedData so we don't need to call it here
            this.editEntryTitle(entry);
        } else {
            // otherwise, add it to the tree entries
            // create title depending on the entry type
            const inputBoxTitle = entryType === EntryType.Finding ? "Add Finding Title" : "Add Note Title";
            const title = await vscode.window.showInputBox({ title: inputBoxTitle });
            if (title === undefined) {
                return;
            }

            const entry: Entry = {
                label: title,
                entryType: entryType,
                author: this.username,
                locations: [location],
                details: createDefaultEntryDetails(),
            };
            this.treeEntries.push(entry);
            this.updateSavedData(this.username);
        }

        this.decorateWithUri(uri);
        this.refresh(uri);
    }

    getActiveSelectionLocation(): Location {
        // the null assertion is never undefined because we check if the editor is undefined
        const editor = vscode.window.activeTextEditor!;
        const uri = editor.document.uri;

        const selectedCode = editor.selection;
        const startLine = selectedCode.start.line;

        let endLine = selectedCode.end.line;
        // vscode sets the end of a fully selected line as the first character of the next line
        // so we decrement the end line if the end character is 0 and the end line is not the same as the start line
        if (endLine > selectedCode.start.line && selectedCode.end.character === 0) {
            endLine--;
        }

        // github preview does not show the preview if the last document line is empty
        // so we decrement it by one
        if (endLine === editor.document.lineCount - 1 && editor.document.lineAt(endLine).text === "") {
            // ensure that we don't go before the start line
            endLine = Math.max(endLine - 1, startLine);
        }

        const relativePath = path.relative(this.workspacePath, uri.fsPath);
        return { path: relativePath, startLine, endLine, label: "", description: "" };
    }

    /**
     * Deletes an additional location from an entry
     * @param entry the entry of type "AdditionalEntry" to remove from some main entry
     */
    deleteLocation(entry: LocationEntry): void {
        // find the treeEntry with this additional data
        const parentEntry = entry.parentEntry;
        if (parentEntry.locations === undefined) {
            console.log("error in deleteLocation");
            return;
        }

        for (let i = 0; i < parentEntry.locations.length; i++) {
            const location = parentEntry.locations[i];
            if (location.path === entry.location.path && location.startLine === entry.location.startLine && location.endLine === entry.location.endLine) {
                parentEntry.locations.splice(i, 1);
                if (parentEntry.locations.length === 0) {
                    this.deleteFinding(parentEntry);
                    this.refreshAndDecorateFromPath(location.path);
                    return;
                }

                this.updateSavedData(parentEntry.author);
                // we only need to refresh the URI for the deleted location
                this.refreshAndDecorateFromPath(entry.location.path);
                return;
            }
        }
    }

    /**
     * Updates the saved data for the given user.
     * @param username the username to update the saved data for
     */
    updateSavedData(username: string): void {
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        // create .vscode folder if it doesn't exist
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }

        const fileName = path.join(vscodeFolder, username + SERIALIZED_FILE_EXTENSION);
        if (!fs.existsSync(fileName) && !this.currentlySelectedUsernames.includes(username)) {
            this.currentlySelectedUsernames.push(username);
        }
        // filter entries of the affected user
        let filteredEntries = this.treeEntries.filter((entry) => entry.author === username);
        let filteredAuditedFiles = this.auditedFiles.filter((file) => file.author === username);
        let filteredResolvedEntries = this.resolvedEntries.filter((entry) => entry.author === username);

        // if we are not seeing the current user's findings, we can't simply overwrite the file
        // we need to merge the findings of the current user with their saved findings
        if (!this.currentlySelectedUsernames.includes(username)) {
            const previousEntries = this.loadSavedDataFromFile(fileName, false, false, username);
            if (previousEntries !== undefined) {
                filteredEntries = mergeTwoEntryArrays(filteredEntries, previousEntries.treeEntries);
                filteredAuditedFiles = mergeTwoAuditedFileArrays(filteredAuditedFiles, previousEntries.auditedFiles);
                filteredResolvedEntries = mergeTwoEntryArrays(filteredResolvedEntries, previousEntries.resolvedEntries);
            }
        }

        // save findings to file
        const data = JSON.stringify(
            {
                clientRemote: this.clientRemote,
                gitRemote: this.gitRemote,
                gitSha: this.gitSha,
                treeEntries: filteredEntries,
                auditedFiles: filteredAuditedFiles,
                resolvedEntries: filteredResolvedEntries,
            },
            null,
            2,
        );
        fs.writeFileSync(fileName, data, { flag: "w+" });
    }

    /**
     * Add the selected code region to an existing entry
     */
    async addRegionToAnEntry(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const location = this.getActiveSelectionLocation();

        // create a quick pick to select the entry to add the region to
        const items = this.treeEntries.map((entry) => {
            return {
                label: entry.label,
                entry: entry,
            };
        });

        // if we have no findings so far, create a new one
        if (items.length === 0) {
            this.addFinding();
            return;
        }

        vscode.window
            .showQuickPick(items, {
                ignoreFocusOut: true,
                title: "Select the finding to add the region to",
            })
            .then((pickItem) => {
                if (pickItem === undefined) {
                    return;
                }
                const entry = pickItem.entry;
                entry.locations.push(location);
                this.updateSavedData(entry.author);
                this.decorateWithUri(editor.document.uri);
                this.refresh(editor.document.uri);
                // reveal the entry in the tree view if the treeview is visible,
                // for some reason, it won't expand even if though it is created
                // with an expanded state
                if (treeView.visible) {
                    treeView.reveal(entry, { expand: 1, select: false });
                }
            });
    }

    /**
     * Loads the saved findings from a file
     * @param fileName  the file to load from
     * @param update  whether to update the tree entries
     * @param add  whether to add the findings to the tree entries
     * @param username  the username of the user whose findings are being loaded
     * @returns the parsed entries in the file
     */
    loadSavedDataFromFile(filename: string, update: boolean, add: boolean, username: string): SerializedData | undefined {
        if (!fs.existsSync(filename)) {
            return;
        }
        const data = fs.readFileSync(filename).toString();
        const parsedEntries: SerializedData = JSON.parse(data);

        if (!validateSerializedData(parsedEntries)) {
            vscode.window.showErrorMessage(`weAudit: Error loading serialized data for ${username}. Filepath: ${filename}`);
            return;
        }

        // load client remote if it exists and if the file is the current user's file
        if (username === this.username) {
            if (parsedEntries.clientRemote !== undefined) {
                this.clientRemote = parsedEntries.clientRemote;
            }
            if (parsedEntries.gitRemote !== undefined) {
                this.gitRemote = parsedEntries.gitRemote;
            }
            if (parsedEntries.gitSha !== undefined) {
                this.gitSha = parsedEntries.gitSha;
            }
        }

        for (const entry of parsedEntries.treeEntries) {
            for (const location of entry.locations) {
                const absoluteEntryPath = path.resolve(this.workspacePath, location.path);
                if (path.isAbsolute(location.path) || path.relative(this.workspacePath, absoluteEntryPath).startsWith("..")) {
                    vscode.window.showErrorMessage("Trying to import entries with regions outside this workspace: " + location.path);
                    return;
                }
            }
        }
        if (update) {
            if (add) {
                // Remove potential entries of username which appear on the tree.
                // This is to avoid duplicates
                if (!this.currentlySelectedUsernames.includes(username)) {
                    this.treeEntries = this.treeEntries.filter((entry) => entry.author !== username);
                    this.auditedFiles = this.auditedFiles.filter((entry) => entry.author !== username);
                    this.resolvedEntries = this.resolvedEntries.filter((entry) => entry.author !== username);
                }

                this.treeEntries = this.treeEntries.concat(parsedEntries.treeEntries);
                this.auditedFiles = this.auditedFiles.concat(parsedEntries.auditedFiles);
                // handle older versions of the extension that don't have resolved entries
                if (parsedEntries.resolvedEntries !== undefined) {
                    this.resolvedEntries = this.resolvedEntries.concat(parsedEntries.resolvedEntries);
                }
            } else {
                this.treeEntries = this.treeEntries.filter((entry) => entry.author !== username);
                this.auditedFiles = this.auditedFiles.filter((entry) => entry.author !== username);
                this.resolvedEntries = this.resolvedEntries.filter((entry) => entry.author !== username);
            }
        }
        return parsedEntries;
    }

    /**
     * Saves the client's remote repository to the current user's file
     */
    persistClientRemote(): void {
        vscode.commands.executeCommand("weAudit.setGitConfigView", this.clientRemote, this.gitRemote, this.gitSha);
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        // create .vscode folder if it doesn't exist
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }

        const filename = path.join(vscodeFolder, this.username + SERIALIZED_FILE_EXTENSION);
        let newData;
        if (!fs.existsSync(filename)) {
            const dataToSerialize = createDefaultSerializedData();
            dataToSerialize.clientRemote = this.clientRemote;
            newData = JSON.stringify(dataToSerialize, null, 2);
        } else {
            const data = fs.readFileSync(filename).toString();
            const parsedEntries: SerializedData = JSON.parse(data);
            parsedEntries.clientRemote = this.clientRemote;
            newData = JSON.stringify(parsedEntries, null, 2);
        }
        fs.writeFileSync(filename, newData, { flag: "w+" });
    }

    /**
     * Saves the audit remote repository to the current user's file
     */
    persistAuditRemote(): void {
        vscode.commands.executeCommand("weAudit.setGitConfigView", this.clientRemote, this.gitRemote, this.gitSha);
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        // create .vscode folder if it doesn't exist
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }

        const filename = path.join(vscodeFolder, this.username + SERIALIZED_FILE_EXTENSION);
        let newData;
        if (!fs.existsSync(filename)) {
            const dataToSerialize = createDefaultSerializedData();
            dataToSerialize.gitRemote = this.gitRemote;
            newData = JSON.stringify(dataToSerialize, null, 2);
        } else {
            const data = fs.readFileSync(filename).toString();
            const parsedEntries: SerializedData = JSON.parse(data);
            parsedEntries.gitRemote = this.gitRemote;
            newData = JSON.stringify(parsedEntries, null, 2);
        }
        fs.writeFileSync(filename, newData, { flag: "w+" });
    }

    /**
     * Saves the relevant git hash to the current user's file
     */
    persistGitHash(): void {
        vscode.commands.executeCommand("weAudit.setGitConfigView", this.clientRemote, this.gitRemote, this.gitSha);
        const vscodeFolder = path.join(this.workspacePath, ".vscode");
        // create .vscode folder if it doesn't exist
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }

        const filename = path.join(vscodeFolder, this.username + SERIALIZED_FILE_EXTENSION);
        let newData;
        if (!fs.existsSync(filename)) {
            const dataToSerialize = createDefaultSerializedData();
            dataToSerialize.gitSha = this.gitSha;
            newData = JSON.stringify(dataToSerialize, null, 2);
        } else {
            const data = fs.readFileSync(filename).toString();
            const parsedEntries: SerializedData = JSON.parse(data);
            parsedEntries.gitSha = this.gitSha;
            newData = JSON.stringify(parsedEntries, null, 2);
        }
        fs.writeFileSync(filename, newData, { flag: "w+" });
    }

    /**
     * Implicitly called in this._onDidChangeFileDecorationsEmitter.fire(uri);
     * which is called on this.refresh(uri)
     * @param uri the uri of the file to decorate
     * @returns the decoration for the file
     */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const uriPath = path.relative(this.workspacePath, uri.fsPath);

        let hasFindings = false;

        outer: for (const entry of this.treeEntries) {
            // if any of the locations is on this file, badge it
            if (entry.entryType === EntryType.Finding && entry.locations) {
                for (const location of entry.locations) {
                    if (location.path === uriPath) {
                        hasFindings = true;
                        break outer;
                    }
                }
            }
        }
        // check if there is an entry for this file in the audited files
        const audited = this.auditedFiles.find((entry) => entry.path === uriPath);
        if (audited !== undefined) {
            if (hasFindings) {
                return {
                    badge: "✓!",
                    tooltip: "Audited but has findings to review",
                };
            } else {
                return {
                    badge: "✓",
                    tooltip: "Audited",
                };
            }
        } else if (hasFindings) {
            return {
                badge: "!",
                tooltip: "Has findings to review",
            };
        }
    }

    /**
     * Redecorates all currently visible editors based on the current treeEntries.
     */
    decorate(): void {
        vscode.window.visibleTextEditors.forEach((editor) => {
            this.decorateEditor(editor);
        });
    }

    /**
     * Redecorates all currently visible editors matching the given uri.
     * @param uri the uri of the file to decorate
     */
    decorateWithUri(uri: vscode.Uri): void {
        vscode.window.visibleTextEditors.forEach((editor) => {
            if (editor.document.uri.fsPath === uri.fsPath) {
                this.decorateEditor(editor);
            }
        });
    }

    /**
     * Redecorates the given editor based on the current treeEntries
     *  - decorate each region with the region decoration type
     *  - decorate the first line of each entry with its description and author
     * @param editor the editor to decorate
     */
    decorateEditor(editor: vscode.TextEditor): void {
        if (editor === undefined) {
            return;
        }

        const fname = path.relative(this.workspacePath, editor.document.fileName);

        const ownDecorations: vscode.Range[] = [];
        const otherDecorations: vscode.Range[] = [];
        const ownNoteDecorations: vscode.Range[] = [];
        const otherNoteDecorations: vscode.Range[] = [];
        const labelDecorations: vscode.DecorationOptions[] = [];

        for (const treeItem of this.treeEntries) {
            const isOwnEntry = this.username === treeItem.author;
            const findingDecoration = isOwnEntry ? ownDecorations : otherDecorations;
            const noteDecoration = isOwnEntry ? ownNoteDecorations : otherNoteDecorations;

            // decorate additional locations for that entry
            for (const location of treeItem.locations) {
                if (location.path !== fname) {
                    continue;
                }
                const range = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
                if (treeItem.entryType === EntryType.Finding) {
                    findingDecoration.push(range);
                } else if (treeItem.entryType === EntryType.Note) {
                    noteDecoration.push(range);
                }
                // add the author information
                const extraLabel = isOwnEntry ? "  (you)" : "  (" + treeItem.author + ")";

                labelDecorations.push(labelAfterFirstLineTextDecoration(location.startLine, treeItem.label + extraLabel));

                const afterLineRange = new vscode.Range(location.startLine, Number.MAX_SAFE_INTEGER, location.startLine, Number.MAX_SAFE_INTEGER);
                labelDecorations.push(hoverOnLabel(afterLineRange, treeItem.label));
            }
        }

        editor.setDecorations(this.decorationManager.ownFindingDecorationType, ownDecorations);
        editor.setDecorations(this.decorationManager.otherFindingDecorationType, otherDecorations);
        editor.setDecorations(this.decorationManager.ownNoteDecorationType, ownNoteDecorations);
        editor.setDecorations(this.decorationManager.otherNoteDecorationType, otherNoteDecorations);

        editor.setDecorations(this.decorationManager.emptyDecorationType, labelDecorations);

        // check if editor is audited, and mark it as such
        let range: vscode.Range[] = [];
        const audited = this.auditedFiles.find((entry) => entry.path === fname);
        if (audited !== undefined) {
            range = [new vscode.Range(0, 0, editor.document.lineCount, 0)];
        }
        editor.setDecorations(this.decorationManager.auditedFileDecorationType, range);
    }

    /**
     * Part of the TreeDataProvider interface.
     * This is the case where the findings are organized by file.
     * So,
     *  - the root elements are the unique file paths
     *  - the children of a file path are the findings and notes with that file path
     * Root elements are sorted alphabetically and
     * entries per file are sorted by their start line.
     * @param element the element to get the children of
     * @returns the children of the element
     */
    getChildrenPerFile(element?: TreeEntry): TreeEntry[] {
        if (element === undefined) {
            // get all unique entry file paths
            const pathSet: Set<string> = new Set();
            // clear the map on the root element
            this.pathToEntryMap.clear();

            for (const entry of this.treeEntries) {
                for (const location of entry.locations) {
                    pathSet.add(location.path);
                }
            }
            const uniquePaths = Array.from(pathSet);
            uniquePaths.sort();
            const pathOrganizerEntries: PathOrganizerEntry[] = [];
            for (const path of uniquePaths) {
                const entry = createPathOrganizer(path);
                pathOrganizerEntries.push(entry);
            }

            return pathOrganizerEntries;
        } else {
            // get entries with same path as element
            if (isPathOrganizerEntry(element)) {
                const entriesWithSamePath = [];
                for (const entry of this.treeEntries) {
                    for (const location of entry.locations) {
                        if (location.path === element.pathLabel) {
                            const locationEntry = createLocationEntry(location, entry);
                            entriesWithSamePath.push(locationEntry);
                        }
                    }
                }
                entriesWithSamePath.sort((a, b) => a.location.startLine - b.location.startLine);
                this.pathToEntryMap.set(element.pathLabel, entriesWithSamePath);
                return entriesWithSamePath;
            } else {
                return [];
            }
        }
    }

    /**
     * Part of the TreeDataProvider interface.
     * This is the case where the findings are organized linearly.
     * So,
     *  - the root element are all findings and notes
     *  - there are no children of the root element
     *
     * @param entry the element to get the children of
     * @returns the children of the element
     */
    getChildrenLinear(entry?: TreeEntry): TreeEntry[] {
        if (entry !== undefined) {
            if (isLocationEntry(entry) || isPathOrganizerEntry(entry) || !entry.locations) {
                return [];
            }

            return entry.locations.map((location) => {
                const childEntry = createLocationEntry(location, entry);
                const lis = this.pathToEntryMap.get(location.path);
                if (lis === undefined) {
                    this.pathToEntryMap.set(location.path, [childEntry]);
                } else {
                    lis.push(childEntry);
                }
                return childEntry;
            });
        }

        const entries: Entry[] = [];
        const notes: Entry[] = [];
        for (const entry of this.treeEntries) {
            if (entry.entryType === EntryType.Finding) {
                entries.push(entry);
            } else {
                notes.push(entry);
            }
        }
        const result = entries.concat(notes);

        // clear the map on the root element
        this.pathToEntryMap.clear();
        for (const entry of result) {
            // if the entry has only one location, add it to the map
            // otherwise, we will add all the locations to the map when we get the children of the entry
            if (entry.locations.length === 1) {
                const path = entry.locations[0].path;
                const lis = this.pathToEntryMap.get(path);
                if (lis === undefined) {
                    this.pathToEntryMap.set(path, [entry]);
                } else {
                    lis.push(entry);
                }
            }
        }
        return result;
    }

    /**
     * Part of the TreeDataProvider interface.
     * @param element the element to get the children of
     * @returns the children of the element
     */
    getChildren(element?: TreeEntry): TreeEntry[] {
        if (this.treeViewMode === TreeViewMode.List) {
            return this.getChildrenLinear(element);
        } else {
            return this.getChildrenPerFile(element);
        }
    }

    /**
     * Part of the TreeDataProvider interface.
     * @param element the element to get the parent of
     * @returns the parent of the element
     */
    getParent(e: TreeEntry): Entry | undefined {
        if (isLocationEntry(e)) {
            return e.parentEntry;
        }
        return undefined;
    }

    /**
     * Part of the TreeDataProvider interface.
     * If the entry is of type PathOrganizer, it is separator-like and can be expanded.
     * Otherwise, it is a leaf and cannot be expanded.
     * @param element the element to get the tree item for
     * @returns the tree item for the element
     */
    getTreeItem(entry: TreeEntry): vscode.TreeItem {
        if (isLocationEntry(entry)) {
            const state = vscode.TreeItemCollapsibleState.None;
            let description = path.basename(entry.location.path) + ":" + (entry.location.startLine + 1).toString();
            if (entry.location.endLine !== entry.location.startLine) {
                description += "-" + (entry.location.endLine + 1).toString();
            }
            let mainLabel: string;
            if (this.treeViewMode === TreeViewMode.List) {
                mainLabel = entry.location.label;
            } else {
                mainLabel = entry.parentEntry.label;
                if (entry.location.label) {
                    mainLabel += " - " + entry.location.label;
                }
            }
            const treeItem = new vscode.TreeItem(mainLabel, state);
            treeItem.description = description;
            treeItem.iconPath = new vscode.ThemeIcon("location");
            treeItem.contextValue = "additionalLocation";
            treeItem.command = {
                command: "weAudit.openFileLines",
                title: "Open File",
                arguments: [vscode.Uri.file(path.join(this.workspacePath, entry.location.path)), entry.location.startLine, entry.location.endLine],
            };
            return treeItem;
        } else if (isPathOrganizerEntry(entry)) {
            const state = vscode.TreeItemCollapsibleState.Expanded;
            const treeItem = new vscode.TreeItem(entry.pathLabel, state);
            treeItem.contextValue = "pathOrganizer";
            return treeItem;
        }

        // if it's not a location entry or a path organizer entry, it's a normal entry
        const state =
            entry.locations && entry.locations.length > 1 && this.treeViewMode === TreeViewMode.List
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
        const treeItem = new vscode.TreeItem(entry.label, state);

        if (entry.entryType === EntryType.Note) {
            treeItem.iconPath = new vscode.ThemeIcon("bookmark");
        } else {
            treeItem.iconPath = new vscode.ThemeIcon("bug");
        }

        const mainLocation = entry.locations[0];

        const basePath = path.basename(mainLocation.path);
        treeItem.description = basePath + ":" + (mainLocation.startLine + 1).toString();

        if (entry.author !== this.username) {
            treeItem.description += " (" + entry.author + ")";
        }

        treeItem.command = {
            command: "weAudit.openFileLines",
            title: "Open File",
            arguments: [vscode.Uri.file(path.join(this.workspacePath, mainLocation.path)), mainLocation.startLine, mainLocation.endLine],
        };

        return treeItem;
    }

    /**
     * Finds the entry under the cursor in the active text editor.
     * @returns the entry under the cursor, or undefined if there is none
     */
    getLocationUnderCursor(): Entry | LocationEntry | undefined {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }

        const relativePath = path.relative(this.workspacePath, editor.document.fileName);
        const locationEntries = this.pathToEntryMap.get(relativePath);
        if (locationEntries === undefined) {
            return;
        }

        for (const entry of locationEntries) {
            let location;
            if (isLocationEntry(entry)) {
                location = entry.location;
            } else if (isEntry(entry)) {
                location = entry.locations[0];
            } else {
                continue;
            }
            const region = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
            if (editor.selection.intersection(region) !== undefined) {
                return entry;
            }
        }
    }

    /**
     * Refreshes the decorations for a file and the finding tree. This is to change file decorations related to
     * a particular URI.
     * @param uri the URI of the file to refresh
     */
    refresh(uri: vscode.Uri): void {
        this._onDidChangeFileDecorationsEmitter.fire(uri);
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * Refreshes the decorations for an entry.
     * @param entry the entry to refresh
     */
    refreshEntry(entry: Entry): void {
        for (const location of entry.locations) {
            const uri = vscode.Uri.file(path.join(this.workspacePath, location.path));
            this._onDidChangeFileDecorationsEmitter.fire(uri);
        }
        this.refreshTree();
    }

    /**
     * Refreshes the finding tree.
     * This is used to change the tree view when a finding is added, resolved, or removed,
     * and also,
     *  - when the tree view mode is changed.
     *  - when the user changes the list of usernames to show.
     */
    refreshTree(): void {
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * Refreshes and decorates and entry, including its additional locations
     * @param entry the entry to refresh and decorate
     */
    refreshAndDecorateEntry(entry: Entry): void {
        for (const loc of entry.locations) {
            const uri = vscode.Uri.file(path.join(this.workspacePath, loc.path));
            this.decorateWithUri(uri);
            this.refresh(uri);
        }
    }

    refreshAndDecorateFromPath(path_: string): void {
        const uri = vscode.Uri.file(path.join(this.workspacePath, path_));
        this.decorateWithUri(uri);
        this.refresh(uri);
    }
}

let treeView: vscode.TreeView<TreeEntry>;
let treeDataProvider: CodeMarker;

export class AuditMarker {
    private previousVisibleTextEditors: string[] = [];
    private decorationManager: DecorationManager;

    constructor(context: vscode.ExtensionContext) {
        this.decorationManager = new DecorationManager(context);

        treeDataProvider = new CodeMarker(context, this.decorationManager);
        treeView = vscode.window.createTreeView("codeMarker", { treeDataProvider });
        context.subscriptions.push(treeView);

        vscode.window.onDidChangeTextEditorSelection(this.checkSelectionEventAndRevealEntryUnderCursor, this);

        // call revealEntryUnderCursor when the extension separator becomes visible
        treeView.onDidChangeVisibility((e: vscode.TreeViewVisibilityChangeEvent) => {
            if (!e.visible) {
                return;
            }

            this.revealEntryUnderCursor();
        });

        treeView.onDidChangeSelection((e: vscode.TreeViewSelectionChangeEvent<TreeEntry>) => {
            if (e.selection.length === 0) {
                vscode.commands.executeCommand("weAudit.hideFindingDetails");
                return;
            }
            const entry = e.selection[0];
            this.showEntryInFindingDetails(entry);
        });

        vscode.window.onDidChangeActiveTextEditor((e: vscode.TextEditor | undefined) => {
            if (e === undefined) {
                return;
            }
            for (const editor of this.previousVisibleTextEditors) {
                // if the active editor is already visible, do nothing
                // because it should already be decorated
                if (editor === e.document.fileName) {
                    return;
                }
            }

            this.decorate();
        });

        vscode.window.registerFileDecorationProvider(treeDataProvider);
        vscode.window.onDidChangeActiveColorTheme(this.decorationManager.reloadAllDecorationConfigurations, this.decorationManager);
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            this.selectivelyReloadConfigurations(e);
        });

        // This event is triggered several times when dragging a file into a new column.
        vscode.window.onDidChangeVisibleTextEditors((newVisibleTextEditors: readonly vscode.TextEditor[]) => {
            // compare previousVisibleTextEditors with newVisibleTextEditors
            // if they are the same, do nothing
            // if they are different, decorate
            if (newVisibleTextEditors.length === 0) {
                return;
            }

            if (newVisibleTextEditors.length === this.previousVisibleTextEditors.length) {
                // check if they all match
                for (const newEditor of newVisibleTextEditors) {
                    let found = false;
                    for (const oldEditor of this.previousVisibleTextEditors) {
                        if (oldEditor === newEditor.document.fileName) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        // TODO: only decorate the new editors
                        // However, to do this you need to keep track of which editors are new
                        // and which are old, and only decorate the new ones. This needs to take
                        // into account that new editors can be for the same file as old editors, e.g., when you
                        // split the editor in two.
                        this.decorate();
                        break;
                    }
                }
            } else {
                this.decorate();
            }
            this.previousVisibleTextEditors = newVisibleTextEditors.map((e) => e.document.fileName);
        });

        vscode.commands.registerCommand("weAudit.showSelectedEntryInFindingDetails", () => {
            if (treeView.selection.length === 0) {
                vscode.commands.executeCommand("weAudit.hideFindingDetails");
                return;
            }
            const entry = treeView.selection[0];
            this.showEntryInFindingDetails(entry);
        });
    }

    private showEntryInFindingDetails(entry: TreeEntry) {
        if (isPathOrganizerEntry(entry)) {
            vscode.commands.executeCommand("weAudit.hideFindingDetails");
            return;
        }

        if (isLocationEntry(entry)) {
            entry = entry.parentEntry;
        }

        // if the entry is from an older version without details, add the default details
        if (entry.details === undefined) {
            entry.details = createDefaultEntryDetails();
        }

        // Fills the Finding details webview with the currently selected entry details
        vscode.commands.executeCommand("weAudit.setWebviewFindingDetails", entry.details, entry.label);
    }

    /**
     * Selectively reload configurations: if the treeViewMode configuration changed, reload only that.
     * Otherwise, reload all decoration configurations.
     * TODO: make it possible to reload only one decoration type
     * @param e the configuration change event
     */
    private selectivelyReloadConfigurations(e: vscode.ConfigurationChangeEvent): void {
        if (e.affectsConfiguration("weAudit.general.treeViewMode")) {
            treeDataProvider.loadTreeViewModeConfiguration();
        } else {
            this.decorationManager.reloadAllDecorationConfigurations();
            this.decorate();
        }
    }

    /**
     * Reveal the entry under the cursor, in the treeView.
     */
    private async revealEntryUnderCursor(): Promise<void> {
        const entry = treeDataProvider.getLocationUnderCursor();
        if (entry !== undefined) {
            try {
                await treeView.reveal(entry);
            } catch (error) {
                const typedError = error as Error;
                if (typedError.message.startsWith("TreeError")) {
                    return;
                }
                throw error;
            }
        }
    }

    /**
     * Reveal the entry under the cursor if:
     *  - the selection event is a command
     *  - the treeView widget is visible
     * @param e the text editor selection change event
     */
    private checkSelectionEventAndRevealEntryUnderCursor(e: vscode.TextEditorSelectionChangeEvent): void {
        // bail on command; this allows mouse and keyboard navigation to reveal the entry under the cursor
        if (e.kind === vscode.TextEditorSelectionChangeKind.Command) {
            return;
        }

        // prevent switching if the treeView widget is not visible
        if (!treeView.visible) {
            return;
        }

        this.revealEntryUnderCursor();
    }

    /**
     * Decorate the visible text editors.
     */
    private decorate() {
        treeDataProvider.decorate();
    }

    /**
     * Decorate text editors with uri.
     * @param uri the uri of the text editor
     */
    private decorateWithUri(uri: vscode.Uri) {
        treeDataProvider.decorateWithUri(uri);
    }
}
