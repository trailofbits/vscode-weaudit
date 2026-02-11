import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";

interface ConfigurationEntry {
    path: string;
    username: string;
    root: { label: string };
}

/**
 * Returns a promise that resolves after the given number of milliseconds.
 */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the absolute path to the current user's `.weaudit` file for the given workspace folder.
 */
function getWeauditFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
    const username = vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username;
    return path.join(workspaceFolder.uri.fsPath, ".vscode", `${username}.weaudit`);
}

/**
 * Writes a minimal `.weaudit` file containing a single finding in `src/sample.ts`.
 */
function writeWeauditWithFinding(workspaceFolder: vscode.WorkspaceFolder, startLine: number, endLine: number): void {
    const filePath = getWeauditFilePath(workspaceFolder);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = {
        clientRemote: "",
        gitRemote: "",
        gitSha: "",
        treeEntries: [
            {
                label: "Test Finding",
                entryType: 0,
                author: vscode.workspace.getConfiguration("weAudit").get("general.username") || userInfo().username,
                locations: [{ path: "src/sample.ts", startLine, endLine, label: "", description: "" }],
                details: { severity: "", difficulty: "", type: "", description: "", exploit: "", recommendation: "" },
            },
        ],
        auditedFiles: [],
        partiallyAuditedFiles: [],
        resolvedEntries: [],
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

/**
 * Creates a `ConfigurationEntry` for the current user's `.weaudit` file in the provided workspace folder.
 */
function getCurrentUserConfigEntry(workspaceFolder: vscode.WorkspaceFolder): ConfigurationEntry {
    const filePath = getWeauditFilePath(workspaceFolder);
    const username = path.parse(filePath).name;
    return {
        path: filePath,
        username,
        root: { label: path.basename(workspaceFolder.uri.fsPath) },
    };
}

suite("Boundary Editing CodeLens", () => {
    const extensionId = "trailofbits.weaudit";
    let testFileUri: vscode.Uri;
    let workspaceFolder: vscode.WorkspaceFolder;
    let originalWeauditContent: string | null = null;
    let weauditFilePath: string;
    let configEntry: ConfigurationEntry;
    let isConfigLoaded = false;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        assert.ok(workspaceFolders && workspaceFolders.length > 0, "Workspace folder should be available for extension tests");
        workspaceFolder = workspaceFolders[0];
        testFileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "src", "sample.ts"));

        weauditFilePath = getWeauditFilePath(workspaceFolder);
        configEntry = getCurrentUserConfigEntry(workspaceFolder);
        if (fs.existsSync(weauditFilePath)) {
            originalWeauditContent = fs.readFileSync(weauditFilePath, "utf-8");
        }
    });

    /**
     * Stops boundary editing, unloads the config if loaded, and closes all editors.
     */
    async function stopEditingAndUnloadConfig(): Promise<void> {
        await vscode.commands.executeCommand("weAudit.stopEditingBoundary");
        if (isConfigLoaded) {
            await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
            isConfigLoaded = false;
        }
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }

    /**
     * Restores the `.weaudit` file to its original state (or removes it if none existed).
     */
    function restoreWeauditFile(): void {
        if (!weauditFilePath) {
            return;
        }
        if (originalWeauditContent !== null) {
            fs.writeFileSync(weauditFilePath, originalWeauditContent);
        } else if (fs.existsSync(weauditFilePath)) {
            fs.unlinkSync(weauditFilePath);
        }
    }

    suiteTeardown(async () => {
        await stopEditingAndUnloadConfig();
        restoreWeauditFile();
        await vscode.commands.executeCommand("weAudit.findAndLoadConfigurationFiles");
    });

    setup(async () => {
        await stopEditingAndUnloadConfig();
        restoreWeauditFile();
    });

    /**
     * Opens the shared test file in an editor.
     */
    async function openTestFile(): Promise<vscode.TextEditor> {
        const document = await vscode.workspace.openTextDocument(testFileUri);
        return await vscode.window.showTextDocument(document);
    }

    /**
     * Places the cursor on a given line (empty selection), matching normal user navigation.
     */
    function placeCursorOnLine(editor: vscode.TextEditor, line: number): void {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
    }

    /**
     * Places a minimal (1-character) selection on a given line.
     * This is used as a fallback for environments where cursor-only selections don't intersect regions as expected.
     */
    function selectSingleCharacterOnLine(editor: vscode.TextEditor, line: number): void {
        const endChar = Math.min(1, editor.document.lineAt(line).text.length);
        editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, endChar));
    }

    /**
     * Retrieves CodeLens commands for a given document URI, filtered to weAudit-provided lenses.
     */
    async function getWeauditCodeLensCommands(uri: vscode.Uri): Promise<string[]> {
        const lenses = (await vscode.commands.executeCommand("vscode.executeCodeLensProvider", uri)) as vscode.CodeLens[];
        return lenses.map((l) => l.command?.command).filter((c): c is string => typeof c === "string" && c.startsWith("weAudit."));
    }

    /**
     * Polls until the given predicate holds for the CodeLens command list, or throws on timeout.
     * @param uri the document to query CodeLens commands for
     * @param predicate returns true when the desired condition is met
     * @param description human-readable description for the timeout error message
     * @param timeoutMs maximum time to wait before throwing
     */
    async function waitForCodeLensCondition(
        uri: vscode.Uri,
        predicate: (commands: string[]) => boolean,
        description: string,
        timeoutMs: number = 3000,
    ): Promise<string[]> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const commands = await getWeauditCodeLensCommands(uri);
            if (predicate(commands)) {
                return commands;
            }
            await delay(100);
        }
        const commands = await getWeauditCodeLensCommands(uri);
        if (predicate(commands)) {
            return commands;
        }
        throw new Error(`Timed out: ${description}. Got: ${JSON.stringify(commands)}`);
    }

    /**
     * Polls until a given CodeLens command appears for a document, or throws on timeout.
     */
    async function waitForWeauditCodeLensCommand(uri: vscode.Uri, command: string, timeoutMs: number = 3000): Promise<string[]> {
        return waitForCodeLensCondition(uri, (cmds) => cmds.includes(command), `waiting for CodeLens command "${command}"`, timeoutMs);
    }

    /**
     * Polls until a given CodeLens command disappears for a document, or throws on timeout.
     */
    async function waitForWeauditCodeLensCommandAbsent(uri: vscode.Uri, command: string, timeoutMs: number = 3000): Promise<string[]> {
        return waitForCodeLensCondition(uri, (cmds) => !cmds.includes(command), `waiting for CodeLens command "${command}" to disappear`, timeoutMs);
    }

    /**
     * Loads the seeded `.weaudit` file into the extension and starts boundary editing.
     * This is resilient to prior test suites leaving the config selected: it toggles once,
     * attempts to start editing, and if that fails it toggles again (reload) and retries.
     */
    async function loadSeededFindingAndStartEditing(editor: vscode.TextEditor, cursorLine: number, expectedLensCommand: string): Promise<string[]> {
        await vscode.commands.executeCommand("weAudit.stopEditingBoundary");
        placeCursorOnLine(editor, cursorLine);

        await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
        isConfigLoaded = true;

        // Allow the extension to process the loaded findings before editing
        await delay(200);

        try {
            await vscode.commands.executeCommand("weAudit.editFindingBoundary");
            return await waitForWeauditCodeLensCommand(editor.document.uri, expectedLensCommand, 2000);
        } catch {
            await vscode.commands.executeCommand("weAudit.stopEditingBoundary");
            // Toggle twice: first unloads, second reloads findings from disk
            await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
            await vscode.commands.executeCommand("weAudit.toggleSavedFindings", configEntry);
            isConfigLoaded = true;

            await delay(200);
            selectSingleCharacterOnLine(editor, cursorLine);
            await vscode.commands.executeCommand("weAudit.editFindingBoundary");
            return await waitForWeauditCodeLensCommand(editor.document.uri, expectedLensCommand, 3000);
        }
    }

    /**
     * Returns the last line index that contains any non-whitespace text, or 0 if the document is empty/whitespace-only.
     */
    function getLastNonEmptyLine(document: vscode.TextDocument): number {
        for (let i = document.lineCount - 1; i >= 0; i--) {
            if (document.lineAt(i).text.trim().length > 0) {
                return i;
            }
        }
        return 0;
    }

    test("Does not show Expand Down at EOF (single-line finding)", async function () {
        this.timeout(20000);

        const editor = await openTestFile();
        const lastLineIndex = editor.document.lineCount - 1;
        assert.ok(lastLineIndex >= 2, "Test file must contain at least 3 lines");

        // Start boundary mode from a 2-line finding, then shrink it to a single-line finding one line above EOF.
        // This avoids a flaky edge case where starting boundary editing directly on a single-line seeded finding
        // sometimes fails to resolve the "finding under cursor" in the extension-host test environment.
        const anchorLine = lastLineIndex - 1;
        writeWeauditWithFinding(workspaceFolder, anchorLine - 1, anchorLine);
        await loadSeededFindingAndStartEditing(editor, anchorLine, "weAudit.boundaryShrinkTop");

        await vscode.commands.executeCommand("weAudit.boundaryShrinkTop");
        await waitForWeauditCodeLensCommand(editor.document.uri, "weAudit.stopEditingBoundary");

        const commandsAfterShrink = await getWeauditCodeLensCommands(editor.document.uri);
        assert.ok(!commandsAfterShrink.includes("weAudit.boundaryShrinkTop"), "Expected the region to be single-line after shrinking from the top");
        assert.ok(!commandsAfterShrink.includes("weAudit.boundaryShrinkBottom"), "Expected the region to be single-line after shrinking from the top");
        assert.ok(commandsAfterShrink.includes("weAudit.boundaryExpandDown"), "Expand Down should be offered when not yet at end-of-file");

        // Move the single-line finding down by one line so it reaches EOF, then verify Expand Down is hidden.
        await vscode.commands.executeCommand("weAudit.boundaryMoveDown");
        await waitForWeauditCodeLensCommand(editor.document.uri, "weAudit.stopEditingBoundary");
        const commandsAtEof = await waitForWeauditCodeLensCommandAbsent(editor.document.uri, "weAudit.boundaryExpandDown", 5000);
        assert.ok(!commandsAtEof.includes("weAudit.boundaryExpandDown"), "Expand Down should not be offered once the finding reaches end-of-file");
    });

    test("Does not show Expand/Move Down at EOF (multi-line finding)", async function () {
        this.timeout(20000);

        const editor = await openTestFile();
        const lastNonEmptyLine = getLastNonEmptyLine(editor.document);
        assert.ok(lastNonEmptyLine > 0, "Test file must contain at least 2 non-empty lines");
        const lastLineIndex = editor.document.lineCount - 1;

        writeWeauditWithFinding(workspaceFolder, lastNonEmptyLine - 1, lastNonEmptyLine);
        const commands = await loadSeededFindingAndStartEditing(editor, lastNonEmptyLine, "weAudit.boundaryShrinkBottom");
        assert.ok(commands.includes("weAudit.boundaryShrinkBottom"), "Shrink Bottom should be offered for multi-line findings");

        if (lastNonEmptyLine === lastLineIndex) {
            assert.ok(!commands.includes("weAudit.boundaryExpandDown"), "Expand Down should not be offered at end-of-file");
            assert.ok(!commands.includes("weAudit.boundaryMoveDown"), "Move Down should not be offered at end-of-file");
        } else {
            assert.ok(commands.includes("weAudit.boundaryExpandDown"), "Expand Down should be offered when not yet at the document's last line");
            assert.ok(commands.includes("weAudit.boundaryMoveDown"), "Move Down should be offered when not yet at the document's last line");

            await vscode.commands.executeCommand("weAudit.boundaryExpandDown");
            await delay(300);

            const commandsAtEof = await getWeauditCodeLensCommands(editor.document.uri);
            assert.ok(!commandsAtEof.includes("weAudit.boundaryExpandDown"), "Expand Down should not be offered once the finding reaches end-of-file");
            assert.ok(!commandsAtEof.includes("weAudit.boundaryMoveDown"), "Move Down should not be offered once the finding reaches end-of-file");
        }
    });

    test("Closing all editors exits boundary editing mode", async function () {
        this.timeout(25000);

        const editor = await openTestFile();
        writeWeauditWithFinding(workspaceFolder, 5, 6);
        await loadSeededFindingAndStartEditing(editor, 5, "weAudit.stopEditingBoundary");

        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await delay(500);

        const reopened = await openTestFile();
        const commandsAfterClose = await getWeauditCodeLensCommands(reopened.document.uri);
        assert.deepStrictEqual(commandsAfterClose, [], "Expected no boundary editing CodeLens after closing all editors");
    });
});
