import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";

/** Open a fresh daily log and extract today's count and the overall total. */
async function readDisplayedLog(): Promise<{ text: string; daily: number; total: number }> {
    const previousDocument = vscode.window.activeTextEditor?.document;
    await vscode.commands.executeCommand("weAudit.showMarkedFilesDayLog");
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const document = vscode.window.activeTextEditor?.document;
        if (document && document !== previousDocument && document.languageId === "markdown") {
            const text = document.getText();
            const todaySection = text.split(`## ${new Date().toDateString()}\n`)[1]?.split("---")[0] ?? "";
            const daily = /Daily LOC: (\d+)/.exec(todaySection);
            const total = /Total LOC: (\d+)/.exec(text);
            assert.ok(daily && total, text);
            return { text, daily: Number(daily[1]), total: Number(total[1]) };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return assert.fail("The daily log did not open");
}

suite("Daily log region reviews", () => {
    test("region commands persist reviewed lines and display them in the daily log", async () => {
        await vscode.extensions.getExtension("trailofbits.weaudit")?.activate();
        const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const uri = vscode.Uri.file(path.join(root, "daily-log-regression.ts"));
        const logPath = path.join(root, ".vscode", ".weauditdaylog");
        fs.writeFileSync(uri.fsPath, "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            // Ending at column zero excludes the following line.
            editor.selection = new vscode.Selection(0, 0, 2, 0);
            await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
            const log = new Map(JSON.parse(fs.readFileSync(logPath, "utf8")) as [string, unknown[]][]);
            assert.ok(
                log.get(new Date().toDateString())?.some((entry) => {
                    const region = entry as { path?: string; startLine?: number; endLine?: number };
                    return region.path === "daily-log-regression.ts" && region.startLine === 0 && region.endLine === 1;
                }),
            );
            await vscode.commands.executeCommand("weAudit.showMarkedFilesDayLog");
            // The command opens its document asynchronously.
            const deadline = Date.now() + 5000;
            while (vscode.window.activeTextEditor?.document.languageId !== "markdown" && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const text = vscode.window.activeTextEditor?.document.getText() ?? "";
            assert.ok(text.includes("daily-log-regression.ts (lines 1–2)"), text);
            assert.ok(/Daily LOC: \d+/.test(text), text);
            assert.ok(!text.includes("NaN"), text);
        } finally {
            const editor = await vscode.window.showTextDocument(uri);
            editor.selection = new vscode.Selection(0, 0, 2, 0);
            await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
            fs.unlinkSync(uri.fsPath);
        }
    });

    test("unreadable whole-file entries do not block other file or region counts", async () => {
        await vscode.extensions.getExtension("trailofbits.weaudit")?.activate();
        const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const directory = fs.mkdtempSync(path.join(root, "daily-log-missing-"));
        const missing = path.join(directory, "deleted.ts");
        const present = path.join(directory, "present.ts");
        const region = path.join(directory, "region.ts");
        const content = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";
        const markedFiles: string[] = [];
        let regionMarked = false;
        for (const file of [missing, present, region]) {
            fs.writeFileSync(file, content);
        }
        try {
            for (const file of [missing, present]) {
                await vscode.window.showTextDocument(vscode.Uri.file(file));
                await vscode.commands.executeCommand("weAudit.toggleAudited");
                markedFiles.push(file);
            }
            const editor = await vscode.window.showTextDocument(vscode.Uri.file(region));
            editor.selection = new vscode.Selection(0, 0, 2, 0);
            await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
            regionMarked = true;
            const before = await readDisplayedLog();
            const logPath = path.join(root, ".vscode", ".weauditdaylog");
            const savedLog = fs.readFileSync(logPath, "utf8");

            fs.unlinkSync(missing);
            const after = await readDisplayedLog();
            assert.strictEqual(after.daily, before.daily - 4);
            assert.strictEqual(after.total, before.total - 4);
            assert.ok(after.text.includes(`${path.relative(root, missing)}; excluded from LOC counts.`), after.text);
            assert.ok(after.text.includes(`Daily LOC: ${after.daily} (incomplete)`), after.text);
            assert.ok(after.text.includes(`Total LOC: ${after.total} (incomplete)`), after.text);
            assert.ok(after.text.includes(path.relative(root, present)), after.text);
            assert.ok(after.text.includes(`${path.relative(root, region)} (lines 1–2)`), after.text);
            assert.strictEqual(fs.readFileSync(logPath, "utf8"), savedLog);

            fs.writeFileSync(missing, content);
            const restored = await readDisplayedLog();
            assert.strictEqual(restored.text, before.text);
        } finally {
            // Restore the deleted file before toggling its review status off.
            fs.writeFileSync(missing, content);
            for (const file of markedFiles) {
                await vscode.window.showTextDocument(vscode.Uri.file(file));
                await vscode.commands.executeCommand("weAudit.toggleAudited");
            }
            if (regionMarked) {
                const editor = await vscode.window.showTextDocument(vscode.Uri.file(region));
                editor.selection = new vscode.Selection(0, 0, 2, 0);
                await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
            }
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            // Windows can retain file handles briefly after editors close.
            await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
    });

    test("same relative paths in separate roots contribute independently to the daily log", async () => {
        await vscode.extensions.getExtension("trailofbits.weaudit")?.activate();
        const existingRoots = vscode.workspace.workspaceFolders!;
        const lastExistingRoot = existingRoots[existingRoots.length - 1].uri.fsPath;
        const temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "weaudit-daylog-")));
        const roots = [path.join(temporaryDirectory, "project-a"), path.join(temporaryDirectory, "project-b")];
        const relativePath = path.join("src", "shared.ts");
        for (const root of roots) {
            fs.mkdirSync(path.join(root, "src"), { recursive: true });
            fs.writeFileSync(path.join(root, relativePath), "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");
        }

        /** Wait for the extension's asynchronous workspace-root updates to finish. */
        async function waitForNextRoot(expectedRoot: string): Promise<void> {
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                if ((await vscode.commands.executeCommand("weAudit.nextRoot", lastExistingRoot, true)) === expectedRoot) {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            assert.fail(
                `The extension did not finish updating workspace roots: expected ${expectedRoot}, got ${String(await vscode.commands.executeCommand("weAudit.nextRoot", lastExistingRoot, true))}`,
            );
        }

        /** Toggle the first lines of the identically named file in the specified root. */
        async function toggleRegion(root: string, lines: number): Promise<void> {
            const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, relativePath)));
            editor.selection = new vscode.Selection(0, 0, lines, 0);
            await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        }

        try {
            assert.ok(vscode.workspace.updateWorkspaceFolders(existingRoots.length, 0, ...roots.map((root) => ({ uri: vscode.Uri.file(root) }))));
            await waitForNextRoot(roots[0]);
            await toggleRegion(roots[0], 2);
            const first = await readDisplayedLog();
            await toggleRegion(roots[1], 3);
            const both = await readDisplayedLog();
            assert.ok(both.text.includes(`${path.join("project-a", relativePath)} (lines 1–2)`), both.text);
            assert.ok(both.text.includes(`${path.join("project-b", relativePath)} (lines 1–3)`), both.text);
            assert.strictEqual(both.daily, first.daily + 3);
            assert.strictEqual(both.total, first.total + 3);

            const secondLogPath = path.join(roots[1], ".vscode", ".weauditdaylog");
            const secondLogBefore = fs.readFileSync(secondLogPath, "utf8");
            const secondLog = new Map(JSON.parse(secondLogBefore) as [string, unknown[]][]);
            assert.deepStrictEqual(secondLog.get(new Date().toDateString()), [{ path: relativePath, startLine: 0, endLine: 2 }]);

            await toggleRegion(roots[0], 2);
            const remaining = await readDisplayedLog();
            assert.ok(!remaining.text.includes(path.join("project-a", relativePath)), remaining.text);
            assert.ok(remaining.text.includes(`${path.join("project-b", relativePath)} (lines 1–3)`), remaining.text);
            assert.strictEqual(remaining.daily, both.daily - 2);
            assert.strictEqual(remaining.total, both.total - 2);
            assert.strictEqual(fs.readFileSync(secondLogPath, "utf8"), secondLogBefore);
        } finally {
            const firstAddedIndex = vscode.workspace.workspaceFolders?.findIndex((folder) => folder.uri.fsPath === roots[0]) ?? -1;
            if (firstAddedIndex !== -1) {
                assert.ok(vscode.workspace.updateWorkspaceFolders(firstAddedIndex, roots.length));
                await waitForNextRoot(existingRoots[0].uri.fsPath);
            }
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            // Retry transient Windows cleanup errors without blocking pending filesystem work.
            await fs.promises.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
    });
});
