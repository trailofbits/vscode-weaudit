import { expect } from "chai";
import { InputBox, Workbench, EditorView, ActivityBar, TextEditor, VSBrowser } from "vscode-extension-tester";
import { Key } from "selenium-webdriver";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";

interface SerializedEntry {
    label: string;
    entryType: number;
    locations: Array<{ path: string; startLine: number; endLine: number }>;
}

interface SerializedData {
    treeEntries: SerializedEntry[];
}

interface LineRange {
    start: number;
    end: number;
}

const SAMPLE_WORKSPACE = path.resolve(__dirname, "../../../../test/extension/fixtures/sample-workspace");
const SAMPLE_FILE = path.join(SAMPLE_WORKSPACE, "src", "sample.ts");
const SAMPLE_FILE_BASENAME = path.basename(SAMPLE_FILE);
const WORKSPACE_VSCODE_DIR = path.join(SAMPLE_WORKSPACE, ".vscode");
const CURRENT_USERNAME = userInfo().username;
const WEAUDIT_FILE = path.join(WORKSPACE_VSCODE_DIR, `${CURRENT_USERNAME}.weaudit`);
const DAY_LOG_FILE = path.join(WORKSPACE_VSCODE_DIR, ".weauditdaylog");

const DEFAULT_FINDING_RANGE: LineRange = { start: 5, end: 7 };
const SECONDARY_RANGE: LineRange = { start: 11, end: 13 };

/**
 * Deletes a file if it exists to keep the workspace clean between tests.
 */
async function removeIfExists(target: string): Promise<void> {
    if (fs.existsSync(target)) {
        await fs.promises.unlink(target);
    }
}

/**
 * Clears persisted state and asks the extension to reload data.
 */
async function resetWorkspaceState(_workbench: Workbench): Promise<void> {
    await fs.promises.mkdir(WORKSPACE_VSCODE_DIR, { recursive: true });
    await removeIfExists(WEAUDIT_FILE);
    await removeIfExists(DAY_LOG_FILE);
}

/**
 * Opens the sample file, using the file picker when needed.
 */
async function openSampleFile(): Promise<TextEditor> {
    const editorView = new EditorView();
    try {
        return (await editorView.openEditor(SAMPLE_FILE_BASENAME)) as TextEditor;
    } catch {
        await VSBrowser.instance.openResources(SAMPLE_FILE);
        await waitForCondition(
            async () => {
                try {
                    await editorView.openEditor(SAMPLE_FILE_BASENAME);
                    return true;
                } catch {
                    return false;
                }
            },
            10_000,
            200,
        );
        return (await editorView.openEditor(SAMPLE_FILE_BASENAME)) as TextEditor;
    }
}

/**
 * Selects a range of lines by moving the caret with Shift+Arrow.
 */
async function selectLines(startLine: number, endLine: number): Promise<TextEditor> {
    const editor = await openSampleFile();
    await editor.setCursor(startLine, 1);

    const clampedEndLine = Math.max(endLine, startLine);
    const downMoves = clampedEndLine - startLine + 1;
    for (let i = 0; i < downMoves; i++) {
        await editor.typeText(Key.chord(Key.SHIFT, Key.ARROW_DOWN));
    }
    return editor;
}

/**
 * Moves the caret to a single location, clearing any selection.
 */
async function moveCursorTo(line: number, column: number = 1): Promise<TextEditor> {
    const editor = await openSampleFile();
    await editor.setCursor(line, column);
    await VSBrowser.instance.driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform();
    return editor;
}

/**
 * Creates a finding via QuickInput and waits until it appears in the tree.
 */
async function createTestFinding(workbench: Workbench, title: string, range: LineRange = DEFAULT_FINDING_RANGE): Promise<void> {
    await selectLines(range.start, range.end);
    await workbench.executeCommand("weAudit: New Finding from Selection");
    const input = await InputBox.create();
    await input.setText(title);
    await input.confirm();
    await waitForCondition(async () => {
        const entries = await readSerializedEntries();
        return entries?.some((entry) => entry.label === title) ?? false;
    });
}

/**
 * Creates a note via QuickInput and waits until it appears in the tree.
 */
async function createTestNote(workbench: Workbench, title: string, range: LineRange = SECONDARY_RANGE): Promise<void> {
    await selectLines(range.start, range.end);
    await workbench.executeCommand("weAudit: New Note from Selection");
    const input = await InputBox.create();
    await input.setText(title);
    await input.confirm();
    await waitForCondition(async () => {
        const entries = await readSerializedEntries();
        return entries?.some((entry) => entry.label === title && entry.entryType === 1) ?? false;
    });
}

/**
 * Reads serialized entries from disk.
 */
