import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildDocDecorations } from "../../src/docOverlay/decorations";
import { DocStore } from "../../src/docOverlay/docStore";
import { buildPrompt, detectClaudeBinary, parseEntries } from "../../src/docOverlay/agentRunner";
import { DocOverlayHoverProvider } from "../../src/docOverlay/hoverProvider";
import { isValidDocEntry } from "../../src/docOverlay/types";
import type { DocEntry, DocSessionData } from "../../src/docOverlay/types";

// ---------------------------------------------------------------------------
// Minimal VS Code mock
// Intercepts lazy require("vscode") calls that happen inside production code
// running outside a VS Code host (e.g. parseEntries warnings, hoverProvider).
// ---------------------------------------------------------------------------

const fakeVscode = {
    window: {
        showWarningMessage: (..._args: unknown[]) => Promise.resolve(undefined),
        showErrorMessage: (..._args: unknown[]) => Promise.resolve(undefined),
    },
    workspace: {
        getConfiguration: (_section: string) => ({
            get: (_key: string, defaultValue: unknown) => defaultValue,
        }),
    },
    MarkdownString: class {
        isTrusted = false;
        supportHtml = false;
        value = "";
        appendMarkdown(s: string): this {
            this.value += s;
            return this;
        }
    },
    Hover: class {
        constructor(public contents: unknown) {}
    },
};

// Install the mock before any tests run so all lazy require("vscode") calls
// in production code return fakeVscode instead of throwing.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const NodeModule = require("module") as { _load: (...args: unknown[]) => unknown };
const _originalLoad = NodeModule._load.bind(NodeModule);
NodeModule._load = function (request: string, ...args: unknown[]): unknown {
    if (request === "vscode") return fakeVscode;
    return _originalLoad(request, ...args);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<DocEntry> = {}): DocEntry {
    return {
        type: "function",
        path: "src/foo.ts",
        startLine: 0,
        endLine: 5,
        functionName: "myFunc",
        summary: "Does something useful.",
        fullDoc: "## myFunc\n\nDoes something.",
        generatedAt: new Date().toISOString(),
        skill: "test-skill",
        ...overrides,
    };
}

function makeSessionData(entries: DocEntry[] = []): DocSessionData {
    return {
        version: 1,
        skill: "test-skill",
        targetDirectory: "src",
        generatedAt: new Date().toISOString(),
        workspaceRoot: "/tmp/ws",
        entries,
    };
}

// ---------------------------------------------------------------------------
// isValidDocEntry
// ---------------------------------------------------------------------------

describe("isValidDocEntry", () => {
    it("accepts a fully valid function entry", () => {
        assert.strictEqual(isValidDocEntry(makeEntry()), true);
    });

    it("accepts a file-type entry without functionName", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ type: "file", functionName: undefined })), true);
    });

    it("accepts a region entry", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ type: "region", functionName: undefined })), true);
    });

    it("rejects null", () => {
        assert.strictEqual(isValidDocEntry(null), false);
    });

    it("rejects non-object", () => {
        assert.strictEqual(isValidDocEntry("string"), false);
        assert.strictEqual(isValidDocEntry(42), false);
    });

    it("rejects missing path", () => {
        const e = makeEntry() as unknown as Record<string, unknown>;
        delete e["path"];
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects empty path", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ path: "" })), false);
    });

    it("rejects invalid type", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ type: "module" as DocEntry["type"] })), false);
    });

    it("rejects negative startLine", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ startLine: -1 })), false);
    });

    it("rejects endLine < startLine", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ startLine: 10, endLine: 5 })), false);
    });

    it("rejects missing summary", () => {
        const e = makeEntry() as unknown as Record<string, unknown>;
        delete e["summary"];
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects empty summary", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ summary: "" })), false);
    });

    it("rejects missing fullDoc", () => {
        const e = makeEntry() as unknown as Record<string, unknown>;
        delete e["fullDoc"];
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects numeric functionName", () => {
        const e = { ...makeEntry(), functionName: 123 } as unknown;
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("accepts undefined functionName", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ functionName: undefined })), true);
    });

    it("accepts string functionName", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ functionName: "foo" })), true);
    });
});

