import { expect } from "chai";

import {
    AuditedFile,
    Entry,
    EntryType,
    FindingDifficulty,
    FindingSeverity,
    FindingType,
    FullEntry,
    FullLocation,
    PathOrganizerEntry,
    PartiallyAuditedFile,
    TreeViewMode,
    WorkspaceRootEntry,
    configEntryEquals,
    createDefaultEntryDetails,
    createDefaultSerializedData,
    createLocationEntry,
    createPathOrganizer,
    entryEquals,
    getEntryIndexFromArray,
    isConfigurationEntry,
    isEntry,
    isLocationEntry,
    isOldEntry,
    isPathOrganizerEntry,
    isWorkspaceRootEntry,
    mergeTwoAuditedFileArrays,
    mergeTwoEntryArrays,
    mergeTwoPartiallyAuditedFileArrays,
    treeViewModeLabel,
    validateSerializedData,
} from "../../src/types";

const baseLocation = { path: "src/index.ts", startLine: 0, endLine: 3, label: "here", description: "" };
const baseEntry: Entry = {
    label: "test",
    entryType: EntryType.Finding,
    author: "alice",
    details: {
        severity: FindingSeverity.Low,
        difficulty: FindingDifficulty.Medium,
        type: FindingType.Configuration,
        description: "desc",
        exploit: "exp",
        recommendation: "rec",
    },
    locations: [baseLocation],
};