async function readSerializedEntries(): Promise<SerializedEntry[] | undefined> {
    if (!fs.existsSync(WEAUDIT_FILE)) {
        return undefined;
    }
    const raw = await fs.promises.readFile(WEAUDIT_FILE, "utf-8");
    return (JSON.parse(raw) as SerializedData).treeEntries;
}

/**
 * Returns the visible labels from the weAudit tree view.
 */
async function getWeAuditTreeItems(workbench: Workbench): Promise<string[]> {
    const activityBar = new ActivityBar();
    const weAuditView = await activityBar.getViewControl("weAudit");
    await weAuditView?.openView();
    const sideBar = workbench.getSideBar();
    const content = sideBar.getContent();
    const section = await content.getSection("List of Findings");
    const items = await section.getVisibleItems();
    return Promise.all(items.map((item) => item.getText()));
}

/**
 * Polls a condition until true or timeout.
 */
async function waitForCondition(condition: () => Promise<boolean>, timeoutMs: number = 10_000, pollIntervalMs: number = 100): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (await condition()) {
            return true;
        }
        await VSBrowser.instance.driver.sleep(pollIntervalMs);
    }
    return condition();
}

describe("weAudit Command UI Tests", () => {
    let workbench: Workbench;

    before(async function () {
        workbench = new Workbench();
        await VSBrowser.instance.openResources(SAMPLE_WORKSPACE);
        await VSBrowser.instance.waitForWorkbench(60_000);
        await VSBrowser.instance.driver.sleep(3_000);
        await openSampleFile();
    });

    beforeEach(async function () {
        await resetWorkspaceState(workbench);
        await openSampleFile();
    });

    after(async function () {
        await resetWorkspaceState(workbench);
        const editorView = new EditorView();
        await editorView.closeAllEditors();
    });

    describe("Findings & Notes", () => {
        it("creates a finding with the provided title", async function () {
            const customTitle = `UI Finding ${Date.now()}`;
            await createTestFinding(workbench, customTitle);
            const entries = await readSerializedEntries();
            const containsCustomTitle = entries?.some((entry) => entry.label === customTitle) ?? false;
            expect(containsCustomTitle).to.equal(true);
        });

        it("creates a note with the provided title", async function () {
            const customTitle = `UI Note ${Date.now()}`;
            await createTestNote(workbench, customTitle);
            const entries = await readSerializedEntries();
            const containsCustomTitle = entries?.some((entry) => entry.label === customTitle && entry.entryType === 1) ?? false;
            expect(containsCustomTitle).to.equal(true);
        });

        it("does not create an entry when the input is cancelled", async function () {
            const beforeCount = (await readSerializedEntries())?.length ?? 0;
            await selectLines(SECONDARY_RANGE.start + 4, SECONDARY_RANGE.end + 4);
            await workbench.executeCommand("weAudit: New Finding from Selection");
            const input = await InputBox.create();
            await input.cancel();
            const unchanged = await waitForCondition(async () => {
                const afterCount = (await readSerializedEntries())?.length ?? 0;
                return afterCount === beforeCount;
            });
            expect(unchanged).to.equal(true);
        });
    });

    describe("Editing & multi-region commands", () => {
        it("edits the finding under the cursor", async function () {
            const originalTitle = `Editable Finding ${Date.now()}`;
            await createTestFinding(workbench, originalTitle, { start: 18, end: 19 });
            await moveCursorTo(18);
            await workbench.executeCommand("weAudit: Edit Finding Under Cursor");
            const input = await InputBox.create();
            const updatedTitle = `Edited Finding Title ${Date.now()}`;
            await input.setText(updatedTitle);
            await input.confirm();
            const updated = await waitForCondition(async () => {
                const entries = await readSerializedEntries();
                const hasUpdated = entries?.some((entry) => entry.label === updatedTitle) ?? false;
                const hasOriginal = entries?.some((entry) => entry.label === originalTitle) ?? false;
                return hasUpdated && !hasOriginal;
            });
            expect(updated).to.equal(true);
        });

        // still broken
        // it("adds an additional region using the quick pick", async function () {
        //     const title = `Multi-region Finding ${Date.now()}`;
        //     await createTestFinding(workbench, title, DEFAULT_FINDING_RANGE);
        //     await selectLines(20, 22);
        //     await workbench.executeCommand("weAudit: Add Region to a Finding");

        //     const picker = await InputBox.create();
        //     await picker.selectQuickPick(title);
        //     await picker.confirm();

        //     const hasSecondRegion = await waitForCondition(async () => {
        //         const entries = await readSerializedEntries();
        //         const entry = entries?.find((candidate) => candidate.label === title);
        //         return (entry?.locations.length ?? 0) === 2;
        //     });
        //     expect(hasSecondRegion).to.equal(true);
        // });
    });
});
