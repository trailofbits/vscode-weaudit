import * as assert from "assert";
import * as vscode from "vscode";

// NOTE: Command registration tests are consolidated in activation.test.ts

suite("Webview Panels", () => {
    const extensionId = "trailofbits.weaudit";

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();
    });

    test("All webview panels are registered in package.json", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const views = extension.packageJSON?.contributes?.views?.weAudit;
        assert.ok(Array.isArray(views), "weAudit views should be registered");

        // Verify all expected webview panels are registered
        const viewIds = views.map((v: { id: string }) => v.id);
        const expectedViews = ["findingDetails", "gitConfig"];

        for (const viewId of expectedViews) {
            assert.ok(viewIds.includes(viewId), `${viewId} panel should be registered`);
        }
    });

    test("Webview panels can be focused and their commands remain registered", async function () {
        this.timeout(10000);

        const panels = ["findingDetails", "gitConfig"];

        for (const panel of panels) {
            // Focus the panel
            await vscode.commands.executeCommand(`${panel}.focus`);
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Verify the focus command is still registered (panel exists)
            const allCommands = await vscode.commands.getCommands(true);
            assert.ok(allCommands.includes(`${panel}.focus`), `${panel}.focus command should be registered`);
        }
    });

    test("Extension remains active after closing editors", async function () {
        this.timeout(15000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        // Close all editors
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Extension should still be active
        assert.ok(extension.isActive, "Extension should remain active after closing editors");
    });
});
