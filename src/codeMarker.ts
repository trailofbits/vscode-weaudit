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
    FullEntry,
    SerializedData,
    TreeEntry,
    AuditedFile,
    TreeViewMode,
    FullPath,
    Location,
    FullLocation,
    FullLocationEntry,
    isLocationEntry,
    isEntry,
    isOldEntry,
    Repository,
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
    PartiallyAuditedFile,
    mergeTwoPartiallyAuditedFileArrays,
    FullSerializedData,
    ConfigurationEntry,
    WorkspaceRootEntry,
    configEntryEquals,
    RootPathAndLabel,
} from "./types";
import { normalizePathForOS } from "./utilities/normalizePath";

export const SERIALIZED_FILE_EXTENSION = ".weaudit";
const DAY_LOG_FILENAME = ".weauditdaylog";

/**
 * Class representing a WeAudit workspace root. Each root maintains its own set of
 * configuration files (configs) with clientRemote, gitRemote, gitSha, treeEntries, auditedFiles,
 * and resolvedEntries. Additionally, it maintains a markedFilesDayLog.
 */
class WARoot {
    private auditedFiles: AuditedFile[];
    private partiallyAuditedFiles: PartiallyAuditedFile[];
    readonly rootPath: string;
    private rootLabel: string;
    public gitRemote: string;
    public gitSha: string;
    public clientRemote: string;
    private username: string;

    // An array corresponding to all .weaudit file in the .vscode folder of this workspace root
    private configs: ConfigurationEntry[];
    private currentlySelectedConfigs: ConfigurationEntry[];

    // markedFilesDayLog contains a map associating a string representing a date to a file path.
    public markedFilesDayLog: Map<string, string[]>;

    // firstTimeRequestingClientRemote is used to prevent repeatedly asking for the client remote
    private firstTimeRequestingClientRemote = true;

    constructor(wsPath: string, wsLabel: string) {
        this.auditedFiles = [];
        this.partiallyAuditedFiles = [];
        this.rootPath = wsPath;
        this.rootLabel = wsLabel;
        if (this.rootLabel === "") {
            vscode.window.showWarningMessage(
                `weAudit: Warning! It looks like your root path ${this.rootPath} is at the root of your filesystem. This is deeply cursed.`,
            );
        }

        // We do not load anything here, because that is done by the CodeMarker or MultiRootManager
        this.clientRemote = "";
        this.gitRemote = "";
        this.gitSha = "";

        this.markedFilesDayLog = new Map<string, string[]>();
        this.loadDayLogFromFile();

        this.username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
        this.configs = [];
        this.currentlySelectedConfigs = [];
        this.loadConfigurations();
    }

    /**
     * A function to check whether a file is in this workspace root and the relative path to the root folder
     * @param filePath an absolute path to a file
     * @returns a tuple of a `boolean` whether the file is in this workspace,
     * and the relative path (which is the empty string if it is not in this workspace).
     */
    isInThisWorkspaceRoot(filePath: string): [boolean, string] {
        const relativePath = path.relative(this.rootPath, filePath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            return [false, ""];
        }
        return [true, relativePath];
    }

    /**
     * A function that returns the unique label for this root.
     * @returns the unique root label.
     */
    getRootLabel(): string {
        return this.rootLabel;
    }

    /**
     * Loads the day log from storage.
     */
    loadDayLogFromFile(): void {
        const vscodeFolder = path.join(this.rootPath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }
        if (!fs.existsSync(path.join(vscodeFolder, DAY_LOG_FILENAME))) {
            return;
        }

        const dayLogPath = path.join(vscodeFolder, DAY_LOG_FILENAME);
        const data = JSON.parse(fs.readFileSync(dayLogPath, "utf8")) as Iterable<readonly [string, string[]]>;
        this.markedFilesDayLog = new Map(data);
    }

    /**
     * Loads the configurations (.weaudit files) from the .vscode folder.
     */
    loadConfigurations(): void {
        this.configs = [];
        this.currentlySelectedConfigs = [];
        const vscodeFolder = path.join(this.rootPath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            return;
        }

        fs.readdirSync(vscodeFolder).forEach((file) => {
            if (path.extname(file) === SERIALIZED_FILE_EXTENSION) {
                const parsedPath = path.parse(file);

                const configEntry = {
                    path: path.join(vscodeFolder, file),
                    username: parsedPath.name,
                    root: { label: this.rootLabel } as WorkspaceRootEntry,
                } as ConfigurationEntry;
                this.configs.push(configEntry);
                this.currentlySelectedConfigs.push(configEntry);
            }
        });
    }

    /**
     * Get the configurations (.weaudit files) of this workspace root.
     * @returns The configuration entries corresponding to the .weaudit
     * files from the .vscode folder in this workspace root.
     */
    getConfigs(): ConfigurationEntry[] {
        return this.configs;
    }

    /**
     * Get the currently selected configurations (.weaudit files) of this
     * workspace root.
     * @returns The currently selectedconfiguration entries
     */
    getSelectedConfigs(): ConfigurationEntry[] {
        return this.currentlySelectedConfigs;
    }

    /**
     * Returns whether a config is currently selected, and optionally selects it if not.
     */
    manageConfiguration(config: ConfigurationEntry, select: boolean): boolean {
        if (this.currentlySelectedConfigs.findIndex((entry) => configEntryEquals(entry, config)) === -1) {
            if (select) {
                this.currentlySelectedConfigs.push(config);
            }
            return false;
        }
        return true;
    }

    /**
     * Deselect the provided configuration if it is selected, and select it if not
     * @param config the configuration to be (de)selected
     * @returns whether the configuration was selected
     */
    toggleConfiguration(config: ConfigurationEntry): boolean {
        const idx = this.currentlySelectedConfigs.findIndex((entry) => configEntryEquals(entry, config));
        const excluded = idx === -1;
        if (excluded) {
            this.currentlySelectedConfigs.push(config);
        } else {
            this.currentlySelectedConfigs.splice(idx, 1);
        }
        return !excluded;
    }

    /**
     * Returns the currently selected configurations in this workspace root
     * @returns the currently selected configurations
     */
    getSelectedConfigurations(): ConfigurationEntry[] {
        return this.currentlySelectedConfigs;
    }

    /**
     * Update the unique workspace root label to the provided label.
     * Updates all the configuration entries to use the new label
     * @param label the new unique label for this workspace root.
     */
    async updateLabel(label: string): Promise<void> {
        if (label !== this.rootLabel) {
            for (const configEntry of this.configs) {
                const isSelected = this.manageConfiguration(configEntry, false);
                if (isSelected) {
                    // We need to unselect it first
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
                    // Now we modify the configEntry root
                    configEntry.root.label = label;
                    // Now we toggle it back
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
                } else {
                    // It is not selected, so we can just modify it and no one will notice
                    configEntry.root.label = label;
                }
            }
            this.rootLabel = label;
        }
    }