// ---------------------------------------------------------------------------
// DocStore — persist / load round-trip (fs-only, no VS Code host needed)
// ---------------------------------------------------------------------------

describe("DocStore", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weaudit-docstore-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns empty array when weaudit-docs/ does not exist", () => {
        const store = new DocStore(tmpDir);
        const sessions = store.loadAllSessions();
        assert.deepStrictEqual(sessions, []);
    });

    it("round-trips a session through persistSession / loadAllSessions", () => {
        const store = new DocStore(tmpDir);
        const entry = makeEntry({ path: "src/hello.ts" });
        const data = makeSessionData([entry]);
        data.workspaceRoot = tmpDir;

        store.persistSession(data);
        const loaded = store.loadAllSessions();

        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0]?.skill, "test-skill");
        assert.strictEqual(loaded[0]?.entries.length, 1);
        assert.strictEqual(loaded[0]?.entries[0]?.path, "src/hello.ts");
    });

    it("persists sessions for different targets and loads all of them", () => {
        const store = new DocStore(tmpDir);
        const dataA = makeSessionData([makeEntry({ path: "a.ts" })]);
        dataA.targetDirectory = "src/moduleA";
        const dataB = makeSessionData([makeEntry({ path: "b.ts" })]);
        dataB.targetDirectory = "src/moduleB";
        store.persistSession(dataA);
        store.persistSession(dataB);

        const loaded = store.loadAllSessions();
        assert.strictEqual(loaded.length, 2);
    });

    it("overwrites an existing session when persisting the same target directory", () => {
        const store = new DocStore(tmpDir);
        const first = makeSessionData([makeEntry({ path: "old.ts" })]);
        const second = makeSessionData([makeEntry({ path: "new.ts" })]);

        store.persistSession(first);
        store.persistSession(second);

        const loaded = store.loadAllSessions();
        assert.strictEqual(loaded.length, 1);
        assert.strictEqual(loaded[0]?.entries[0]?.path, "new.ts");
    });

    it("clearAllSessions removes the weaudit-docs directory", () => {
        const store = new DocStore(tmpDir);
        store.persistSession(makeSessionData([makeEntry()]));

        const docsDir = path.join(tmpDir, "weaudit-docs");
        assert.ok(fs.existsSync(docsDir), "weaudit-docs should exist before clear");

        store.clearAllSessions();
        assert.ok(!fs.existsSync(docsDir), "weaudit-docs should be gone after clear");
    });

    it("clearAllSessions is a no-op when weaudit-docs/ does not exist", () => {
        const store = new DocStore(tmpDir);
        // Should not throw.
        store.clearAllSessions();
    });

    it("skips corrupted sessions without throwing", () => {
        const store = new DocStore(tmpDir);
        // Write a valid session first.
        store.persistSession(makeSessionData([makeEntry()]));

        // Write a corrupted session directory.
        const badDir = path.join(tmpDir, "weaudit-docs", "bad-session");
        fs.mkdirSync(badDir, { recursive: true });
        fs.writeFileSync(path.join(badDir, "metadata.json"), "not json");
        fs.writeFileSync(path.join(badDir, "entries.json"), "not json");

        const loaded = store.loadAllSessions();
        // Only the valid session should be loaded.
        assert.strictEqual(loaded.length, 1);
    });

    it("skips invalid entries within a valid session", () => {
        const store = new DocStore(tmpDir);
        const sessionDir = store.persistSession(makeSessionData([makeEntry()]));

        // Overwrite entries.json with one valid and one invalid entry.
        const entriesPath = path.join(sessionDir, "entries.json");
        const invalid = { type: "function" }; // missing required fields
        fs.writeFileSync(entriesPath, JSON.stringify([makeEntry({ path: "good.ts" }), invalid]), "utf-8");

        const loaded = store.loadAllSessions();
        assert.strictEqual(loaded[0]?.entries.length, 1);
        assert.strictEqual(loaded[0]?.entries[0]?.path, "good.ts");
    });
});

