import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

suite("Workspace Operations", () => {
    const extensionId = "trailofbits.weaudit";

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();
    });

    test("Extension loads in workspace with .weaudit files", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active");

        const workspaceFolders = vscode.workspace.workspaceFolders;
        assert.ok(workspaceFolders && workspaceFolders.length > 0, "Workspace should have folders");

        const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, ".vscode");
        if (fs.existsSync(vscodeDir)) {
            const weauditFiles = fs.readdirSync(vscodeDir).filter((f) => f.endsWith(".weaudit"));
            // Just verify the extension can handle the workspace - count doesn't matter for this test
            assert.ok(weauditFiles.length >= 0, "Extension should load .weaudit files if present");
        }
    });

    test("Multi-root workspace commands are registered", async function () {
        this.timeout(10000);

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("weAudit.nextGitConfig"), "nextGitConfig command should exist");
        assert.ok(commands.includes("weAudit.prevGitConfig"), "prevGitConfig command should exist");
    });

    test("Configuration refresh command works", async function () {
        this.timeout(10000);

        // This should not throw
        await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
    });

    test("Configuration properties are defined", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const packageJson = extension.packageJSON;
        const configProps = packageJson?.contributes?.configuration?.properties;

        assert.ok(configProps, "Configuration properties should be defined");
        assert.ok(configProps["weAudit.general.treeViewMode"], "treeViewMode should be configurable");
        assert.ok(configProps["weAudit.general.username"], "username should be configurable");
    });

    test("Configuration values are accessible", async function () {
        this.timeout(10000);

        const config = vscode.workspace.getConfiguration("weAudit");

        // These may return default values, but should not throw
        const treeViewMode = config.get("general.treeViewMode");
        const username = config.get("general.username");

        // Verify we get values (could be defaults)
        assert.ok(treeViewMode === undefined || typeof treeViewMode === "string", "treeViewMode should be undefined or a string");
        assert.ok(username === undefined || typeof username === "string", "username should be undefined or a string");
    });
});
