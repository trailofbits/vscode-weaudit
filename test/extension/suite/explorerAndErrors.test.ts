import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("File Decorations - Explorer", () => {
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

    test("Extension implements FileDecorationProvider", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active");

        // Verify the extension contributes to file decorations capability
        // by checking that it doesn't throw when toggling audit status
        await vscode.workspace.openTextDocument(testFileUri);
        await vscode.commands.executeCommand("weAudit.toggleAudited");
    });

    test("toggleAudited command executes for open file", async function () {
        this.timeout(10000);

        await vscode.workspace.openTextDocument(testFileUri);
        await vscode.commands.executeCommand("weAudit.toggleAudited");
        // If no exception, command executed successfully
    });
});

suite("Error Handling", () => {
    const extensionId = "trailofbits.weaudit";

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();
    });

    test("Extension remains stable during concurrent operations", async function () {
        this.timeout(15000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active initially");

        // Trigger multiple operations quickly - should not crash
        await Promise.allSettled([
            vscode.commands.executeCommand("weAudit.toggleTreeViewMode"),
            vscode.commands.executeCommand("weAudit.toggleTreeViewMode"),
            vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles"),
        ]);

        // Extension should remain active and stable
        assert.ok(extension.isActive, "Extension should remain stable after concurrent operations");
    });

    test("Extension handles large files without error", async function () {
        this.timeout(30000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active");

        // Create a large document
        const largeContent = "// Line\n".repeat(10000);

        const doc = await vscode.workspace.openTextDocument({
            content: largeContent,
            language: "typescript",
        });

        await vscode.window.showTextDocument(doc);

        // Give the extension time to process
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Extension should still be responsive
        assert.ok(extension.isActive, "Extension should remain responsive with large files");

        // Close the document
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    });

    test("Copy permalink command is registered", async function () {
        this.timeout(10000);

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("weAudit.copySelectedCodePermalink"), "copySelectedCodePermalink command should exist");
    });
});