// ---------------------------------------------------------------------------
// buildDocDecorations (pure structure check — no VS Code runtime needed)
// ---------------------------------------------------------------------------

describe("buildDocDecorations", () => {
    const workspaceRoot = "/workspace";

    it("returns empty array when no entries match the file", () => {
        const entries: DocEntry[] = [makeEntry({ path: "src/other.ts" })];
        const result = buildDocDecorations(entries, "/workspace/src/main.ts", workspaceRoot);
        assert.strictEqual(result.length, 0);
    });

    it("returns one decoration per matching entry", () => {
        const entries: DocEntry[] = [
            makeEntry({ path: "src/main.ts", startLine: 0 }),
            makeEntry({ path: "src/main.ts", startLine: 10 }),
            makeEntry({ path: "src/other.ts", startLine: 5 }),
        ];
        const result = buildDocDecorations(entries, "/workspace/src/main.ts", workspaceRoot);
        assert.strictEqual(result.length, 2);
    });

    it("sets the decoration range to the entry startLine", () => {
        const entry = makeEntry({ path: "src/main.ts", startLine: 7 });
        const result = buildDocDecorations([entry], "/workspace/src/main.ts", workspaceRoot);
        assert.strictEqual(result.length, 1);
        // The range is a plain object with start/end because we avoid new vscode.Range in unit-test context.
        const range = result[0]?.range as unknown as { start: { line: number } };
        assert.strictEqual(range.start.line, 7);
    });

    it("includes functionName in ghost text when present", () => {
        const entry = makeEntry({ path: "src/main.ts", functionName: "doWork", summary: "Works." });
        const result = buildDocDecorations([entry], "/workspace/src/main.ts", workspaceRoot);
        const opts = result[0] as { renderOptions?: { dark?: { after?: { contentText?: string } } } };
        const contentText = opts.renderOptions?.dark?.after?.contentText ?? "";
        assert.ok(contentText.includes("doWork"), `Expected "doWork" in "${contentText}"`);
    });

    it("shows only summary when functionName is absent", () => {
        const entry = makeEntry({ path: "src/main.ts", functionName: undefined, summary: "Just a region." });
        const result = buildDocDecorations([entry], "/workspace/src/main.ts", workspaceRoot);
        const opts = result[0] as { renderOptions?: { dark?: { after?: { contentText?: string } } } };
        const contentText = opts.renderOptions?.dark?.after?.contentText ?? "";
        assert.ok(contentText.includes("Just\u00a0a\u00a0region"), `Expected summary in "${contentText}"`);
    });

    it("resolves absolute entry paths", () => {
        const entry = makeEntry({ path: "/workspace/src/main.ts" });
        const result = buildDocDecorations([entry], "/workspace/src/main.ts", workspaceRoot);
        assert.strictEqual(result.length, 1);
    });
});

// ---------------------------------------------------------------------------
// isValidDocEntry — additional edge cases
// ---------------------------------------------------------------------------

