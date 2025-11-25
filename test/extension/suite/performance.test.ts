import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

suite("Performance", () => {
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

    test("Extension activates within reasonable time", async function () {
        this.timeout(5000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        // If already active, we can only verify it's active
        // (startup timing is handled by VS Code itself)
        if (!extension.isActive) {
            const startTime = Date.now();
            await extension.activate();
            const activationTime = Date.now() - startTime;

            // Activation should be under 2 seconds even in CI environments
            assert.ok(activationTime < 2000, `Extension activation took ${activationTime}ms, should be under 2000ms`);
        }

        assert.ok(extension.isActive, "Extension should be active");
    });

    test("Tree view handles 100 entries within reasonable time", async function () {
        this.timeout(30000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active");

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.skip();
            return;
        }

        const entries = [];
        for (let i = 0; i < 100; i++) {
            entries.push({
                label: `Test Entry ${i}`,
                entryType: i % 2,
                author: "testuser",
                details: {
                    severity: "Undefined",
                    difficulty: "Undefined",
                    type: "Undefined",
                    description: "",
                    exploit: "",
                    recommendation: "",
                },
                locations: [
                    {
                        path: "src/sample.ts",
                        startLine: i % 40,
                        endLine: (i % 40) + 1,
                        label: "",
                        description: "",
                    },
                ],
            });
        }

        const testData = {
            treeEntries: entries,
            auditedFiles: [],
            partiallyAuditedFiles: [],
            resolvedEntries: [],
            clientRemote: "",
            gitRemote: "",
            gitSha: "",
        };

        const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, ".vscode");
        const perfTestFile = path.join(vscodeDir, "perftest.weaudit");

        try {
            // Ensure the .vscode directory exists
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }
            fs.writeFileSync(perfTestFile, JSON.stringify(testData, null, 2));

            const startTime = Date.now();
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
            const renderTime = Date.now() - startTime;

            // Should complete within 5 seconds even in CI environments
            assert.ok(renderTime < 5000, `Tree view render took ${renderTime}ms, should be under 5000ms`);
        } finally {
            try {
                fs.unlinkSync(perfTestFile);
            } catch {
                // Ignore cleanup errors
            }
        }
    });

    test("Adding finding command responds within reasonable time", async function () {
        this.timeout(10000);

        const document = await vscode.workspace.openTextDocument(testFileUri);
        const editor = await vscode.window.showTextDocument(document);

        const startTime = Date.now();

        const start = new vscode.Position(0, 0);
        const end = new vscode.Position(1, 0);
        editor.selection = new vscode.Selection(start, end);

        // Start the command (shows input box)
        const commandPromise = vscode.commands.executeCommand("weAudit.addFinding");

        // Wait briefly for input box to appear, then dismiss it
        await new Promise((resolve) => setTimeout(resolve, 100));
        await vscode.commands.executeCommand("workbench.action.closeQuickOpen");

        await commandPromise;
        const operationTime = Date.now() - startTime;

        // Command should respond within 2 seconds even in CI environments
        assert.ok(operationTime < 2000, `Adding finding took ${operationTime}ms, should be under 2000ms`);
    });

    test("Large .weaudit file (1000 entries) loads within reasonable time", async function () {
        this.timeout(60000);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.skip();
            return;
        }

        // Create a large test .weaudit file with 1000 entries
        const entries = [];
        for (let i = 0; i < 1000; i++) {
            entries.push({
                label: `Large Test Entry ${i}`,
                entryType: i % 2,
                author: "testuser",
                details: {
                    severity: "Undefined",
                    difficulty: "Undefined",
                    type: "Undefined",
                    description: `Description for entry ${i}`,
                    exploit: "",
                    recommendation: "",
                },
                locations: [
                    {
                        path: "src/sample.ts",
                        startLine: i % 40,
                        endLine: (i % 40) + 1,
                        label: `Location ${i}`,
                        description: "",
                    },
                ],
            });
        }

        const testData = {
            treeEntries: entries,
            auditedFiles: [],
            partiallyAuditedFiles: [],
            resolvedEntries: [],
            clientRemote: "",
            gitRemote: "",
            gitSha: "",
        };

        const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, ".vscode");
        const largeTestFile = path.join(vscodeDir, "largetest.weaudit");

        try {
            fs.writeFileSync(largeTestFile, JSON.stringify(testData, null, 2));

            const startTime = Date.now();
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
            const loadTime = Date.now() - startTime;

            // Large file should load within reasonable time
            assert.ok(loadTime < 30000, `Large file load took ${loadTime}ms, should be under 30000ms`);

            const extension = vscode.extensions.getExtension(extensionId);
            assert.ok(extension?.isActive, "Extension should remain active after loading large file");
        } finally {
            // Clean up
            try {
                fs.unlinkSync(largeTestFile);
            } catch {
                // Ignore cleanup errors
            }
        }
    });
});