describe("types utilities", () => {
    describe("defaults", () => {
        it("createDefaultSerializedData returns empty data with required keys", () => {
            const result = createDefaultSerializedData();
            expect(result).to.deep.equal({
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                treeEntries: [],
                auditedFiles: [],
                partiallyAuditedFiles: [],
                resolvedEntries: [],
            });
        });

        it("createDefaultEntryDetails returns empty placeholders", () => {
            const details = createDefaultEntryDetails();
            expect(details).to.include({
                severity: FindingSeverity.Undefined,
                difficulty: FindingDifficulty.Undefined,
                type: FindingType.Undefined,
            });
            expect(details.description).to.equal("");
            expect(details.exploit).to.equal("");
            expect(details.recommendation).to.be.a("string");
        });
    });

    describe("validateSerializedData", () => {
        it("accepts a fully populated serialized payload", () => {
            const data = {
                clientRemote: "https://example.com",
                gitRemote: "https://example.com/audit",
                gitSha: "abc",
                treeEntries: [baseEntry],
                auditedFiles: [{ path: "src/index.ts", author: "alice" }],
                partiallyAuditedFiles: [{ path: "src/index.ts", author: "alice", startLine: 0, endLine: 1 }],
                resolvedEntries: [baseEntry],
            };
            expect(validateSerializedData(data)).to.equal(true);
        });

        it("rejects missing required top-level arrays", () => {
            const badData = {
                clientRemote: "",
                gitRemote: "",
                gitSha: "",
                // @ts-expect-error deliberate malformed input
                treeEntries: undefined,
                auditedFiles: [],
                resolvedEntries: [],
            };
            expect(validateSerializedData(badData as any)).to.equal(false);
        });

        it("rejects entries with invalid entryType", () => {
            const malformedEntry = { ...baseEntry, entryType: 99 };
            const data = { ...createDefaultSerializedData(), treeEntries: [malformedEntry] };
            expect(validateSerializedData(data as any)).to.equal(false);
        });

        it("rejects locations missing required fields", () => {
            const missingLocation = { ...baseEntry, locations: [{ path: "p", startLine: 0, label: "x" }] };
            const data = { ...createDefaultSerializedData(), treeEntries: [missingLocation] };
            expect(validateSerializedData(data as any)).to.equal(false);
        });

        it("rejects partially audited entries with no coordinates or author/path", () => {
            const data = {
                ...createDefaultSerializedData(),
                partiallyAuditedFiles: [
                    // @ts-expect-error deliberate malformed input
                    { path: undefined, author: undefined },
                ],
            };
            expect(validateSerializedData(data as any)).to.equal(false);
        });
    });

    describe("tree view helpers", () => {
        it("treeViewModeLabel returns the expected labels", () => {
            expect(treeViewModeLabel(TreeViewMode.List)).to.equal("list");
            expect(treeViewModeLabel(TreeViewMode.GroupByFile)).to.equal("byFile");
        });

        it("createPathOrganizer returns a path label entry", () => {
            const pathOrg = createPathOrganizer("src/file.ts");
            expect(pathOrg).to.deep.equal({ pathLabel: "src/file.ts" });
            expect(isPathOrganizerEntry(pathOrg)).to.equal(true);
        });

        it("createLocationEntry ties location to parent entry", () => {
            const fullLocation: FullLocation = { ...baseLocation, rootPath: "/workspace" };
            const parent: FullEntry = { ...(baseEntry as FullEntry), locations: [fullLocation] };
            const locEntry = createLocationEntry(fullLocation, parent);
            expect(locEntry.location).to.equal(fullLocation);
            expect(locEntry.parentEntry).to.equal(parent);
            expect(isLocationEntry(locEntry)).to.equal(true);
        });
    });

    describe("entry equality and merging", () => {
        it("entryEquals detects identical entries", () => {
            const a = { ...baseEntry };
            const b = { ...baseEntry, locations: [...baseEntry.locations] };
            expect(entryEquals(a, b)).to.equal(true);
        });

        it("entryEquals rejects when location counts differ", () => {
            const a = baseEntry;
            const b = { ...baseEntry, locations: [...baseEntry.locations, { ...baseLocation, path: "other" }] };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("getEntryIndexFromArray finds matching entry", () => {
            const array = [baseEntry, { ...baseEntry, label: "next" }];
            expect(getEntryIndexFromArray(baseEntry, array)).to.equal(0);
            expect(getEntryIndexFromArray({ ...baseEntry, label: "missing" }, array)).to.equal(-1);
        });

        it("mergeTwoEntryArrays deduplicates entries", () => {
            const a = [baseEntry];
            const b = [baseEntry, { ...baseEntry, label: "other" }];
            const merged = mergeTwoEntryArrays(a, b);
            expect(merged).to.have.length(2);
            expect(merged[1].label).to.equal("other");
        });
    });

    describe("audited and partially audited merging", () => {
        const audited: AuditedFile = { path: "src/a.ts", author: "alice" };
        const auditedDup: AuditedFile = { path: "src/a.ts", author: "alice" };
        const auditedOther: AuditedFile = { path: "src/b.ts", author: "bob" };

        it("mergeTwoAuditedFileArrays removes duplicates", () => {
            const merged = mergeTwoAuditedFileArrays([audited], [auditedDup, auditedOther]);
            expect(merged).to.deep.equal([audited, auditedOther]);
        });

        const partial: PartiallyAuditedFile = { path: "src/a.ts", author: "alice", startLine: 0, endLine: 1 };
        const partialOverlap: PartiallyAuditedFile = { ...partial };
        const partialNew: PartiallyAuditedFile = { path: "src/a.ts", author: "alice", startLine: 2, endLine: 3 };

        it("mergeTwoPartiallyAuditedFileArrays removes exact duplicates", () => {
            const merged = mergeTwoPartiallyAuditedFileArrays([partial], [partialOverlap, partialNew]);
            expect(merged).to.deep.equal([partial, partialNew]);
        });
    });

    describe("type guards and config equality", () => {
        it("isEntry and isOldEntry distinguish entry shapes", () => {
            const fullLoc: FullLocation = { ...baseLocation, rootPath: "/workspace" };
            const fullEntry: FullEntry = { ...(baseEntry as FullEntry), locations: [fullLoc] };
            expect(isEntry(fullEntry)).to.equal(true);
            expect(isOldEntry(baseEntry)).to.equal(true);
            expect(isOldEntry(fullEntry)).to.equal(false);
        });

        it("configEntryEquals matches full tuple of properties", () => {
            const rootA: WorkspaceRootEntry = { label: "rootA" };
            const rootB: WorkspaceRootEntry = { label: "rootB" };
            const configA = { path: "/tmp/a", username: "alice", root: rootA };
            const configASame = { ...configA };
            const configDifferent = { ...configA, root: rootB };

            expect(configEntryEquals(configA, configASame)).to.equal(true);
            expect(configEntryEquals(configA, configDifferent)).to.equal(false);
        });

        it("isConfigurationEntry and isWorkspaceRootEntry type guards behave on mixed inputs", () => {
            const config = { path: "/tmp/a", username: "alice", root: { label: "root" } };
            const root = { label: "root" };
            const arbitrary: PathOrganizerEntry = { pathLabel: "x" };

            expect(isConfigurationEntry(config)).to.equal(true);
            expect(isWorkspaceRootEntry(root)).to.equal(true);
            expect(isConfigurationEntry(arbitrary as any)).to.equal(false);
            expect(isWorkspaceRootEntry(arbitrary as any)).to.equal(false);
        });
    });

    describe("type guards - comprehensive", () => {
        const fullLocation: FullLocation = { ...baseLocation, rootPath: "/workspace" };
        const fullEntry: FullEntry = { ...(baseEntry as FullEntry), locations: [fullLocation] };
        const locationEntry = createLocationEntry(fullLocation, fullEntry);
        const pathOrganizer = createPathOrganizer("src/file.ts");

        describe("isEntry", () => {
            it("returns true for FullEntry", () => {
                expect(isEntry(fullEntry)).to.equal(true);
            });

            it("returns false for LocationEntry", () => {
                expect(isEntry(locationEntry)).to.equal(false);
            });

            it("returns false for PathOrganizerEntry", () => {
                expect(isEntry(pathOrganizer)).to.equal(false);
            });
        });

        describe("isLocationEntry", () => {
            it("returns true for FullLocationEntry", () => {
                expect(isLocationEntry(locationEntry)).to.equal(true);
            });

            it("returns false for FullEntry", () => {
                expect(isLocationEntry(fullEntry)).to.equal(false);
            });

            it("returns false for PathOrganizerEntry", () => {
                expect(isLocationEntry(pathOrganizer)).to.equal(false);
            });
        });

        describe("isPathOrganizerEntry", () => {
            it("returns true for PathOrganizerEntry", () => {
                expect(isPathOrganizerEntry(pathOrganizer)).to.equal(true);
            });

            it("returns false for FullEntry", () => {
                expect(isPathOrganizerEntry(fullEntry)).to.equal(false);
            });

            it("returns false for LocationEntry", () => {
                expect(isPathOrganizerEntry(locationEntry)).to.equal(false);
            });
        });

        describe("isOldEntry", () => {
            it("returns true for Entry without rootPath", () => {
                expect(isOldEntry(baseEntry)).to.equal(true);
            });

            it("returns false for FullEntry with rootPath", () => {
                expect(isOldEntry(fullEntry)).to.equal(false);
            });

            it("returns true for Entry with empty locations array", () => {
                const entryNoLocations = { ...baseEntry, locations: [] };
                // isOldEntry checks locations[0]?.rootPath, so empty array returns true (undefined rootPath)
                expect(isOldEntry(entryNoLocations)).to.equal(true);
            });
        });

        describe("isConfigurationEntry", () => {
            it("returns true for ConfigurationEntry", () => {
                const config = { path: "/path", username: "user", root: { label: "root" } };
                expect(isConfigurationEntry(config)).to.equal(true);
            });

            it("returns false for WorkspaceRootEntry", () => {
                const root: WorkspaceRootEntry = { label: "root" };
                expect(isConfigurationEntry(root)).to.equal(false);
            });

            it("returns false for arbitrary object", () => {
                expect(isConfigurationEntry({ foo: "bar" } as any)).to.equal(false);
            });
        });

        describe("isWorkspaceRootEntry", () => {
            it("returns true for WorkspaceRootEntry", () => {
                const root: WorkspaceRootEntry = { label: "myroot" };
                expect(isWorkspaceRootEntry(root)).to.equal(true);
            });

            it("returns true for ConfigurationEntry (has label via root)", () => {
                // Note: ConfigurationEntry also has a label indirectly, but isWorkspaceRootEntry
                // checks for direct label property which ConfigurationEntry doesn't have
                const config = { path: "/path", username: "user", root: { label: "root" } };
                expect(isWorkspaceRootEntry(config)).to.equal(false);
            });
        });
    });

    describe("entry equality - comprehensive", () => {
        it("entryEquals returns true for identical entries", () => {
            const a = { ...baseEntry };
            const b = { ...baseEntry };
            expect(entryEquals(a, b)).to.equal(true);
        });

        it("entryEquals returns false for different labels", () => {
            const a = { ...baseEntry, label: "Label A" };
            const b = { ...baseEntry, label: "Label B" };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals returns false for different authors", () => {
            const a = { ...baseEntry, author: "alice" };
            const b = { ...baseEntry, author: "bob" };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals returns false for different entryTypes", () => {
            const a = { ...baseEntry, entryType: EntryType.Finding };
            const b = { ...baseEntry, entryType: EntryType.Note };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals returns false for different location counts", () => {
            const a = { ...baseEntry, locations: [baseLocation] };
            const b = { ...baseEntry, locations: [baseLocation, { ...baseLocation, path: "other.ts" }] };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals returns false for different location paths", () => {
            const a = { ...baseEntry, locations: [{ ...baseLocation, path: "a.ts" }] };
            const b = { ...baseEntry, locations: [{ ...baseLocation, path: "b.ts" }] };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals returns false for different startLine", () => {
            const a = { ...baseEntry, locations: [{ ...baseLocation, startLine: 10 }] };
            const b = { ...baseEntry, locations: [{ ...baseLocation, startLine: 20 }] };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals returns false for different endLine", () => {
            const a = { ...baseEntry, locations: [{ ...baseLocation, endLine: 10 }] };
            const b = { ...baseEntry, locations: [{ ...baseLocation, endLine: 20 }] };
            expect(entryEquals(a, b)).to.equal(false);
        });

        it("entryEquals ignores differences in details", () => {
            const a = { ...baseEntry, details: { ...baseEntry.details, description: "A" } };
            const b = { ...baseEntry, details: { ...baseEntry.details, description: "B" } };
            expect(entryEquals(a, b)).to.equal(true);
        });

        it("entryEquals ignores differences in location labels", () => {
            const a = { ...baseEntry, locations: [{ ...baseLocation, label: "Label A" }] };
            const b = { ...baseEntry, locations: [{ ...baseLocation, label: "Label B" }] };
            expect(entryEquals(a, b)).to.equal(true);
        });
    });

    describe("configEntryEquals - comprehensive", () => {
        const rootA: WorkspaceRootEntry = { label: "rootA" };
        const rootB: WorkspaceRootEntry = { label: "rootB" };

        it("returns true for identical configs", () => {
            const a = { path: "/path/a", username: "alice", root: rootA };
            const b = { path: "/path/a", username: "alice", root: rootA };
            expect(configEntryEquals(a, b)).to.equal(true);
        });

        it("returns false for different paths", () => {
            const a = { path: "/path/a", username: "alice", root: rootA };
            const b = { path: "/path/b", username: "alice", root: rootA };
            expect(configEntryEquals(a, b)).to.equal(false);
        });

        it("returns false for different usernames", () => {
            const a = { path: "/path/a", username: "alice", root: rootA };
            const b = { path: "/path/a", username: "bob", root: rootA };
            expect(configEntryEquals(a, b)).to.equal(false);
        });

        it("returns false for different root labels", () => {
            const a = { path: "/path/a", username: "alice", root: rootA };
            const b = { path: "/path/a", username: "alice", root: rootB };
            expect(configEntryEquals(a, b)).to.equal(false);
        });
    });

    describe("merging - comprehensive", () => {
        describe("mergeTwoEntryArrays", () => {
            it("combines unique entries", () => {
                const entryA = { ...baseEntry, label: "A" };
                const entryB = { ...baseEntry, label: "B" };
                const merged = mergeTwoEntryArrays([entryA], [entryB]);
                expect(merged).to.have.length(2);
            });

            it("removes duplicates", () => {
                const merged = mergeTwoEntryArrays([baseEntry], [baseEntry]);
                expect(merged).to.have.length(1);
            });

            it("handles empty first array", () => {
                const merged = mergeTwoEntryArrays([], [baseEntry]);
                expect(merged).to.have.length(1);
            });

            it("handles empty second array", () => {
                const merged = mergeTwoEntryArrays([baseEntry], []);
                expect(merged).to.have.length(1);
            });

            it("handles both arrays empty", () => {
                const merged = mergeTwoEntryArrays([], []);
                expect(merged).to.have.length(0);
            });
        });

        describe("mergeTwoAuditedFileArrays", () => {
            it("combines unique audited files", () => {
                const a: AuditedFile = { path: "a.ts", author: "alice" };
                const b: AuditedFile = { path: "b.ts", author: "bob" };
                const merged = mergeTwoAuditedFileArrays([a], [b]);
                expect(merged).to.have.length(2);
            });

            it("removes duplicates with same path and author", () => {
                const a: AuditedFile = { path: "a.ts", author: "alice" };
                const merged = mergeTwoAuditedFileArrays([a], [a]);
                expect(merged).to.have.length(1);
            });

            it("keeps entries with same path but different authors", () => {
                const a: AuditedFile = { path: "file.ts", author: "alice" };
                const b: AuditedFile = { path: "file.ts", author: "bob" };
                const merged = mergeTwoAuditedFileArrays([a], [b]);
                expect(merged).to.have.length(2);
            });

            it("handles empty arrays", () => {
                const merged = mergeTwoAuditedFileArrays([], []);
                expect(merged).to.have.length(0);
            });
        });

        describe("mergeTwoPartiallyAuditedFileArrays", () => {
            it("combines unique partially audited files", () => {
                const a: PartiallyAuditedFile = { path: "a.ts", author: "alice", startLine: 0, endLine: 10 };
                const b: PartiallyAuditedFile = { path: "b.ts", author: "bob", startLine: 0, endLine: 10 };
                const merged = mergeTwoPartiallyAuditedFileArrays([a], [b]);
                expect(merged).to.have.length(2);
            });

            it("removes exact duplicates", () => {
                const a: PartiallyAuditedFile = { path: "a.ts", author: "alice", startLine: 0, endLine: 10 };
                const merged = mergeTwoPartiallyAuditedFileArrays([a], [a]);
                expect(merged).to.have.length(1);
            });

            it("keeps entries with same path but different line ranges", () => {
                const a: PartiallyAuditedFile = { path: "file.ts", author: "alice", startLine: 0, endLine: 10 };
                const b: PartiallyAuditedFile = { path: "file.ts", author: "alice", startLine: 20, endLine: 30 };
                const merged = mergeTwoPartiallyAuditedFileArrays([a], [b]);
                expect(merged).to.have.length(2);
            });

            it("handles empty arrays", () => {
                const merged = mergeTwoPartiallyAuditedFileArrays([], []);
                expect(merged).to.have.length(0);
            });
        });

        describe("getEntryIndexFromArray", () => {
            it("finds entry at beginning of array", () => {
                const entries = [baseEntry, { ...baseEntry, label: "other" }];
                expect(getEntryIndexFromArray(baseEntry, entries)).to.equal(0);
            });

            it("finds entry at end of array", () => {
                const target = { ...baseEntry, label: "target" };
                const entries = [{ ...baseEntry, label: "first" }, target];
                expect(getEntryIndexFromArray(target, entries)).to.equal(1);
            });

            it("returns -1 for missing entry", () => {
                const entries = [baseEntry];
                const missing = { ...baseEntry, label: "missing" };
                expect(getEntryIndexFromArray(missing, entries)).to.equal(-1);
            });

            it("returns -1 for empty array", () => {
                expect(getEntryIndexFromArray(baseEntry, [])).to.equal(-1);
            });
        });
    });

    describe("factory functions - comprehensive", () => {
        describe("createDefaultSerializedData", () => {
            it("returns object with all required keys", () => {
                const data = createDefaultSerializedData();
                expect(data).to.have.all.keys("clientRemote", "gitRemote", "gitSha", "treeEntries", "auditedFiles", "partiallyAuditedFiles", "resolvedEntries");
            });

            it("returns empty arrays for all array fields", () => {
                const data = createDefaultSerializedData();
                expect(data.treeEntries).to.deep.equal([]);
                expect(data.auditedFiles).to.deep.equal([]);
                expect(data.partiallyAuditedFiles).to.deep.equal([]);
                expect(data.resolvedEntries).to.deep.equal([]);
            });

            it("returns empty strings for remote fields", () => {
                const data = createDefaultSerializedData();
                expect(data.clientRemote).to.equal("");
                expect(data.gitRemote).to.equal("");
                expect(data.gitSha).to.equal("");
            });
        });

        describe("createDefaultEntryDetails", () => {
            it("returns object with all required keys", () => {
                const details = createDefaultEntryDetails();
                expect(details).to.have.all.keys("severity", "difficulty", "type", "description", "exploit", "recommendation");
            });

            it("returns Undefined for enum fields", () => {
                const details = createDefaultEntryDetails();
                expect(details.severity).to.equal(FindingSeverity.Undefined);
                expect(details.difficulty).to.equal(FindingDifficulty.Undefined);
                expect(details.type).to.equal(FindingType.Undefined);
            });

            it("returns empty string for description and exploit", () => {
                const details = createDefaultEntryDetails();
                expect(details.description).to.equal("");
                expect(details.exploit).to.equal("");
            });

            it("returns recommendation template", () => {
                const details = createDefaultEntryDetails();
                expect(details.recommendation).to.contain("Short term");
                expect(details.recommendation).to.contain("Long term");
            });
        });

        describe("createPathOrganizer", () => {
            it("creates object with pathLabel", () => {
                const organizer = createPathOrganizer("src/file.ts");
                expect(organizer).to.deep.equal({ pathLabel: "src/file.ts" });
            });

            it("passes isPathOrganizerEntry check", () => {
                const organizer = createPathOrganizer("any/path");
                expect(isPathOrganizerEntry(organizer)).to.equal(true);
            });
        });

        describe("createLocationEntry", () => {
            it("creates object with location and parentEntry", () => {
                const fullLocation: FullLocation = { ...baseLocation, rootPath: "/workspace" };
                const parent: FullEntry = { ...(baseEntry as FullEntry), locations: [fullLocation] };
                const entry = createLocationEntry(fullLocation, parent);
                expect(entry.location).to.equal(fullLocation);
                expect(entry.parentEntry).to.equal(parent);
            });

            it("passes isLocationEntry check", () => {
                const fullLocation: FullLocation = { ...baseLocation, rootPath: "/workspace" };
                const parent: FullEntry = { ...(baseEntry as FullEntry), locations: [fullLocation] };
                const entry = createLocationEntry(fullLocation, parent);
                expect(isLocationEntry(entry)).to.equal(true);
            });
        });

        describe("treeViewModeLabel", () => {
            it("returns 'list' for TreeViewMode.List", () => {
                expect(treeViewModeLabel(TreeViewMode.List)).to.equal("list");
            });

            it("returns 'byFile' for TreeViewMode.GroupByFile", () => {
                expect(treeViewModeLabel(TreeViewMode.GroupByFile)).to.equal("byFile");
            });
        });
    });
});
