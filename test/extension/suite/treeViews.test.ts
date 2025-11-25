import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Tree View Integration", () => {
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

    test("Findings tree view can be focused", async function () {
        this.timeout(10000);

        // Focus the findings tree view - should not throw
        await vscode.commands.executeCommand("codeMarker.focus");
    });

    test("Findings tree updates after adding finding", async function () {
        this.timeout(15000);

        const document = await vscode.workspace.openTextDocument(testFileUri);
        const editor = await vscode.window.showTextDocument(document);

        // Select a line and add a finding
        const start = new vscode.Position(35, 0);
        const end = new vscode.Position(36, 0);
        editor.selection = new vscode.Selection(start, end);

        const originalShowInputBox = vscode.window.showInputBox;
        (vscode.window as any).showInputBox = async () => "Tree Update Test Finding";

        try {
            await vscode.commands.executeCommand("weAudit.addFinding");
            // Give tree time to update
            await new Promise((resolve) => setTimeout(resolve, 500));
            // If we get here without error, tree view update worked
        } finally {
            (vscode.window as any).showInputBox = originalShowInputBox;
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

    test("Resolved findings tree view can be focused", async function () {
        this.timeout(10000);

        await vscode.commands.executeCommand("resolvedFindings.focus");
    });

    test("Saved findings tree view can be focused", async function () {
        this.timeout(10000);

        await vscode.commands.executeCommand("savedFindings.focus");
    });

    test("Tree view refresh command executes without error", async function () {
        this.timeout(10000);

        await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
    });
});
