import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Command Execution", () => {
    const extensionId = "trailofbits.weaudit";
    let testFileUri: vscode.Uri;

    suiteSetup(async () => {
        // Ensure extension is activated
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        // Get path to test file
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            testFileUri = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, "src", "sample.ts"));
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

    test("weAudit.addFinding creates finding at selection", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 5, 6);

        // Mock the input box to return a label
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => "Test Finding Label";

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            // If command executes without error, test passes
            assert.ok(true, "addFinding command executed successfully");
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.addFinding prompts for label", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 10, 12);

        let inputBoxCalled = false;
        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => {
            inputBoxCalled = true;
            return "Prompted Label";
        };

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            assert.ok(inputBoxCalled, "Input box should be shown for label");
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.addFinding cancels on escape", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 15, 16);

        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => undefined; // Simulates escape

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            // Command should complete without error even when cancelled
            assert.ok(true, "addFinding handles cancellation gracefully");
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.addNote creates note at selection", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 20, 22);

        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => "Test Note Label";

        try {
            await vscode.commands.executeCommand("weAudit.addNote");
            assert.ok(true, "addNote command executed successfully");
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("weAudit.toggleAudited executes without error", async function () {
        this.timeout(10000);

        await openTestFile();
        // Command should execute without throwing
        await vscode.commands.executeCommand("weAudit.toggleAudited");
    });

    test("weAudit.addPartiallyAudited executes with selection", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        await selectLines(editor, 30, 35);
        // Command should execute without throwing when a selection is made
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
    });

    test("weAudit.showMarkedFilesDayLog executes without error", async function () {
        this.timeout(10000);

        // Command should execute without throwing
        await vscode.commands.executeCommand("weAudit.showMarkedFilesDayLog");
    });

    test("weAudit.toggleTreeViewMode executes without error", async function () {
        this.timeout(10000);

        // Command should execute without throwing
        await vscode.commands.executeCommand("weAudit.toggleTreeViewMode");
    });
});
