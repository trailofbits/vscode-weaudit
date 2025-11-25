import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";

interface SerializedEntry {
    label: string;
    entryType: number;
    author: string;
    locations: Array<{ path: string; startLine: number; endLine: number }>;
}

interface SerializedData {
    treeEntries: SerializedEntry[];
    auditedFiles: Array<{ path: string; author: string }>;
    partiallyAuditedFiles: Array<{ path: string; startLine: number; endLine: number }>;
    resolvedEntries: SerializedEntry[];
}

function getWeauditFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
    const username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
    return path.join(workspaceFolder.uri.fsPath, ".vscode", `${username}.weaudit`);
}

function readWeauditData(workspaceFolder: vscode.WorkspaceFolder): SerializedData | null {
    const filePath = getWeauditFilePath(workspaceFolder);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SerializedData;
}

/**
 * Poll for a condition to become true, with timeout.
 * Returns true if condition was met, false if timed out.
 */
async function waitForCondition(condition: () => boolean, timeoutMs: number = 5000, pollIntervalMs: number = 100): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (condition()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return condition(); // Final check
}

suite("Command Execution", () => {
    const extensionId = "trailofbits.weaudit";
    let testFileUri: vscode.Uri;
    let workspaceFolder: vscode.WorkspaceFolder;
    let originalWeauditContent: string | null = null;
    let weauditFilePath: string;

    suiteSetup(async () => {
        // Ensure extension is activated
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        // Get path to test file
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            workspaceFolder = workspaceFolders[0];
            testFileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "src", "sample.ts"));

            // Save original weaudit file content for restoration after tests
            weauditFilePath = getWeauditFilePath(workspaceFolder);
            if (fs.existsSync(weauditFilePath)) {
                originalWeauditContent = fs.readFileSync(weauditFilePath, "utf-8");
            }
        }
    });

    suiteTeardown(async () => {
        // Restore original weaudit file content
        if (weauditFilePath) {
            if (originalWeauditContent !== null) {
                fs.writeFileSync(weauditFilePath, originalWeauditContent);
            } else if (fs.existsSync(weauditFilePath)) {
                // If there was no original file, delete the one created by tests
                fs.unlinkSync(weauditFilePath);
            }
            // Reload the extension's data
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
        }
    });

    async function openTestFile(): Promise<vscode.TextEditor> {
        const document = await vscode.workspace.openTextDocument(testFileUri);
        return await vscode.window.showTextDocument(document);
    }

    async function selectLines(editor: vscode.TextEditor, startLine: number, endLine: number): Promise<void> {
        const start = new vscode.Position(startLine, 0);
        const end = new vscode.Position(endLine, editor.document.lineAt(endLine).text.length);
        editor.selection = new vscode.Selection(start, end);
    }

    test("weAudit.addFinding creates a new finding entry", async function () {
        this.timeout(15000);

        const editor = await openTestFile();
        await selectLines(editor, 5, 6);

        // Record entry count before
        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        // Start the command (this will show the input box)
        const commandPromise = vscode.commands.executeCommand("weAudit.addFinding");

        // Wait for input box to appear
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Accept the input box with empty label (VS Code's type command doesn't work with QuickInput)
        // Note: We can't programmatically type into VS Code's QuickInput widget in extension tests
        await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");

        // Wait for command to complete and data to be persisted
        await commandPromise;
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify that a new entry was added
        const dataAfter = readWeauditData(workspaceFolder);
        assert.ok(dataAfter, "Data file should exist after adding finding");
        assert.ok(dataAfter.treeEntries.length > entriesBefore, "A new entry should be added");

        // Verify the entry has the correct type and location
        const newEntry = dataAfter.treeEntries[dataAfter.treeEntries.length - 1];
        assert.strictEqual(newEntry.entryType, 0, "Entry type should be Finding (0)");
        assert.ok(
            newEntry.locations.some((loc) => loc.startLine === 5 && loc.endLine === 6),
            "Entry should have correct line range",
        );
    });

    test("weAudit.addFinding handles cancellation gracefully", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 15, 16);

        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        // Start the command (this will show the input box)
        const commandPromise = vscode.commands.executeCommand("weAudit.addFinding");

        // Wait for input box to appear
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Cancel by pressing Escape
        await vscode.commands.executeCommand("type", { text: "\u001b" }); // Escape character

        // If that didn't work, try closing quick open
        await new Promise((resolve) => setTimeout(resolve, 100));
        await vscode.commands.executeCommand("workbench.action.closeQuickOpen");

        // Wait for command to complete
        await commandPromise;
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify no new entry was added
        const dataAfter = readWeauditData(workspaceFolder);
        const entriesAfter = dataAfter?.treeEntries.length ?? 0;
        assert.strictEqual(entriesAfter, entriesBefore, "No entry should be added when cancelled");
    });

    test("weAudit.addNote creates a new note entry", async function () {
        this.timeout(15000);

        const editor = await openTestFile();
        await selectLines(editor, 20, 22);

        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        // Start the command (this will show the input box)
        const commandPromise = vscode.commands.executeCommand("weAudit.addNote");

        // Wait for input box to appear
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Accept the input box with empty label (VS Code's type command doesn't work with QuickInput)
        // Note: We can't programmatically type into VS Code's QuickInput widget in extension tests
        await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");

        // Wait for command to complete and data to be persisted
        await commandPromise;
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify that a new entry was added
        const dataAfter = readWeauditData(workspaceFolder);
        assert.ok(dataAfter, "Data file should exist after adding note");
        assert.ok(dataAfter.treeEntries.length > entriesBefore, "A new entry should be added");

        // Verify the entry has the correct type and location (Note = 1)
        const newEntry = dataAfter.treeEntries[dataAfter.treeEntries.length - 1];
        assert.strictEqual(newEntry.entryType, 1, "Entry type should be Note (1)");
        assert.ok(
            newEntry.locations.some((loc) => loc.startLine === 20 && loc.endLine === 22),
            "Entry should have correct line range",
        );
    });

    // NOTE: toggleAudited and addPartiallyAudited are tested in decorations.test.ts
    // NOTE: toggleTreeViewMode is tested in treeViews.test.ts

    test("weAudit.showMarkedFilesDayLog shows day log after marking a file as audited", async function () {
        this.timeout(15000);

        // First, mark a file as audited to ensure there's content in the day log
        await openTestFile();
        // Use path.join for cross-platform compatibility (Windows uses backslashes)
        const relativePath = path.join("src", "sample.ts");

        // Check if file is already audited
        const dataBefore = readWeauditData(workspaceFolder);
        const wasAudited = dataBefore?.auditedFiles.some((f) => f.path === relativePath) ?? false;

        // If not audited, mark it as audited
        if (!wasAudited) {
            await vscode.commands.executeCommand("weAudit.toggleAudited");
            // Wait for the audit to complete
            await waitForCondition(() => {
                const data = readWeauditData(workspaceFolder);
                return data?.auditedFiles.some((f) => f.path === relativePath) ?? false;
            });
        }

        // Close all editors first to get a clean slate
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        // Wait for editors to close
        await waitForCondition(() => vscode.window.visibleTextEditors.length === 0, 2000);

        const editorsBefore = vscode.window.visibleTextEditors.length;

        // Now call the day log command - it should open a markdown document
        await vscode.commands.executeCommand("weAudit.showMarkedFilesDayLog");

        // Wait for a new editor to appear (poll instead of fixed delay)
        const editorOpened = await waitForCondition(() => vscode.window.visibleTextEditors.length > editorsBefore, 5000);
        assert.ok(editorOpened, "A new document should be opened with the day log");

        // Verify the opened document contains expected content
        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, "There should be an active editor");
        const content = activeEditor.document.getText();
        assert.ok(content.includes("LOC"), "Day log should contain LOC information");

        // Clean up: restore the file's audited state if we changed it
        if (!wasAudited) {
            // Close the day log first
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await openTestFile();
            await vscode.commands.executeCommand("weAudit.toggleAudited");
            // Wait for the unaudit to complete
            await waitForCondition(() => {
                const data = readWeauditData(workspaceFolder);
                return !data?.auditedFiles.some((f) => f.path === relativePath);
            });
        }
    });
});