    /**
     * Saves the client's remote repository to the current user's file
     */
    persistClientRemote(): void {
        vscode.commands.executeCommand(
            "weAudit.setGitConfigView",
            { rootPath: this.rootPath, rootLabel: this.rootLabel } as RootPathAndLabel,
            this.clientRemote,
            this.gitRemote,
            this.gitSha,
        );
        const vscodeFolder = path.join(this.rootPath, ".vscode");
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

            // We are creating a new config file
            const wsRootEntry = { label: this.rootLabel } as WorkspaceRootEntry;
            const configEntry = { path: filename, username: this.username, root: wsRootEntry } as ConfigurationEntry;
            this.configs.push(configEntry);
            this.currentlySelectedConfigs.push(configEntry);
        } else {
            const data = fs.readFileSync(filename).toString();
            const parsedEntries = JSON.parse(data) as SerializedData;
            parsedEntries.clientRemote = this.clientRemote;
            newData = JSON.stringify(parsedEntries, null, 2);
        }
        fs.writeFileSync(filename, newData, { flag: "w+" });
    }

    /**
     * Saves the audit remote repository to the current user's file
     */
    persistAuditRemote(): void {
        vscode.commands.executeCommand(
            "weAudit.setGitConfigView",
            { rootPath: this.rootPath, rootLabel: this.rootLabel } as RootPathAndLabel,
            this.clientRemote,
            this.gitRemote,
            this.gitSha,
        );
        const vscodeFolder = path.join(this.rootPath, ".vscode");
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

            // We are creating a new config file
            const wsRootEntry = { label: this.rootLabel } as WorkspaceRootEntry;
            const configEntry = { path: filename, username: this.username, root: wsRootEntry } as ConfigurationEntry;
            this.configs.push(configEntry);
            this.currentlySelectedConfigs.push(configEntry);
        } else {
            const data = fs.readFileSync(filename).toString();
            const parsedEntries = JSON.parse(data) as SerializedData;
            parsedEntries.gitRemote = this.gitRemote;
            newData = JSON.stringify(parsedEntries, null, 2);
        }
        fs.writeFileSync(filename, newData, { flag: "w+" });
    }

    /**
     * Saves the relevant git hash to the current user's file
     */
    persistGitHash(): void {
        vscode.commands.executeCommand(
            "weAudit.setGitConfigView",
            { rootPath: this.rootPath, rootLabel: this.rootLabel } as RootPathAndLabel,
            this.clientRemote,
            this.gitRemote,
            this.gitSha,
        );
        const vscodeFolder = path.join(this.rootPath, ".vscode");
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

            // We are creating a new config file
            const wsRootEntry = { label: this.rootLabel } as WorkspaceRootEntry;
            const configEntry = { path: filename, username: this.username, root: wsRootEntry } as ConfigurationEntry;
            this.configs.push(configEntry);
            this.currentlySelectedConfigs.push(configEntry);
        } else {
            const data = fs.readFileSync(filename).toString();
            const parsedEntries = JSON.parse(data) as SerializedData;
            parsedEntries.gitSha = this.gitSha;
            newData = JSON.stringify(parsedEntries, null, 2);
        }
        fs.writeFileSync(filename, newData, { flag: "w+" });
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

        const gitPath = path.join(this.rootPath, ".git");
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
            await this.editAuditRemote();
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

        void this.updateSavedData(this.username);
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

        const gitPath = path.join(this.rootPath, ".git", "HEAD");
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

        const shaPath = path.join(this.rootPath, ".git", headPath[1]);
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
     * Edit the client's remote repository
     */
    async editClientRemote(): Promise<void> {
        const clientRemote = await vscode.window.showInputBox({
            title: `Edit Client Repository for ${this.rootLabel}:`,
            value: this.clientRemote,
            ignoreFocusOut: true,
        });
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
        const auditRemote = await vscode.window.showInputBox({
            title: `Edit Audit Repository for ${this.rootLabel}:`,
            value: this.gitRemote,
            ignoreFocusOut: true,
        });
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
        const gitSha = await vscode.window.showInputBox({ title: `Edit Git Commit Hash for ${this.rootLabel}:`, value: this.gitSha, ignoreFocusOut: true });
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
        void this.updateSavedData(this.username);
    }

    /**
     * Toggle a file as audited.
     * @param uri the `uri` of the target file.
     * @param relativePath the relative path of the target file to this workspace root.
     * @returns A list of `uri`s to decorate and the relevant username.
     */
    toggleAudited(uri: vscode.Uri, relativePath: string): [vscode.Uri[], string] {
        let relevantUsername = "";

        let urisToDecorate: vscode.Uri[] = [];

        // check if file is already in list
        const index = this.auditedFiles.findIndex((file) => file.path === relativePath);
        if (index > -1) {
            // if it exists, remove it
            const auditedEntry = this.auditedFiles.splice(index, 1);
            relevantUsername = auditedEntry[0].author;
            urisToDecorate = this.checkIfAllSiblingFilesAreAudited(uri);
        } else {
            // if it doesn't exist, add it
            this.auditedFiles.push({ path: relativePath, author: this.username });
            relevantUsername = this.username;
            urisToDecorate = this.checkIfAllSiblingFilesAreAudited(uri);
        }

        // clean out any partially audited file entries
        this.cleanPartialAudits(uri);

        // update day log structure
        const isAdd = index === -1;
        this.updateDayLog(relativePath, isAdd);

        return [urisToDecorate, relevantUsername];
    }

    /**
     * Concatenates an array of AuditedFiles to the AuditedFiles of this workspace root.
     * @param files The array of audited files to be concatenated.
     */
    concatAudited(files: AuditedFile[]): void {
        this.auditedFiles = this.auditedFiles.concat(files);
    }

    /**
     * Concatenates an array of PartiallyAuditedFiles to the PartiallyAuditedFiles
     * of this workspace root.
     * @param files The array of audited files to be concatenated.
     */
    concatPartiallyAudited(files: PartiallyAuditedFile[]): void {
        this.partiallyAuditedFiles = this.partiallyAuditedFiles.concat(files);
    }

    /**
     * Remove the AuditedFiles of this workspace root for a specific username.
     * @param username The username whose AuditedFiles entries need to be removed.
     */
    filterAudited(username: string): void {
        this.auditedFiles = this.auditedFiles.filter((entry) => entry.author !== username);
    }

    /**
     * Remove the PartiallyAuditedFiles of this workspace root for a specific username.
     * @param username The username whose PartiallyAuditedFiles entries need to be removed.
     */
    filterPartiallyAudited(username: string): void {
        this.partiallyAuditedFiles = this.partiallyAuditedFiles.filter((entry) => entry.author !== username);
    }

    /**
     * Checks whether the file at a particular path is in the AuditedFiles of this workspace root.
     * @param path The path of the file to be checked.
     * @returns `true` if the file is in the AuditedFiles, `false` if not.
     */
    isAudited(path: string): boolean {
        return this.auditedFiles.findIndex((entry) => entry.path === path) !== -1;
    }

    /**
     * Get the PartiallyAuditedFiles of this workspace root.
     * @returns The PartiallyAuditedFiles of this workspace root.
     */
    getPartiallyAudited(): PartiallyAuditedFile[] {
        return this.partiallyAuditedFiles;
    }

    /**
     * Checks if all sibling files of the file that was audit-toggle are audited.
     * If they are, the containing folder is added to the list of audited files.
     * If they are not, the containing folder is removed from the list of audited files.
     * TODO: too many findIndex calls, maybe use a map instead of an array
     * @param uri The uri of the file that was audit-toggle
     */
    checkIfAllSiblingFilesAreAudited(uri: vscode.Uri): vscode.Uri[] {
        const urisToDecorate: vscode.Uri[] = [];
        // iterate over all the files in the same folder as the file that was audited
        const folder = path.dirname(uri.fsPath);
        const files = fs.readdirSync(folder);
        let allFilesAudited = true;
        for (const file of files) {
            // if any file is not audited, set allFilesAudited to false
            const relativePath = path.relative(this.rootPath, path.join(folder, file));
            if (this.auditedFiles.findIndex((file) => file.path === relativePath) === -1) {
                allFilesAudited = false;
                break;
            }
        }
        const folderUri = vscode.Uri.file(folder);

        // if all files are audited, add the folder to the list of audited files
        if (allFilesAudited) {
            this.auditedFiles.push({ path: path.relative(this.rootPath, folder), author: this.username });
            urisToDecorate.push(folderUri);
            // additionally, call checkIfAllSiblingFilesAreAudited on the parent folder
            urisToDecorate.push(...this.checkIfAllSiblingFilesAreAudited(folderUri));
        } else {
            // if not all files are audited, remove the folder from the list of audited files
            const index = this.auditedFiles.findIndex((file) => file.path === path.relative(this.rootPath, folder));
            if (index > -1) {
                this.auditedFiles.splice(index, 1);
                urisToDecorate.push(folderUri);
                // additionally, call checkIfAllSiblingFilesAreAudited on the parent folder for recursive removal
                urisToDecorate.push(...this.checkIfAllSiblingFilesAreAudited(folderUri));
            }
        }
        return urisToDecorate;
    }

    private cleanPartialAudits(uriToRemove: vscode.Uri): void {
        const relative = path.relative(this.rootPath, uriToRemove.fsPath);
        this.partiallyAuditedFiles = this.partiallyAuditedFiles.filter((file) => file.path !== relative);
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
    persistDayLog(): void {
        const vscodeFolder = path.join(this.rootPath, ".vscode");
        if (!fs.existsSync(vscodeFolder)) {
            fs.mkdirSync(vscodeFolder);
        }
        const dayLogPath = path.join(vscodeFolder, DAY_LOG_FILENAME);
        fs.writeFileSync(dayLogPath, JSON.stringify(Array.from(this.markedFilesDayLog), null, 2));
    }

    /**
     * Adds a file in this workspace root to the array of PartiallyAuditedFiles.
     * @param relativePath The relative path of the file to the folder of this root
     */
    addPartiallyAudited(relativePath: string): void {
        // check if file is already in list
        const index = this.auditedFiles.findIndex((file) => file.path === relativePath);
        // if file is already audited ignore
        if (index > -1) {
            return;
        }

        const locations = this.getActiveSelectionLocation();

        // Process each selection/location separately
        for (const location of locations) {
            const alreadyMarked = this.partiallyAuditedFiles.findIndex(
                (file) => file.path === relativePath && file.startLine <= location.startLine && file.endLine >= location.endLine,
            );

            // this section is already marked. Remove it then
            if (alreadyMarked > -1) {
                // Splits the existing entry into 2 and remove the location marked by the user
                const previousMarkedEntry = this.partiallyAuditedFiles[alreadyMarked];

                // same area has been selected so lets delete it
                if (previousMarkedEntry.startLine === location.startLine && previousMarkedEntry.endLine === location.endLine) {
                    this.partiallyAuditedFiles.splice(alreadyMarked, 1);
                } else {
                    // not the same area so we need to split the entry or change it

                    const locationClone = { ...previousMarkedEntry };

                    // if either the end line or the start line is the same we don't need
                    // to split the entry but can just adjust the current one
                    let splitNeeded = true;
                    if (previousMarkedEntry.endLine === location.endLine) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                        splitNeeded = false;
                    }

                    if (previousMarkedEntry.startLine === location.startLine) {
                        previousMarkedEntry.startLine = location.endLine + 1;
                        splitNeeded = false;
                    }

                    if (splitNeeded) {
                        previousMarkedEntry.endLine = location.startLine - 1;
                        locationClone.startLine = location.endLine + 1;

                        this.partiallyAuditedFiles.push(locationClone);
                    }

                    this.partiallyAuditedFiles[alreadyMarked] = previousMarkedEntry;
                }
            } else {
                this.partiallyAuditedFiles.push({
                    path: relativePath,
                    author: this.username,
                    startLine: location.startLine,
                    endLine: location.endLine,
                });
            }
        }

        this.mergePartialAudits();
    }

    /**
     * Gets the active selection locations, supporting multiple selections.
     * @returns An array of FullLocations corresponding to all active selections.
     */
    getActiveSelectionLocation(): FullLocation[] {
        // the null assertion is never undefined because we check if the editor is undefined
        const editor = vscode.window.activeTextEditor!;
        const uri = editor.document.uri;
        const relativePath = path.relative(this.rootPath, uri.fsPath);

        return editor.selections.map((selection) => {
            const startLine = selection.start.line;
            let endLine = selection.end.line;

            // vscode sets the end of a fully selected line as the first character of the next line
            // so we decrement the end line if the end character is 0 and the end line is not the same as the start line
            if (endLine > selection.start.line && selection.end.character === 0) {
                endLine--;
            }

            // github preview does not show the preview if the last document line is empty
            // so we decrement it by one
            if (endLine === editor.document.lineCount - 1 && editor.document.lineAt(endLine).text === "") {
                // ensure that we don't go before the start line
                endLine = Math.max(endLine - 1, startLine);
            }

            // TODO: error if not in this workspace root?
            return { path: relativePath, startLine, endLine, label: "", description: "", rootPath: this.rootPath };
        });
    }

    /**
     * Merge the PartiallyAuditedFiles in this workspace root.
     */
    private mergePartialAudits(): void {
        const cleanedEntries: PartiallyAuditedFile[] = [];
        // sort first by path and startLine for the merge to work
        const sortedEntries = this.partiallyAuditedFiles.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);
        for (const entry of sortedEntries) {
            // check if the current location is already partially audited
            const partIdx = cleanedEntries.findIndex(
                (file) =>
                    // only merge entries for the same file
                    file.path === entry.path &&
                    // checks if the start is within bounds but the end is not
                    ((file.startLine <= entry.startLine && file.endLine >= entry.startLine) ||
                        // checks if the end is within bounds but the start is not
                        (file.startLine <= entry.endLine && file.endLine >= entry.endLine) ||
                        // checks if the location includes the entry
                        (file.startLine >= entry.startLine && file.endLine <= entry.endLine) ||
                        // checks adjacent entries
                        file.endLine === entry.startLine - 1),
            );
            // update entry if necessary
            if (partIdx > -1) {
                const foundLocation = cleanedEntries[partIdx];
                if (foundLocation.endLine < entry.endLine) {
                    foundLocation.endLine = entry.endLine;
                }
                if (foundLocation.startLine > entry.startLine) {
                    foundLocation.startLine = entry.startLine;
                }

                cleanedEntries[partIdx] = foundLocation;
            } else {
                cleanedEntries.push(entry);
            }
        }

        this.partiallyAuditedFiles = cleanedEntries;
    }

    /**
     * Loads the saved findings from a configuration
     * @param config  the configuration entry to load from
     * @returns the parsed entries in the file
     */
    loadSavedDataFromConfig(config: ConfigurationEntry): SerializedData | undefined {
        if (!fs.existsSync(config.path)) {
            return;
        }
        const data = fs.readFileSync(config.path).toString();
        const parsedEntries = JSON.parse(data) as SerializedData;

        if (!validateSerializedData(parsedEntries)) {
            vscode.window.showErrorMessage(`weAudit: Error loading serialized data for ${config.username}. Filepath: ${config.path}`);
            return;
        }

        if (!this.isInThisWorkspaceRoot(config.path)) {
            vscode.window.showErrorMessage(
                `weAudit: Error loading data for ${config.username}. Filepath: ${config.path} is not in the expected workspace root.`,
            );
            return;
        }

        // load client remote if it exists and if the file is the current user's file
        if (config.username === this.username) {
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
                const absoluteEntryPath = path.resolve(this.rootPath, location.path);
                if (path.isAbsolute(location.path) || path.relative(this.rootPath, absoluteEntryPath).startsWith("..")) {
                    vscode.window.showWarningMessage("Trying to import entries with regions outside this workspace: " + location.path);
                    // We cannot reject this because the region may be in another workspace root
                }
            }
        }
        return parsedEntries;
    }

    /**
     * Update the saved data of a specific user in the .weaudit file of that user in
     * the .vscode folder of this workspace root.
     * @param username The username of the target user.
     */
    async updateSavedData(username: string): Promise<void> {
        const vscodeFolder = path.join(this.rootPath, ".vscode");

        let existsFolder = true;
        let existsFile = true;
        let toCreateData = false;

        if (!fs.existsSync(vscodeFolder)) {
            existsFolder = false;
        }

        const fileName = path.join(vscodeFolder, username + SERIALIZED_FILE_EXTENSION);
        const wsRootEntry = { label: this.rootLabel } as WorkspaceRootEntry;
        const configEntry = { path: fileName, username: username, root: wsRootEntry };
        if (!fs.existsSync(fileName)) {
            existsFile = false;
        }

        // filter local entries of the affected user
        let filteredAuditedFiles = this.auditedFiles.filter((file) => file.author === username);
        let filteredPartiallyAuditedEntries = this.partiallyAuditedFiles.filter((entry) => entry.author === username);

        // get filtered entries from the CodeMarker
        const [filteredEntries, filteredResolvedEntries]: [FullEntry[], FullEntry[]] = await vscode.commands.executeCommand(
            "weAudit.getFilteredEntriesForSaving",
            username,
            this,
        );

        // Remove the root path for backwards compatibility. It is implicit in the location of the saved file anyway.
        let reducedEntries = filteredEntries.map(
            (fullEntry) =>
                ({
                    label: fullEntry.label,
                    entryType: fullEntry.entryType,
                    author: fullEntry.author,
                    details: fullEntry.details,
                    locations: fullEntry.locations.map(
                        (location) =>
                            ({
                                path: location.path,
                                startLine: location.startLine,
                                endLine: location.endLine,
                                label: location.label,
                                description: location.description,
                            }) as Location,
                    ),
                }) as Entry,
        );
        let reducedResolvedEntries = filteredResolvedEntries.map(
            (fullEntry) =>
                ({
                    label: fullEntry.label,
                    entryType: fullEntry.entryType,
                    author: fullEntry.author,
                    details: fullEntry.details,
                    locations: fullEntry.locations.map(
                        (location) =>
                            ({
                                path: location.path,
                                startLine: location.startLine,
                                endLine: location.endLine,
                                label: location.label,
                                description: location.description,
                            }) as Location,
                    ),
                }) as Entry,
        );

        if (existsFile) {
            // if we are not seeing the current user's findings, we can't simply overwrite the file
            // we need to merge the findings of the current user with their saved findings
            if (!this.manageConfiguration(configEntry, false)) {
                const previousEntries = this.loadSavedDataFromConfig(configEntry);
                if (previousEntries !== undefined) {
                    reducedEntries = mergeTwoEntryArrays(reducedEntries, previousEntries.treeEntries);
                    filteredAuditedFiles = mergeTwoAuditedFileArrays(filteredAuditedFiles, previousEntries.auditedFiles);
                    filteredPartiallyAuditedEntries = mergeTwoPartiallyAuditedFileArrays(
                        filteredPartiallyAuditedEntries,
                        previousEntries.partiallyAuditedFiles ?? [],
                    );
                    reducedResolvedEntries = mergeTwoEntryArrays(reducedResolvedEntries, previousEntries.resolvedEntries);
                }
            }
        }

        if (
            !!this.clientRemote ||
            !!this.gitRemote ||
            !!this.gitSha ||
            reducedEntries.length !== 0 ||
            filteredAuditedFiles.length !== 0 ||
            filteredPartiallyAuditedEntries.length !== 0 ||
            reducedResolvedEntries.length !== 0
        ) {
            toCreateData = true;
        }

        if (toCreateData) {
            // create .vscode folder if it doesn't exist
            if (!existsFolder) {
                fs.mkdirSync(vscodeFolder);
            }

            // create a new config file if it doesn't exist
            if (!existsFile) {
                this.configs.push(configEntry);
                this.currentlySelectedConfigs.push(configEntry);
            }
        }

        // If the file already exists but toCreateData is false,
        // this means we are deleting the last element
        if (toCreateData || existsFile) {
            // save findings to file
            const data = JSON.stringify(
                {
                    clientRemote: this.clientRemote,
                    gitRemote: this.gitRemote,
                    gitSha: this.gitSha,
                    treeEntries: reducedEntries,
                    auditedFiles: filteredAuditedFiles,
                    partiallyAuditedFiles: filteredPartiallyAuditedEntries,
                    resolvedEntries: reducedResolvedEntries,
                },
                null,
                2,
            );

            fs.writeFileSync(fileName, data, { flag: "w+" });
        }
    }

    /**
     * Update the git configuration of this workspace root.
     * @param clientRemote The client remote to be configured.
     * @param auditRemote The audit remote to be configured.
     * @param gitSha The git SHA digest to be configured.
     */
    updateGitConfig(clientRemote: string, auditRemote: string, gitSha: string): void {
        this.clientRemote = clientRemote;
        this.gitRemote = auditRemote;
        this.gitSha = gitSha;

        // persist the data
        void this.updateSavedData(this.username);
    }
}

/**
 * This class helps manage a workspace with multiple root folders.
 * It maintains a list of root folders that it keeps up to date with user changes.
 * The functions in this class serve to transparently manage multiple root folders,
 * e.g. by taking taking filepaths and selecting the corresponding workspace root
 * that this file belongs to.
 */
class MultiRootManager {
    private roots: WARoot[];
    private _onDidChangeRootsEmitter = new vscode.EventEmitter<[WARoot[], WARoot[]]>();
    private pathToRootMap: Map<string, [WARoot, string, boolean]>;
    private pathToMultipleRootMap: Map<string, [WARoot, string][]>;
    readonly onDidChangeRoots = this._onDidChangeRootsEmitter.event;

    constructor(context: vscode.ExtensionContext) {
        this.pathToRootMap = new Map<string, [WARoot, string, boolean]>();
        this.pathToMultipleRootMap = new Map<string, [WARoot, string][]>();
        this.roots = this.setupRoots();

        // We tell the Git Config Webview about the roots
        // MultiConfig will request the roots by itself when
        // weAudit.findAndLoadConfigurationFiles is executed by the CodeMarker
        vscode.commands.executeCommand(
            "weAudit.setGitConfigRoots",
            this.roots.map((root) => ({ rootPath: root.rootPath, rootLabel: root.getRootLabel() }) as RootPathAndLabel),
        );
        // Add a listener for changes to the roots
        const listener = async (event: vscode.WorkspaceFoldersChangeEvent): Promise<void> => {
            // Any removed or added roots will execute weAudit.toggleSavedFindings, which will cause a refresh
            // of the tree, and hence a recreation of the pathToEntryMap (which is important in case there is
            // only one workspace root left)
            for (const removed of event.removed) {
                await this.removeRoot(removed.uri.fsPath);
            }

            // Clear the pathToRootMap and pathToMultiRootMap after removing the roots,
            // but before adding the new ones because this change may (un)curse the roots
            this.pathToRootMap.clear();
            this.pathToMultipleRootMap.clear();

            const newRootPathList = this.roots.map((root) => root.rootPath).concat(event.added.map((added) => added.uri.fsPath));
            const newRootPathsAndLabels = this.createUniqueLabels(newRootPathList);
            let i;
            for (i = 0; i < this.roots.length; i++) {
                await this.roots[i].updateLabel(newRootPathsAndLabels[i].rootLabel);
            }
            for (; i < newRootPathsAndLabels.length; i++) {
                const root = new WARoot(newRootPathsAndLabels[i].rootPath, newRootPathsAndLabels[i].rootLabel);
                this.roots.push(root);
                for (const config of root.getConfigs()) {
                    // This is a quirk, because the WARoot constructor sets the configurations as active,
                    // but weAudit.toggleSavedFindings needs it to be inactive, we need to toggle it first
                    // a better solution would be to register another command that just loads findings into
                    // the tree for a specific incoming workspace root
                    root.toggleConfiguration(config);
                    // Add the findings of new roots to the MultiConfig and load them into the tree
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", config);
                }
            }

            // Refresh the configuration files: This will request the roots and currently selected configurations
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");

            // Tell the git Config WebView that there are new roots
            await vscode.commands.executeCommand(
                "weAudit.setGitConfigRoots",
                this.roots.map((root) => ({ rootPath: root.rootPath, rootLabel: root.getRootLabel() }) as RootPathAndLabel),
            );
        };
        const disposable = vscode.workspace.onDidChangeWorkspaceFolders(listener);
        context.subscriptions.push(disposable);
    }

