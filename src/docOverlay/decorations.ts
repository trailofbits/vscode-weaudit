import * as path from "path";

import type * as vscode from "vscode";

import type { DocEntry } from "./types";

const SPACE = "\u00a0";
const DOC_GHOST_COLOR_DARK = "#6699cc88";
const DOC_GHOST_COLOR_LIGHT = "#33669988";

/**
 * Creates the decoration type used for all documentation overlay ghost text.
 * Uses an empty base style; all visual output is carried by per-decoration renderOptions.
 * @returns A TextEditorDecorationType for doc overlays.
 */
export function createDocOverlayDecorationType(): vscode.TextEditorDecorationType {
    // Lazy-require so this module is loadable outside a VS Code host.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscodeModule = require("vscode") as typeof vscode;
    return vscodeModule.window.createTextEditorDecorationType({});
}

/**
 * Builds decoration options for all doc entries that match the given file.
 * Each matching entry produces one ghost-text decoration at its startLine.
 * @param entries All loaded DocEntry objects.
 * @param filePath Absolute filesystem path of the file being decorated.
 * @param workspaceRoot Absolute workspace root for resolving relative entry paths.
 * @returns Array of DecorationOptions ready to pass to editor.setDecorations().
 */
export function buildDocDecorations(entries: DocEntry[], filePath: string, workspaceRoot: string): vscode.DecorationOptions[] {
    const decorations: vscode.DecorationOptions[] = [];

    for (const entry of entries) {
        const entryAbsPath = resolveEntryPath(entry.path, workspaceRoot);
        if (entryAbsPath !== filePath) {
            continue;
        }
        decorations.push(buildDecoration(entry));
    }

    return decorations;
}

function buildDecoration(entry: DocEntry): vscode.DecorationOptions {
    const label = entry.functionName ? `${entry.functionName}: ${entry.summary}` : entry.summary;
    const contentText = ("      " + label).replace(/ /g, SPACE);

    // Construct a range-shaped object structurally compatible with vscode.Range.
    // At runtime inside VS Code this satisfies setDecorations; in unit tests it
    // lets us inspect line values without needing the real vscode module.
    const range = {
        start: { line: entry.startLine, character: 0 },
        end: { line: entry.startLine, character: Number.MAX_SAFE_INTEGER },
    } as unknown as vscode.Range;

    return {
        range,
        renderOptions: {
            dark: { after: { contentText, color: DOC_GHOST_COLOR_DARK } },
            light: { after: { contentText, color: DOC_GHOST_COLOR_LIGHT } },
        },
    };
}

function resolveEntryPath(entryRelPath: string, workspaceRoot: string): string {
    if (path.isAbsolute(entryRelPath)) {
        return entryRelPath;
    }
    return path.resolve(workspaceRoot, entryRelPath);
}
