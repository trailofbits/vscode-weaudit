import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { userInfo } from "os";
import { SERIALIZED_FILE_EXTENSION } from "../codeMarker";

const DEFAULT_BRANCH_NAME = "weaudit-sync";
const DEFAULT_CENTRAL_BRANCH = "weaudit-sync";
const DEFAULT_REMOTE_NAME = "origin";
const DEFAULT_SYNC_MODE = "repo-branch";
const DEFAULT_POLL_MINUTES = 1;
const DEFAULT_DEBOUNCE_MS = 1000;
const SUPPRESS_EVENTS_MS = 2000;
const SYNC_COMMIT_MESSAGE = "chore(weaudit): sync findings";
const LAST_SUCCESS_KEY = "weAudit.sync.lastSuccessAt";
const CENTRAL_REMOTE_NAME = "origin";
const PREFERRED_ORG = "trailofbits";

type SyncMode = "repo-branch" | "central-repo";

type SyncSettings = {
    enabled: boolean;
    mode: SyncMode;
    branchName: string;
    remoteName: string;
    pollMinutes: number;
    debounceMs: number;
    centralRepoUrl: string;
    centralBranch: string;
    repoKeyOverride: string;
};

type WorkspaceRootMapping = {
    workspaceRoot: string;
    repoRelativeRoot: string;
};

interface SyncSession extends vscode.Disposable {
    syncNow(): Promise<void>;
}

/**
 * Run a git command and return stdout as a trimmed string.
 * Throws if git exits with a non-zero status.
 */
async function runGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            args,
            {
                cwd,
                env: {
                    ...process.env,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    GIT_TERMINAL_PROMPT: "0",
                },
            },
            (error, stdout, stderr) => {
                if (error) {
                    const message = stderr?.toString().trim() || error.message;
                    reject(new Error(message));
                    return;
                }
                resolve(stdout.toString().trim());
            },
        );
    });
}

/**
 * Create a stable short hash for a string value.
 */