    /**
     * Given a list of root paths and labels where all labels collide, this function
     * takes a directory from the root path and moves it to the label. It then checks
     * whether there are still any duplicates, and if so, it recurses on the remaining
     * root paths / label pairs where the labels have duplicates.
     * @param rootPathsAndLabels a list of root paths and labels where each label occurs
     * more than once.
     */
    private recurseUniqueLabels(rootPathsAndLabels: RootPathAndLabel[]): void {
        // We have called this function because all input elements have duplicates
        for (const rootPathAndLabel of rootPathsAndLabels) {
            const parsedRootPath = path.parse(rootPathAndLabel.rootPath);
            const labelPrefix = parsedRootPath.base ? parsedRootPath.base : "/";
            rootPathAndLabel.rootLabel = path.join(labelPrefix, rootPathAndLabel.rootLabel);
            rootPathAndLabel.rootPath = path.join(parsedRootPath.root, parsedRootPath.dir);
        }

        const rootLabels = rootPathsAndLabels.map((rootPathAndLabel) => rootPathAndLabel.rootLabel);
        if (new Set(rootLabels).size === rootPathsAndLabels.length) {
            return;
        } else {
            // We have duplicates
            const duplicateMap = new Map<string, string[]>();

            // First pass over the array to determine duplicates
            for (const rootPathAndLabel of rootPathsAndLabels) {
                const duplicateEntry = duplicateMap.get(rootPathAndLabel.rootLabel);
                if (duplicateEntry === undefined) {
                    duplicateMap.set(rootPathAndLabel.rootLabel, [rootPathAndLabel.rootPath]);
                } else {
                    duplicateMap.set(rootPathAndLabel.rootLabel, duplicateEntry.concat(rootPathAndLabel.rootPath));
                }
            }

            const duplicates = rootPathsAndLabels.filter(
                (rootPathAndLabel) => duplicateMap.get(rootPathAndLabel.rootLabel) !== undefined && duplicateMap.get(rootPathAndLabel.rootLabel)!.length > 1,
            );

            this.recurseUniqueLabels(duplicates);
        }
    }

    /**
     * Creates unique labels for a list of root paths, where Each label is a postfix of
     * the corresponding root path.
     * @param rootPaths the list of root paths that require unique labels
     * @returns a list of [root path, label] tuples where each label is unique
     */
    private createUniqueLabels(rootPaths: string[]): RootPathAndLabel[] {
        const rootPathsAndLabels: RootPathAndLabel[] = rootPaths.map(
            (rootPath) => ({ rootPath: rootPath, rootLabel: path.basename(rootPath) }) as RootPathAndLabel,
        );
        const rootLabels = rootPathsAndLabels.map((rootPathAndLabel) => rootPathAndLabel.rootLabel);

        if (new Set(rootLabels).size === rootPaths.length) {
            return rootPathsAndLabels;
        } else {
            // We have duplicates
            console.log("There are workspace root folders with the same name.");
            const duplicateMap = new Map<string, string[]>();

            // First pass over the array to determine duplicates
            for (const rootPathAndLabel of rootPathsAndLabels) {
                const duplicateEntry = duplicateMap.get(rootPathAndLabel.rootLabel);
                if (duplicateEntry === undefined) {
                    duplicateMap.set(rootPathAndLabel.rootLabel, [rootPathAndLabel.rootPath]);
                } else {
                    duplicateMap.set(rootPathAndLabel.rootLabel, duplicateEntry.concat(rootPathAndLabel.rootPath));
                }
            }

            // Second pass over the array to process duplicates
            const duplicates = rootPathsAndLabels.filter(
                (rootPathAndLabel) => duplicateMap.get(rootPathAndLabel.rootLabel) !== undefined && duplicateMap.get(rootPathAndLabel.rootLabel)!.length > 1,
            );
            for (const duplicateEntry of duplicates) {
                duplicateEntry.rootPath = path.parse(duplicateEntry.rootPath).dir;
            }

            this.recurseUniqueLabels(duplicates);
            for (const duplicateEntry of duplicates) {
                duplicateEntry.rootPath = path.join(duplicateEntry.rootPath, duplicateEntry.rootLabel);
            }
            return rootPathsAndLabels;
        }
    }

    /**
     * Get the unique label for a specific root path.
     * @param rootPath the path to the workspace root.
     * @returns the unique label of this workspace root.
     */
    getUniqueLabel(rootPath: string): string | undefined {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(rootPath);
        return wsRoot?.getRootLabel();
    }

    /**
     * Sets up the workspace root folders, which are each instances of the WARoot class.
     * @returns An array of current the current WARoot instances.
     */
    private setupRoots(): WARoot[] {
        this.pathToRootMap.clear();
        this.pathToMultipleRootMap.clear();
        const roots: WARoot[] = [];
        if (vscode.workspace.workspaceFolders === undefined) {
            return roots;
        }

        const rootPathsAndLabels = this.createUniqueLabels(vscode.workspace.workspaceFolders.map((folder) => folder.uri.fsPath));
        for (const rootPathAndLabel of rootPathsAndLabels) {
            const root = new WARoot(rootPathAndLabel.rootPath, rootPathAndLabel.rootLabel);
            roots.push(root);
        }

        return roots;
    }

    /**
     * Checks whether there is more than one workspace root
     * @returns `true` if there is more than one workspace root and `false` otherwise
     */
    moreThanOneRoot(): boolean {
        return this.roots.length > 1;
    }

    /**
     * This function provides direct access to the current workspace roots.
     * @returns The array of the current WARoot instances.
     */
    getRoots(): WARoot[] {
        return this.roots;
    }

    /**
     * Removes a root based on its root path and removes all the corresponding
     * data from the CodeMarker.
     * @param rootPath The path to the workspace root.
     */
    private async removeRoot(rootPath: string): Promise<void> {
        for (const root of this.roots.filter((root) => root.rootPath === rootPath)) {
            for (const config of root.getConfigs()) {
                if (root.manageConfiguration(config, false)) {
                    // Remove the findings of outgoing roots from the MultiConfig and remove them from the tree
                    await vscode.commands.executeCommand("weAudit.toggleSavedFindings", config);
                }
            }
        }
        this.roots = this.roots.filter((root) => root.rootPath !== rootPath);
    }

    /**
     * Prompts the user to select a WARoot based on the root paths.
     * @returns The WARoot selected by the user or undefined.
     */
    private async selectRoot(): Promise<WARoot | undefined> {
        const allRootPaths = this.roots.map((root) => root.rootPath);
        const wsRootPath = await vscode.window.showQuickPick(allRootPaths, {
            ignoreFocusOut: true,
            title: "Choose workspace",
            placeHolder: "Choose workspace",
            canPickMany: false,
        });
        if (wsRootPath === undefined) {
            return;
        }
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(wsRootPath);
        return wsRoot;
    }

    /**
     * Prompts the user to select a WARoot and edit the client remote of that WARoot.
     * @returns The Promise of editing the client remote.
     */
    async editClientRemote(): Promise<void> {
        const wsRoot = await this.selectRoot();
        if (wsRoot === undefined) {
            return;
        }
        return wsRoot.editClientRemote();
    }

    /**
     * Prompts the user to select a WARoot and edit the audit remote of that WARoot.
     * @returns The Promise of editing the audit remote.
     */
    async editAuditRemote(): Promise<void> {
        const wsRoot = await this.selectRoot();
        if (wsRoot === undefined) {
            return;
        }
        return wsRoot.editAuditRemote();
    }

    /**
     * Prompts the user to select a WARoot and edit the git hash of that WARoot.
     * @returns The Promise of editing the git hash.
     */
    async editGitHash(): Promise<void> {
        const wsRoot = await this.selectRoot();
        if (wsRoot === undefined) {
            return;
        }
        return wsRoot.editGitHash();
    }

    /**
     * Goes through all workspace roots and sets up the repositories.
     */
    async setupRepositories(): Promise<void> {
        for (const wsRoot of this.roots) {
            await wsRoot.setupRepositories();
        }
    }

    /**
     * Configures the git settings of the WARoot corresponding to the provided root path.
     * @param rootPath The root path corresponding to the WARoot.
     * @param clientRemote The client remote to be configured.
     * @param auditRemote The audit remote to be configured.
     * @param gitSha the git SHA to be configured.
     */
    updateGitConfig(rootPath: string, clientRemote: string, auditRemote: string, gitSha: string): void {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(rootPath);
        if (wsRoot === undefined) {
            return;
        }
        return wsRoot.updateGitConfig(clientRemote, auditRemote, gitSha);
    }

    /**
     * Checks whether the following path is contained in any of the current workspace roots.
     * @param path The absolute path to be checked.
     * @returns A triple containing the corresponding WARoot if it exists (undefined otherwise),
     * a string with the relative path to this root folder ("" otherwise), and a boolean stating
     * whether the path is in multiple workspace roots. If so, the path to the closest root is returned.
     */
    getCorrespondingRootAndPath(path: string): [WARoot | undefined, string, boolean] {
        const cached = this.pathToRootMap.get(path);
        if (cached !== undefined) {
            return cached;
        }

        // It is possible that there are multiple workspace roots containing each other.
        // While this is deeply cursed, let's try to handle it by returning the root that is closest.
        // This corresponds to the shortest relative path.
        let currentBest: [WARoot | undefined, string] = [undefined, ""];
        let currentDistance = -1;
        let inMultipleRoots = false;
        for (const root of this.roots) {
            const [inWS, relativePath] = root.isInThisWorkspaceRoot(path);
            if (inWS) {
                if (currentBest[0] === undefined) {
                    currentBest = [root, relativePath];
                    currentDistance = relativePath.length;
                    this.pathToRootMap.set(path, [root, relativePath, false]);
                } else {
                    console.log("Path is present in multiple workspace roots.");
                    inMultipleRoots = true;
                    if (relativePath.length < currentDistance) {
                        currentBest = [root, relativePath];
                        currentDistance = relativePath.length;
                        this.pathToRootMap.set(path, [root, relativePath, true]);
                    }
                }
            }
        }
        return [...currentBest, inMultipleRoots];
    }

    /**
     * Returns all workspace roots that contain this path. This function only exists to deal
     * with the deeply cursed scenario when a user adds workspace roots that are contained in
     * other workspace roots.
     * @param path The absolute path to be checked.
     * @returns A an array of tuples containing a WARoot and a string with the relative path
     * to that root folder.
     */
    getAllCorrespondingRootsAndPaths(path: string): [WARoot, string][] {
        const cached = this.pathToMultipleRootMap.get(path);
        if (cached !== undefined) {
            return cached;
        }

        const correspondingRootsAndPaths: [WARoot, string][] = [];

        for (const root of this.roots) {
            const [inWS, relativePath] = root.isInThisWorkspaceRoot(path);
            if (inWS) {
                correspondingRootsAndPaths.push([root, relativePath]);
            }
        }

        this.pathToMultipleRootMap.set(path, correspondingRootsAndPaths);
        return correspondingRootsAndPaths;
    }

    /**
     * Get the selected configurations of all workspace roots
     * @returns the selected configurations of all workspace roots
     */
    getSelectedConfigurations(): ConfigurationEntry[] {
        const currentlySelectedConfigs: ConfigurationEntry[] = [];
        for (const wsRoot of this.roots) {
            currentlySelectedConfigs.push(...wsRoot.getSelectedConfigurations());
        }
        return currentlySelectedConfigs;
    }

    /**
     * Given a configuration, checks whether it is selected
     * @param config the target configuration.
     * @returns true if it is selected, false if not.
     */
    isConfigurationSelected(config: ConfigurationEntry): boolean {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(config.path);
        if (wsRoot === undefined) {
            return false;
        }
        return wsRoot.manageConfiguration(config, false);
    }

    /**
     * Given a configuration, toggle its selection status.
     * @param config the target configuration.
     */
    toggleConfiguration(config: ConfigurationEntry): void {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(config.path);
        if (wsRoot === undefined) {
            return;
        }
        wsRoot.toggleConfiguration(config);
    }

    /**
     * Given the uri of the current file, finds the corresponding workspace root and returns a FullLocation
     * corresponding to the current selection of the user.
     * @param uri The uri of the current file.
     * @returns A FullLocation corresponding to the selection or undefined if the current file is not in any workspace root.
     */
    getActiveSelectionLocation(uri: vscode.Uri): FullLocation[] | undefined {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(uri.fsPath);
        const result = wsRoot?.getActiveSelectionLocation();
        if (result === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error getting the current location. The file at ${uri.fsPath} is not in any workspace root.`);
        }
        return result;
    }

    /**
     * Given the `uri` of the current file, finds the corresponding workspace root and toggles the file as audited.
     * @param uri The `uri` of the current file.
     * @returns A list of `uri`s to be decorated and a list of relevant usernames
     * (or `undefined` and "" if the `uri` is not in any workspace root.)
     */
    toggleAudited(uri: vscode.Uri): [vscode.Uri[] | undefined, string[]] {
        const [closestRoot, closestRelativePath, inMultipleRoots] = this.getCorrespondingRootAndPath(uri.fsPath);
        if (closestRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error marking a file as audited. The file at ${uri.fsPath} is not in any workspace root.`);
            // This file was not in any workspace root. No URIs to update.
            return [undefined, []];
        }

