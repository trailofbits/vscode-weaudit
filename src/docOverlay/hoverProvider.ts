import * as path from "path";

import type * as vscode from "vscode";

import type { DocEntry } from "./types";

/**
 * Provides hover tooltips showing full markdown documentation for annotated code regions.
 * Registered for all file-scheme documents; only activates when a doc entry covers the cursor.
 */
export class DocOverlayHoverProvider {
    /**
     * @param getEntries Lazy getter returning the current set of loaded doc entries.
     * @param workspaceRoot Absolute workspace root for resolving relative entry paths.
     */
    constructor(
        private readonly getEntries: () => DocEntry[],
        private readonly workspaceRoot: string,
    ) {}

    /**
     * Returns hover content when the cursor falls within a documented region.
     * Multiple overlapping entries are rendered as sections separated by horizontal rules.
     * @param document The document in which the hover was triggered.
     * @param position The position at which the hover was triggered.
     * @returns A Hover with full markdown, or undefined if no entry covers the position.
     */
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const filePath = document.uri.fsPath;
        const line = position.line;

        const matching = this.getEntries().filter((entry) => {
            const entryPath = resolveEntryPath(entry.path, this.workspaceRoot);
            if (entryPath !== filePath) {
                return false;
            }
            // File-level entries are pinned to the first line only.
            if (entry.type === "file") {
                return line === 0;
            }
            return line >= entry.startLine && line <= entry.endLine;
        });

        if (matching.length === 0) {
            return undefined;
        }

        // Lazy-require vscode so the class is instantiable outside a VS Code host.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscodeModule = require("vscode") as typeof vscode;

        const md = new vscodeModule.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = false;

        for (const entry of matching) {
            const header = entry.functionName ?? (entry.type === "file" ? "File" : "Region");
            md.appendMarkdown(`### ${header}\n\n`);
            md.appendMarkdown(entry.fullDoc);
            md.appendMarkdown("\n\n---\n\n");
        }

        return new vscodeModule.Hover(md);
    }
}

function resolveEntryPath(entryRelPath: string, workspaceRoot: string): string {
    if (path.isAbsolute(entryRelPath)) {
        return entryRelPath;
    }
    return path.resolve(workspaceRoot, entryRelPath);
}
