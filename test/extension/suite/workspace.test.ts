import * as assert from "assert";
import * as vscode from "vscode";

// NOTE: Command registration tests are consolidated in activation.test.ts
// NOTE: Configuration refresh is tested in treeViews.test.ts

suite("Workspace Operations", () => {
    const extensionId = "trailofbits.weaudit";

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();
    });

    test("Extension activates in workspace", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension?.isActive, "Extension should be active");

        const workspaceFolders = vscode.workspace.workspaceFolders;
        assert.ok(workspaceFolders && workspaceFolders.length > 0, "Workspace should have folders");
    });

    test("Configuration properties are defined in package.json", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const packageJson = extension.packageJSON;
        const configuration = packageJson?.contributes?.configuration;

        assert.ok(configuration, "Configuration should be defined");

        // Configuration can be an array or an object - combine all properties
        let configProps: Record<string, unknown> = {};
        if (Array.isArray(configuration)) {
            for (const section of configuration) {
                if (section.properties) {
                    configProps = { ...configProps, ...section.properties };
                }
            }
        } else if (configuration?.properties) {
            configProps = configuration.properties;
        }

        assert.ok(Object.keys(configProps).length > 0, "Configuration properties should be defined");

        // Verify essential configuration properties exist
        const requiredProps = ["weAudit.general.treeViewMode", "weAudit.general.username"];

        for (const prop of requiredProps) {
            assert.ok(configProps[prop], `${prop} should be configurable`);
        }
    });

    test("Configuration values can be read via VS Code API", async function () {
        this.timeout(10000);

        const config = vscode.workspace.getConfiguration("weAudit");

        // Verify config.get returns expected types for known properties
        const treeViewMode = config.get<string>("general.treeViewMode");
        const username = config.get<string>("general.username");

        // treeViewMode should be one of the valid values if set
        if (treeViewMode !== undefined) {
            assert.ok(treeViewMode === "list" || treeViewMode === "byFile", `Tree view mode should be 'list' or 'byFile' if set, got '${treeViewMode}'`);
        }

        // username can be undefined or a string
        if (username !== undefined) {
            assert.strictEqual(typeof username, "string", "Username should be a string if set");
        }

        // Verify we can successfully read the configuration without errors
        assert.ok(config !== undefined, "Configuration should be accessible");
    });
});