        if (!inMultipleRoots) {
            // Only in one workspace root: default behavior
            const [urisToDecorate, relevantUsername] = closestRoot.toggleAudited(uri, closestRelativePath);
            return [urisToDecorate, [relevantUsername]];
        } else {
            // In multiple workspace roots: stupid behavior
            const allRootsAndPaths = this.getAllCorrespondingRootsAndPaths(uri.fsPath);
            let isAudited = false;
            const urisToDecorateMultiple: vscode.Uri[] = [];
            const relevantUsernamesMultiple: string[] = [];

            // Check if the file is audited anywhere and remove it from there
            for (const [wsRoot, relativePath] of allRootsAndPaths) {
                if (wsRoot.isAudited(relativePath)) {
                    isAudited = true;
                    const [urisToAdd, relevantUsernameToAdd] = wsRoot.toggleAudited(uri, relativePath);
                    urisToDecorateMultiple.push(...urisToAdd);
                    relevantUsernamesMultiple.push(relevantUsernameToAdd);
                }
            }

            // If it was not audited anywhere, toggle it everywhere
            if (!isAudited) {
                for (const [wsRoot, relativePath] of allRootsAndPaths) {
                    const [urisToAdd, relevantUsernameToAdd] = wsRoot.toggleAudited(uri, relativePath);
                    urisToDecorateMultiple.push(...urisToAdd);
                    relevantUsernamesMultiple.push(relevantUsernameToAdd);
                }
            }

            return [urisToDecorateMultiple, relevantUsernamesMultiple];
        }
    }

    /**
     * Given the `uri` of the current file, finds the corresponding workspace root and toggles the file as partially audited.
     * @param uri The `uri` of the current file.
     */
    addPartiallyAudited(uri: vscode.Uri): void {
        const [wsRoot, relativePath] = this.getCorrespondingRootAndPath(uri.fsPath);
        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error adding a partially audited file. The file at ${uri.fsPath} is not in any workspace root.`);
            return;
        }
        wsRoot.addPartiallyAudited(relativePath);
    }

    /**
     * Updates the saved data for the given user.
     * @param username the username to update the saved data for
     */
    updateSavedData(username: string): void {
        //Iterate over all workspace roots
        for (const root of this.roots) {
            void root.updateSavedData(username);
        }
    }

    /**
     * Gives the merged marked files by daily log for all roots.
     * The paths are all extended to full.
     */
    getMarkedFilesDayLog(): Map<string, [FullPath, string][]> {
        const mergedMarkedFilesDayLog: Map<string, [FullPath, string][]> = new Map<string, [FullPath, string][]>();
        for (const root of this.roots) {
            root.markedFilesDayLog.forEach((value, key) => {
                const currentValue = mergedMarkedFilesDayLog.get(key);
                const updateValue = value.map((path) => [{ rootPath: root.rootPath, path: path } as FullPath, root.getRootLabel()] as [FullPath, string]);
                if (currentValue === undefined) {
                    mergedMarkedFilesDayLog.set(key, updateValue);
                } else {
                    mergedMarkedFilesDayLog.set(key, currentValue.concat(updateValue));
                }
            });
        }
        return mergedMarkedFilesDayLog;
    }

    /**
     * Creates a unique path in case of a multi-root workspace.
     * This assumes that there are no workspace roots with the same folder name.
     * @param rootPath the path of the workspace root
     * @param relativePath the relative path of the target
     * @returns the unique path or undefined if the rootPath does not correspond to a current workspace root
     */
    createUniquePath(rootPath: string, relativePath: string): string | undefined {
        const [wsRoot, _relativePath] = this.getCorrespondingRootAndPath(rootPath);
        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error creating unique path. Filepath: ${rootPath} is not a workspace root.`);
            return undefined;
        }
        const rootLabel = wsRoot.getRootLabel();
        if (rootLabel !== "") {
            return path.join(rootLabel, relativePath);
        } else {
            vscode.window.showWarningMessage(
                `weAudit: Warning! It looks like your root path ${rootPath} is at the root of your filesystem. This is deeply cursed.`,
            );
            return path.join("/", relativePath);
        }
    }
}

export class CodeMarker implements vscode.TreeDataProvider<TreeEntry> {
    // treeEntries contains the currently active entries: findings and notes
    private treeEntries: FullEntry[];

    // resolvedEntries contains all entries that have been resolved
    private resolvedEntries: FullEntry[];

    private workspaces: MultiRootManager;
    private username: string;

    // pathToEntryMap associates a path label with the actual tree entries (location entries) rendered for that file
    private pathToEntryMap: Map<string, FullLocationEntry[]>;
    private pathToEntryMapDirty = true;
    private locationEntryCache = new WeakMap<FullLocation, FullLocationEntry>();

    private treeViewMode: TreeViewMode;

    private _onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorationsEmitter.event;

    private _onDidChangeTreeDataEmitter = new vscode.EventEmitter<FullEntry | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeDataEmitter.event;

    private resolvedEntriesTree: ResolvedEntries;

    private decorationManager: DecorationManager;
    private decorationsEnabled = true;

    // Cached configuration for sorting entries alphabetically
    private sortEntriesAlphabetically: boolean;

    // State for navigating through partially audited regions
    private currentPartiallyAuditedIndex = -1;

    constructor(context: vscode.ExtensionContext, decorationManager: DecorationManager) {
        this.treeEntries = [];
        this.resolvedEntries = [];

        this.workspaces = new MultiRootManager(context);

        this.decorationManager = decorationManager;

        this.pathToEntryMap = new Map<string, FullLocationEntry[]>();

        this.treeViewMode = TreeViewMode.List;
        this.loadTreeViewModeConfiguration();

        this.sortEntriesAlphabetically = vscode.workspace
            .getConfiguration("weAudit")
            .get<boolean>("general.sortEntriesAlphabetically", false);

        this.username = this.setUsernameConfigOrDefault();
        this.findAndLoadConfigurationUsernames();
        this.resolvedEntriesTree = new ResolvedEntries(context, this.resolvedEntries);

        vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.workspaces.getSelectedConfigurations());

