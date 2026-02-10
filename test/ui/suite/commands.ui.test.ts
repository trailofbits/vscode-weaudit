import { expect } from "chai";
import { InputBox, Workbench, EditorView, ActivityBar, TextEditor, VSBrowser } from "vscode-extension-tester";
import { Key } from "selenium-webdriver";
import * as path from "path";
import * as fs from "fs";
import { userInfo } from "os";

interface SerializedEntry {
    label: string;
    entryType: number;
    locations: Array<{ path: string; startLine: number; endLine: number; label?: string }>;
}

interface SerializedData {
    treeEntries: SerializedEntry[];
    auditedFiles?: Array<{ path: string; author?: string }>;
    partiallyAuditedFiles?: Array<{ path: string; startLine: number; endLine: number; author?: string }>;
}

interface LineRange {
    start: number;
    end: number;
}

const SAMPLE_WORKSPACE = path.resolve(__dirname, "../../../../test/extension/fixtures/sample-workspace");
const SAMPLE_FILE = path.join(SAMPLE_WORKSPACE, "src", "sample.ts");
const SAMPLE_FILE_BASENAME = path.basename(SAMPLE_FILE);
const SAMPLE_RELATIVE_PATH = path.join("src", "sample.ts");
const WORKSPACE_VSCODE_DIR = path.join(SAMPLE_WORKSPACE, ".vscode");
const CURRENT_USERNAME = userInfo().username;
const WEAUDIT_FILE = path.join(WORKSPACE_VSCODE_DIR, `${CURRENT_USERNAME}.weaudit`);
const DAY_LOG_FILE = path.join(WORKSPACE_VSCODE_DIR, ".weauditdaylog");

const DEFAULT_FINDING_RANGE: LineRange = { start: 5, end: 7 };
const SECONDARY_RANGE: LineRange = { start: 11, end: 13 };

/** Shared editor instance, set once in the `before` hook. */
let editor!: TextEditor;

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
 * Reads the persisted `.weaudit` file from disk.
 */
async function readSerializedData(): Promise<SerializedData | undefined> {
    if (!fs.existsSync(WEAUDIT_FILE)) {
        return undefined;
    }
    const raw = await fs.promises.readFile(WEAUDIT_FILE, "utf-8");
    try {
        return JSON.parse(raw) as SerializedData;
    } catch {
        // File may be mid-write; treat as not yet available.
        return undefined;
    }
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
            20_000,
            500,
        );
        return (await editorView.openEditor(SAMPLE_FILE_BASENAME)) as TextEditor;
    }
}

/**
 * Selects a snippet of text in the sample file.
 * Prefer this over line-range selection when the test needs stable single-line selections.
 */
async function selectTextInSampleFile(text: string, occurrence: number = 1): Promise<void> {
    await editor.selectText(text, occurrence);
}

/**
 * Selects a range of lines by moving the caret with Shift+Arrow.
 */
async function selectLines(startLine: number, endLine: number): Promise<void> {
    await editor.setCursor(startLine, 1);

    const clampedEndLine = Math.max(endLine, startLine);
    const downMoves = clampedEndLine - startLine + 1;
    for (let i = 0; i < downMoves; i++) {
        await editor.typeText(Key.chord(Key.SHIFT, Key.ARROW_DOWN));
    }
}

/**
 * Moves the caret to a single location, clearing any selection.
 */
