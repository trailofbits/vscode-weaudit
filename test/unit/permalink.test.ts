import * as assert from "node:assert";

/**
 * Tests for permalink generation logic used in codeMarker.ts:2595-2603
 *
 * The actual getRemoteAndPermalink method is tightly coupled to VS Code API.
 * These tests verify the URL building logic and edge cases.
 */
describe("Permalink Generation Logic", () => {
    /**
     * Generates a permalink based on the remote URL, SHA, and location.
     * This mirrors the logic in codeMarker.ts:2595-2603
     */
    function generatePermalink(gitRemote: string, sha: string, filePath: string, startLine: number, endLine: number): string {
        // Parse hostname - mirrors URL.parse(gitRemote)?.hostname in codeMarker.ts:2595
        let remoteHost: string | null = null;
        try {
            remoteHost = new URL(gitRemote).hostname;
        } catch {
            // Invalid URL
        }

        if (remoteHost === "bitbucket.org") {
            // Bitbucket format: line numbers are 1-indexed
            const issueLocation = `#lines-${startLine + 1}:${endLine + 1}`;
            return gitRemote + "/src/" + sha + "/" + filePath + issueLocation;
        } else {
            // GitHub/GitLab format: line numbers are 1-indexed
            const issueLocation = `#L${startLine + 1}-L${endLine + 1}`;
            return gitRemote + "/blob/" + sha + "/" + filePath + issueLocation;
        }
    }

    describe("GitHub permalink generation", () => {
        const gitRemote = "https://github.com/trailofbits/vscode-weaudit";
        const sha = "abc123def456";

        it("should generate correct GitHub permalink", () => {
            const permalink = generatePermalink(gitRemote, sha, "src/codeMarker.ts", 10, 20);
            assert.strictEqual(permalink, "https://github.com/trailofbits/vscode-weaudit/blob/abc123def456/src/codeMarker.ts#L11-L21");
        });

        it("should convert 0-indexed lines to 1-indexed", () => {
            // Internal representation uses 0-indexed lines
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 0, 0);
            assert.ok(permalink.includes("#L1-L1"));
        });

        it("should handle single line selection", () => {
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 5, 5);
            assert.ok(permalink.includes("#L6-L6"));
        });

        it("should handle deeply nested file paths", () => {
            const permalink = generatePermalink(gitRemote, sha, "src/a/b/c/d/file.ts", 1, 2);
            assert.ok(permalink.includes("/src/a/b/c/d/file.ts"));
        });
    });

    describe("Bitbucket permalink generation", () => {
        const gitRemote = "https://bitbucket.org/team/repo";
        const sha = "abc123def456";

        it("should generate correct Bitbucket permalink", () => {
            const permalink = generatePermalink(gitRemote, sha, "src/file.ts", 10, 20);
            assert.strictEqual(permalink, "https://bitbucket.org/team/repo/src/abc123def456/src/file.ts#lines-11:21");
        });

        it("should use /src/ instead of /blob/ for Bitbucket", () => {
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 0, 0);
            assert.ok(permalink.includes("/src/"));
            assert.ok(!permalink.includes("/blob/"));
        });

        it("should use #lines-X:Y format for Bitbucket", () => {
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 5, 10);
            assert.ok(permalink.includes("#lines-6:11"));
        });
    });

    describe("path encoding in permalinks", () => {
        const gitRemote = "https://github.com/org/repo";
        const sha = "abc123";

        // NOTE: Currently the code does NOT URL-encode paths - this is a potential bug
        // These tests document the current behavior

        it("should handle paths with spaces (current behavior - not encoded)", () => {
            const permalink = generatePermalink(gitRemote, sha, "src/my file.ts", 1, 2);
            // Current implementation does not encode - space is passed through
            assert.ok(permalink.includes("my file.ts"));
        });

        it("should handle paths with hash character (potential issue)", () => {
            // Hash in path could conflict with URL fragment
            const permalink = generatePermalink(gitRemote, sha, "src/file#1.ts", 1, 2);
            // This could be problematic as # starts the fragment
            assert.ok(permalink.includes("file#1.ts"));
        });

        it("should handle paths with query characters (potential issue)", () => {
            const permalink = generatePermalink(gitRemote, sha, "src/file?.ts", 1, 2);
            assert.ok(permalink.includes("file?.ts"));
        });

        it("should handle paths starting with special characters", () => {
            const permalink = generatePermalink(gitRemote, sha, ".github/workflows/ci.yml", 1, 5);
            assert.ok(permalink.includes(".github/workflows/ci.yml"));
        });
    });

    describe("remote URL edge cases", () => {
        const sha = "abc123";

        it("should handle remote URL with trailing slash", () => {
            // If the remote URL has a trailing slash, we'd get double slashes
            const gitRemote = "https://github.com/org/repo/";
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 1, 2);
            // Note: Current implementation would produce //blob/
            assert.ok(permalink.includes("repo//blob/") || permalink.includes("repo/blob/"));
        });

        it("should handle GitLab URLs (uses GitHub-style format)", () => {
            const gitRemote = "https://gitlab.com/group/project";
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 1, 2);
            // GitLab URLs get treated like GitHub
            assert.ok(permalink.includes("/blob/"));
            assert.ok(permalink.includes("#L2-L3"));
        });

        it("should handle self-hosted GitHub Enterprise URLs", () => {
            const gitRemote = "https://github.company.com/org/repo";
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 1, 2);
            assert.ok(permalink.includes("/blob/"));
        });

        it("should handle invalid URL gracefully", () => {
            const gitRemote = "not-a-valid-url";
            // Should not throw, will use default GitHub format
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 1, 2);
            assert.ok(permalink.includes("/blob/"));
        });
    });

    describe("SHA handling", () => {
        const gitRemote = "https://github.com/org/repo";

        it("should include full SHA in permalink", () => {
            const fullSha = "abc123def456789012345678901234567890abcd";
            const permalink = generatePermalink(gitRemote, fullSha, "file.ts", 1, 2);
            assert.ok(permalink.includes(fullSha));
        });

        it("should handle short SHA", () => {
            const shortSha = "abc123";
            const permalink = generatePermalink(gitRemote, shortSha, "file.ts", 1, 2);
            assert.ok(permalink.includes(shortSha));
        });

        it("should handle empty SHA (edge case)", () => {
            const permalink = generatePermalink(gitRemote, "", "file.ts", 1, 2);
            // Will produce /blob//file.ts - potentially invalid but doesn't throw
            assert.ok(permalink.includes("/blob//"));
        });
    });

    describe("line number edge cases", () => {
        const gitRemote = "https://github.com/org/repo";
        const sha = "abc123";

        it("should handle very large line numbers", () => {
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 99999, 100000);
            assert.ok(permalink.includes("#L100000-L100001"));
        });

        it("should handle startLine greater than endLine", () => {
            // This shouldn't happen but test current behavior
            const permalink = generatePermalink(gitRemote, sha, "file.ts", 20, 10);
            assert.ok(permalink.includes("#L21-L11"));
        });

        it("should handle negative line numbers (shouldn't happen but defensive)", () => {
            const permalink = generatePermalink(gitRemote, sha, "file.ts", -1, 0);
            // -1 + 1 = 0
            assert.ok(permalink.includes("#L0-L1"));
        });
    });
});