function hashValue(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Create a stable hash string for a repository root path.
 */
function hashRepoRoot(repoRoot: string): string {
    return hashValue(repoRoot);
}

/**
 * Compare two files and return true if they have identical contents.
 */
async function filesAreIdentical(sourcePath: string, targetPath: string): Promise<boolean> {
    try {
        const [source, target] = await Promise.all([fs.promises.readFile(sourcePath), fs.promises.readFile(targetPath)]);
        return source.equals(target);
    } catch (_error) {
        return false;
    }
}

/**
 * Ensure a directory exists on disk.
 */
async function ensureDirectory(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Read a workspace-scoped setting and ignore user-level values.
 */
function readWorkspaceSetting<T>(config: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
    const inspected = config.inspect<T>(key);
    if (!inspected) {
        return fallback;
    }
    if (inspected.workspaceValue !== undefined) {
        return inspected.workspaceValue as T;
    }
    if (inspected.workspaceFolderValue !== undefined) {
        return inspected.workspaceFolderValue as T;
    }
    return fallback;
}

/**
 * Read a setting preferring workspace values and falling back to globals.
 */
function readWorkspaceOrGlobalSetting<T>(config: vscode.WorkspaceConfiguration, key: string, fallback: T): T {
    const inspected = config.inspect<T>(key);
    if (!inspected) {
        return fallback;
    }
    if (inspected.workspaceValue !== undefined) {
        return inspected.workspaceValue as T;
    }
    if (inspected.workspaceFolderValue !== undefined) {
        return inspected.workspaceFolderValue as T;
    }
    if (inspected.globalValue !== undefined) {
        return inspected.globalValue as T;
    }
    return fallback;
}

/**
 * Normalize a git remote URL to a stable https form without credentials.
 */
function normalizeRemoteUrl(remoteUrl: string): string {
    let value = remoteUrl.trim();
    if (value.length === 0) {
        return "";
    }

    const scpLikeMatch = value.match(/^[^@]+@([^:]+):(.+)$/);
    if (scpLikeMatch) {
        value = `https://${scpLikeMatch[1]}/${scpLikeMatch[2]}`;
    }

    if (value.startsWith("ssh://")) {
        try {
            const parsed = new URL(value);
            value = `https://${parsed.host}${parsed.pathname}`;
        } catch (_error) {
            return value;
        }
    }

    if (value.startsWith("git://")) {
        value = `https://${value.slice("git://".length)}`;
    }

    if (value.startsWith("http://") || value.startsWith("https://")) {
        try {
            const parsed = new URL(value);
            value = `https://${parsed.host}${parsed.pathname}`;
        } catch (_error) {
            return value;
        }
    }

    if (value.endsWith(".git")) {
        value = value.slice(0, -".git".length);
    }

    return value.replace(/\/+$/, "");
}

/**
 * Convert a normalized remote URL into a filesystem-safe repo key.
 */
function formatRepoKey(normalizedUrl: string): string {
    const withoutScheme = normalizedUrl.replace(/^[a-z]+:\/\//i, "");
    const sanitized = withoutScheme.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
    return sanitized.length > 0 ? sanitized : hashValue(normalizedUrl);
}

/**
 * Check if a normalized remote URL belongs to the preferred GitHub organization.
 */
function isPreferredOrgRemote(normalizedUrl: string, orgName: string): boolean {
    try {
        const parsed = new URL(normalizedUrl);
        return parsed.hostname.toLowerCase() === "github.com" && parsed.pathname.toLowerCase().startsWith(`/${orgName}/`);
    } catch (_error) {
        return normalizedUrl.toLowerCase().includes(`github.com/${orgName.toLowerCase()}/`);
    }
}

/**
 * Select the preferred remote URL, prioritizing a specific GitHub organization.
 */
function selectPreferredRemoteUrl(normalizedRemotes: string[], orgName: string): string | undefined {
    for (const remote of normalizedRemotes) {
        if (isPreferredOrgRemote(remote, orgName)) {
            return remote;
        }
    }
    return normalizedRemotes[0];
}

/**
 * List remote URLs configured for a repository.
 */
async function listRemoteUrls(repoRoot: string): Promise<string[]> {
    try {
        const output = await runGit(["config", "--get-regexp", "^remote\\..*\\.url$"], repoRoot);
        return output
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => line.split(/\s+/).slice(1).join(" "));
    } catch (_error) {
        return [];
    }
}

/**
 * Derive a repo key from git remotes, falling back to a hash of the repo root.
 */
async function deriveRepoKey(
    repoRoot: string,
    repoKeyOverride: string,
    outputChannel: vscode.OutputChannel,
): Promise<string> {
    if (repoKeyOverride.trim().length > 0) {
        return formatRepoKey(repoKeyOverride.trim());
    }

    const remotes = await listRemoteUrls(repoRoot);
    const normalizedRemotes = remotes.map(normalizeRemoteUrl).filter((remote) => remote.length > 0);
    const preferred = selectPreferredRemoteUrl(normalizedRemotes, PREFERRED_ORG);

    if (preferred) {
        return formatRepoKey(preferred);
    }

    outputChannel.appendLine(`weAudit: central sync repo key fallback for ${repoRoot} (no remotes found).`);
    return hashRepoRoot(repoRoot);
}

/**
 * Read weAudit sync settings from workspace configuration only.
 */
function readSyncSettings(): SyncSettings {
    const config = vscode.workspace.getConfiguration("weAudit");
    const modeValue = readWorkspaceOrGlobalSetting(config, "sync.mode", DEFAULT_SYNC_MODE);
    const mode: SyncMode = modeValue === "central-repo" ? "central-repo" : "repo-branch";
    const isCentral = mode === "central-repo";
    const centralRepoUrl = isCentral ? readWorkspaceOrGlobalSetting(config, "sync.centralRepoUrl", "") : "";
    const repoKeyOverride = isCentral ? readWorkspaceOrGlobalSetting(config, "sync.repoKeyOverride", "") : "";

    return {
        enabled: isCentral ? readWorkspaceOrGlobalSetting(config, "sync.enabled", false) : readWorkspaceSetting(config, "sync.enabled", false),
        mode,
        branchName: readWorkspaceSetting(config, "sync.branchName", DEFAULT_BRANCH_NAME),
        remoteName: readWorkspaceSetting(config, "sync.remoteName", DEFAULT_REMOTE_NAME),
        pollMinutes: isCentral
            ? readWorkspaceOrGlobalSetting(config, "sync.pollMinutes", DEFAULT_POLL_MINUTES)
            : readWorkspaceSetting(config, "sync.pollMinutes", DEFAULT_POLL_MINUTES),
        debounceMs: isCentral
            ? readWorkspaceOrGlobalSetting(config, "sync.debounceMs", DEFAULT_DEBOUNCE_MS)
            : readWorkspaceSetting(config, "sync.debounceMs", DEFAULT_DEBOUNCE_MS),
        centralRepoUrl: centralRepoUrl.trim(),
        centralBranch: isCentral ? readWorkspaceOrGlobalSetting(config, "sync.centralBranch", DEFAULT_CENTRAL_BRANCH) : DEFAULT_CENTRAL_BRANCH,
        repoKeyOverride: repoKeyOverride.trim(),
    };
}

/**
 * Resolve the current weAudit username for this workspace.
 */
function getCurrentUsername(): string {
    const configUsername = vscode.workspace.getConfiguration("weAudit").get<string>("general.username");
    return configUsername && configUsername.length > 0 ? configUsername : userInfo().username;
}

/**
 * Manages git-based auto-sync sessions across workspace roots.
 */
export class GitAutoSyncManager implements vscode.Disposable {
    private sessions = new Map<string, SyncSession>();
    private readonly outputChannel: vscode.OutputChannel;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel("weAudit Sync");
        this.disposables.push(this.outputChannel);

        this.disposables.push(
            vscode.commands.registerCommand("weAudit.syncNow", () => {
                void this.syncNow();
            }),
        );

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                void this.refreshSessions();
            }),
        );

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("weAudit.sync")) {
                    void this.refreshSessions();
                }
            }),
        );

        void this.refreshSessions();
    }

    /**
     * Trigger a manual sync across all active sessions.
     */
    async syncNow(): Promise<void> {
        const settings = readSyncSettings();
        if (!settings.enabled) {
            vscode.window.showInformationMessage("weAudit: Auto sync is disabled. Enable it in settings to use Sync Now.");
            return;
        }
        if (settings.mode === "central-repo" && !settings.centralRepoUrl) {
            vscode.window.showInformationMessage("weAudit: Central sync is enabled but no central repo URL is configured.");
            return;
        }

        const sessions = Array.from(this.sessions.values());
        if (sessions.length === 0) {
            vscode.window.showInformationMessage("weAudit: No git repositories found to sync.");
            return;
        }

        await Promise.all(sessions.map((session) => session.syncNow()));
    }

    /**
     * Dispose all sessions and event subscriptions.
     */
    dispose(): void {
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    /**
     * Refresh sessions based on the current workspace roots and settings.
     */
    private async refreshSessions(): Promise<void> {
        const settings = readSyncSettings();
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();

        if (!settings.enabled || vscode.workspace.workspaceFolders === undefined) {
            return;
        }

        const workspaceRoots = vscode.workspace.workspaceFolders.map((folder) => folder.uri.fsPath);
        const repoMap = await this.collectRepoMap(workspaceRoots);
        const baseWorktreeDir = path.join(this.context.globalStorageUri.fsPath, "git-sync");
        await ensureDirectory(baseWorktreeDir);

        if (settings.mode === "central-repo") {
            if (!settings.centralRepoUrl) {
                this.outputChannel.appendLine("weAudit: central sync is enabled but no central repo URL is configured.");
                return;
            }
            if (repoMap.size === 0) {
                this.outputChannel.appendLine("weAudit: central sync enabled but no git repositories were found.");
                return;
            }
            if (settings.repoKeyOverride && repoMap.size > 1) {
                this.outputChannel.appendLine("weAudit: repoKeyOverride applies to all repos; multiple repos may collide.");
            }

            const workspaceMappings = await this.buildCentralMappings(repoMap, settings.repoKeyOverride);
            if (workspaceMappings.length === 0) {
                this.outputChannel.appendLine("weAudit: central sync enabled but no workspace roots are eligible.");
                return;
            }

            const session = new CentralGitSyncSession({
                workspaceMappings,
                worktreeBaseDir: baseWorktreeDir,
                settings,
                outputChannel: this.outputChannel,
                onSyncSuccess: (): void => {
                    void this.recordSyncSuccess();
                },
            });
            try {
                await session.initialize();
                this.sessions.set("central", session);
            } catch (error) {
                this.outputChannel.appendLine(
                    `weAudit: central sync session disabled: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            return;
        }

        for (const [repoRoot, repoWorkspaceRoots] of repoMap.entries()) {
            const session = new GitSyncSession({
                repoRoot,
                workspaceRoots: repoWorkspaceRoots,
                worktreeBaseDir: baseWorktreeDir,
                settings,
                outputChannel: this.outputChannel,
                onSyncSuccess: (): void => {
                    void this.recordSyncSuccess();
                },
            });
            try {
                await session.initialize();
                this.sessions.set(repoRoot, session);
            } catch (error) {
                this.outputChannel.appendLine(
                    `weAudit: sync session disabled for ${repoRoot}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }

    /**
     * Build mappings for central repo sync based on repository roots.
     */
    private async buildCentralMappings(
        repoMap: Map<string, string[]>,
        repoKeyOverride: string,
    ): Promise<CentralWorkspaceMapping[]> {
        const mappings: CentralWorkspaceMapping[] = [];
        for (const [repoRoot, workspaceRoots] of repoMap.entries()) {
            const repoKey = await deriveRepoKey(repoRoot, repoKeyOverride, this.outputChannel);
            for (const workspaceRoot of workspaceRoots) {
                const repoRelativeRoot = path.relative(repoRoot, workspaceRoot);
                if (repoRelativeRoot.startsWith("..") || path.isAbsolute(repoRelativeRoot)) {
                    continue;
                }
                mappings.push({
                    workspaceRoot,
                    repoRoot,
                    repoRelativeRoot,
                    repoKey,
                });
            }
        }
        return mappings;
    }

    /**
     * Build a map of git repository roots to workspace roots that live inside them.
     */
    private async collectRepoMap(workspaceRoots: string[]): Promise<Map<string, string[]>> {
        const repoMap = new Map<string, string[]>();
        const resolutions = await Promise.all(
            workspaceRoots.map(async (rootPath) => {
                const repoRoot = await this.resolveRepoRoot(rootPath);
                return { rootPath, repoRoot };
            }),
        );

        for (const resolution of resolutions) {
            if (!resolution.repoRoot) {
                continue;
            }
            const existing = repoMap.get(resolution.repoRoot) ?? [];
            existing.push(resolution.rootPath);
            repoMap.set(resolution.repoRoot, existing);
        }

        return repoMap;
    }

    /**
     * Resolve the git repository root for a workspace path.
     */
    private async resolveRepoRoot(rootPath: string): Promise<string | undefined> {
        try {
            const repoRoot = await runGit(["rev-parse", "--show-toplevel"], rootPath);
            return repoRoot.trim();
        } catch (error) {
            this.outputChannel.appendLine(`weAudit: sync disabled for ${rootPath}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
    }

    /**
     * Store the timestamp for the last successful sync and refresh the sync panel.
     */
    private async recordSyncSuccess(): Promise<void> {
        await this.context.workspaceState.update(LAST_SUCCESS_KEY, new Date().toISOString());
        void vscode.commands.executeCommand("weAudit.refreshSyncConfigStatus");
    }
}

type GitSyncSessionOptions = {
    repoRoot: string;
    workspaceRoots: string[];
    worktreeBaseDir: string;
    settings: SyncSettings;
    outputChannel: vscode.OutputChannel;
    onSyncSuccess: () => void;
};

type CentralWorkspaceMapping = {
    workspaceRoot: string;
    repoRoot: string;
    repoRelativeRoot: string;
    repoKey: string;
};

type CentralGitSyncSessionOptions = {
    workspaceMappings: CentralWorkspaceMapping[];
    worktreeBaseDir: string;
    settings: SyncSettings;
    outputChannel: vscode.OutputChannel;
    onSyncSuccess: () => void;
};

/**
 * Handles git-based sync for a single repository root.
 */
class GitSyncSession implements SyncSession {
    private readonly repoRoot: string;
    private readonly workspaceMappings: WorkspaceRootMapping[];
    private readonly worktreePath: string;
    private readonly settings: SyncSettings;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly onSyncSuccess: () => void;
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private readonly dirtyFiles = new Set<string>();
    private syncQueue: Promise<void> = Promise.resolve();
    private debounceTimer: NodeJS.Timeout | undefined;
    private pollTimer: NodeJS.Timeout | undefined;
    private suppressEventsUntil = 0;

    constructor(options: GitSyncSessionOptions) {
        this.repoRoot = options.repoRoot;
        this.settings = options.settings;
        this.outputChannel = options.outputChannel;
        this.onSyncSuccess = options.onSyncSuccess;
        this.worktreePath = path.join(options.worktreeBaseDir, hashRepoRoot(this.repoRoot));
        this.workspaceMappings = this.buildWorkspaceMappings(options.workspaceRoots);
    }

    /**
     * Initialize the worktree, watchers, and polling timer.
     */
    async initialize(): Promise<void> {
        await this.ensureWorktree();
        const seededDirty = this.seedLocalUserFile();
        this.setupWatchers();
        this.startPolling();
        if (seededDirty) {
            void this.enqueue(() => this.performLocalSync());
        } else {
            void this.enqueue(() => this.performPollSync());
        }
    }

    /**
     * Dispose watchers and timers for this session.
     */
    dispose(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers.length = 0;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    /**
     * Trigger a manual sync of this repository.
     */
    syncNow(): Promise<void> {
        return this.enqueue(() => this.performLocalSync());
    }

    /**
     * Build workspace mappings to repo-relative paths.
     */
    private buildWorkspaceMappings(workspaceRoots: string[]): WorkspaceRootMapping[] {
        const mappings: WorkspaceRootMapping[] = [];
        for (const workspaceRoot of workspaceRoots) {
            const repoRelativeRoot = path.relative(this.repoRoot, workspaceRoot);
            if (repoRelativeRoot.startsWith("..") || path.isAbsolute(repoRelativeRoot)) {
                continue;
            }
            mappings.push({ workspaceRoot, repoRelativeRoot });
        }
        return mappings;
    }

    /**
     * Seed the dirty set with the current user's .weaudit file if it exists.
     */
    private seedLocalUserFile(): boolean {
        const username = getCurrentUsername();
        let seeded = false;
        for (const mapping of this.workspaceMappings) {
            const userFile = path.join(mapping.workspaceRoot, ".vscode", `${username}${SERIALIZED_FILE_EXTENSION}`);
            if (fs.existsSync(userFile)) {
                this.dirtyFiles.add(userFile);
                seeded = true;
            }
        }
        return seeded;
    }

    /**
     * Set up file watchers for each workspace root.
     */
    private setupWatchers(): void {
        for (const mapping of this.workspaceMappings) {
            const pattern = new vscode.RelativePattern(mapping.workspaceRoot, `.vscode/*${SERIALIZED_FILE_EXTENSION}`);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidCreate((uri) => this.onWorkspaceFileChange(uri.fsPath));
            watcher.onDidChange((uri) => this.onWorkspaceFileChange(uri.fsPath));
            watcher.onDidDelete((uri) => this.onWorkspaceFileChange(uri.fsPath));
            this.watchers.push(watcher);
        }
    }

    /**
     * Start the polling timer that pulls remote updates.
     */
    private startPolling(): void {
        const pollMs = Math.max(1, this.settings.pollMinutes) * 60 * 1000;
        this.pollTimer = setInterval(() => {
            void this.enqueue(() => this.performPollSync());
        }, pollMs);
    }

    /**
     * Enqueue a sync task to run sequentially.
     */
    private enqueue(task: () => Promise<void>): Promise<void> {
        this.syncQueue = this.syncQueue
            .then(task)
            .catch((error) => {
                this.outputChannel.appendLine(`weAudit: sync error in ${this.repoRoot}: ${error instanceof Error ? error.message : String(error)}`);
            });
        return this.syncQueue;
    }

    /**
     * Handle a local .weaudit file change event.
     */
    private onWorkspaceFileChange(filePath: string): void {
        if (Date.now() < this.suppressEventsUntil) {
            return;
        }
        this.dirtyFiles.add(filePath);
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            void this.enqueue(() => this.performLocalSync());
        }, this.settings.debounceMs);
    }

    /**
     * Ensure a git worktree is available for the sync branch.
     */
    private async ensureWorktree(): Promise<void> {
        if (fs.existsSync(path.join(this.worktreePath, ".git"))) {
            return;
        }

        if (fs.existsSync(this.worktreePath)) {
            throw new Error(`Worktree path is not a git worktree: ${this.worktreePath}`);
        }

        const remoteExists = await this.remoteExists();
        if (!remoteExists) {
            throw new Error(`Remote '${this.settings.remoteName}' is not configured.`);
        }

        const branchExists = await this.remoteBranchExists();
        const args = ["worktree", "add", "-B", this.settings.branchName, this.worktreePath];
        if (branchExists) {
            args.push(`${this.settings.remoteName}/${this.settings.branchName}`);
        }

        await runGit(args, this.repoRoot);
    }

    /**
     * Check whether the configured remote exists.
     */
    private async remoteExists(): Promise<boolean> {
        try {
            await runGit(["remote", "get-url", this.settings.remoteName], this.repoRoot);
            return true;
        } catch (_error) {
            return false;
        }
    }

    /**
     * Check if the sync branch exists on the remote.
     */
    private async remoteBranchExists(): Promise<boolean> {
        try {
            const output = await runGit(
                ["ls-remote", "--heads", this.settings.remoteName, this.settings.branchName],
                this.repoRoot,
            );
            return output.trim().length > 0;
        } catch (_error) {
            return false;
        }
    }

    /**
     * Perform a local sync: pull remote, apply remote changes, then commit/push local changes.
     */
    private async performLocalSync(): Promise<void> {
        const dirtySnapshot = new Set(this.dirtyFiles);
        this.dirtyFiles.clear();
        let shouldRecordSuccess = false;

        try {
            await this.ensureWorktree();
            const hasRemote = await this.pullRemote();
            if (hasRemote) {
                const appliedChanges = await this.applyRemoteToWorkspace(dirtySnapshot);
                if (appliedChanges) {
                    await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
                    await vscode.commands.executeCommand("weAudit.reloadSavedFindingsFromDisk");
                }
                shouldRecordSuccess = true;
            }

            if (dirtySnapshot.size === 0) {
                if (shouldRecordSuccess) {
                    this.onSyncSuccess();
                }
                return;
            }

            await this.applyWorkspaceToWorktree(dirtySnapshot);
            const committed = await this.commitChanges(dirtySnapshot);
            if (committed) {
                await this.pushRemote();
                shouldRecordSuccess = true;
            }
            if (shouldRecordSuccess) {
                this.onSyncSuccess();
            }
        } catch (error) {
            this.mergeDirty(dirtySnapshot);
            throw error;
        }
    }

    /**
     * Perform a polling sync: pull remote and apply changes locally.
     */
    private async performPollSync(): Promise<void> {
        await this.ensureWorktree();
        const hasRemote = await this.pullRemote();
        if (!hasRemote) {
            return;
        }
        const appliedChanges = await this.applyRemoteToWorkspace(new Set<string>());
        if (appliedChanges) {
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
            await vscode.commands.executeCommand("weAudit.reloadSavedFindingsFromDisk");
        }
        this.onSyncSuccess();
    }

    /**
     * Pull the latest sync branch from the remote, if available.
     */
    private async pullRemote(): Promise<boolean> {
        const branchExists = await this.remoteBranchExists();
        if (!branchExists) {
            return false;
        }
        await runGit(["pull", "--rebase", this.settings.remoteName, this.settings.branchName], this.worktreePath);
        return true;
    }

    /**
     * Push local commits to the remote sync branch.
     */
    private async pushRemote(): Promise<void> {
        await runGit(["push", "-u", this.settings.remoteName, this.settings.branchName], this.worktreePath);
    }

    /**
     * Apply remote .weaudit files to the workspace, skipping dirty files.
     */
    private async applyRemoteToWorkspace(dirtySnapshot: Set<string>): Promise<boolean> {
        let didApply = false;
        this.suppressEventsUntil = Number.MAX_SAFE_INTEGER;

        try {
            for (const mapping of this.workspaceMappings) {
                const workspaceVscodeDir = path.join(mapping.workspaceRoot, ".vscode");
                const worktreeVscodeDir = path.join(this.worktreePath, mapping.repoRelativeRoot, ".vscode");

                const [worktreeFiles, workspaceFiles] = await Promise.all([
                    this.listWeauditFiles(worktreeVscodeDir),
                    this.listWeauditFiles(workspaceVscodeDir),
                ]);

                const worktreeFileNames = new Set(worktreeFiles.map((file) => path.basename(file)));

                for (const worktreeFile of worktreeFiles) {
                    const fileName = path.basename(worktreeFile);
                    const workspaceFile = path.join(workspaceVscodeDir, fileName);
                    if (dirtySnapshot.has(workspaceFile)) {
                        continue;
                    }
                    if (!(await filesAreIdentical(worktreeFile, workspaceFile))) {
                        await ensureDirectory(workspaceVscodeDir);
                        await fs.promises.copyFile(worktreeFile, workspaceFile);
                        didApply = true;
                    }
                }

                for (const workspaceFile of workspaceFiles) {
                    const fileName = path.basename(workspaceFile);
                    if (worktreeFileNames.has(fileName)) {
                        continue;
                    }
                    if (dirtySnapshot.has(workspaceFile)) {
                        continue;
                    }
                    await fs.promises.unlink(workspaceFile);
                    didApply = true;
                }
            }
        } finally {
            this.suppressEventsUntil = Date.now() + SUPPRESS_EVENTS_MS;
        }

        return didApply;
    }

    /**
     * Apply local workspace changes into the worktree, including deletions.
     */
    private async applyWorkspaceToWorktree(dirtySnapshot: Set<string>): Promise<void> {
        for (const workspaceFile of dirtySnapshot) {
            const repoRelativePath = path.relative(this.repoRoot, workspaceFile);
            if (repoRelativePath.startsWith("..") || path.isAbsolute(repoRelativePath)) {
                continue;
            }
            const worktreeFile = path.join(this.worktreePath, repoRelativePath);
            const worktreeDir = path.dirname(worktreeFile);
            if (fs.existsSync(workspaceFile)) {
                await ensureDirectory(worktreeDir);
                await fs.promises.copyFile(workspaceFile, worktreeFile);
            } else if (fs.existsSync(worktreeFile)) {
                await fs.promises.unlink(worktreeFile);
            }
        }
    }

    /**
     * Stage and commit local changes in the worktree.
     */
    private async commitChanges(dirtySnapshot: Set<string>): Promise<boolean> {
        const relativePaths = Array.from(dirtySnapshot)
            .map((workspaceFile) => path.relative(this.repoRoot, workspaceFile))
            .filter((repoRelativePath) => !repoRelativePath.startsWith("..") && !path.isAbsolute(repoRelativePath));

        if (relativePaths.length === 0) {
            return false;
        }

        await runGit(["add", "-f", "--", ...relativePaths], this.worktreePath);
        const status = await runGit(["status", "--porcelain"], this.worktreePath);
        if (status.trim().length === 0) {
            return false;
        }
        await runGit(["commit", "-m", SYNC_COMMIT_MESSAGE], this.worktreePath);
        return true;
    }

    /**
     * List .weaudit files within a .vscode directory.
     */
    private async listWeauditFiles(vscodeDir: string): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(vscodeDir, { withFileTypes: true });
            return entries
                .filter((entry) => entry.isFile() && entry.name.endsWith(SERIALIZED_FILE_EXTENSION))
                .map((entry) => path.join(vscodeDir, entry.name));
        } catch (_error) {
            return [];
        }
    }

    /**
     * Merge a dirty snapshot back into the live dirty set.
     */
    private mergeDirty(dirtySnapshot: Set<string>): void {
        for (const file of dirtySnapshot) {
            this.dirtyFiles.add(file);
        }
    }
}

/**
 * Handles centralized git sync across multiple repositories.
 */
class CentralGitSyncSession implements SyncSession {
    private readonly workspaceMappings: CentralWorkspaceMapping[];
    private readonly repoPath: string;
    private readonly settings: SyncSettings;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly onSyncSuccess: () => void;
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private readonly dirtyFiles = new Set<string>();
    private syncQueue: Promise<void> = Promise.resolve();
    private debounceTimer: NodeJS.Timeout | undefined;
    private pollTimer: NodeJS.Timeout | undefined;
    private suppressEventsUntil = 0;

    constructor(options: CentralGitSyncSessionOptions) {
        this.workspaceMappings = options.workspaceMappings;
        this.settings = options.settings;
        this.outputChannel = options.outputChannel;
        this.onSyncSuccess = options.onSyncSuccess;
        const centralRepoUrl = this.settings.centralRepoUrl.trim();
        this.repoPath = path.join(options.worktreeBaseDir, "central", hashValue(centralRepoUrl));
    }

    /**
     * Initialize the central repo, watchers, and polling timer.
     */
    async initialize(): Promise<void> {
        await this.ensureCentralRepo();
        const seededDirty = this.seedLocalUserFile();
        this.setupWatchers();
        this.startPolling();
        if (seededDirty) {
            void this.enqueue(() => this.performLocalSync());
        } else {
            void this.enqueue(() => this.performPollSync());
        }
    }

    /**
     * Dispose watchers and timers for this session.
     */
    dispose(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers.length = 0;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    /**
     * Trigger a manual sync of the central repository.
     */
    syncNow(): Promise<void> {
        return this.enqueue(() => this.performLocalSync());
    }

    /**
     * Seed the dirty set with the current user's .weaudit file if it exists.
     */
    private seedLocalUserFile(): boolean {
        const username = getCurrentUsername();
        let seeded = false;
        for (const mapping of this.workspaceMappings) {
            const userFile = path.join(mapping.workspaceRoot, ".vscode", `${username}${SERIALIZED_FILE_EXTENSION}`);
            if (fs.existsSync(userFile)) {
                this.dirtyFiles.add(userFile);
                seeded = true;
            }
        }
        return seeded;
    }

    /**
     * Set up file watchers for each workspace root.
     */
    private setupWatchers(): void {
        for (const mapping of this.workspaceMappings) {
            const pattern = new vscode.RelativePattern(mapping.workspaceRoot, `.vscode/*${SERIALIZED_FILE_EXTENSION}`);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidCreate((uri) => this.onWorkspaceFileChange(uri.fsPath));
            watcher.onDidChange((uri) => this.onWorkspaceFileChange(uri.fsPath));
            watcher.onDidDelete((uri) => this.onWorkspaceFileChange(uri.fsPath));
            this.watchers.push(watcher);
        }
    }

    /**
     * Start the polling timer that pulls remote updates.
     */
    private startPolling(): void {
        const pollMs = Math.max(1, this.settings.pollMinutes) * 60 * 1000;
        this.pollTimer = setInterval(() => {
            void this.enqueue(() => this.performPollSync());
        }, pollMs);
    }

    /**
     * Enqueue a sync task to run sequentially.
     */
    private enqueue(task: () => Promise<void>): Promise<void> {
        this.syncQueue = this.syncQueue
            .then(task)
            .catch((error) => {
                this.outputChannel.appendLine(`weAudit: central sync error: ${error instanceof Error ? error.message : String(error)}`);
            });
        return this.syncQueue;
    }

    /**
     * Handle a local .weaudit file change event.
     */
    private onWorkspaceFileChange(filePath: string): void {
        if (Date.now() < this.suppressEventsUntil) {
            return;
        }
        this.dirtyFiles.add(filePath);
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            void this.enqueue(() => this.performLocalSync());
        }, this.settings.debounceMs);
    }

    /**
     * Ensure the central repository exists with the configured remote and branch.
     */
    private async ensureCentralRepo(): Promise<void> {
        await ensureDirectory(this.repoPath);
        if (!fs.existsSync(path.join(this.repoPath, ".git"))) {
            await runGit(["init"], this.repoPath);
        }
        await this.ensureCentralRemote();
        await this.ensureCentralBranch();
    }

    /**
     * Ensure the central remote is configured for the local repo.
     */
    private async ensureCentralRemote(): Promise<void> {
        const remoteUrl = this.settings.centralRepoUrl.trim();
        try {
            const current = await runGit(["remote", "get-url", CENTRAL_REMOTE_NAME], this.repoPath);
            if (current.trim() !== remoteUrl) {
                await runGit(["remote", "set-url", CENTRAL_REMOTE_NAME, remoteUrl], this.repoPath);
            }
        } catch (_error) {
            await runGit(["remote", "add", CENTRAL_REMOTE_NAME, remoteUrl], this.repoPath);
        }
    }

    /**
     * Ensure the configured central branch exists locally.
     */
    private async ensureCentralBranch(): Promise<void> {
        let currentBranch = "";
        try {
            currentBranch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], this.repoPath);
        } catch (_error) {
            currentBranch = "";
        }

        if (currentBranch.trim() === this.settings.centralBranch) {
            return;
        }

        const branchExists = await this.remoteBranchExists();
        if (branchExists) {
            await runGit(["fetch", CENTRAL_REMOTE_NAME, this.settings.centralBranch], this.repoPath);
            await runGit(
                ["checkout", "-B", this.settings.centralBranch, `${CENTRAL_REMOTE_NAME}/${this.settings.centralBranch}`],
                this.repoPath,
            );
        } else {
            await runGit(["checkout", "-B", this.settings.centralBranch], this.repoPath);
        }
    }

    /**
     * Check if the central sync branch exists on the remote.
     */
    private async remoteBranchExists(): Promise<boolean> {
        try {
            const output = await runGit(
                ["ls-remote", "--heads", CENTRAL_REMOTE_NAME, this.settings.centralBranch],
                this.repoPath,
            );
            return output.trim().length > 0;
        } catch (_error) {
            return false;
        }
    }

    /**
     * Perform a local sync: pull remote, apply remote changes, then commit/push local changes.
     */
    private async performLocalSync(): Promise<void> {
        const dirtySnapshot = new Set(this.dirtyFiles);
        this.dirtyFiles.clear();
        let shouldRecordSuccess = false;

        try {
            await this.ensureCentralRepo();
            const hasRemote = await this.pullRemote();
            if (hasRemote) {
                const appliedChanges = await this.applyRemoteToWorkspace(dirtySnapshot);
                if (appliedChanges) {
                    await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
                    await vscode.commands.executeCommand("weAudit.reloadSavedFindingsFromDisk");
                }
                shouldRecordSuccess = true;
            }

            if (dirtySnapshot.size === 0) {
                if (shouldRecordSuccess) {
                    this.onSyncSuccess();
                }
                return;
            }

            await this.applyWorkspaceToCentral(dirtySnapshot);
            const committed = await this.commitChanges(dirtySnapshot);
            if (committed) {
                await this.pushRemote();
                shouldRecordSuccess = true;
            }
            if (shouldRecordSuccess) {
                this.onSyncSuccess();
            }
        } catch (error) {
            this.mergeDirty(dirtySnapshot);
            throw error;
        }
    }

    /**
     * Perform a polling sync: pull remote and apply changes locally.
     */
    private async performPollSync(): Promise<void> {
        await this.ensureCentralRepo();
        const hasRemote = await this.pullRemote();
        if (!hasRemote) {
            return;
        }
        const appliedChanges = await this.applyRemoteToWorkspace(new Set<string>());
        if (appliedChanges) {
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
            await vscode.commands.executeCommand("weAudit.reloadSavedFindingsFromDisk");
        }
        this.onSyncSuccess();
    }

    /**
     * Pull the latest central sync branch from the remote, if available.
     */
    private async pullRemote(): Promise<boolean> {
        const branchExists = await this.remoteBranchExists();
        if (!branchExists) {
            return false;
        }
        await runGit(["pull", "--rebase", CENTRAL_REMOTE_NAME, this.settings.centralBranch], this.repoPath);
        return true;
    }

    /**
     * Push local commits to the central remote.
     */
    private async pushRemote(): Promise<void> {
        await runGit(["push", "-u", CENTRAL_REMOTE_NAME, this.settings.centralBranch], this.repoPath);
    }

    /**
     * Apply remote .weaudit files to the workspace, skipping dirty files.
     */
    private async applyRemoteToWorkspace(dirtySnapshot: Set<string>): Promise<boolean> {
        let didApply = false;
        this.suppressEventsUntil = Number.MAX_SAFE_INTEGER;

        try {
            for (const mapping of this.workspaceMappings) {
                const workspaceVscodeDir = path.join(mapping.workspaceRoot, ".vscode");
                const centralVscodeDir = path.join(
                    this.repoPath,
                    "repos",
                    mapping.repoKey,
                    mapping.repoRelativeRoot,
                    ".vscode",
                );

                const [centralFiles, workspaceFiles] = await Promise.all([
                    this.listWeauditFiles(centralVscodeDir),
                    this.listWeauditFiles(workspaceVscodeDir),
                ]);

                const centralFileNames = new Set(centralFiles.map((file) => path.basename(file)));

                for (const centralFile of centralFiles) {
                    const fileName = path.basename(centralFile);
                    const workspaceFile = path.join(workspaceVscodeDir, fileName);
                    if (dirtySnapshot.has(workspaceFile)) {
                        continue;
                    }
                    if (!(await filesAreIdentical(centralFile, workspaceFile))) {
                        await ensureDirectory(workspaceVscodeDir);
                        await fs.promises.copyFile(centralFile, workspaceFile);
                        didApply = true;
                    }
                }

                for (const workspaceFile of workspaceFiles) {
                    const fileName = path.basename(workspaceFile);
                    if (centralFileNames.has(fileName)) {
                        continue;
                    }
                    if (dirtySnapshot.has(workspaceFile)) {
                        continue;
                    }
                    await fs.promises.unlink(workspaceFile);
                    didApply = true;
                }
            }
        } finally {
            this.suppressEventsUntil = Date.now() + SUPPRESS_EVENTS_MS;
        }

        return didApply;
    }

    /**
     * Apply local workspace changes into the central repository, including deletions.
     */
    private async applyWorkspaceToCentral(dirtySnapshot: Set<string>): Promise<void> {
        for (const workspaceFile of dirtySnapshot) {
            const centralRelativePath = this.getCentralRelativePath(workspaceFile);
            if (!centralRelativePath) {
                continue;
            }
            const centralFile = path.join(this.repoPath, centralRelativePath);
            const centralDir = path.dirname(centralFile);
            if (fs.existsSync(workspaceFile)) {
                await ensureDirectory(centralDir);
                await fs.promises.copyFile(workspaceFile, centralFile);
            } else if (fs.existsSync(centralFile)) {
                await fs.promises.unlink(centralFile);
            }
        }
    }

    /**
     * Stage and commit local changes in the central repository.
     */
    private async commitChanges(dirtySnapshot: Set<string>): Promise<boolean> {
        const relativePaths = Array.from(dirtySnapshot)
            .map((workspaceFile) => this.getCentralRelativePath(workspaceFile))
            .filter((pathValue): pathValue is string => Boolean(pathValue));

        const uniquePaths = Array.from(new Set(relativePaths));
        if (uniquePaths.length === 0) {
            return false;
        }

        await runGit(["add", "-f", "--", ...uniquePaths], this.repoPath);
        const status = await runGit(["status", "--porcelain"], this.repoPath);
        if (status.trim().length === 0) {
            return false;
        }
        await runGit(["commit", "-m", SYNC_COMMIT_MESSAGE], this.repoPath);
        return true;
    }

    /**
     * List .weaudit files within a .vscode directory.
     */
    private async listWeauditFiles(vscodeDir: string): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(vscodeDir, { withFileTypes: true });
            return entries
                .filter((entry) => entry.isFile() && entry.name.endsWith(SERIALIZED_FILE_EXTENSION))
                .map((entry) => path.join(vscodeDir, entry.name));
        } catch (_error) {
            return [];
        }
    }

    /**
     * Find the workspace mapping that contains a given file.
     */
    private getMappingForWorkspaceFile(filePath: string): CentralWorkspaceMapping | undefined {
        for (const mapping of this.workspaceMappings) {
            const relativePath = path.relative(mapping.workspaceRoot, filePath);
            if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
                return mapping;
            }
        }
        return undefined;
    }

    /**
     * Convert a workspace file path into a central repo-relative path.
     */
    private getCentralRelativePath(filePath: string): string | undefined {
        const mapping = this.getMappingForWorkspaceFile(filePath);
        if (!mapping) {
            return;
        }
        const workspaceRelativePath = path.relative(mapping.workspaceRoot, filePath);
        if (workspaceRelativePath.startsWith("..") || path.isAbsolute(workspaceRelativePath)) {
            return;
        }
        return path.join("repos", mapping.repoKey, mapping.repoRelativeRoot, workspaceRelativePath);
    }

    /**
     * Merge a dirty snapshot back into the live dirty set.
     */
    private mergeDirty(dirtySnapshot: Set<string>): void {
        for (const file of dirtySnapshot) {
            this.dirtyFiles.add(file);
        }
    }
}
