import * as assert from "node:assert";
import { normalizePathForOS } from "../utilities/normalizePath";

describe("normalizePath.ts", () => {
    describe("normalizePathForOS", () => {
        const wsRoot = "/workspace/root";

        it("should return unchanged path when no conversion needed", () => {
            const filePath = "src/utils/helper.ts";
            const result = normalizePathForOS(wsRoot, filePath);
            assert.strictEqual(result, filePath);
        });

        it("should handle paths with spaces", () => {
            const filePath = "src/my folder/my file.ts";
            const result = normalizePathForOS(wsRoot, filePath);
            // Should preserve spaces
            assert.ok(result.includes("my folder"));
            assert.ok(result.includes("my file.ts"));
        });

        it("should handle paths with special characters (#, ?, &)", () => {
            const filePath = "src/file#1.ts";
            const result = normalizePathForOS(wsRoot, filePath);
            assert.ok(result.includes("#"));

            const filePathWithQuestion = "src/file?.ts";
            const result2 = normalizePathForOS(wsRoot, filePathWithQuestion);
            assert.ok(result2.includes("?"));

            const filePathWithAmpersand = "src/file&more.ts";
            const result3 = normalizePathForOS(wsRoot, filePathWithAmpersand);
            assert.ok(result3.includes("&"));
        });

        it("should handle empty path", () => {
            const result = normalizePathForOS(wsRoot, "");
            assert.strictEqual(result, "");
        });

        it("should handle path that is just a filename", () => {
            const result = normalizePathForOS(wsRoot, "file.ts");
            assert.strictEqual(result, "file.ts");
        });

        // Platform-specific tests
        if (process.platform !== "win32") {
            describe("on Unix-like systems", () => {
                it("should convert Windows backslashes to forward slashes", () => {
                    const windowsPath = "src\\utils\\helper.ts";
                    const result = normalizePathForOS(wsRoot, windowsPath);
                    assert.strictEqual(result, "src/utils/helper.ts");
                });

                it("should convert mixed slashes to forward slashes", () => {
                    const mixedPath = "src\\utils/helper.ts";
                    const result = normalizePathForOS(wsRoot, mixedPath);
                    assert.strictEqual(result, "src/utils/helper.ts");
                });

                it("should preserve Unix paths unchanged", () => {
                    const unixPath = "src/utils/helper.ts";
                    const result = normalizePathForOS(wsRoot, unixPath);
                    assert.strictEqual(result, unixPath);
                });

                it("should handle deeply nested Windows paths", () => {
                    const deepPath = "a\\b\\c\\d\\e\\f\\file.ts";
                    const result = normalizePathForOS(wsRoot, deepPath);
                    assert.strictEqual(result, "a/b/c/d/e/f/file.ts");
                });

                it("should handle paths with consecutive backslashes", () => {
                    const doublePath = "src\\\\utils\\\\file.ts";
                    const result = normalizePathForOS(wsRoot, doublePath);
                    assert.strictEqual(result, "src//utils//file.ts");
                });
            });
        }

        if (process.platform === "win32") {
            describe("on Windows systems", () => {
                it("should normalize Unix-style paths", () => {
                    const unixPath = "src/utils/helper.ts";
                    const result = normalizePathForOS(wsRoot, unixPath);
                    // path.normalize on Windows will convert forward slashes
                    assert.ok(result.includes("src"));
                    assert.ok(result.includes("utils"));
                    assert.ok(result.includes("helper.ts"));
                });

                it("should preserve Windows paths unchanged", () => {
                    const windowsPath = "src\\utils\\helper.ts";
                    const result = normalizePathForOS(wsRoot, windowsPath);
                    assert.strictEqual(result, windowsPath);
                });
            });
        }

        describe("edge cases", () => {
            it("should handle path with leading slash", () => {
                const result = normalizePathForOS(wsRoot, "/src/file.ts");
                assert.ok(result.includes("src"));
                assert.ok(result.includes("file.ts"));
            });

            it("should handle relative path markers", () => {
                const result = normalizePathForOS(wsRoot, "./src/file.ts");
                assert.ok(result.includes("src"));
                assert.ok(result.includes("file.ts"));
            });

            it("should handle parent directory references", () => {
                const result = normalizePathForOS(wsRoot, "../other/file.ts");
                assert.ok(result.includes("other"));
                assert.ok(result.includes("file.ts"));
            });

            it("should handle path ending with separator", () => {
                if (process.platform !== "win32") {
                    const pathWithTrailingSlash = "src/utils/";
                    const result = normalizePathForOS(wsRoot, pathWithTrailingSlash);
                    assert.ok(result.endsWith("utils/") || result.endsWith("utils"));
                }
            });

            it("should handle Unicode characters in path", () => {
                const unicodePath = "src/日本語/файл.ts";
                const result = normalizePathForOS(wsRoot, unicodePath);
                assert.ok(result.includes("日本語"));
                assert.ok(result.includes("файл.ts"));
            });
        });
    });
});
