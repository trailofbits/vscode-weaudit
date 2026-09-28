import * as assert from "node:assert/strict";
import {
    type Entry,
    type FullEntry,
    EntryType,
    createDefaultEntryDetails,
    createLocationEntry,
    createPathOrganizer,
    getEntryIndexFromArray,
    isOldEntry,
} from "../../src/types";

function finding(label = "Finding"): FullEntry {
    return {
        label,
        author: "alice",
        entryType: EntryType.Finding,
        details: createDefaultEntryDetails(),
        locations: [{ path: "file.ts", rootPath: "/workspace", startLine: 2, endLine: 5, label: "Location", description: "Context" }],
    };
}

describe("Entry helpers", () => {
    it("preserves the path label without interpreting special characters", () => {
        assert.deepEqual(createPathOrganizer("src/[test]/file (1).ts"), { pathLabel: "src/[test]/file (1).ts" });
    });

    it("keeps the original location and parent references in a location entry", () => {
        const parent = finding();
        const location = parent.locations[0];
        const entry = createLocationEntry(location, parent);
        assert.equal(entry.parentEntry, parent);
        assert.equal(entry.location, location);
    });

    describe("getEntryIndexFromArray", () => {
        it("finds an equivalent object at a nonzero index", () => {
            assert.equal(getEntryIndexFromArray(finding("Target"), [finding("Other"), finding("Target")]), 1);
        });

        it("returns the first equivalent entry when there are duplicates", () => {
            assert.equal(getEntryIndexFromArray(finding(), [finding("Other"), finding(), finding()]), 1);
        });

        it("returns -1 for missing entries and empty arrays", () => {
            assert.equal(getEntryIndexFromArray(finding("Missing"), [finding()]), -1);
            assert.equal(getEntryIndexFromArray(finding(), []), -1);
        });

        it("ignores edited details and location labels when identifying an entry", () => {
            const edited = finding();
            edited.details.description = "Updated details";
            edited.locations[0].label = "Updated label";
            assert.equal(getEntryIndexFromArray(edited, [finding()]), 0);
        });
    });

    describe("isOldEntry", () => {
        it("recognizes the legacy entry shape used by external commands", () => {
            const entry: Entry = { ...finding(), locations: [{ path: "/workspace/file.ts", startLine: 2, endLine: 5, label: "", description: "" }] };
            assert.equal(isOldEntry(entry), true);
        });

        it("recognizes full findings and preserves the empty-location legacy case", () => {
            assert.equal(isOldEntry(finding()), false);
            assert.equal(isOldEntry({ ...finding(), locations: [] }), true);
        });

        it("accepts a full location entry without trying to index a missing locations array", () => {
            const parent = finding();
            assert.equal(isOldEntry(createLocationEntry(parent.locations[0], parent)), false);
        });
    });
});
