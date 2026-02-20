import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { type SerializedData, validateSerializedData } from "../../src/types";

/**
 * Loads a serialized weAudit fixture from disk for compatibility tests.
 */
function loadSerializedFixture(filename: string): SerializedData {
    const fixturePath = path.join(__dirname, "fixtures", filename);
    const rawFixture = fs.readFileSync(fixturePath, "utf8");
    return JSON.parse(rawFixture) as SerializedData;
}

describe("weAudit fixture compatibility", () => {
    it("should load the plugin compatibility fixture from disk", () => {
        const data = loadSerializedFixture("weaudit-plugin-compat.json");

        assert.strictEqual(validateSerializedData(data), true);
        assert.deepStrictEqual(data.auditedFiles, []);
        assert.deepStrictEqual(data.resolvedEntries, []);
        assert.strictEqual(data.treeEntries.length, 1);
    });
});
