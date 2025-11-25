import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { validateSerializedData, SerializedData } from "../../src/types";

const fixturesDir = path.join(__dirname, "..", "fixtures");

describe("Test fixtures", () => {
    describe("valid.weaudit", () => {
        it("loads and parses as valid JSON", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "valid.weaudit"), "utf-8");
            const data = JSON.parse(content);
            expect(data).to.be.an("object");
        });

        it("passes validation", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "valid.weaudit"), "utf-8");
            const data: SerializedData = JSON.parse(content);
            expect(validateSerializedData(data)).to.equal(true);
        });

        it("contains expected structure", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "valid.weaudit"), "utf-8");
            const data: SerializedData = JSON.parse(content);
            expect(data.treeEntries).to.have.length(3);
            expect(data.auditedFiles).to.have.length(2);
            expect(data.partiallyAuditedFiles).to.have.length(2);
            expect(data.resolvedEntries).to.have.length(1);
        });
    });

    describe("minimal.weaudit", () => {
        it("loads and parses as valid JSON", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "minimal.weaudit"), "utf-8");
            const data = JSON.parse(content);
            expect(data).to.be.an("object");
        });

        it("passes validation with empty arrays", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "minimal.weaudit"), "utf-8");
            const data: SerializedData = JSON.parse(content);
            expect(validateSerializedData(data)).to.equal(true);
            expect(data.treeEntries).to.have.length(0);
            expect(data.auditedFiles).to.have.length(0);
            expect(data.resolvedEntries).to.have.length(0);
        });
    });

    describe("legacy.weaudit", () => {
        it("loads and parses as valid JSON", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "legacy.weaudit"), "utf-8");
            const data = JSON.parse(content);
            expect(data).to.be.an("object");
        });

        it("passes validation without partiallyAuditedFiles field", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "legacy.weaudit"), "utf-8");
            const data: SerializedData = JSON.parse(content);
            expect(data.partiallyAuditedFiles).to.be.undefined;
            expect(validateSerializedData(data)).to.equal(true);
        });
    });

    describe("corrupt.weaudit", () => {
        it("fails to parse as JSON", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "corrupt.weaudit"), "utf-8");
            expect(() => JSON.parse(content)).to.throw();
        });
    });

    describe("empty.weaudit", () => {
        it("fails to parse as JSON (empty file)", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "empty.weaudit"), "utf-8");
            expect(content).to.equal("");
            expect(() => JSON.parse(content)).to.throw();
        });
    });

    describe("invalid-entry-type.weaudit", () => {
        it("loads as JSON but fails validation", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "invalid-entry-type.weaudit"), "utf-8");
            const data: SerializedData = JSON.parse(content);
            expect(validateSerializedData(data)).to.equal(false);
        });
    });

    describe("missing-fields.weaudit", () => {
        it("loads as JSON but fails validation", () => {
            const content = fs.readFileSync(path.join(fixturesDir, "missing-fields.weaudit"), "utf-8");
            const data: SerializedData = JSON.parse(content);
            expect(validateSerializedData(data)).to.equal(false);
        });
    });
});