        // Fill the Git configuration webview with the current git configuration
        vscode.commands.registerCommand(
            "weAudit.pushGitConfigView",
            (rootPath?: string) => {
                let wsRoot, _relativePath;
                if (rootPath === undefined) {
                    // If there is no rootPath, this is a request to repopulate the webview on webview-ready
                    const wsRoots = this.workspaces.getRoots();
                    if (wsRoots.length === 0) {
                        vscode.window.showErrorMessage(`weAudit: Error pushing git configuration. There are no workspace roots.`);
                        return;
                    }
                    wsRoot = wsRoots[0];
                } else {
                    // We should populate it with the requested workspace root
                    [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(rootPath);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`weAudit: Error pushing git configuration. The path ${rootPath} is not a current workspace root.`);
                        return;
                    }
                }
                vscode.commands.executeCommand(
                    "weAudit.setGitConfigView",
                    { rootPath: wsRoot.rootPath, rootLabel: wsRoot.getRootLabel() } as RootPathAndLabel,
                    wsRoot.clientRemote,
                    wsRoot.gitRemote,
                    wsRoot.gitSha,
                );
            },
            this,
        );

        // Push the workspace roots to the git configuration webview
        vscode.commands.registerCommand("weAudit.getGitConfigRoots", () => {
            vscode.commands.executeCommand(
                "weAudit.setGitConfigRoots",
                this.workspaces.getRoots().map((root) => ({ rootPath: root.rootPath, rootLabel: root.getRootLabel() }) as RootPathAndLabel),
            );
        });

        // Given a root path, return the root path of the next or previous root
        vscode.commands.registerCommand("weAudit.nextRoot", (rootPath: string, forward: boolean) => {
            const roots = this.workspaces.getRoots();
            if (roots.length < 2) {
                return rootPath;
            }
            let idx = roots.map((root) => root.rootPath).indexOf(rootPath);
            if (idx === -1) {
                vscode.commands.executeCommand("weAudit.getGitConfigRoots");
                idx = 0;
            }
            idx = forward ? (idx + 1) % roots.length : (idx - 1 + roots.length) % roots.length;
            return roots[idx].rootPath;
        });

        this.decorate();

        // Pushes the roots and currently selected configurations to the MultiConfig
        vscode.commands.registerCommand("weAudit.getMultiConfigRoots", () => {
            const rootPathsAndLabels = this.workspaces
                .getRoots()
                .map((root) => ({ rootPath: root.rootPath, rootLabel: root.getRootLabel() }) as RootPathAndLabel);
            vscode.commands.executeCommand("weAudit.setMultiConfigRoots", rootPathsAndLabels);
            vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.workspaces.getSelectedConfigurations());
        });

        vscode.commands.registerCommand("weAudit.toggleAudited", () => {
            this.toggleAudited();
        });

        vscode.commands.registerCommand("weAudit.addPartiallyAudited", () => {
            this.addPartiallyAudited();
        });

        vscode.commands.registerCommand("weAudit.toggleFindingsHighlighting", () => {
            this.decorationsEnabled = !this.decorationsEnabled;
            this.decorate();
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

        vscode.commands.registerCommand("weAudit.navigateToNextPartiallyAuditedRegion", () => {
            this.navigateToNextPartiallyAuditedRegion();
        });

        vscode.commands.registerCommand("weAudit.resolveFinding", (node: FullEntry) => {
            this.resolveFinding(node);
        });

        vscode.commands.registerCommand("weAudit.deleteFinding", (node: FullEntry) => {
            this.deleteFinding(node);
        });

        vscode.commands.registerCommand("weAudit.editEntryTitle", (node: FullEntry) => {
            void this.editEntryTitle(node);
        });

        vscode.commands.registerCommand("weAudit.editLocationEntry", (node: FullLocationEntry) => {
            void this.editLocationEntryDescription(node);
        });

        vscode.commands.registerCommand("weAudit.restoreFinding", (node: FullEntry) => {
            this.restoreFinding(node);
        });

        vscode.commands.registerCommand("weAudit.deleteResolvedFinding", (node: FullEntry) => {
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
                void this.editEntryTitle(toEdit);
            }
        });

        vscode.commands.registerCommand("weAudit.deleteLocationUnderCursor", () => {
            const entry = this.getLocationUnderCursor();
            if (entry) {
                const toDelete = isEntry(entry) ? createLocationEntry(entry.locations[0], entry) : entry;
                this.deleteLocation(toDelete);
            }
        });

        vscode.commands.registerCommand("weAudit.copyEntryPermalink", (entry: FullEntry | FullLocationEntry) => {
            void this.copyEntryPermalink(entry);
        });

        vscode.commands.registerCommand("weAudit.copyEntryPermalinks", (entry: FullEntry) => {
            void this.copyEntryPermalinks(entry);
        });

        vscode.commands.registerTextEditorCommand("weAudit.copySelectedCodePermalink", () => {
            void this.copySelectedCodePermalink(Repository.Audit);
        });

        vscode.commands.registerTextEditorCommand("weAudit.copySelectedCodeClientPermalink", () => {
            void this.copySelectedCodePermalink(Repository.Client);
        });

        vscode.commands.registerCommand("weAudit.editClientRemote", () => {
            void this.workspaces.editClientRemote();
        });

        vscode.commands.registerCommand("weAudit.editAuditRemote", () => {
            void this.workspaces.editAuditRemote();
        });

        vscode.commands.registerCommand("weAudit.editGitHash", () => {
            void this.workspaces.editGitHash();
        });

        // Set up the repositories for one workspace root specified by its path
        vscode.commands.registerCommand("weAudit.setupRepositoriesOne", (rootPath: string) => {
            const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(rootPath);
            if (wsRoot === undefined) {
                vscode.window.showErrorMessage(`weAudit: Error setting up repositories. The path ${rootPath} is not a current workspace root.`);
                return;
            }
            return wsRoot.setupRepositories();
        });

        // Set up the repositories for all workspace roots
        vscode.commands.registerCommand("weAudit.setupRepositoriesAll", () => {
            void this.workspaces.setupRepositories();
        });

        /**
         * Open a github issue. Warning: this command is used by Sarif Explorer and should at least accept Entry types.
         * Sarif explorer will always provide absolute paths as location paths, so it should be possible to find the corresponding workspace root.
         *  */
        vscode.commands.registerCommand("weAudit.openGithubIssue", (entry: Entry | FullEntry | FullLocationEntry) => {
            let actualEntries: FullEntry[];
            if (isOldEntry(entry)) {
                // This is the Sarif Explorer case. Location paths are absolute paths.

                // First check that all locations are inside one of the workspace roots:
                for (const loc of entry.locations) {
                    const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`Failed to open a GitHub issue. The file ${loc.path} is not in any workspace root.`);
                        return;
                    }
                }

                const splitEntries = this.splitLocationsFromEntry(entry);
                actualEntries = splitEntries.map(
                    (entry) =>
                        ({
                            label: entry.label,
                            entryType: entry.entryType,
                            author: entry.author,
                            details: entry.details,
                            locations: entry.locations.map((loc) => {
                                // transform absolute paths to relative paths to the workspace path
                                const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                                return {
                                    path: relativePath,
                                    startLine: loc.startLine,
                                    endLine: loc.endLine,
                                    label: loc.label,
                                    description: loc.description,
                                    rootPath: wsRoot!.rootPath, // We checked this in the earlier for loop
                                } as FullLocation;
                            }),
                        }) as FullEntry,
                );
            } else {
                // This is the weAudit internal case, entries are either FullEntry or FullLocationEntry
                const actualEntry = isLocationEntry(entry) ? entry.parentEntry : entry;

                // First check that all locations are inside one of the workspace roots:
                for (const loc of actualEntry.locations) {
                    const fullPath = path.join(loc.rootPath, loc.path);
                    const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.rootPath);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`Failed to open a GitHub issue. The file ${fullPath} is not in any workspace root.`);
                        return;
                    }
                }

                actualEntries = [actualEntry];
            }

            for (const actualEntry of actualEntries) {
                void this.openGithubIssue(actualEntry);
            }
        });

        // This command takes a configuration file, toggles its current selection, and shows/hides the corresponding findings
        vscode.commands.registerCommand("weAudit.toggleSavedFindings", (config: ConfigurationEntry) => {
            // Push configuration entry if not already in list, remove otherwise.

            // Toggle a specific config file
            const isSelected = this.workspaces.isConfigurationSelected(config);
            const savedData = this.loadSavedDataFromConfig(config, true, !isSelected);
            this.workspaces.toggleConfiguration(config);

            // refresh the currently selected files, findings tree and file decorations
            vscode.commands.executeCommand("weAudit.refreshSavedFindings", this.workspaces.getSelectedConfigurations());
            this.resolvedEntriesTree.setResolvedEntries(this.resolvedEntries);
            this.refreshTree();
            this.decorate();
            if (!savedData) {
                return;
            }
            // trigger the file decoration event so that the file decorations are updated
            for (const entry of savedData.treeEntries) {
                for (const loc of entry.locations) {
                    const uri = vscode.Uri.file(path.join(loc.rootPath, loc.path));
                    this._onDidChangeFileDecorationsEmitter.fire(uri);
                }
            }
        });

        vscode.commands.registerCommand("weAudit.updateCurrentSelectedEntry", (field: string, value: string, isPersistent: boolean) => {
            this.updateCurrentlySelectedEntry(field, value, isPersistent);
        });

        vscode.commands.registerCommand("weAudit.updateGitConfig", (rootPath: string, clientRemote: string, auditRemote: string, gitSha: string) => {
            this.workspaces.updateGitConfig(rootPath, clientRemote, auditRemote, gitSha);
        });

        // This command is used by Sarif Explorer and requires to accept Entry for backwards compatibility
        vscode.commands.registerCommand("weAudit.externallyLoadFindings", (results: Entry[]) => {
            // First check that all locations are inside one of the workspace roots:
            for (const result of results) {
                for (const loc of result.locations) {
                    const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                    if (wsRoot === undefined) {
                        vscode.window.showErrorMessage(`Failed to load external findings. The file ${loc.path} is not in any workspace root.`);
                        return;
                    }
                }
            }

            const indicesToRemove: number[] = [];
            const entriesToPush: Entry[] = [];

            results.forEach((result, ind) => {
                const splitEntries = this.splitLocationsFromEntry(result);

                // If it contains only one entry, there was nothing to split
                if (splitEntries.length > 1) {
                    indicesToRemove.push(ind);
                    entriesToPush.push(...splitEntries);
                }
            });

            for (const index of indicesToRemove.reverse()) {
                results.splice(index, 1);
            }

            results.push(...entriesToPush);

            const fullResults = results.map(
                (entry) =>
                    ({
                        label: entry.label,
                        entryType: entry.entryType,
                        author: entry.author,
                        details: entry.details,
                        locations: entry.locations.map((loc) => {
                            // transform absolute paths to relative paths to the workspace path
                            const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                            return {
                                path: relativePath,
                                startLine: loc.startLine,
                                endLine: loc.endLine,
                                label: loc.label,
                                description: loc.description,
                                rootPath: wsRoot!.rootPath, // We checked this in the earlier for loop
                            } as FullLocation;
                        }),
                    }) as FullEntry,
            );

            this.externallyLoadFindings(fullResults);
        });

        vscode.commands.registerCommand("weAudit.showMarkedFilesDayLog", () => {
            this.showMarkedFilesDayLog();
        });

        // This command is only used by Sarif Explorer, which will provide a location with an absolute path
        vscode.commands.registerCommand("weAudit.getClientPermalink", (location: Location) => {
            const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(location.path);
            if (wsRoot === undefined) {
                vscode.window.showErrorMessage(`Failed to get Client Permalink. The file ${location.path} is not in any workspace root.`);
                return;
            }

            const fullLocation = {
                path: relativePath,
                startLine: location.startLine,
                endLine: location.endLine,
                label: location.label,
                description: location.description,
                rootPath: wsRoot.rootPath,
            } as FullLocation;

            return this.getClientPermalink(fullLocation);
        });

        vscode.commands.registerCommand("weAudit.addRegionToAnEntry", () => {
            void this.addRegionToAnEntry();
        });

        vscode.commands.registerCommand("weAudit.addRegionToAnEntryWithLabel", () => {
            void this.addRegionToAnEntryWithLabel();
        });

        vscode.commands.registerCommand("weAudit.deleteLocation", (entry: FullLocationEntry) => {
            this.deleteLocation(entry);
        });

        vscode.commands.registerCommand("weAudit.showFindingsSearchBar", () => {
            void this.showFindingsSearchBar();
        });

        vscode.commands.registerCommand("weAudit.exportFindingsInMarkdown", () => {
            void this.exportFindingsInMarkdown();
        });

        // Gets the filtered entries from the current tree that correspond to a specific username and workspace root
        vscode.commands.registerCommand("weAudit.getFilteredEntriesForSaving", (username: string, root: WARoot) => {
            return this.getFilteredEntriesForSaving(username, root);
        });

        // ======== PUBLIC INTERFACE ========
        vscode.commands.registerCommand("weAudit.getCodeToCopyFromLocation", (entry: FullEntry | FullLocationEntry) => {
            return this.getCodeToCopyFromLocation(entry);
        });

        vscode.commands.registerCommand("weAudit.getSelectedClientCodeAndPermalink", () => {
            return this.getSelectedClientCodeAndPermalink();
        });
    }

    public setUsernameConfigOrDefault(): string {
        this.username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
        return this.username;
    }

    /**
     * Exports the findings to a markdown file
     * allowing the user to select which findings to export
     */
    private async exportFindingsInMarkdown(): Promise<void> {
        if (this.treeEntries.length === 0) {
            vscode.window.showInformationMessage("No findings to export.");
            return;
        }

        const items = this.treeEntries.map((entry) => {
            return {
                label: entry.label,
                entry: entry,
                iconPath: entry.entryType === EntryType.Note ? new vscode.ThemeIcon("bookmark") : new vscode.ThemeIcon("bug"),
                picked: true,
            };
        });

        const selectedEntries = await vscode.window.showQuickPick(items, {
            ignoreFocusOut: true,
            title: "Select the findings to export to markdown",
            canPickMany: true,
        });

        if (selectedEntries === undefined || selectedEntries.length === 0) {
            return;
        }

        let markdown = "";
        for (const entry of selectedEntries) {
            let entryMarkdown = await this.getEntryMarkdown(entry.entry);
            if (entryMarkdown === undefined) {
                entryMarkdown = "";
            }
            markdown += `---\n---\n---\n${entryMarkdown}\n\n`;
        }

        vscode.workspace
            .openTextDocument({
                language: "markdown",
                content: markdown,
            })
            .then((doc) => {
                vscode.window.showTextDocument(doc);
            });
    }

    private async showFindingsSearchBar(): Promise<void> {
        await vscode.commands.executeCommand("codeMarker.focus");
        // list.find opens the current view's search bar
        // https://stackoverflow.com/questions/68208883/filtering-a-treeview
        await vscode.commands.executeCommand("list.find");
    }

    async getSelectedClientCodeAndPermalink(): Promise<FromLocationResponse | void> {
        const locations = this.getActiveSelectionLocation();
        if (locations === undefined || locations.length === 0) {
            return;
        }

        // Use the first (primary) selection if more than one is present
        const location = locations[0];
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

    async getCodeToCopyFromLocation(entry: FullEntry | FullLocationEntry): Promise<FromLocationResponse | void> {
        const location = isLocationEntry(entry) ? entry.location : entry.locations[0];
        const permalink = await this.getClientPermalink(location);
        if (permalink === undefined) {
            return;
        }
        const codeToCopy = await this.getLocationCode(location);
        return { codeToCopy, permalink };
    }

    /**
     * When Sarif Explorer provides entries, it does not know anything about workspace roots.
     * So the locations inside the entries can correspond to multiple workspace roots.
     * This function splits out entries into one entry per workspace root.
     * @param entry The entry provided by Sarif Explorer
     * @returns An array containing one entry per workspace root in the locations of the original entry
     */
    splitLocationsFromEntry(entry: Entry): Entry[] {
        const splitEntries: Entry[] = [];

        const allRoots: Set<WARoot> = new Set(
            entry.locations.map((loc) => {
                const [wsRoot] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                return wsRoot!;
            }),
        );

        if (allRoots.size > 1) {
            for (const root of allRoots) {
                const newLocations = entry.locations.filter((loc) => {
                    const [wsRoot] = this.workspaces.getCorrespondingRootAndPath(loc.path);
                    return root === wsRoot;
                });
                const newEntry = {
                    label: entry.label,
                    entryType: entry.entryType,
                    author: entry.author,
                    details: entry.details,
                    locations: newLocations,
                } as Entry;

                splitEntries.push(newEntry);
            }
        } else {
            splitEntries.push(entry);
        }

        return splitEntries;
    }

    externallyLoadFindings(entries: FullEntry[]): void {
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
                if (e.author === entry.author && e.label === entry.label && e.locations[0]?.rootPath === entry.locations[0]?.rootPath) {
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
                void this.updateSavedData(author);
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
            void this.updateSavedData(entry.author);
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

    getTreeViewMode(): TreeViewMode {
        return this.treeViewMode;
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
        vscode.workspace.getConfiguration("weAudit").update("general.treeViewMode", label, true);
        this.refreshTree();
    }

    /**
     * Because most of the handling is now done by the MultiRootManager
     * and the individual WARoot constructors, this function merely loads
     * saved data from all configuration files
     */
    findAndLoadConfigurationUsernames(): void {
        for (const configEntry of this.workspaces.getSelectedConfigurations()) {
            this.loadSavedDataFromConfig(configEntry, true, true);
        }
        vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
    }

    /**
     * Toggles the current active file as audited or not audited.
     * Fires the onDidChangeFileDecorationsEmitter event if applicable.
     */
    toggleAudited(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;

        const [urisToDecorate, relevantUsernames] = this.workspaces.toggleAudited(uri);
        if (urisToDecorate !== undefined) {
            for (const uriToDecorate of urisToDecorate) {
                this._onDidChangeFileDecorationsEmitter.fire(uriToDecorate);
            }
        }
        // update decorations
        this.decorateWithUri(uri);
        for (const relevantUsername of relevantUsernames) {
            void this.updateSavedData(relevantUsername);
        }
        this.refresh(uri);
    }

    addPartiallyAudited(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;

        // Since partially audited files are maintained separately for each workspace root, use the MultiRootManager
        this.workspaces.addPartiallyAudited(uri);
        // update decorations
        this.decorateWithUri(uri);
        void this.updateSavedData(this.username);
    }

    private navigateToNextPartiallyAuditedRegion(): void {
        // Collect all partially audited regions from all workspace roots
        const allPartiallyAuditedRegions: { file: PartiallyAuditedFile; rootPath: string }[] = [];

        for (const wsRoot of this.workspaces.getRoots()) {
            const partiallyAuditedFiles = wsRoot.getPartiallyAudited();
            for (const file of partiallyAuditedFiles) {
                allPartiallyAuditedRegions.push({
                    file,
                    rootPath: wsRoot.rootPath,
                });
            }
        }

        if (allPartiallyAuditedRegions.length === 0) {
            return;
        }

        // Sort regions by file path, then by start line for consistent navigation order
        allPartiallyAuditedRegions.sort((a, b) => {
            const pathComparison = a.file.path.localeCompare(b.file.path);
            if (pathComparison !== 0) {
                return pathComparison;
            }
            return a.file.startLine - b.file.startLine;
        });

        // Update navigation index
        this.currentPartiallyAuditedIndex = (this.currentPartiallyAuditedIndex + 1) % allPartiallyAuditedRegions.length;

        const targetRegion = allPartiallyAuditedRegions[this.currentPartiallyAuditedIndex];
        const uri = vscode.Uri.file(path.join(targetRegion.rootPath, targetRegion.file.path));

        // Navigate to the region using the same pattern as tree entries
        vscode.commands.executeCommand("weAudit.openFileLines", uri, targetRegion.file.startLine, targetRegion.file.endLine);
    }

    /**
     * Creates and shows a representation of
     * the marked files by daily log, in markdown format.
     */
    showMarkedFilesDayLog(): void {
        // Since audited files are maintained separately for each workspace root, use the MultiRootManager
        const markedFilesDayLog = this.workspaces.getMarkedFilesDayLog();

        // sort the keys of the map by date
        const sortedDates = new Map(Array.from(markedFilesDayLog).sort(([a], [b]) => Date.parse(a) - Date.parse(b)));
        const asciiArrayData = new Array(sortedDates.keys.length);
        let idxDataArray = 0;

        let logString = "";
        let totalLOC = 0;

        for (const [date, files] of sortedDates) {
            if (files && files.length > 0) {
                let filesString = `## ${date}\n - `;
                filesString += files.map(([fullPath, rootLabel]) => path.join(rootLabel, fullPath.path)).join("\n - ");
                logString += `${filesString}\n\n`;

                // count the LOC per day
                const fullPaths = files.map(([fullPath]) => path.join(fullPath.rootPath, fullPath.path));
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
     * Edit the label of a marked code region
     * @param entry The entry to edit
     */
    async editEntryTitle(entry: FullEntry): Promise<void> {
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
        void this.updateSavedData(entry.author);
    }

    async editLocationEntryDescription(locationEntry: FullLocationEntry): Promise<void> {
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
        void this.updateSavedData(locationEntry.parentEntry.author);
    }

    /**
     * Get the git remote and the permalink for the given code region
     * @param repository If the repository is the Audit repository or the Client repository
     * @param startLine The start line of the code region
     * @param endLine The end line of the code region
     * @param path The path of the file
     * @returns The git remote and the permalink, or undefined if either could not be found
     */
    async getRemoteAndPermalink(repository: Repository, location: FullLocation): Promise<RemoteAndPermalink | undefined> {
        let gitRemote;

        // Since git configuration is managed per workspace root, use the MultiRootManager
        // to get the corresponding WARoot and get the link from there
        const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(location.rootPath);

        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error retrieving link. Filepath: ${location.rootPath} is not a workspace root.`);
            return;
        }

        switch (repository) {
            case Repository.Audit:
                gitRemote = await wsRoot.findGitRemote();
                break;
            case Repository.Client:
                gitRemote = await wsRoot.findClientRemote();
                break;
        }

        if (!gitRemote) {
            vscode.window
                .showErrorMessage(`Could not determine the ${repository} Repository URL.`, `Configure ${repository} URL for the corresponding workspace root`)
                .then((config) => {
                    if (config === undefined) {
                        return;
                    }
                    switch (repository) {
                        case Repository.Audit:
                            void wsRoot.editAuditRemote();
                            break;
                        case Repository.Client:
                            void wsRoot.editClientRemote();
                            break;
                    }
                });
            return;
        }

        const sha = wsRoot.findGitSha();
        if (!sha) {
            vscode.window.showErrorMessage("Could not determine the commit hash.", "Configure Commit Hash of the workspace root").then((config) => {
                if (config === undefined) {
                    return;
                }
                void wsRoot.editGitHash();
            });
            return;
        }

        const remoteHost = URL.parse(gitRemote)?.hostname;
        let permalink;
        if (remoteHost === "bitbucket.org") {
            const issueLocation = `#lines-${location.startLine + 1}:${location.endLine + 1}`;
            permalink = gitRemote + "/src/" + sha + "/" + location.path + issueLocation;
        } else {
            const issueLocation = `#L${location.startLine + 1}-L${location.endLine + 1}`;
            permalink = gitRemote + "/blob/" + sha + "/" + location.path + issueLocation;
        }

        return { remote: gitRemote, permalink };
    }

    /**
     * Get the git remote and the permalink for the given location, in the audit repository
     * @param location The location to get the remote and permalink for
     * @returns The git remote and the permalink, or undefined if either could not be found
     */
    async getEntryRemoteAndPermalink(location: FullLocation): Promise<RemoteAndPermalink | undefined> {
        return this.getRemoteAndPermalink(Repository.Audit, location);
    }

    /**
     * Get the git remote and the permalink for the given entry, in the client repository
     * @param startLine The start line of the code region
     * @param endLine The end line of the code region
     * @param path The path of the file
     * @returns The permalink, or undefined if either could not be found
     */
    async getClientPermalink(location: FullLocation): Promise<string | undefined> {
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
        const locations = this.getActiveSelectionLocation();
        if (locations === undefined || locations.length === 0) {
            return;
        }
        // Use the first selection
        const location = locations[0];

        const remoteAndPermalink = await this.getRemoteAndPermalink(repository, location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        this.copyToClipboard(remoteAndPermalink.permalink);
    }

    /**
     * Copy the permalink of the given entry to the clipboard
     * @param entry The entry to copy the permalink of
     */
    async copyEntryPermalink(entry: FullEntry | FullLocationEntry): Promise<void> {
        const location = isLocationEntry(entry) ? entry.location : entry.locations[0];
        const remoteAndPermalink = await this.getEntryRemoteAndPermalink(location);
        if (remoteAndPermalink === undefined) {
            return;
        }
        this.copyToClipboard(remoteAndPermalink.permalink);
    }

    /**
     * Copy all permalinks of the given entry to the clipboard
     * @param entry The entry to copy the permalinks of
     */
    async copyEntryPermalinks(entry: FullEntry): Promise<void> {
        const permalinkList = [];
        for (const location of entry.locations) {
            const remoteAndPermalink = await this.getEntryRemoteAndPermalink(location);
            if (remoteAndPermalink === undefined) {
                return;
            }
            permalinkList.push(remoteAndPermalink.permalink);
        }

        // get separator from configuration
        const separator: string = vscode.workspace.getConfiguration("weAudit").get("general.permalinkSeparator") || "\n";
        // interpret \n as newline
        const interpretedSep = separator.replace(/\\n/g, "\n");
        // join the permalinks with the separator
        const permalinksString = permalinkList.join(interpretedSep);
        // copy the permalinks to the clipboard
        this.copyToClipboard(permalinksString);
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
    async getLocationCode(location: FullLocation): Promise<string> {
        await vscode.commands.executeCommand(
            "weAudit.openFileLines",
            vscode.Uri.file(path.join(location.rootPath, location.path)),
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
    async openGithubIssue(entry: FullEntry): Promise<void> {
        // open github issue with the issue body with the finding text and permalink
        const title = encodeURIComponent(entry.label);

        const issueBodyText = await this.getEntryMarkdown(entry);
        if (issueBodyText === undefined) {
            return;
        }

        const encodedIssueBody = encodeURIComponent(issueBodyText);

        // Since each workspace root should correspond to a different git repository,
        // we first get the corresponding root
        let wsRoot;
        for (const loc of entry.locations) {
            const [_wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(loc.rootPath);
            if (_wsRoot !== undefined) {
                wsRoot = _wsRoot;
                break;
            }
        }

        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error opening GitHub issue. None of the locations in this finding correspond to a workspace root.`);
            return;
        }

        const isGitHubRemote = wsRoot.gitRemote.startsWith("https://github.com/") || wsRoot.gitRemote.startsWith("github.com/");

        let issueUrl: string;
        let issueUrlWithBody: string;

        if (isGitHubRemote) {
            issueUrl = wsRoot.gitRemote + "/issues/new?";
            issueUrlWithBody = `${issueUrl}title=${title}&body=${encodedIssueBody}`;
        } else {
            // If the remote is not GitHub, we assume it is GitLab
            // gitlab url arguments spec
            // https://docs.gitlab.com/ee/user/project/issues/create_issues.html#using-a-url-with-prefilled-values
            issueUrl = wsRoot.gitRemote + "/-/issues/new?";
            issueUrlWithBody = `${issueUrl}issue[title]=${title}&issue[description]=${encodedIssueBody}`;
        }

        // GitHub's URL max size is about 8000 characters
        // Gitlab seems to allow more but we'll use the same limit for now
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
        vscode.window
            .showErrorMessage("The issue body is too long to open automatically in the URL", "Copy issue to clipboard and open browser window")
            .then((action) => {
                if (action === undefined) {
                    return;
                }
                vscode.env.clipboard.writeText(issueBodyText);
                const pasteHereMessage = encodeURIComponent("[Paste the issue body here]");
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                vscode.env.openExternal(`${issueUrl}title=${title}&body=${pasteHereMessage}`);
            });
    }

    private async getEntryMarkdown(entry: FullEntry): Promise<string | void> {
        const clientPermalinks = [];
        const auditPermalinks = [];
        let locationDescriptions = "";

        let atLeastOneUniqueClientRemote = false;

        // Use .entries to iterate over entry.locations
        for (const [i, location] of entry.locations.entries()) {
            const clientRemoteAndPermalink = await this.getRemoteAndPermalink(Repository.Client, location);
            const auditRemoteAndPermalink = await this.getRemoteAndPermalink(Repository.Audit, location);
            if (auditRemoteAndPermalink === undefined) {
                return;
            }
            if (
                clientRemoteAndPermalink !== undefined &&
                clientRemoteAndPermalink.remote !== "" &&
                clientRemoteAndPermalink.remote !== auditRemoteAndPermalink.remote
            ) {
                atLeastOneUniqueClientRemote = true;
            }
            const clientPermalink = clientRemoteAndPermalink === undefined ? "" : clientRemoteAndPermalink.permalink;
            clientPermalinks.push(clientPermalink);
            auditPermalinks.push(auditRemoteAndPermalink.permalink);

            // Include location section if there's a label or description
            if (location.label !== "" || location.description !== "") {
                locationDescriptions += `\n\n---\n`;
                locationDescriptions += `#### Location ${i + 1}${location.label ? ` ${location.label}` : ""}\n`;
                if (location.description !== "") {
                    locationDescriptions += `${location.description}\n\n`;
                }
                locationDescriptions += `${auditRemoteAndPermalink.permalink}`;
            }
        }

        // deduplicate the target paths
        const locationSet: Set<string> = new Set();
        for (const location of entry.locations) {
            // Multi-root may have colliding paths
            if (this.workspaces.moreThanOneRoot()) {
                const uniquePath = this.workspaces.createUniquePath(location.rootPath, location.path);
                if (uniquePath !== undefined) {
                    locationSet.add(uniquePath);
                }
            } else {
                locationSet.add(location.path);
            }
        }

        const target = Array.from(locationSet).join(", ");
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
        // TODO: this breaks the finding writer
        if (clientPermalinkString !== "" && atLeastOneUniqueClientRemote) {
            issueBodyText += `Client PermaLink:\n${clientPermalinkString}\n`;
        }
        return issueBodyText;
    }

    /**
     * Gets the index of the tree entry that matches the given path and intersects the provided line range.
     * This does not use entryEquals because we use it to find which tree entry intersects
     * the cursor position.
     * @param location The location to check
     * @returns The index of the entry in the tree entries list or -1 if it was not found
     */
    getIntersectingTreeEntryIndex(location: FullLocation, entryType: EntryType): number {
        const entryTree = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
        for (let i = 0; i < this.treeEntries.length; i++) {
            const entry = this.treeEntries[i];
            if (entry.entryType !== entryType) {
                continue;
            }
            for (const loc of entry.locations) {
                if (loc.path === location.path && loc.rootPath === location.rootPath) {
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
    deleteAndResolveFinding(entry: FullEntry, resolve: boolean): void {
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

        void this.updateSavedData(removed.author);
        this.refreshAndDecorateEntry(removed);
    }

    /**
     * Deletes the entry from the tree entries list, but does not add it to the
     * resolved entries list.
     * @param entry the entry to remove from the tree entries list
     */
    deleteFinding(entry: FullEntry): void {
        this.deleteAndResolveFinding(entry, false);
    }

    /**
     * Deletes the entry from the tree entries list and adds it to the
     * resolved entries list.
     * @param entry the entry to resolve.
     */
    resolveFinding(entry: FullEntry): void {
        this.deleteAndResolveFinding(entry, true);
    }

    /**
     * Creates a new finding entry and adds it to the tree entries list,
     * or edits the entry if it already exists.
     *
     */
    addFinding(): void {
        void this.createOrEditEntry(EntryType.Finding);
    }

    /**
     * Creates a new note entry and adds it to the tree entries list,
     * or edits the entry if it already exists.
     */
    addNote(): void {
        void this.createOrEditEntry(EntryType.Note);
    }

    /**
     * Restores the entry to the tree entries list and removes it from the
     * resolved entries list.
     * @param entry the entry to restore
     */
    restoreFinding(entry: FullEntry): void {
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
        void this.updateSavedData(entry.author);
    }

    /**
     * Deletes the entry from the resolved entries list.
     * @param entry the entry to delete
     */
    deleteResolvedFinding(entry: FullEntry): void {
        const idx = getEntryIndexFromArray(entry, this.resolvedEntries);
        if (idx === -1) {
            console.log("error in deleteResolvedFinding");
            return;
        }
        this.resolvedEntries.splice(idx, 1);
        this.resolvedEntriesTree.refresh();
        void this.updateSavedData(entry.author);
    }

    /**
     * Deletes all resolved findings.
     */
    deleteAllResolvedFindings(): void {
        if (this.resolvedEntries.length === 0) {
            return;
        }

        // get the authors of the resolved findings without duplicates
        const authors = this.resolvedEntries.map((entry) => entry.author).filter((value, index, self) => self.indexOf(value) === index);

        this.resolvedEntries.splice(0, this.resolvedEntries.length);
        for (const author of authors) {
            void this.updateSavedData(author);
        }
        this.resolvedEntriesTree.refresh();
    }

    /**
     * Restores all resolved findings.
     */
    restoreAllResolvedFindings(): void {
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
            void this.updateSavedData(author);
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
    async createOrEditEntry(entryType: EntryType): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const uri = editor.document.uri;
        const locations = this.workspaces.getActiveSelectionLocation(uri);

        if (locations === undefined) {
            vscode.window.showErrorMessage("Trying to add entries to a file outside this workspace: " + uri.fsPath);
            return;
        }
        if (locations.length === 0) {
            return;
        }

        const location = locations[0];

        const intersectedIdx = this.getIntersectingTreeEntryIndex(location, entryType);

        // if we found an entry, edit the description
        if (intersectedIdx !== -1) {
            const entry = this.treeEntries[intersectedIdx];
            // editEntryTitle calls updateSavedData so we don't need to call it here
            await this.editEntryTitle(entry);
        } else {
            // otherwise, add it to the tree entries
            // create title depending on the entry type
            const inputBoxTitle = entryType === EntryType.Finding ? "Add Finding Title" : "Add Note Title";
            const title = await vscode.window.showInputBox({ title: inputBoxTitle, ignoreFocusOut: true });
            if (title === undefined) {
                return;
            }

            const entry: FullEntry = {
                label: title,
                entryType: entryType,
                author: this.username,
                locations: locations,
                details: createDefaultEntryDetails(),
            };
            this.treeEntries.push(entry);
            void this.updateSavedData(this.username);
        }

        this.decorateWithUri(uri);
        this.refresh(uri);
    }

    addNewEntryFromLocationEntry(locationEntry: FullLocationEntry): void {
        const entry: FullEntry = {
            label: locationEntry.location.label !== "" ? locationEntry.location.label : locationEntry.parentEntry.label,
            entryType: locationEntry.parentEntry.entryType,
            author: this.username,
            locations: [locationEntry.location],
            details: createDefaultEntryDetails(),
        };
        this.treeEntries.push(entry);
        void this.updateSavedData(this.username);

        const uri = vscode.Uri.file(path.join(locationEntry.location.rootPath, locationEntry.location.path));
        this.decorateWithUri(uri);
        this.refresh(uri);
    }

    getActiveSelectionLocation(): FullLocation[] | undefined {
        // the null assertion is never undefined because we check if the editor is undefined
        const editor = vscode.window.activeTextEditor!;
        const uri = editor.document.uri;
        const locations = this.workspaces.getActiveSelectionLocation(uri);

        if (locations === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error determining location of selected code. Filepath: ${uri.fsPath} is not in any workspace root.`);
            return;
        }

        return locations;
    }

    /**
     * Deletes an additional location from an entry
     * @param entry the entry of type "AdditionalEntry" to remove from some main entry
     */
    deleteLocation(entry: FullLocationEntry): void {
        // find the treeEntry with this additional data
        const parentEntry = entry.parentEntry;
        if (parentEntry.locations === undefined) {
            console.log("error in deleteLocation");
            return;
        }

        for (let i = 0; i < parentEntry.locations.length; i++) {
            const location = parentEntry.locations[i];
            if (
                location.path === entry.location.path &&
                location.startLine === entry.location.startLine &&
                location.endLine === entry.location.endLine &&
                location.rootPath === entry.location.rootPath
            ) {
                parentEntry.locations.splice(i, 1);
                if (parentEntry.locations.length === 0) {
                    this.deleteFinding(parentEntry);
                    this.refreshAndDecorateFromPath(location);
                    return;
                }

                void this.updateSavedData(parentEntry.author);
                // we only need to refresh the URI for the deleted location
                this.refreshAndDecorateFromPath(entry.location);
                return;
            }
        }
    }

    /**
     * Updates the saved data for the given user.
     * @param username the username to update the saved data for
     */
    updateSavedData(username: string): void {
        this.workspaces.updateSavedData(username);
    }

    /**
     * This is a helper function that allows workspace roots to get the relevant entries from the
     * CodeMarker's treeEntries when saving data. The entries are filtered by username and workspace
     * root before handing them over.
     * @param username The username whose findings should be saved.
     * @param root The workspace root where the findings should be saved.
     * @returns
     */
    getFilteredEntriesForSaving(username: string, root: WARoot): [FullEntry[], FullEntry[]] {
        const filteredEntries = this.treeEntries.filter((entry) => {
            let inWs = false;
            for (const location of entry.locations) {
                if (location.rootPath === root.rootPath) {
                    inWs = true;
                    break;
                }
            }
            return entry.author === username && inWs;
        });
        const filteredResolvedEntries = this.resolvedEntries.filter((entry) => {
            let inWs = false;
            for (const location of entry.locations) {
                if (location.rootPath === root.rootPath) {
                    inWs = true;
                    break;
                }
            }
            return entry.author === username && inWs;
        });
        return [filteredEntries, filteredResolvedEntries];
    }

    /**
     * Shared helper that adds the current editor selection(s) to an existing entry.
     * Optionally prompts for a label that is applied to each new location.
     * @param getLabel function that resolves to the label to assign, or undefined to skip labeling
     */
    private async addRegionToEntryWithOptionalLabel(getLabel?: () => Promise<string | undefined>): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const locations = this.getActiveSelectionLocation();
        if (locations === undefined || locations.length === 0) {
            return;
        }

        // create a quick pick to select the entry to add the region to
        const items = this.treeEntries
            .filter((entry) => {
                if (entry.locations.length === 0 || entry.locations[0].rootPath !== locations[0].rootPath) {
                    return false;
                }
                return true;
            })
            .map((entry) => {
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

        const pickItem = await vscode.window.showQuickPick(items, {
            ignoreFocusOut: true,
            title: "Select the finding to add the region to",
        });

        if (pickItem === undefined) {
            return;
        }

        let label: string | undefined;
        if (getLabel) {
            label = await getLabel();
            if (label === undefined) {
                return;
            }
        }

        const entry = pickItem.entry;
        // Add each selection as a separate region, optionally tagging with the provided label
        for (const location of locations) {
            if (label !== undefined) {
                location.label = label;
            }
            entry.locations.push(location);
        }
        this.updateSavedData(entry.author);
        this.decorateWithUri(editor.document.uri);
        this.refresh(editor.document.uri);
        // reveal the entry in the tree view if the treeview is visible,
        // for some reason, it won't expand even if though it is created
        // with an expanded state
        if (treeView.visible) {
            treeView.reveal(entry, { expand: 1, select: false });
        }
    }

    /**
     * Add the selected code region to an existing entry
     */
    async addRegionToAnEntry(): Promise<void> {
        await this.addRegionToEntryWithOptionalLabel();
    }

    /**
     * Add the selected code region to an existing entry, prompting for a label
     */
    async addRegionToAnEntryWithLabel(): Promise<void> {
        await this.addRegionToEntryWithOptionalLabel(async () =>
            vscode.window.showInputBox({
                title: "Enter a label for this location",
                ignoreFocusOut: true,
            }),
        );
    }

    /**
     * Loads the saved findings from a file
     * @param config  the configuration to load from
     * @param update  whether to update the tree entries
     * @param add  whether to add the findings to the tree entries
     * @returns the parsed entries in the file
     */
    loadSavedDataFromConfig(config: ConfigurationEntry, update: boolean, add: boolean): FullSerializedData | undefined {
        if (!fs.existsSync(config.path)) {
            return;
        }

        // TODO: can be better?
        const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(config.path);

        if (wsRoot === undefined) {
            vscode.window.showErrorMessage(`weAudit: Error loading data for ${config.username}. Filepath: ${config.path} is not in any workspace root.`);
            return;
        }

        const parsedEntries = wsRoot.loadSavedDataFromConfig(config);
        if (parsedEntries === undefined) {
            return;
        }

        // For backwards compatibility, we need to add the rootpath to the locations here
        const rootPath = wsRoot.rootPath;
        const fullParsedEntries = {
            clientRemote: parsedEntries.clientRemote,
            gitRemote: parsedEntries.gitRemote,
            gitSha: parsedEntries.gitSha,
            treeEntries: parsedEntries.treeEntries.map(
                (entry) =>
                    ({
                        label: entry.label,
                        entryType: entry.entryType,
                        author: entry.author,
                        details: entry.details,
                        locations: entry.locations.map(
                            (loc) =>
                                ({
                                    path: loc.path,
                                    startLine: loc.startLine,
                                    endLine: loc.endLine,
                                    label: loc.label,
                                    description: loc.description,
                                    rootPath: rootPath,
                                }) as FullLocation,
                        ),
                    }) as FullEntry,
            ),
            auditedFiles: parsedEntries.auditedFiles,
            // older versions do not have partiallyAuditedFiles
            partiallyAuditedFiles: parsedEntries.partiallyAuditedFiles,
            resolvedEntries: parsedEntries.resolvedEntries.map(
                (entry) =>
                    ({
                        label: entry.label,
                        entryType: entry.entryType,
                        author: entry.author,
                        details: entry.details,
                        locations: entry.locations.map(
                            (loc) =>
                                ({
                                    path: loc.path,
                                    startLine: loc.startLine,
                                    endLine: loc.endLine,
                                    label: loc.label,
                                    description: loc.description,
                                    rootPath: rootPath,
                                }) as FullLocation,
                        ),
                    }) as FullEntry,
            ),
        } as FullSerializedData;

        // Normalize all the paths from loaded files. These can come from different OSes with different path
        // conventions. We do a best effort to match them to the current OS format.
        fullParsedEntries.treeEntries.forEach((entry) => {
            entry.locations.forEach((loc) => {
                loc.path = normalizePathForOS(rootPath, loc.path);
            });
        });

        fullParsedEntries.resolvedEntries.forEach((entry) => {
            entry.locations.forEach((loc) => {
                loc.path = normalizePathForOS(rootPath, loc.path);
            });
        });

        fullParsedEntries.auditedFiles.forEach((auditedFile) => {
            auditedFile.path = normalizePathForOS(rootPath, auditedFile.path);
        });

        fullParsedEntries.partiallyAuditedFiles?.forEach((partiallyAuditedFile) => {
            partiallyAuditedFile.path = normalizePathForOS(rootPath, partiallyAuditedFile.path);
        });

        if (update) {
            if (add) {
                // Remove potential entries of username which appear on the tree.
                // This is to avoid duplicates
                // However, in a multi-root setting it is possible that this username is active in multiple roots
                // In that case, we only remove findings where all locations correspond to the workspace root of the
                // config file whose data is loaded
                if (
                    !this.workspaces
                        .getSelectedConfigurations()
                        .map((selectedConfig) => selectedConfig.username)
                        .includes(config.username)
                ) {
                    this.treeEntries = this.treeEntries.filter(
                        (entry) =>
                            entry.author !== config.username ||
                            entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                    );
                    wsRoot.filterAudited(config.username);
                    wsRoot.filterPartiallyAudited(config.username);
                    this.resolvedEntries = this.resolvedEntries.filter(
                        (entry) =>
                            entry.author !== config.username ||
                            entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                    );
                }

                const newTreeEntries = fullParsedEntries.treeEntries;

                this.treeEntries = this.treeEntries.concat(newTreeEntries);
                wsRoot.concatAudited(fullParsedEntries.auditedFiles);
                // handle older versions of the extension that don't have partially audited entries
                if (fullParsedEntries.partiallyAuditedFiles !== undefined) {
                    wsRoot.concatPartiallyAudited(fullParsedEntries.partiallyAuditedFiles);
                }

                // handle older versions of the extension that don't have resolved entries
                if (fullParsedEntries.resolvedEntries !== undefined) {
                    this.resolvedEntries = this.resolvedEntries.concat(fullParsedEntries.resolvedEntries);
                }
            } else {
                this.treeEntries = this.treeEntries.filter(
                    (entry) =>
                        entry.author !== config.username ||
                        entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                );
                wsRoot.filterAudited(config.username);
                wsRoot.filterPartiallyAudited(config.username);
                this.resolvedEntries = this.resolvedEntries.filter(
                    (entry) =>
                        entry.author !== config.username ||
                        entry.locations.findIndex((loc) => this.workspaces.getUniqueLabel(loc.rootPath) !== config.root.label) !== -1,
                );
            }
        }

        this.markPathMapDirty();

        return fullParsedEntries;
    }

    /**
     * Implicitly called in this._onDidChangeFileDecorationsEmitter.fire(uri);
     * which is called on this.refresh(uri)
     * @param uri the uri of the file to decorate
     * @returns the decoration for the file
     */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const [wsRoot, relativePath, inMultipleRoots] = this.workspaces.getCorrespondingRootAndPath(uri.fsPath);

        if (wsRoot === undefined) {
            return;
        }

        let hasFindings = false;
        let isAudited = false;

        const allRootsAndPaths: [WARoot, string][] = [];
        if (!inMultipleRoots) {
            // There is only one root, so we use it
            allRootsAndPaths.push([wsRoot, relativePath]);
        } else {
            // There are multiple roots, we need to look up all of them
            allRootsAndPaths.push(...this.workspaces.getAllCorrespondingRootsAndPaths(uri.fsPath));
        }

        outer: for (const entry of this.treeEntries) {
            // if any of the locations is on this file, badge it
            if (entry.entryType === EntryType.Finding && entry.locations) {
                for (const location of entry.locations) {
                    for (const [wsRoot, relativePath] of allRootsAndPaths) {
                        if (location.path === relativePath && location.rootPath === wsRoot.rootPath) {
                            hasFindings = true;
                            break outer;
                        }
                    }
                }
            }
        }
        // check if there is an entry for this file in the audited files
        for (const [wsRoot, relativePath] of allRootsAndPaths) {
            if (wsRoot.isAudited(relativePath)) {
                isAudited = true;
            }
        }

        if (isAudited) {
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

        // If highlights were disabled, clear the decorations and return
        if (!this.decorationsEnabled) {
            this.decorationManager.clearEditorDecorations(editor);
            return;
        }

        const [wsRoot, relativePath, inMultipleRoots] = this.workspaces.getCorrespondingRootAndPath(editor.document.fileName);

        if (wsRoot === undefined || relativePath === undefined) {
            return;
        }

        const allRootsAndPaths: [WARoot, string][] = [];
        if (!inMultipleRoots) {
            // There is only one root, so we use it
            allRootsAndPaths.push([wsRoot, relativePath]);
        } else {
            // There are multiple roots, we need to look up all of them
            allRootsAndPaths.push(...this.workspaces.getAllCorrespondingRootsAndPaths(editor.document.fileName));
        }

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
                for (const [wsRoot, fname] of allRootsAndPaths) {
                    if (location.path !== fname || location.rootPath !== wsRoot.rootPath) {
                        continue;
                    }
                    const range = new vscode.Range(location.startLine, 0, location.endLine, Number.MAX_SAFE_INTEGER);
                    if (treeItem.entryType === EntryType.Finding) {
                        findingDecoration.push(range);
                    } else if (treeItem.entryType === EntryType.Note) {
                        noteDecoration.push(range);
                    }
                    // add the author information
                    const extraLabel = isOwnEntry ? "(you)" : "(" + treeItem.author + ")";
                    const labelString =
                        treeItem.label === location.label ? `${treeItem.label}  ${extraLabel}` : `${treeItem.label} ${location.label}  ${extraLabel}`;

                    labelDecorations.push(labelAfterFirstLineTextDecoration(location.startLine, labelString));

                    const afterLineRange = new vscode.Range(location.startLine, Number.MAX_SAFE_INTEGER, location.startLine, Number.MAX_SAFE_INTEGER);
                    labelDecorations.push(hoverOnLabel(afterLineRange, treeItem.label));
                }
            }
        }

        editor.setDecorations(this.decorationManager.ownFindingDecorationType, ownDecorations);
        editor.setDecorations(this.decorationManager.otherFindingDecorationType, otherDecorations);
        editor.setDecorations(this.decorationManager.ownNoteDecorationType, ownNoteDecorations);
        editor.setDecorations(this.decorationManager.otherNoteDecorationType, otherNoteDecorations);

        editor.setDecorations(this.decorationManager.emptyDecorationType, labelDecorations);

        // check if editor is audited, and mark it as such
        let range: vscode.Range[] = [];
        const partiallyAuditedFiles: PartiallyAuditedFile[] = [];
        for (const [wsRoot, fname] of allRootsAndPaths) {
            if (wsRoot.isAudited(fname)) {
                range = [new vscode.Range(0, 0, editor.document.lineCount, 0)];
            }
            partiallyAuditedFiles.push(...wsRoot.getPartiallyAudited().filter((entry) => entry.path === fname));
        }

        // check if editor is partially audited, and mark locations as such
        const partiallyAuditedDecorations = partiallyAuditedFiles.map((r) => new vscode.Range(r.startLine, 0, r.endLine, 0));
        editor.setDecorations(this.decorationManager.auditedFileDecorationType, range.concat(partiallyAuditedDecorations));
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
        this.ensurePathToEntryMap();

        if (element === undefined) {
            const pathLabels = Array.from(this.pathToEntryMap.keys()).sort();
            return pathLabels.map((label) => createPathOrganizer(label));
        } else {
            // get entries with same path as element
            if (isPathOrganizerEntry(element)) {
                const entries = this.pathToEntryMap.get(element.pathLabel) ?? [];
                if (this.sortEntriesAlphabetically) {
                    return [...entries].sort((a, b) => {
                        // Sort by entry type first (findings before notes), then by label
                        if (a.parentEntry.entryType !== b.parentEntry.entryType) {
                            if (a.parentEntry.entryType === EntryType.Finding) {
                                return -1;
                            }
                            if (b.parentEntry.entryType === EntryType.Finding) {
                                return 1;
                            }
                            return 0; // Stable sort for any future entry types
                        }
                        return a.parentEntry.label.localeCompare(b.parentEntry.label);
                    });
                }
                return entries;
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
     *  - if findings and notes have multiple locations, these will be their children
     *
     * @param entry the element to get the children of
     * @returns the children of the element
     */
    getChildrenLinear(entry?: TreeEntry): TreeEntry[] {
        this.ensurePathToEntryMap();

        if (entry !== undefined) {
            if (isLocationEntry(entry) || isPathOrganizerEntry(entry) || !entry.locations) {
                return [];
            }

            return entry.locations
                .filter((location) => this.isLocationVisible(entry, location))
                .map((location) => this.getOrCreateLocationEntry(entry, location));
        }

        const entries: FullEntry[] = [];
        const notes: FullEntry[] = [];
        for (const entry of this.treeEntries) {
            if (entry.entryType === EntryType.Finding) {
                entries.push(entry);
            } else {
                notes.push(entry);
            }
        }

        if (this.sortEntriesAlphabetically) {
            entries.sort((a, b) => a.label.localeCompare(b.label));
            notes.sort((a, b) => a.label.localeCompare(b.label));
        }

        return entries.concat(notes).filter((entry) => this.hasVisibleLocation(entry));
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
    getParent(e: TreeEntry): FullEntry | undefined {
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
                arguments: [vscode.Uri.file(path.join(entry.location.rootPath, entry.location.path)), entry.location.startLine, entry.location.endLine],
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
            arguments: [vscode.Uri.file(path.join(mainLocation.rootPath, mainLocation.path)), mainLocation.startLine, mainLocation.endLine],
        };

        treeItem.contextValue = entry.entryType === EntryType.Note ? "note" : "finding";

        return treeItem;
    }

    /**
     * Finds the entry under the cursor in the active text editor.
     * @returns the entry under the cursor, or undefined if there is none
     */
    getLocationUnderCursor(): FullEntry | FullLocationEntry | undefined {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
            return;
        }
        const [wsRoot, relativePath] = this.workspaces.getCorrespondingRootAndPath(editor.document.fileName);

        if (wsRoot === undefined || relativePath === undefined) {
            return;
        }

        let pathLabel: string;
        // If there is more than one root, relative paths may not be unique
        // Therefore, we create unique paths by prepending the workspace root directory name
        if (this.workspaces.moreThanOneRoot()) {
            // We know that the unique path creation succeeds, because we are calling it directly on a WARoot's path
            pathLabel = this.workspaces.createUniquePath(wsRoot.rootPath, relativePath)!;
        } else {
            pathLabel = relativePath;
        }

        this.ensurePathToEntryMap();

        const locationEntries = this.pathToEntryMap.get(pathLabel);
        if (locationEntries === undefined) {
            return;
        }

        for (const locationEntry of locationEntries) {
            const region = new vscode.Range(locationEntry.location.startLine, 0, locationEntry.location.endLine, Number.MAX_SAFE_INTEGER);
            if (editor.selection.intersection(region) !== undefined) {
                if (locationEntry.parentEntry.locations.length === 1) {
                    return locationEntry.parentEntry;
                }
                return locationEntry;
            }
        }
    }

    private ensurePathToEntryMap(): void {
        if (!this.pathToEntryMapDirty) {
            return;
        }
        this.rebuildPathToEntryMap();
    }

    private rebuildPathToEntryMap(): void {
        this.pathToEntryMap.clear();

        for (const entry of this.treeEntries) {
            for (const location of entry.locations) {
                if (!this.isLocationVisible(entry, location)) {
                    continue;
                }

                const pathLabel = this.getPathLabelForLocation(location);
                if (pathLabel === undefined) {
                    continue;
                }

                const locationEntry = this.getOrCreateLocationEntry(entry, location);
                const entriesForPath = this.pathToEntryMap.get(pathLabel);
                if (entriesForPath === undefined) {
                    this.pathToEntryMap.set(pathLabel, [locationEntry]);
                } else {
                    entriesForPath.push(locationEntry);
                }
            }
        }

        for (const entries of this.pathToEntryMap.values()) {
            entries.sort((a, b) => a.location.startLine - b.location.startLine);
        }

        this.pathToEntryMapDirty = false;
    }

    private getOrCreateLocationEntry(entry: FullEntry, location: FullLocation): FullLocationEntry {
        const cached = this.locationEntryCache.get(location);
        if (cached !== undefined && cached.parentEntry === entry) {
            return cached;
        }
        const locationEntry = createLocationEntry(location, entry);
        this.locationEntryCache.set(location, locationEntry);
        return locationEntry;
    }

    private isLocationVisible(entry: FullEntry, location: FullLocation): boolean {
        const absolutePath = path.join(location.rootPath, location.path);
        const [wsRoot, _relativePath] = this.workspaces.getCorrespondingRootAndPath(absolutePath);
        if (wsRoot === undefined) {
            return false;
        }
        return (
            this.workspaces
                .getSelectedConfigurations()
                .findIndex((config) => config.username === entry.author && config.root.label === wsRoot.getRootLabel()) !== -1
        );
    }

    private getPathLabelForLocation(location: FullLocation): string | undefined {
        if (this.workspaces.moreThanOneRoot()) {
            return this.workspaces.createUniquePath(location.rootPath, location.path) ?? undefined;
        }
        return location.path;
    }

    private hasVisibleLocation(entry: FullEntry): boolean {
        for (const location of entry.locations) {
            if (this.isLocationVisible(entry, location)) {
                return true;
            }
        }
        return false;
    }

    private markPathMapDirty(): void {
        this.pathToEntryMapDirty = true;
    }

    /**
     * Refreshes the decorations for a file and the finding tree. This is to change file decorations related to
     * a particular URI.
     * @param uri the URI of the file to refresh
     */
    refresh(uri: vscode.Uri): void {
        this.markPathMapDirty();
        this._onDidChangeFileDecorationsEmitter.fire(uri);
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * Refreshes the decorations for an entry.
     * @param entry the entry to refresh
     */
    refreshEntry(entry: FullEntry): void {
        for (const location of entry.locations) {
            const uri = vscode.Uri.file(path.join(location.rootPath, location.path));
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
        this.markPathMapDirty();
        this._onDidChangeTreeDataEmitter.fire();
    }

    /**
     * Refreshes and decorates and entry, including its additional locations
     * @param entry the entry to refresh and decorate
     */
    refreshAndDecorateEntry(entry: FullEntry): void {
        for (const loc of entry.locations) {
            const uri = vscode.Uri.file(path.join(loc.rootPath, loc.path));
            this.decorateWithUri(uri);
            this.refresh(uri);
        }
    }

    refreshAndDecorateFromPath(location: FullLocation): void {
        const uri = vscode.Uri.file(path.join(location.rootPath, location.path));
        this.decorateWithUri(uri);
        this.refresh(uri);
    }
}

let treeView: vscode.TreeView<TreeEntry>;
let treeDataProvider: CodeMarker;

class DragAndDropController implements vscode.TreeDragAndDropController<TreeEntry> {
    /* eslint-disable @typescript-eslint/naming-convention */
    private MIME_TYPE = "application/vnd.code.tree.codemarker";
    private LOCATION_MIME_TYPE = "application/vnd.code.tree.codemarker.locationentry";
    private ENTRY_MIME_TYPE = "application/vnd.code.tree.codemarker.entry";
    /* eslint-enable @typescript-eslint/naming-convention */

    dragMimeTypes = [this.LOCATION_MIME_TYPE, this.ENTRY_MIME_TYPE];
    dropMimeTypes = [this.MIME_TYPE, this.LOCATION_MIME_TYPE, this.ENTRY_MIME_TYPE];

    handleDrag(source: readonly TreeEntry[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
        // drag and drop in the TreeViewMode.GroupByFile does not make sense unless we wanted to reorder the file list
        if (treeDataProvider.getTreeViewMode() === TreeViewMode.GroupByFile) {
            return;
        }

        if (source.length === 0 || source.length > 1) {
            return;
        }

        const entry = source[0];
        if (isPathOrganizerEntry(entry)) {
            return;
        }
        if (isLocationEntry(entry)) {
            dataTransfer.set(this.LOCATION_MIME_TYPE, new vscode.DataTransferItem(entry));
        } else if (isEntry(entry)) {
            dataTransfer.set(this.ENTRY_MIME_TYPE, new vscode.DataTransferItem(entry));
        }
    }

    async handleDrop(target: TreeEntry | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        // drag and drop in the TreeViewMode.GroupByFile does not make sense unless we wanted to reorder the file list
        if (treeDataProvider.getTreeViewMode() === TreeViewMode.GroupByFile) {
            return;
        }

        let data = dataTransfer.get(this.LOCATION_MIME_TYPE);
        if (data === undefined) {
            return;
        }

        if (isLocationEntry(data.value as TreeEntry)) {
            // A LocationEntry is being dragged
            const locationEntry = data.value as FullLocationEntry;

            if (target === undefined) {
                // dragged a location entry into the empty space
                // create a new finding from it

                // remove from previous parent
                locationEntry.parentEntry.locations = locationEntry.parentEntry.locations.filter((loc) => loc !== locationEntry.location);

                // create a new finding with it
                treeDataProvider.addNewEntryFromLocationEntry(locationEntry);

                if (locationEntry.parentEntry.locations.length === 1) {
                    const singleLabel = locationEntry.parentEntry.locations[0].label;
                    if (singleLabel !== "" && !locationEntry.parentEntry.label.includes(singleLabel)) {
                        // if we now only have 1 location, we add the label from the location into the finding
                        locationEntry.parentEntry.label += ` ${singleLabel}`;
                    }
                }

                return;
            }

            if (isPathOrganizerEntry(target)) {
                return;
            }

            const authorSet: Set<string> = new Set();
            authorSet.add(locationEntry.parentEntry.author);

            // Target is an Entry (a finding with only one location, or the root element of a multi-location finding)
            if (isEntry(target)) {
                if (target === locationEntry.parentEntry) {
                    return;
                }

                // Prevent mixing findings that belong to different workspace roots, because it is a headache to synchronize this.
                if (target.locations[0].rootPath !== locationEntry.location.rootPath) {
                    vscode.window.showErrorMessage(
                        "weAudit: Error moving a location to a different finding, as this finding is in a different workspace root.",
                    );
                    return;
                }

                // add the other author
                authorSet.add(target.author);

                // remove from previous parent
                locationEntry.parentEntry.locations = locationEntry.parentEntry.locations.filter((loc) => loc !== locationEntry.location);

                if (locationEntry.parentEntry.locations.length === 1) {
                    const singleLabel = locationEntry.parentEntry.locations[0].label;
                    if (singleLabel !== "" && !locationEntry.parentEntry.label.includes(singleLabel)) {
                        // if we now only have 1 location, we add the label from the location into the finding
                        locationEntry.parentEntry.label += ` ${singleLabel}`;
                    }
                }

                if (target.locations.length === 1 && target.locations[0].label === "") {
                    target.locations[0].label = target.label;
                }

                // push at the end of the locations of the target
                target.locations.push(locationEntry.location);
                locationEntry.parentEntry = target;
            } else if (isLocationEntry(target)) {
                // Target is a LocationEntry (a location of a multi-location finding)

                // do nothing if the target is the same as the source
                if (target === locationEntry) {
                    return;
                }

                // Prevent mixing findings that belong to different workspace roots, because it is a headache to synchronize this.
                if (target.location.rootPath !== locationEntry.location.rootPath) {
                    vscode.window.showErrorMessage(
                        "weAudit: Error moving a location to a different finding, as this finding is in a different workspace root.",
                    );
                    return;
                }

                // add the other author
                authorSet.add(target.parentEntry.author);

                // find the source before we remove it
                const sourceIndex = locationEntry.parentEntry.locations.indexOf(locationEntry.location);

                // remove from previous parent
                locationEntry.parentEntry.locations = locationEntry.parentEntry.locations.filter((loc) => loc !== locationEntry.location);

                // find target index
                const targetIndex = target.parentEntry.locations.indexOf(target.location);

                // if the entry is the same as the source, and the source is after the target,
                // insert it before the target. Basically, it prepends to the target location if you dragged from below, and
                // appends if you dragged from above.
                if (locationEntry.parentEntry === target.parentEntry && sourceIndex >= targetIndex + 1) {
                    target.parentEntry.locations.splice(targetIndex, 0, locationEntry.location);
                } else {
                    // otherwise, insert it after the target
                    target.parentEntry.locations.splice(targetIndex + 1, 0, locationEntry.location);
                }

                if (locationEntry.parentEntry.locations.length === 1) {
                    const singleLabel = locationEntry.parentEntry.locations[0].label;
                    if (singleLabel !== "" && !locationEntry.parentEntry.label.includes(singleLabel)) {
                        // if we now only have 1 location, we add the label from the location into the finding
                        locationEntry.parentEntry.label += ` ${singleLabel}`;
                    }
                }
            }
            treeDataProvider.refreshTree();
            treeDataProvider.decorate();

            for (const author of authorSet) {
                treeDataProvider.updateSavedData(author);
            }

            // if the target was an Entry (only one location), we need to expand the dropdown after adding an extra location
            if (isEntry(target) && treeView.visible) {
                treeView.reveal(target, { expand: 1, select: false });
            }

            return;
        }

        // if the data is not a location, check if it is an entry
        data = dataTransfer.get(this.ENTRY_MIME_TYPE);
        const value = data?.value as TreeEntry;
        if (data !== undefined && isEntry(value)) {
            // An Entry is being dragged
            const entry = value;

            // an undefined target means we dragged an Entry to the empty space
            // that would move it to the bottom.
            // We currently don't support reordering the entries
            if (target === undefined) {
                return;
            }

            if (isPathOrganizerEntry(target)) {
                return;
            }

            // if we drop it on a location,
            // get its parent entry and continue to the next if statement
            if (isLocationEntry(target)) {
                target = target.parentEntry;
            }

            // Prevent mixing findings that belong to different workspace roots, because it is a headache to synchronize this.
            if (target.locations[0].rootPath !== entry.locations[0].rootPath) {
                vscode.window.showErrorMessage("weAudit: Error merging findings, as this finding is in a different workspace root.");
                return;
            }

            if (isEntry(target)) {
                // don't do anything if the target is the same as the source
                if (target === entry) {
                    return;
                }

                // decide what to do if the source entry has details
                // - join the details to the new one
                // - discard the details but drag
                // - discard the drag and drop action
                if (entry.details.description !== "" || entry.details.exploit !== "") {
                    const choice = await vscode.window
                        .showWarningMessage(
                            "The item being dragged contains detailed information. Do you want to...",
                            "Join details",
                            "Discard old details",
                            "Cancel",
                        )
                        .then((choice) => {
                            return choice;
                        });

                    // if the user discarded the dialog cancel handling the drag
                    if (choice === undefined) {
                        return;
                    }

                    switch (choice) {
                        case "Join details":
                            if (target.details.description !== "") {
                                target.details.description += "\n";
                            }
                            target.details.description += entry.details.description;

                            if (target.details.exploit !== "") {
                                target.details.exploit += "\n";
                            }
                            target.details.exploit += entry.details.exploit;
                            break;

                        case "Discard old details":
                            break;

                        case "Cancel":
                            return;
                    }
                }

                if (target.locations.length === 1 && target.locations[0].label === "") {
                    target.locations[0].label = target.label;
                }

                // add the authors
                const authorSet: Set<string> = new Set();
                authorSet.add(entry.author);
                authorSet.add(target.author);

                // if the entry has a single location,
                // add its title as the location label
                if (entry.locations.length === 1) {
                    entry.locations[0].label = entry.label;
                    target.locations.push(entry.locations[0]);
                } else {
                    for (const loc of entry.locations) {
                        target.locations.push(loc);
                    }
                }

                treeDataProvider.deleteFinding(entry);
                treeDataProvider.refreshTree();
                treeDataProvider.decorate();

                if (treeView.visible) {
                    treeView.reveal(target, { expand: 1, select: false });
                }

                for (const author of authorSet) {
                    treeDataProvider.updateSavedData(author);
                }
            }
            return;
        }
    }
}

export class AuditMarker {
    private previousVisibleTextEditors: string[] = [];
    private decorationManager: DecorationManager;

    constructor(context: vscode.ExtensionContext) {
        this.decorationManager = new DecorationManager(context);

        treeDataProvider = new CodeMarker(context, this.decorationManager);
        treeView = vscode.window.createTreeView("codeMarker", { treeDataProvider, dragAndDropController: new DragAndDropController() });
        context.subscriptions.push(treeView);

        vscode.window.onDidChangeTextEditorSelection((e) => this.checkSelectionEventAndRevealEntryUnderCursor(e));

        // call revealEntryUnderCursor when the extension separator becomes visible
        treeView.onDidChangeVisibility((e: vscode.TreeViewVisibilityChangeEvent) => {
            if (!e.visible) {
                return;
            }

            void this.revealEntryUnderCursor();
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
        vscode.window.onDidChangeActiveColorTheme(() => this.decorationManager.reloadAllDecorationConfigurations());
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

        vscode.commands.registerCommand("weAudit.openGithubIssueFromDetails", () => {
            const entry = this.getCurrentlySelectedFullEntry();
            if (entry === undefined) {
                return;
            }
            void treeDataProvider.openGithubIssue(entry);
        });
    }

    private showEntryInFindingDetails(entry: TreeEntry): void {
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
     * Returns the currently selected tree entry as a FullEntry, ignoring grouping and location-only nodes.
     */
    private getCurrentlySelectedFullEntry(): FullEntry | undefined {
        if (treeView.selection.length === 0) {
            return;
        }

        let entry = treeView.selection[0];
        if (isPathOrganizerEntry(entry)) {
            return;
        }
        if (isLocationEntry(entry)) {
            entry = entry.parentEntry;
        }
        if (!isEntry(entry)) {
            return;
        }

        return entry;
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
        } else if (e.affectsConfiguration("weAudit.general.sortEntriesAlphabetically")) {
            treeDataProvider.sortEntriesAlphabetically = vscode.workspace
                .getConfiguration("weAudit")
                .get<boolean>("general.sortEntriesAlphabetically", false);
            treeDataProvider._onDidChangeTreeDataEmitter.fire();
        } else if (e.affectsConfiguration("weAudit.general.username")) {
            treeDataProvider.setUsernameConfigOrDefault();
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

        void this.revealEntryUnderCursor();
    }

    /**
     * Decorate the visible text editors.
     */
    private decorate(): void {
        treeDataProvider.decorate();
    }

    /**
     * Decorate text editors with uri.
     * @param uri the uri of the text editor
     */
    private decorateWithUri(uri: vscode.Uri): void {
        treeDataProvider.decorateWithUri(uri);
    }
}