describe("isValidDocEntry — additional edge cases", () => {
    it("rejects missing generatedAt", () => {
        const e = makeEntry() as unknown as Record<string, unknown>;
        delete e["generatedAt"];
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects non-string generatedAt", () => {
        const e = { ...makeEntry(), generatedAt: 12345 } as unknown;
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects missing skill", () => {
        const e = makeEntry() as unknown as Record<string, unknown>;
        delete e["skill"];
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects non-string skill", () => {
        const e = { ...makeEntry(), skill: true } as unknown;
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("rejects non-string fullDoc", () => {
        const e = { ...makeEntry(), fullDoc: [] } as unknown;
        assert.strictEqual(isValidDocEntry(e), false);
    });

    it("accepts equal startLine and endLine (single-line entry)", () => {
        assert.strictEqual(isValidDocEntry(makeEntry({ startLine: 5, endLine: 5 })), true);
    });
});

// ---------------------------------------------------------------------------
// parseEntries — JSON extraction and validation
// ---------------------------------------------------------------------------

describe("parseEntries", () => {
    it("returns empty array when response contains no JSON array", () => {
        const result = parseEntries("No JSON here.");
        assert.deepStrictEqual(result, []);
    });

    it("returns empty array when JSON array is malformed", () => {
        const result = parseEntries("[{broken json}]");
        assert.deepStrictEqual(result, []);
    });

    it("returns validated entries from a well-formed JSON array", () => {
        const entry = makeEntry({ path: "src/parsed.ts" });
        const result = parseEntries(JSON.stringify([entry]));
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0]?.path, "src/parsed.ts");
    });

    it("filters out invalid entries and keeps valid ones", () => {
        const valid = makeEntry({ path: "src/good.ts" });
        const invalid = { type: "function" }; // missing required fields
        const result = parseEntries(JSON.stringify([valid, invalid]));
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0]?.path, "src/good.ts");
    });

    it("extracts JSON array even when surrounded by extra text", () => {
        const entry = makeEntry({ path: "src/surrounded.ts" });
        const response = `Here is the output:\n${JSON.stringify([entry])}\nEnd of output.`;
        const result = parseEntries(response);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0]?.path, "src/surrounded.ts");
    });

    it("returns empty array for an empty JSON array", () => {
        const result = parseEntries("[]");
        assert.deepStrictEqual(result, []);
    });
});

// ---------------------------------------------------------------------------
// buildPrompt — prompt structure
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
    const skillName = "my-skill";
    const targetDir = "/repo/src/module";
    const workspaceRoot = "/repo";

    it("starts with the skill slash-command", () => {
        const prompt = buildPrompt(skillName, targetDir, workspaceRoot);
        assert.ok(prompt.startsWith(`/${skillName} `), `Expected prompt to start with /${skillName}`);
    });

    it("contains the target directory", () => {
        const prompt = buildPrompt(skillName, targetDir, workspaceRoot);
        assert.ok(prompt.includes(targetDir), "Expected prompt to include targetDir");
    });

    it("contains the workspace root", () => {
        const prompt = buildPrompt(skillName, targetDir, workspaceRoot);
        assert.ok(prompt.includes(workspaceRoot), "Expected prompt to include workspaceRoot");
    });

    it("contains the JSON schema fields", () => {
        const prompt = buildPrompt(skillName, targetDir, workspaceRoot);
        for (const field of ["type", "path", "startLine", "endLine", "summary", "fullDoc", "generatedAt", "skill"]) {
            assert.ok(prompt.includes(`"${field}"`), `Expected prompt to include schema field "${field}"`);
        }
    });
});

// ---------------------------------------------------------------------------
// detectClaudeBinary — binary location detection
// ---------------------------------------------------------------------------

describe("detectClaudeBinary", () => {
    let tmpDir: string;
    // Keep a reference to the original mock so tests can temporarily override it.
    const originalGetConfiguration = fakeVscode.workspace.getConfiguration;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weaudit-bin-test-"));
        fakeVscode.workspace.getConfiguration = originalGetConfiguration;
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fakeVscode.workspace.getConfiguration = originalGetConfiguration;
    });

    it("returns the VS Code claude-code config path when it exists on disk", () => {
        const binPath = path.join(tmpDir, "claude");
        fs.writeFileSync(binPath, "");
        fakeVscode.workspace.getConfiguration = (_section: string) => ({
            get: (key: string, defaultValue: unknown) => (key === "binaryPath" ? binPath : defaultValue),
        });
        assert.strictEqual(detectClaudeBinary(), binPath);
    });

    it("skips the VS Code claude-code config path when it does not exist on disk", () => {
        const nonExistentPath = path.join(tmpDir, "nonexistent-claude");
        fakeVscode.workspace.getConfiguration = (_section: string) => ({
            get: (key: string, defaultValue: unknown) => (key === "binaryPath" ? nonExistentPath : defaultValue),
        });
        const result = detectClaudeBinary();
        assert.notStrictEqual(result, nonExistentPath);
    });

    it("always returns a string", () => {
        assert.strictEqual(typeof detectClaudeBinary(), "string");
    });
});

