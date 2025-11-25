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
});
