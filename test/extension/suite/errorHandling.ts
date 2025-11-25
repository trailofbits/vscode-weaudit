import * as assert from "assert";
import * as vscode from "vscode";

// NOTE: File decoration tests (toggleAudited, addPartiallyAudited) are in decorations.test.ts
// NOTE: Command registration tests are consolidated in activation.test.ts

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
});
