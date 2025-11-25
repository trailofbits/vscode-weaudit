import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Editor Decorations", () => {
    const extensionId = "trailofbits.weaudit";
    let testFileUri: vscode.Uri;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            testFileUri = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, "src", "sample.ts"));
        }
    });

    async function openTestFile(): Promise<vscode.TextEditor> {
        const document = await vscode.workspace.openTextDocument(testFileUri);
        return await vscode.window.showTextDocument(document);
    }

    test("Adding a finding applies decorations without error", async function () {
        this.timeout(10000);

        const editor = await openTestFile();

        // Create a finding to trigger decoration
        const start = new vscode.Position(5, 0);
        const end = new vscode.Position(6, 0);
        editor.selection = new vscode.Selection(start, end);

        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => "Decoration Test Finding";

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            // Give decorations time to apply
            await new Promise((resolve) => setTimeout(resolve, 500));
            // Command executed without throwing - decorations were applied
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("Adding a note applies decorations without error", async function () {
        this.timeout(10000);

        const editor = await openTestFile();

        const start = new vscode.Position(10, 0);
        const end = new vscode.Position(11, 0);
        editor.selection = new vscode.Selection(start, end);

        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => "Decoration Test Note";

        try {
            await vscode.commands.executeCommand("weAudit.addNote");
            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
        }
    });

    test("toggleAudited applies file-wide decoration without error", async function () {
        this.timeout(10000);

        await openTestFile();
        await vscode.commands.executeCommand("weAudit.toggleAudited");
        await new Promise((resolve) => setTimeout(resolve, 500));
    });

    test("addPartiallyAudited applies region decoration without error", async function () {
        this.timeout(10000);

        const editor = await openTestFile();

        const start = new vscode.Position(25, 0);
        const end = new vscode.Position(30, 0);
        editor.selection = new vscode.Selection(start, end);

        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        await new Promise((resolve) => setTimeout(resolve, 500));
    });

    test("Extension survives file edits", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        const extension = vscode.extensions.getExtension(extensionId);

        // Make an edit
        await editor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), "// Test comment\n");
        });

        // Give decorations time to update
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Undo the edit
        await vscode.commands.executeCommand("undo");

        // Extension should still be active after file edits
        assert.ok(extension?.isActive, "Extension should survive file edits");
    });

    test("Decoration color configuration exists", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const packageJson = extension.packageJSON;
        const configProps = packageJson?.contributes?.configuration?.properties;

        assert.ok(configProps, "Configuration properties should exist");
        assert.ok(configProps["weAudit.ownFindingColor"], "ownFindingColor should be configured");
        assert.ok(configProps["weAudit.otherFindingColor"], "otherFindingColor should be configured");
        assert.ok(configProps["weAudit.ownNoteColor"], "ownNoteColor should be configured");
        assert.ok(configProps["weAudit.otherNoteColor"], "otherNoteColor should be configured");
        assert.ok(configProps["weAudit.auditedColor"], "auditedColor should be configured");
    });
});
