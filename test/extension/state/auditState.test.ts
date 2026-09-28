import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { tmpdir, userInfo } from "os";
import * as vscode from "vscode";

interface Finding {
    label: string;
    entryType: number;
    author: string;
    details: { severity: string; difficulty: string; type: string; description: string; exploit: string; recommendation: string };
    locations: { path: string; startLine: number; endLine: number; label: string; description: string; rootPath?: string }[];
}

interface SavedData {
    treeEntries: Finding[];
    resolvedEntries: Finding[];
    auditedFiles: { path: string; author: string }[];
    partiallyAuditedFiles: { path: string; author: string; startLine: number; endLine: number }[];
}

/** Retry assertions while command-triggered persistence and workspace updates finish. */
async function eventually(check: () => void | Promise<void>): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
        try {
            await check();
            return;
        } catch (error) {
            if (Date.now() >= deadline) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
}

// Run in a separate extension host: bulk lifecycle commands affect every loaded root.
suite("Audit state persistence", () => {
    let root: string;
    let username: string;
    let previousRoot: string;
    let firstRoot: string;

    suiteSetup(async () => {
        await vscode.extensions.getExtension("trailofbits.weaudit")!.activate();
        username = vscode.workspace.getConfiguration("weAudit").get<string>("general.username") || userInfo().username;
    });

    setup(async () => {
        const folders = vscode.workspace.workspaceFolders!;
        firstRoot = folders[0].uri.fsPath;
        previousRoot = folders[folders.length - 1].uri.fsPath;
        root = vscode.Uri.file(fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "weaudit-state-")))).fsPath;
        for (const file of ["sample.ts", "other.ts"]) {
            fs.writeFileSync(path.join(root, file), Array.from({ length: 20 }, (_, i) => `const line${i} = ${i};\n`).join(""));
        }
        assert.ok(vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(root) }));
        await eventually(async () => {
            assert.strictEqual(await vscode.commands.executeCommand("weAudit.nextRoot", previousRoot, true), root);
        });
    });

    teardown(async () => {
        const index = vscode.workspace.workspaceFolders?.findIndex((folder) => folder.uri.fsPath === root) ?? -1;
        if (index !== -1) {
            assert.ok(vscode.workspace.updateWorkspaceFolders(index, 1));
            await eventually(async () => {
                assert.strictEqual(await vscode.commands.executeCommand("weAudit.nextRoot", previousRoot, true), firstRoot);
            });
        }
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });

    function saved(author = username): SavedData {
        return JSON.parse(fs.readFileSync(path.join(root, ".vscode", `${author}.weaudit`), "utf8")) as SavedData;
    }

    async function select(start: number, end: number, endCharacter = 1, file = "sample.ts"): Promise<void> {
        const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, file)));
        editor.selection = new vscode.Selection(start, 0, end, endCharacter);
    }

    async function toggleRegion(start: number, end: number, file = "sample.ts"): Promise<void> {
        await select(start, end, 1, file);
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
    }

    async function assertRegions(ranges: number[][], file = "sample.ts"): Promise<void> {
        await eventually(() => {
            assert.deepStrictEqual(
                saved().partiallyAuditedFiles.filter((region) => region.path === file),
                ranges.map(([startLine, endLine]) => ({ path: file, author: username, startLine, endLine })),
            );
        });
    }

    for (const scenario of [
        {
            name: "merges overlaps",
            selections: [
                [2, 6],
                [5, 9],
            ],
            expected: [[2, 9]],
        },
        {
            name: "merges adjacent regions selected in reverse order",
            selections: [
                [8, 10],
                [5, 7],
            ],
            expected: [[5, 10]],
        },
        {
            name: "merges a selection bridging two regions",
            selections: [
                [2, 4],
                [8, 10],
                [5, 7],
            ],
            expected: [[2, 10]],
        },
        {
            name: "extends a region when the selection contains it",
            selections: [
                [4, 6],
                [2, 8],
            ],
            expected: [[2, 8]],
        },
        {
            name: "keeps disjoint regions separate",
            selections: [
                [2, 4],
                [8, 10],
            ],
            expected: [
                [2, 4],
                [8, 10],
            ],
        },
        {
            name: "removes an exact match",
            selections: [
                [2, 10],
                [2, 10],
            ],
            expected: [],
        },
        {
            name: "trims the beginning of a region",
            selections: [
                [2, 10],
                [2, 5],
            ],
            expected: [[6, 10]],
        },
        {
            name: "trims the end of a region",
            selections: [
                [2, 10],
                [7, 10],
            ],
            expected: [[2, 6]],
        },
        {
            name: "splits a region around a deselected middle",
            selections: [
                [2, 10],
                [5, 7],
            ],
            expected: [
                [2, 4],
                [8, 10],
            ],
        },
    ]) {
        test(`partial review ${scenario.name}`, async () => {
            for (const [start, end] of scenario.selections) {
                await toggleRegion(start, end);
            }
            await assertRegions(scenario.expected);
        });
    }

    test("partial reviews in different files remain independent", async () => {
        await toggleRegion(2, 6);
        await toggleRegion(2, 6, "other.ts");
        await toggleRegion(4, 8);
        await assertRegions([[2, 8]]);
        await assertRegions([[2, 6]], "other.ts");
        assert.strictEqual(saved().partiallyAuditedFiles.length, 2);
    });

    test("multiple selections persist their exact regions", async () => {
        await select(2, 4);
        vscode.window.activeTextEditor!.selections = [new vscode.Selection(8, 0, 10, 1), new vscode.Selection(2, 0, 4, 1)];
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        await assertRegions([
            [2, 4],
            [8, 10],
        ]);
    });

    test("a selection ending at column zero excludes the following line", async () => {
        await select(2, 6, 0);
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        await assertRegions([[2, 5]]);
    });

    test("a cursor-only selection still reviews one line", async () => {
        await select(4, 4, 0);
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        await assertRegions([[4, 4]]);
    });

    test("an empty final line never produces a range ending before its start", async () => {
        await select(20, 20, 0);
        await vscode.commands.executeCommand("weAudit.addPartiallyAudited");
        await assertRegions([[20, 20]]);
    });

    test("whole-file review clears partial regions and prevents new partial reviews", async () => {
        await toggleRegion(2, 5);
        await vscode.commands.executeCommand("weAudit.toggleAudited");
        await eventually(() => assert.deepStrictEqual(saved().auditedFiles, [{ path: "sample.ts", author: username }]));
        await assertRegions([]);
        await toggleRegion(8, 10);
        await assertRegions([]);
        await vscode.commands.executeCommand("weAudit.toggleAudited");
        await eventually(() => assert.deepStrictEqual(saved().auditedFiles, []));
        await assertRegions([]);
    });

    function finding(label: string, author = username): Finding {
        return {
            label,
            author,
            entryType: 0,
            details: { severity: "High", difficulty: "Low", type: "Data Validation", description: "Description", exploit: "Exploit", recommendation: "Fix" },
            locations: [{ path: "sample.ts", startLine: 2, endLine: 5, label: "Main location", description: "Location context" }],
        };
    }

    /** Import through the public command, which accepts absolute paths from other extensions. */
    async function load(entries: Finding[]): Promise<void> {
        await vscode.commands.executeCommand(
            "weAudit.externallyLoadFindings",
            entries.map((entry) => ({ ...entry, locations: entry.locations.map((location) => ({ ...location, path: path.join(root, location.path) })) })),
        );
        for (const author of new Set(entries.map((entry) => entry.author))) {
            await assertSaved(
                entries.filter((entry) => entry.author === author),
                [],
                author,
            );
        }
    }

    async function currentEntries(author = username): Promise<[Finding[], Finding[]]> {
        return (await vscode.commands.executeCommand<[Finding[], Finding[]]>("weAudit.getFilteredEntriesForSaving", author, { rootPath: root }))!;
    }

    /** Check complete persisted entries, including details, location metadata and list order. */
    async function assertSaved(active: Finding[], resolved: Finding[], author = username): Promise<void> {
        await eventually(() => {
            assert.deepStrictEqual(saved(author).treeEntries, active);
            assert.deepStrictEqual(saved(author).resolvedEntries, resolved);
        });
    }

    test("resolve and restore move the complete finding between lists and survive reloading", async () => {
        const target = finding("Target");
        const other = finding("Other");
        await load([target, other]);
        const [[entry]] = await currentEntries();
        await vscode.commands.executeCommand("weAudit.resolveFinding", entry);
        await assertSaved([other], [target]);
        let [active, resolved] = await currentEntries();
        assert.deepStrictEqual(
            active.map((item) => item.label),
            ["Other"],
        );
        assert.deepStrictEqual(
            resolved.map((item) => item.label),
            ["Target"],
        );

        await vscode.commands.executeCommand("weAudit.restoreFinding", resolved[0]);
        await assertSaved([other, target], []);
        [active, resolved] = await currentEntries();
        assert.deepStrictEqual(
            active.map((item) => item.label),
            ["Other", "Target"],
        );
        assert.deepStrictEqual(resolved, []);

        const config = { path: path.join(root, ".vscode", `${username}.weaudit`), username, root: { label: path.basename(root) } };
        await vscode.commands.executeCommand("weAudit.toggleSavedFindings", config);
        assert.deepStrictEqual(await currentEntries(), [[], []]);
        await vscode.commands.executeCommand("weAudit.toggleSavedFindings", config);
        [active, resolved] = await currentEntries();
        assert.deepStrictEqual(
            active,
            [other, target].map((item) => ({ ...item, locations: item.locations.map((location) => ({ ...location, rootPath: root })) })),
        );
        assert.deepStrictEqual(resolved, []);
        await assertSaved([other, target], []);
    });

    test("deleting an active finding preserves other active and resolved findings", async () => {
        const target = finding("Target");
        const other = finding("Other");
        const resolved = finding("Resolved");
        await load([target, other, resolved]);
        const [[targetEntry, , resolvedEntry]] = await currentEntries();
        await vscode.commands.executeCommand("weAudit.resolveFinding", resolvedEntry);
        await assertSaved([target, other], [resolved]);
        await vscode.commands.executeCommand("weAudit.deleteFinding", targetEntry);
        await assertSaved([other], [resolved]);
    });

    test("deleting one resolved finding preserves the others and the active list", async () => {
        const active = finding("Active");
        const first = finding("First resolved");
        const second = finding("Second resolved");
        await load([active, first, second]);
        const [[, firstEntry, secondEntry]] = await currentEntries();
        await vscode.commands.executeCommand("weAudit.resolveFinding", firstEntry);
        await vscode.commands.executeCommand("weAudit.resolveFinding", secondEntry);
        await assertSaved([active], [first, second]);
        await vscode.commands.executeCommand("weAudit.deleteResolvedFinding", firstEntry);
        await assertSaved([active], [second]);
    });

    for (const restore of [true, false]) {
        test(`${restore ? "restoring" : "deleting"} all resolved findings updates every affected author's file`, async () => {
            const otherAuthor = `${username}-other`;
            const active = finding("Active");
            const first = finding("First resolved");
            const second = finding("Second resolved");
            const foreign = finding("Other author's finding", otherAuthor);
            await load([active, first, second, foreign]);
            const [[, firstEntry, secondEntry]] = await currentEntries();
            const [[foreignEntry]] = await currentEntries(otherAuthor);
            for (const entry of [firstEntry, secondEntry, foreignEntry]) {
                await vscode.commands.executeCommand("weAudit.resolveFinding", entry);
            }
            await assertSaved([active], [first, second]);
            await assertSaved([], [foreign], otherAuthor);
            await vscode.commands.executeCommand(restore ? "weAudit.restoreAllResolvedFindings" : "weAudit.deleteAllResolvedFinding");
            await assertSaved(restore ? [active, first, second] : [active], []);
            await assertSaved(restore ? [foreign] : [], [], otherAuthor);
            assert.deepStrictEqual((await currentEntries())[1], []);
            assert.deepStrictEqual((await currentEntries(otherAuthor))[1], []);
        });
    }

    test("deleting locations preserves the remaining location, then deletes the empty finding", async () => {
        const target = finding("Two locations");
        target.locations.push({ path: "other.ts", startLine: 8, endLine: 10, label: "Second", description: "Keep this context" });
        const other = finding("Other");
        await load([target, other]);
        const [[parent]] = await currentEntries();
        await vscode.commands.executeCommand("weAudit.deleteLocation", { parentEntry: parent, location: parent.locations[0] });
        await assertSaved([{ ...target, locations: [target.locations[1]] }, other], []);
        await vscode.commands.executeCommand("weAudit.deleteLocation", { parentEntry: parent, location: parent.locations[0] });
        await assertSaved([other], []);
        assert.deepStrictEqual(
            (await currentEntries())[0].map((entry) => entry.label),
            ["Other"],
        );
    });
});
