import * as assert from "assert";
import * as vscode from "vscode";

suite("Webview Panels", () => {
    const extensionId = "trailofbits.weaudit";

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();
    });

    test("Finding details panel is registered", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const views = extension.packageJSON?.contributes?.views?.weAudit;
        assert.ok(Array.isArray(views), "weAudit views should be registered");

        const findingDetailsView = views.find((v: { id: string }) => v.id === "findingDetails");
        assert.ok(findingDetailsView, "Finding details panel should be registered");
    });

    test("Finding details panel can be focused", async function () {
        this.timeout(10000);

        await vscode.commands.executeCommand("findingDetails.focus");
    });

    test("Git config panel is registered", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const views = extension.packageJSON?.contributes?.views?.weAudit;
        assert.ok(Array.isArray(views), "weAudit views should be registered");

        const gitConfigView = views.find((v: { id: string }) => v.id === "gitConfig");
        assert.ok(gitConfigView, "Git config panel should be registered");
    });

    test("Git config panel can be focused", async function () {
        this.timeout(10000);

        await vscode.commands.executeCommand("gitConfig.focus");
    });

    test("Git config commands are registered", async function () {
        this.timeout(10000);

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("weAudit.editClientRemote"), "editClientRemote command should exist");
        assert.ok(commands.includes("weAudit.editAuditRemote"), "editAuditRemote command should exist");
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
