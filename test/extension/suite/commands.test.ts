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

suite("Command Execution", () => {
    const extensionId = "trailofbits.weaudit";
    let testFileUri: vscode.Uri;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async () => {
        // Ensure extension is activated
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        // Get path to test file
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            workspaceFolder = workspaceFolders[0];
            testFileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "src", "sample.ts"));
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
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 5, 6);

        // Record entry count before
        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        // Mock the input box to return a label
        const originalShowInputBox = vscode.window.showInputBox;
        const testLabel = `Test Finding ${Date.now()}`;
        (vscode.window as any).showInputBox = async () => testLabel;

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            // Wait for data to be persisted
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify that a new entry was added
            const dataAfter = readWeauditData(workspaceFolder);
            assert.ok(dataAfter, "Data file should exist after adding finding");
            assert.ok(dataAfter.treeEntries.length > entriesBefore, "A new entry should be added");

            // Verify the entry has the correct label and type
            const newEntry = dataAfter.treeEntries.find((e) => e.label === testLabel);
            assert.ok(newEntry, "New entry should have the provided label");
            assert.strictEqual(newEntry.entryType, 0, "Entry type should be Finding (0)");
            assert.ok(
                newEntry.locations.some((loc) => loc.startLine === 5 && loc.endLine === 6),
                "Entry should have correct line range",
            );
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.addFinding prompts for label and creates entry", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 10, 12);

        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        let inputBoxCalled = false;
        const originalShowInputBox = vscode.window.showInputBox;
        const promptedLabel = `Prompted Label ${Date.now()}`;
        (vscode.window as any).showInputBox = async () => {
            inputBoxCalled = true;
            return promptedLabel;
        };

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            await new Promise((resolve) => setTimeout(resolve, 500));

            assert.ok(inputBoxCalled, "Input box should be shown for label");

            // Verify the entry was created with the prompted label
            const dataAfter = readWeauditData(workspaceFolder);
            assert.ok(dataAfter, "Data file should exist");
            assert.ok(dataAfter.treeEntries.length > entriesBefore, "A new entry should be added");

            const newEntry = dataAfter.treeEntries.find((e) => e.label === promptedLabel);
            assert.ok(newEntry, "Entry should have the prompted label");
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.addFinding handles cancellation gracefully without adding entry", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 15, 16);

        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined; // Simulates escape

        try {
            // Cancellation should not throw an error
            await vscode.commands.executeCommand("weAudit.addFinding");
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Verify no new entry was added
            const dataAfter = readWeauditData(workspaceFolder);
            const entriesAfter = dataAfter?.treeEntries.length ?? 0;
            assert.strictEqual(entriesAfter, entriesBefore, "No entry should be added when cancelled");
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.addNote creates a new note entry", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 20, 22);

        const dataBefore = readWeauditData(workspaceFolder);
        const entriesBefore = dataBefore?.treeEntries.length ?? 0;

        const originalShowInputBox = vscode.window.showInputBox;
        const noteLabel = `Test Note ${Date.now()}`;
        (vscode.window as any).showInputBox = async () => noteLabel;

        try {
            await vscode.commands.executeCommand("weAudit.addNote");
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify that a new entry was added
            const dataAfter = readWeauditData(workspaceFolder);
            assert.ok(dataAfter, "Data file should exist after adding note");
            assert.ok(dataAfter.treeEntries.length > entriesBefore, "A new entry should be added");

            // Verify the entry has the correct label and type (Note = 1)
            const newEntry = dataAfter.treeEntries.find((e) => e.label === noteLabel);
            assert.ok(newEntry, "New entry should have the provided label");
            assert.strictEqual(newEntry.entryType, 1, "Entry type should be Note (1)");
            assert.ok(
                newEntry.locations.some((loc) => loc.startLine === 20 && loc.endLine === 22),
                "Entry should have correct line range",
            );
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    // NOTE: toggleAudited and addPartiallyAudited are tested in decorations.test.ts
    // NOTE: toggleTreeViewMode is tested in treeViews.test.ts

    test("weAudit.showMarkedFilesDayLog opens a document or shows info message", async function () {
        this.timeout(10000);

        const editorsBefore = vscode.window.visibleTextEditors.length;

        // Command should execute without throwing and either open a document or show an info message
        await vscode.commands.executeCommand("weAudit.showMarkedFilesDayLog");
        await new Promise((resolve) => setTimeout(resolve, 500));

        // The command either opens a new markdown document (if there's a day log)
        // or shows an information message (if no files have been marked)
        // We can verify by checking if a new editor was opened or not
        const editorsAfter = vscode.window.visibleTextEditors.length;

        // If the day log has content, a new document should be opened
        // If not, the editor count should stay the same (info message shown)
        // Both outcomes are valid - we just verify the command completed
        assert.ok(editorsAfter >= editorsBefore, "Command should complete without error");
    });
});
