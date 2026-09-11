import * as assert from "node:assert";
import * as path from "node:path";
import { generatePermalink } from "../../src/permalink";

describe("generatePermalink", () => {
    const sha = "abc123def456789012345678901234567890abcd";
    const hosts = [
        { remote: "https://github.com/org/repo", route: "blob", fragment: "#L11-L21" },
        { remote: "https://gitlab.com/group/repo", route: "blob", fragment: "#L11-L21" },
        { remote: "https://github.company.com/org/repo", route: "blob", fragment: "#L11-L21" },
        { remote: "https://bitbucket.org/team/repo", route: "src", fragment: "#lines-11:21" },
    ];

    for (const { remote, route, fragment } of hosts) {
        describe(remote, () => {
            const prefix = remote + "/" + route + "/" + sha + "/";

            for (const platform of [path.posix, path.win32]) {
                it("uses URL separators for " + platform.sep + " filesystem paths", () => {
                    const root = platform.resolve("repo");
                    const file = platform.resolve("repo", "src", "nested", "file.ts");
                    const location = Object.freeze({
                        path: platform.relative(root, file),
                        startLine: 10,
                        endLine: 20,
                    });
                    const result = generatePermalink(remote, sha, location, platform.sep);
                    assert.strictEqual(result, prefix + "src/nested/file.ts" + fragment);
                });
            }

            it("handles mixed Windows separators", () => {
                const location = { path: "src\\nested/file.ts", startLine: 10, endLine: 20 };
                const result = generatePermalink(remote, sha, location, "\\");
                assert.strictEqual(result, prefix + "src/nested/file.ts" + fragment);
            });

            it("encodes special characters within each path segment", () => {
                const location = { path: "src/my folder/日本語#?%20&.ts", startLine: 10, endLine: 20 };
                const result = generatePermalink(remote, sha, location);
                const encodedPath = "src/my%20folder/%E6%97%A5%E6%9C%AC%E8%AA%9E%23%3F%2520%26.ts";
                assert.strictEqual(result, prefix + encodedPath + fragment);
                assert.strictEqual(new URL(result).search, "");
                assert.strictEqual(new URL(result).hash, fragment);
            });

            it("encodes Windows path segments after converting separators", () => {
                const location = { path: "src\\my folder\\file#1%.ts", startLine: 10, endLine: 20 };
                const result = generatePermalink(remote, sha, location, "\\");
                assert.strictEqual(result, prefix + "src/my%20folder/file%231%25.ts" + fragment);
            });

            it("preserves a literal backslash in a POSIX filename", () => {
                const location = { path: "src/file\\name.ts", startLine: 10, endLine: 20 };
                const result = generatePermalink(remote, sha, location, "/");
                assert.strictEqual(result, prefix + "src/file%5Cname.ts" + fragment);
            });
        });
    }

    it("defaults to the current OS separator", () => {
        const location = { path: path.join("src", "file.ts"), startLine: 0, endLine: 0 };
        const result = generatePermalink("https://github.com/org/repo", sha, location);
        assert.strictEqual(result, "https://github.com/org/repo/blob/" + sha + "/src/file.ts#L1-L1");
    });

    it("retains the Bitbucket fragment for a single line in a root-level file", () => {
        const location = { path: "file.ts", startLine: 0, endLine: 0 };
        const result = generatePermalink("https://bitbucket.org/team/repo", sha, location);
        assert.strictEqual(result, "https://bitbucket.org/team/repo/src/" + sha + "/file.ts#lines-1:1");
    });
});