// ---------------------------------------------------------------------------
// DocOverlayHoverProvider — entry matching and hover content
// ---------------------------------------------------------------------------

describe("DocOverlayHoverProvider", () => {
    const workspaceRoot = "/workspace";

    /** Minimal vscode.TextDocument stub. */
    function makeDoc(fsPath: string) {
        return { uri: { fsPath } };
    }

    /** Minimal vscode.Position stub. */
    function makePos(line: number) {
        return { line };
    }

    it("returns undefined when the entries list is empty", () => {
        const provider = new DocOverlayHoverProvider(() => [], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(3) as never);
        assert.strictEqual(result, undefined);
    });

    it("returns undefined when entries exist for a different file", () => {
        const provider = new DocOverlayHoverProvider(() => [makeEntry({ path: "src/other.ts" })], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(0) as never);
        assert.strictEqual(result, undefined);
    });

    it("returns undefined when cursor line is before the entry startLine", () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 10, endLine: 20 });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(9) as never);
        assert.strictEqual(result, undefined);
    });

    it("returns undefined when cursor line is after the entry endLine", () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 10, endLine: 20 });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(21) as never);
        assert.strictEqual(result, undefined);
    });

    it("returns a hover when cursor is on the startLine", () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 5, endLine: 15 });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(5) as never);
        assert.ok(result !== undefined, "Expected a hover");
    });

    it("returns a hover when cursor is on the endLine", () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 5, endLine: 15 });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(15) as never);
        assert.ok(result !== undefined, "Expected a hover");
    });

    it("includes fullDoc content from all matching entries", () => {
        const entries = [
            makeEntry({ path: "src/foo.ts", startLine: 0, endLine: 10, fullDoc: "Doc for alpha." }),
            makeEntry({ path: "src/foo.ts", startLine: 5, endLine: 15, fullDoc: "Doc for beta." }),
        ];
        const provider = new DocOverlayHoverProvider(() => entries, workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(7) as never);
        assert.ok(result !== undefined, "Expected a hover");
        const md = (result as { contents: { value: string } }).contents;
        assert.ok(md.value.includes("Doc for alpha."), "Expected first entry fullDoc in hover");
        assert.ok(md.value.includes("Doc for beta."), "Expected second entry fullDoc in hover");
    });

    it("uses functionName as the section header when present", () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 0, endLine: 5, functionName: "myFunc" });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(2) as never);
        const md = (result as { contents: { value: string } }).contents;
        assert.ok(md.value.includes("### myFunc"), `Expected "### myFunc" header in hover`);
    });

    it('uses "File" as header for file entries without functionName', () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 0, endLine: 5, type: "file", functionName: undefined });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(0) as never);
        const md = (result as { contents: { value: string } }).contents;
        assert.ok(md.value.includes("### File"), `Expected "### File" header in hover`);
    });

    it("file entries only show a hover on line 0", () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 0, endLine: 100, type: "file", functionName: undefined });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        assert.ok(provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(0) as never) !== undefined, "Expected hover on line 0");
        assert.strictEqual(provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(1) as never), undefined, "Expected no hover on line 1");
        assert.strictEqual(provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(50) as never), undefined, "Expected no hover on line 50");
    });

    it('uses "Region" as header for region entries without functionName', () => {
        const entry = makeEntry({ path: "src/foo.ts", startLine: 0, endLine: 5, type: "region", functionName: undefined });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(2) as never);
        const md = (result as { contents: { value: string } }).contents;
        assert.ok(md.value.includes("### Region"), `Expected "### Region" header in hover`);
    });

    it("resolves absolute entry paths", () => {
        const entry = makeEntry({ path: "/workspace/src/foo.ts", startLine: 0, endLine: 5 });
        const provider = new DocOverlayHoverProvider(() => [entry], workspaceRoot);
        const result = provider.provideHover(makeDoc("/workspace/src/foo.ts") as never, makePos(2) as never);
        assert.ok(result !== undefined, "Expected a hover for absolute path entry");
    });
});
