"use strict";

import * as vscode from "vscode";

import { AuditMarker } from "./codeMarker";
import { MultipleSavedFindings } from "./multiConfigs";
import { activateFindingDetailsWebview } from "./panels/findingDetailsPanel";
import { activateGitConfigWebview } from "./panels/gitConfigPanel";

export function activate(context: vscode.ExtensionContext): void {
    // if there are no open folders, return
    // the extension will be reactivated when a folder is opened
    if (vscode.workspace.workspaceFolders === undefined) {
        return;
    }

    vscode.commands.registerCommand("weAudit.openFileLines", (resource, startLine, endLine) => openResource(resource, startLine, endLine));
    vscode.commands.registerCommand("weAudit.openFile", (resource) => vscode.window.showTextDocument(resource));

    new AuditMarker(context);
    new MultipleSavedFindings(context);
    activateFindingDetailsWebview(context);
    activateGitConfigWebview(context);
}

async function openResource(resource: vscode.Uri, startLine: number, endLine: number): Promise<void> {
    const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);

    const activeEditor = vscode.window.activeTextEditor;

    // if the file is already open in the active column, just reveal it
    if (activeEditor !== undefined && activeEditor.document.uri.fsPath === resource.fsPath) {
        // reveal the range and select it
        activeEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        activeEditor.selection = new vscode.Selection(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
        return;
    }

    // if the file is already open in one of the columns, just reveal it
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.fsPath === resource.fsPath) {
            // reveal the range and select it
            editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            editor.selection = new vscode.Selection(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
            await vscode.window.showTextDocument(editor.document, editor.viewColumn);
            return;
        }
    }

    // if the file is already open in a tab, open it
    for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
            const tabInput = tab.input;
            if (tabInput instanceof vscode.TabInputText) {
                if (tabInput.uri.fsPath === resource.fsPath) {
                    await vscode.window.showTextDocument(tabInput.uri, { selection: range });
                    return;
                }
            }
        }
    }

    // open the file in the active column
    await vscode.window.showTextDocument(resource, { selection: range, preview: false, viewColumn: vscode.ViewColumn.One });
}
