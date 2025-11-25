import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";

interface SerializedData {
    treeEntries: Array<{ label: string; entryType: number }>;
    auditedFiles: Array<{ path: string; author: string }>;
    partiallyAuditedFiles: Array<{ path: string; author: string; startLine: number; endLine: number }>;
    resolvedEntries: Array<{ label: string }>;
}

function getWeauditFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
    const username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
    return path.join(workspaceFolder.uri.fsPath, ".vscode", `${username}.weaudit`);
}

function readWeauditData(workspaceFolder: vscode.WorkspaceFolder): SerializedData | null {
    const filePath = getWeauditFilePath(workspaceFolder);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SerializedData;
}

suite("Editor Decorations", () => {
    const extensionId = "trailofbits.weaudit";
    let testFileUri: vscode.Uri;
    let workspaceFolder: vscode.WorkspaceFolder;
    let originalWeauditContent: string | null = null;
    let weauditFilePath: string;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            workspaceFolder = workspaceFolders[0];
            testFileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "src", "sample.ts"));

            // Save original weaudit file content for restoration after tests
            weauditFilePath = getWeauditFilePath(workspaceFolder);
            if (fs.existsSync(weauditFilePath)) {
                originalWeauditContent = fs.readFileSync(weauditFilePath, "utf-8");
            }
        }
    });

    suiteTeardown(async () => {
        // Restore original weaudit file content
        if (weauditFilePath) {
            if (originalWeauditContent !== null) {
                fs.writeFileSync(weauditFilePath, originalWeauditContent);
            } else if (fs.existsSync(weauditFilePath)) {
                // If there was no original file, delete the one created by tests
                fs.unlinkSync(weauditFilePath);
            }
            // Reload the extension's data
            await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
        }
    });

    async function openTestFile(): Promise<vscode.TextEditor> {
        const document = await vscode.workspace.openTextDocument(testFileUri);
        return await vscode.window.showTextDocument(document);
    }

    test("toggleAudited command toggles file audit status", async function () {
        this.timeout(10000);

        await openTestFile();
        const relativePath = "src/sample.ts";

        // Get the initial state
        const dataBefore = readWeauditData(workspaceFolder);
        const wasAudited = dataBefore?.auditedFiles.some((f) => f.path === relativePath) ?? false;

        // Toggle audited status
        await vscode.commands.executeCommand("weAudit.toggleAudited");
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify the state changed
        const dataAfter = readWeauditData(workspaceFolder);
        const isAudited = dataAfter?.auditedFiles.some((f) => f.path === relativePath) ?? false;

        assert.notStrictEqual(isAudited, wasAudited, "Audited status should be toggled");
    });

    test("addPartiallyAudited command adds partially audited region", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        const relativePath = "src/sample.ts";

        // Ensure the file is not fully audited (which would prevent partial auditing)
        // The previous test may have marked it as fully audited
        const dataCheck = readWeauditData(workspaceFolder);
        if (dataCheck?.auditedFiles.some((f) => f.path === relativePath)) {
            await vscode.commands.executeCommand("weAudit.toggleAudited");
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // Use lines that are not already partially audited
        // Note: When selection ends at character 0, the extension decrements endLine by 1
        // So we set the end position with a non-zero character to preserve the exact line
        const startLine = 30;
        const endLine = 35;
        const start = new vscode.Position(startLine, 0);
        const end = new vscode.Position(endLine, 1);
        editor.selection = new vscode.Selection(start, end);

        // Get the initial state
        const dataBefore = readWeauditData(workspaceFolder);
        const regionExistsBefore =
            dataBefore?.partiallyAuditedFiles.some((f) => f.path === relativePath && f.startLine === startLine && f.endLine === endLine) ?? false;

        // Add partially audited region
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify state changed
        const dataAfter = readWeauditData(workspaceFolder);
        const regionExistsAfter =
            dataAfter?.partiallyAuditedFiles.some((f) => f.path === relativePath && f.startLine === startLine && f.endLine === endLine) ?? false;

        // The command toggles the region - so if it existed before it's removed, if it didn't exist it's added
        assert.notStrictEqual(regionExistsAfter, regionExistsBefore, "Partially audited region should be toggled");
    });

    test("Extension survives file edits", async function () {
        this.timeout(10000);

        const editor = await openTestFile();
        const extension = vscode.extensions.getExtension(extensionId);

        // Make an edit
        await editor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), "// Test comment\n");
        });

        // Give decorations time to update
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Undo the edit
        await vscode.commands.executeCommand("undo");

        // Extension should still be active after file edits
        assert.ok(extension?.isActive, "Extension should survive file edits");
    });

    test("Decoration color configuration exists", async function () {
        this.timeout(10000);

        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, "Extension should be present");

        const packageJson = extension.packageJSON;
        const configuration = packageJson?.contributes?.configuration;

        assert.ok(configuration, "Configuration should exist");

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

        assert.ok(Object.keys(configProps).length > 0, "Configuration properties should exist");
        assert.ok(configProps["weAudit.ownFindingColor"], "ownFindingColor should be configured");
        assert.ok(configProps["weAudit.otherFindingColor"], "otherFindingColor should be configured");
        assert.ok(configProps["weAudit.ownNoteColor"], "ownNoteColor should be configured");
        assert.ok(configProps["weAudit.otherNoteColor"], "otherNoteColor should be configured");
        assert.ok(configProps["weAudit.auditedColor"], "auditedColor should be configured");
    });
});
