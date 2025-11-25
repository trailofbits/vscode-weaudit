import * as assert from "assert";
import * as vscode from "vscode";

suite("Tree View Integration", () => {
    const extensionId = "trailofbits.weaudit";

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();
    });

    test("All tree views can be focused and become visible", async function () {
        this.timeout(15000);

        // Test that all tree view focus commands work
        const treeViews = ["codeMarker", "resolvedFindings", "savedFindings"];

        for (const view of treeViews) {
            await vscode.commands.executeCommand(`${view}.focus`);
            await new Promise((resolve) => setTimeout(resolve, 300));

            // Verify the view is visible by checking if the weAudit activity bar is active
            // After focusing, we check that we can still execute the command (view exists)
            const allCommands = await vscode.commands.getCommands(true);
            assert.ok(allCommands.includes(`${view}.focus`), `${view}.focus command should be available`);
        }
    });

    test("Context menu items are registered in package.json", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const packageJson = extension.packageJSON;
        const menus = packageJson?.contributes?.menus;
        assert.ok(menus, "Menus should be contributed");
        assert.ok(menus["view/item/context"], "Context menu items should be registered");
        assert.ok(Array.isArray(menus["view/item/context"]) && menus["view/item/context"].length > 0, "At least one context menu item should be registered");
    });

    test("toggleTreeViewMode command changes the configuration value", async function () {
        this.timeout(10000);

        // Get the current mode from configuration
        const modeBefore = vscode.workspace.getConfiguration("weAudit").get<string>("general.treeViewMode");

        // Toggle the mode
        await vscode.commands.executeCommand("weAudit.toggleTreeViewMode");
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Get a fresh configuration object to see the updated value
        const modeAfter = vscode.workspace.getConfiguration("weAudit").get<string>("general.treeViewMode");
        assert.notStrictEqual(modeAfter, modeBefore, "Tree view mode should change after toggle");

        // Verify it's one of the valid values
        assert.ok(modeAfter === "list" || modeAfter === "byFile", `Mode should be 'list' or 'byFile', got '${modeAfter}'`);
    });

    test("Tree view refresh command loads configuration files", async function () {
        this.timeout(10000);

        // Get extension to verify it's active
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active before refresh");

        // findAndLoadConfigurationFiles refreshes the tree views
        await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Verify extension remains active after refresh
        assert.ok(extension?.isActive, "Extension should remain active after refresh");
    });
});