async function moveCursorTo(line: number, column: number = 1): Promise<void> {
    await editor.setCursor(line, column);
    await VSBrowser.instance.driver.actions({ bridge: true }).sendKeys(Key.ESCAPE).perform();
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
    const data = await readSerializedData();
    return data?.treeEntries;
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
        this.timeout(120_000);
        workbench = new Workbench();
        await VSBrowser.instance.openResources(SAMPLE_WORKSPACE);
        await VSBrowser.instance.waitForWorkbench(60_000);

        // Wait for the workspace to fully load before running tests.
        // In CI the explorer may not be ready immediately after waitForWorkbench.
        await VSBrowser.instance.driver.sleep(2000);

        // Open the sample file once and keep a reference for the entire suite
        editor = await openSampleFile();
    });

    beforeEach(async function () {
        await resetWorkspaceState(workbench);
    });

    after(async function () {
        await resetWorkspaceState(workbench);
        // Revert any unsaved editors to prevent "Save changes?" dialogs from
        // blocking closeAllEditors.
        await workbench.executeCommand("workbench.action.files.revertAll");
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

        it("adds an additional region using the quick pick", async function () {
            const title = `Multi-region Finding ${Date.now()}`;
            // Avoid reusing line ranges from other tests so this selection never intersects
            // an existing finding (intersection triggers an edit flow instead of creation).
            await createTestFinding(workbench, title, { start: 28, end: 30 });

            await selectLines(20, 22);
            await workbench.executeCommand("weAudit: Add Region to a Finding");

            const picker = await InputBox.create();
            await picker.selectQuickPick(title);
            // `selectQuickPick` clicks the item; for single-select quick picks VS Code often
            // accepts immediately and closes the input. Calling `confirm()` after that can
            // throw ElementNotInteractableError on a closed input.

            const hasSecondRegion = await waitForCondition(async () => {
                const entries = await readSerializedEntries();
                const entry = entries?.find((candidate) => candidate.label === title);
                return (entry?.locations.length ?? 0) >= 2;
            });
            expect(hasSecondRegion).to.equal(true);
        });

        // it("adds a labeled region to an existing finding", async function () {
        //     const title = `Labeled Region ${Date.now()}`;
        //     await createTestFinding(workbench, title, DEFAULT_FINDING_RANGE);

        //     await selectLines(SECONDARY_RANGE.start, SECONDARY_RANGE.end);
        //     await workbench.executeCommand("weAudit: Add Region to a Finding with Label");

        //     const picker = await InputBox.create();
        //     await picker.selectQuickPick(title);

        //     const labelInput = await InputBox.create();
        //     const regionLabel = `region-label-${Date.now()}`;
        //     await labelInput.setText(regionLabel);
        //     await labelInput.confirm();

        //     const hasLabeledRegion = await waitForCondition(async () => {
        //         const entries = await readSerializedEntries();
        //         const entry = entries?.find((candidate) => candidate.label === title);
        //         if (!entry || entry.locations.length < 2) {
        //             return false;
        //         }
        //         return entry.locations.some((loc) => loc.label === regionLabel);
        //     });
        //     expect(hasLabeledRegion).to.equal(true);
        // });
    });

    describe("Auditing", () => {
        it("marks a region as reviewed and toggles it off", async function () {
            const beforeCount = (await readSerializedData())?.partiallyAuditedFiles?.length ?? 0;
            await selectTextInSampleFile("Sample file");
            await workbench.executeCommand("weAudit: Mark Region as Reviewed");

            let createdRegion: { path: string; startLine: number; endLine: number } | undefined;
            const created = await waitForCondition(async () => {
                const data = await readSerializedData();
                const regions = data?.partiallyAuditedFiles ?? [];
                createdRegion = regions.find((region) => region.path === SAMPLE_RELATIVE_PATH);
                return (data?.partiallyAuditedFiles?.length ?? 0) > beforeCount && createdRegion !== undefined;
            });
            expect(created).to.equal(true);
            expect(createdRegion).to.not.equal(undefined);

            await selectTextInSampleFile("Sample file");
            await workbench.executeCommand("weAudit: Mark Region as Reviewed");

            const removed = await waitForCondition(async () => {
                const data = await readSerializedData();
                const regions = data?.partiallyAuditedFiles ?? [];
                return regions.length === beforeCount && regions.every((region) => region.path !== SAMPLE_RELATIVE_PATH);
            });
            expect(removed).to.equal(true);
        });

        it("marks a file as reviewed and toggles it off", async function () {
            await workbench.executeCommand("weAudit: Mark File as Reviewed");

            const added = await waitForCondition(async () => {
                const data = await readSerializedData();
                const audited = data?.auditedFiles ?? [];
                return audited.some((file) => file.path === SAMPLE_RELATIVE_PATH);
            });
            expect(added).to.equal(true);

            await workbench.executeCommand("weAudit: Mark File as Reviewed");

            const removed = await waitForCondition(async () => {
                const data = await readSerializedData();
                const audited = data?.auditedFiles ?? [];
                return !audited.some((file) => file.path === SAMPLE_RELATIVE_PATH);
            });
            expect(removed).to.equal(true);
        });

        it("navigates to the next partially audited region", async function () {
            // Mark two regions as reviewed
            await selectLines(DEFAULT_FINDING_RANGE.start, DEFAULT_FINDING_RANGE.end);
            await workbench.executeCommand("weAudit: Mark Region as Reviewed");
            await waitForCondition(async () => {
                const data = await readSerializedData();
                return (data?.partiallyAuditedFiles?.length ?? 0) >= 1;
            });

            await selectLines(SECONDARY_RANGE.start, SECONDARY_RANGE.end);
            await workbench.executeCommand("weAudit: Mark Region as Reviewed");
            await waitForCondition(async () => {
                const data = await readSerializedData();
                return (data?.partiallyAuditedFiles?.length ?? 0) >= 2;
            });

            // Move cursor away from both regions
            await moveCursorTo(1);

            await workbench.executeCommand("weAudit: Navigate to Next Partially Audited Region");

            const coords = await editor.getCoordinates();
            const cursorLine = coords[0];

            // The cursor should have moved into one of the two audited regions.
            const inFirstRegion = cursorLine >= DEFAULT_FINDING_RANGE.start && cursorLine <= DEFAULT_FINDING_RANGE.end;
            const inSecondRegion = cursorLine >= SECONDARY_RANGE.start && cursorLine <= SECONDARY_RANGE.end;
            expect(inFirstRegion || inSecondRegion).to.equal(true);
        });
    });

    describe("Delete commands", () => {
        it("deletes a finding when cursor is on its range", async function () {
            const title = `Deletable Finding ${Date.now()}`;
            await createTestFinding(workbench, title, { start: 34, end: 36 });

            // Verify the finding exists before deletion
            const existsBefore = await waitForCondition(async () => {
                const entries = await readSerializedEntries();
                return entries?.some((entry) => entry.label === title) ?? false;
            });
            expect(existsBefore).to.equal(true);

            await moveCursorTo(35);
            await workbench.executeCommand("weAudit: Delete Location Under Cursor");

            const deleted = await waitForCondition(async () => {
                const entries = await readSerializedEntries();
                return !(entries?.some((entry) => entry.label === title) ?? false);
            });
            expect(deleted).to.equal(true);
        });

        it("removes one location from a multi-region finding without deleting it", async function () {
            const title = `MultiLoc Delete ${Date.now()}`;
            await createTestFinding(workbench, title, { start: 37, end: 39 });

            // Add a second region at lines 41-43
            await selectLines(41, 43);
            await workbench.executeCommand("weAudit: Add Region to a Finding");
            const picker = await InputBox.create();
            await picker.selectQuickPick(title);

            const hasTwoRegions = await waitForCondition(async () => {
                const entries = await readSerializedEntries();
                const entry = entries?.find((e) => e.label === title);
                return (entry?.locations.length ?? 0) >= 2;
            });
            expect(hasTwoRegions).to.equal(true);

            // Delete the second location by placing cursor inside it
            await moveCursorTo(42);
            await workbench.executeCommand("weAudit: Delete Location Under Cursor");

            const hasOneRegion = await waitForCondition(async () => {
                const entries = await readSerializedEntries();
                const entry = entries?.find((e) => e.label === title);
                return entry !== undefined && entry.locations.length === 1;
            });
            expect(hasOneRegion).to.equal(true);
        });
    });

    describe("Tree view", () => {
        it("toggles between list and byFile view modes", async function () {
            const title = `Tree Mode Finding ${Date.now()}`;
            await createTestFinding(workbench, title, DEFAULT_FINDING_RANGE);

            // Default mode is "list" — tree items should include the finding title directly
            const listItems = await getWeAuditTreeItems(workbench);
            expect(listItems.some((item) => item.includes(title))).to.equal(true);

            // Toggle to "byFile" mode
            await workbench.executeCommand("weAudit: Toggle View Mode");
            await VSBrowser.instance.driver.sleep(500);

            // In byFile mode, tree items should include a path-like organizer node
            const byFileItems = await getWeAuditTreeItems(workbench);
            expect(byFileItems.some((item) => item.includes("sample.ts"))).to.equal(true);

            // Toggle back to "list" mode for clean state
            await workbench.executeCommand("weAudit: Toggle View Mode");
        });
    });
});
