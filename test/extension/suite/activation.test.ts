import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Activation", () => {
    const extensionId = "trailofbits.weaudit";

    test("Extension activates on workspace open", async () => {
        // Get the extension
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        // Activate and wait
        await extension.activate();
        assert.strictEqual(extension.isActive, true, "Extension should be active");
    });

    test("Extension activates on view open", async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        // Opening the weAudit view should trigger activation
        await vscode.commands.executeCommand("workbench.view.extension.weAudit");

        // Give it a moment to activate
        await new Promise((resolve) => setTimeout(resolve, 500));

        assert.strictEqual(extension?.isActive, true, "Extension should be active after view open");
    });

    test("Extension registers all commands", async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        await extension.activate();

        // Get all registered commands
        const allCommands = await vscode.commands.getCommands(true);

        // List of commands the extension should register
        // This is the consolidated test for command registration - don't duplicate elsewhere
        const expectedCommands = [
            "weAudit.addFinding",
            "weAudit.addNote",
            "weAudit.toggleAudited",
            "weAudit.addPartiallyAudited",
            "weAudit.deleteFinding",
            "weAudit.resolveFinding",
            "weAudit.restoreFinding",
            "weAudit.editEntryTitle",
            "weAudit.copyEntryPermalink",
            "weAudit.copySelectedCodePermalink",
            "weAudit.toggleTreeViewMode",
            "weAudit.openGithubIssue",
            "weAudit.exportFindingsInMarkdown",
            "weAudit.showMarkedFilesDayLog",
            "weAudit.navigateToNextPartiallyAuditedRegion",
            // Boundary editing commands
            "weAudit.editFindingBoundary",
            "weAudit.stopEditingBoundary",
            "weAudit.boundaryExpandUp",
            "weAudit.boundaryShrinkTop",
            "weAudit.boundaryMoveUp",
            "weAudit.boundaryExpandDown",
            "weAudit.boundaryShrinkBottom",
            "weAudit.boundaryMoveDown",
            // Git config commands
            "weAudit.editClientRemote",
            "weAudit.editAuditRemote",
            // Code Quality commands
            "weAudit.editCodeQualityIssueNumber",
            // Multi-root workspace commands
            "weAudit.nextGitConfig",
            "weAudit.prevGitConfig",
        ];

        for (const cmd of expectedCommands) {
            assert.ok(allCommands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });

    test("Extension registers tree view contributions", async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        await extension.activate();

        // Verify tree views are registered in package.json
        const packageJson = extension.packageJSON;
        const views = packageJson?.contributes?.views?.weAudit;

        assert.ok(Array.isArray(views), "weAudit views should be registered");
        assert.ok(views.length > 0, "At least one tree view should be registered");

        // Verify specific tree views exist
        const viewIds = views.map((v: { id: string }) => v.id);
        assert.ok(viewIds.includes("codeMarker"), "codeMarker tree view should be registered");
        assert.ok(viewIds.includes("resolvedFindings"), "resolvedFindings tree view should be registered");
    });
});
