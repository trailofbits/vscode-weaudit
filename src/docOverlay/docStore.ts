import * as fs from "fs";
import * as path from "path";

import type * as vscode from "vscode";

import { type DocEntry, type DocSessionData, isValidDocEntry } from "./types";

const DOCS_DIR = "weaudit-docs";

/**
 * Persists and retrieves documentation sessions from <workspaceRoot>/weaudit-docs/.
 * Each session is a subdirectory containing metadata.json and entries.json.
 */
export class DocStore {
    private readonly docsDir: string;

    /** @param workspaceRoot Absolute path to the workspace root. */
    constructor(private readonly workspaceRoot: string) {
        this.docsDir = path.join(workspaceRoot, DOCS_DIR);
    }

    /**
     * Reads all valid sessions from the weaudit-docs/ directory.
     * Silently skips sessions with missing or malformed JSON files.
     * @returns Array of loaded DocSessionData objects.
     */
    loadAllSessions(): DocSessionData[] {
        if (!fs.existsSync(this.docsDir)) {
            return [];
        }

        const sessions: DocSessionData[] = [];

        for (const sessionDir of safeReadDir(this.docsDir)) {
            const sessionPath = path.join(this.docsDir, sessionDir);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(sessionPath);
            } catch {
                continue;
            }
            if (!stat.isDirectory()) {
                continue;
            }

            const metaPath = path.join(sessionPath, "metadata.json");
            const entriesPath = path.join(sessionPath, "entries.json");

            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
                const entriesRaw = JSON.parse(fs.readFileSync(entriesPath, "utf-8")) as unknown[];

                const entries = entriesRaw.filter((e): e is DocEntry => {
                    const valid = isValidDocEntry(e);
                    if (!valid) {
                        console.warn(`weAudit docOverlay: skipping invalid entry in ${entriesPath}`);
                    }
                    return valid;
                });

                sessions.push({
                    version: 1,
                    skill: stringField(meta["skill"]),
                    targetDirectory: stringField(meta["targetDirectory"]),
                    generatedAt: stringField(meta["generatedAt"]),
                    workspaceRoot: stringField(meta["workspaceRoot"]) || this.workspaceRoot,
                    entries,
                });
            } catch {
                console.warn(`weAudit docOverlay: skipping corrupted session at ${sessionPath}`);
            }
        }

        return sessions;
    }

    /**
     * Writes a documentation session to disk under a directory named after the target.
     * If a session for the same target directory already exists it is overwritten,
     * so there is always at most one session per target directory.
     * @param data The session data to persist.
     * @returns The absolute path to the session directory.
     */
    persistSession(data: DocSessionData): string {
        const slug = data.targetDirectory.replace(/[^a-zA-Z0-9_-]/g, "_");
        const sessionDir = path.join(this.docsDir, slug);
        fs.mkdirSync(sessionDir, { recursive: true });

        const { entries, ...meta } = data;
        fs.writeFileSync(path.join(sessionDir, "metadata.json"), JSON.stringify(meta, null, 2), "utf-8");
        fs.writeFileSync(path.join(sessionDir, "entries.json"), JSON.stringify(entries, null, 2), "utf-8");

        return sessionDir;
    }

    /**
     * Deletes the entire weaudit-docs/ directory and all its sessions.
     */
    clearAllSessions(): void {
        if (fs.existsSync(this.docsDir)) {
            fs.rmSync(this.docsDir, { recursive: true, force: true });
        }
    }

    /**
     * Watches weaudit-docs/** for external file system changes.
     * @param cb Callback invoked on any create, change, or delete event.
     * @returns A disposable that stops the watcher when disposed.
     */
    watchForChanges(cb: () => void): vscode.Disposable {
        // Lazy-require vscode so this module remains loadable outside a VS Code host (unit tests).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeModule = require("vscode") as typeof vscode;
        const pattern = new vscodeModule.RelativePattern(this.workspaceRoot, `${DOCS_DIR}/**`);
        const watcher = vscodeModule.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate(cb);
        watcher.onDidChange(cb);
        watcher.onDidDelete(cb);
        return watcher;
    }
}

/** Safely extracts a string field from an unknown metadata record value. */
function stringField(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function safeReadDir(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}
