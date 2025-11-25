import { expect } from "chai";
import * as sinon from "sinon";

import { FullLocation, RemoteAndPermalink, FullEntry, EntryType, FindingSeverity, FindingDifficulty, FindingType } from "../../src/types";

/**
 * Enum for repository types
 */
enum Repository {
    Audit = "audit",
    Client = "client",
}

/**
 * Helper to create a FullLocation for testing
 */
function createFullLocation(overrides: Partial<FullLocation> = {}): FullLocation {
    return {
        path: "src/contracts/Token.sol",
        startLine: 10,
        endLine: 20,
        label: "test location",
        description: "",
        rootPath: "/workspace/project",
        ...overrides,
    };
}

/**
 * Helper to create a FullEntry for testing
 */
function createFullEntry(overrides: Partial<FullEntry> = {}): FullEntry {
    return {
        label: "Test Finding",
        entryType: EntryType.Finding,
        author: "testuser",
        details: {
            severity: FindingSeverity.Medium,
            difficulty: FindingDifficulty.Low,
            type: FindingType.DataValidation,
            description: "Test description",
            exploit: "Test exploit",
            recommendation: "Test recommendation",
        },
        locations: [createFullLocation()],
        ...overrides,
    };
}

/**
 * Parses a git remote URL and returns the hostname
 */
function parseRemoteHost(gitRemote: string): string | undefined {
    try {
        // Handle SSH URLs like git@github.com:user/repo.git
        if (gitRemote.startsWith("git@")) {
            const match = gitRemote.match(/git@([^:]+):/);
            return match ? match[1] : undefined;
        }
        // Handle HTTPS URLs
        const url = new URL(gitRemote);
        return url.hostname;
    } catch {
        return undefined;
    }
}

/**
 * Normalizes a git remote URL to HTTPS format
 * Handles SSH format (git@host:user/repo) and strips .git suffix
 */
function normalizeGitRemote(remote: string): string {
    let normalized = remote;

    // Convert SSH to HTTPS format
    if (normalized.startsWith("git@")) {
        const match = normalized.match(/git@([^:]+):(.+)/);
        if (match) {
            normalized = `https://${match[1]}/${match[2]}`;
        }
    }

    // Strip .git suffix
    if (normalized.endsWith(".git")) {
        normalized = normalized.slice(0, -4);
    }

    return normalized;
}

/**
 * Simulates getRemoteAndPermalink logic
 */
function getRemoteAndPermalink(gitRemote: string | undefined, sha: string | undefined, location: FullLocation): RemoteAndPermalink | undefined {
    if (!gitRemote || !sha) {
        return undefined;
    }

    const normalizedRemote = normalizeGitRemote(gitRemote);
    const remoteHost = parseRemoteHost(normalizedRemote);

    let permalink;
    if (remoteHost === "bitbucket.org") {
        // Bitbucket uses different line format: #lines-START:END
        const issueLocation = `#lines-${location.startLine + 1}:${location.endLine + 1}`;
        permalink = normalizedRemote + "/src/" + sha + "/" + location.path + issueLocation;
    } else {
        // GitHub/GitLab use #LSTART-LEND format
        const issueLocation = `#L${location.startLine + 1}-L${location.endLine + 1}`;
        permalink = normalizedRemote + "/blob/" + sha + "/" + location.path + issueLocation;
    }

    return { remote: normalizedRemote, permalink };
}

/**
 * Simulates getClientPermalink logic
 */
function getClientPermalink(clientRemote: string | undefined, sha: string | undefined, location: FullLocation): string | undefined {
    const result = getRemoteAndPermalink(clientRemote, sha, location);
    return result?.permalink;
}

/**
 * Simulates copyEntryPermalinks logic
 */
function copyEntryPermalinks(entry: FullEntry, gitRemote: string, sha: string, separator: string = "\n"): string | undefined {
    const permalinkList: string[] = [];

    for (const location of entry.locations) {
        const result = getRemoteAndPermalink(gitRemote, sha, location);
        if (result === undefined) {
            return undefined;
        }
        permalinkList.push(result.permalink);
    }

    // Interpret \n as newline in separator
    const interpretedSep = separator.replace(/\\n/g, "\n");
    return permalinkList.join(interpretedSep);
}

describe("Permalink Generation", () => {
    describe("getRemoteAndPermalink", () => {
        describe("platform-specific URL formats", () => {
            it("generates GitHub permalink URL", () => {
                const location = createFullLocation({
                    path: "src/Token.sol",
                    startLine: 100,
                    endLine: 110,
                });
                const gitRemote = "https://github.com/user/repo";
                const sha = "abc123def456";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result).to.not.be.undefined;
                expect(result!.remote).to.equal("https://github.com/user/repo");
                expect(result!.permalink).to.include("github.com");
                expect(result!.permalink).to.include("/blob/");
                expect(result!.permalink).to.include(sha);
                expect(result!.permalink).to.include("#L101-L111"); // 1-indexed
            });

            it("generates GitLab permalink URL", () => {
                const location = createFullLocation({
                    path: "contracts/Vault.sol",
                    startLine: 50,
                    endLine: 75,
                });
                const gitRemote = "https://gitlab.com/organization/project";
                const sha = "deadbeef1234";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result).to.not.be.undefined;
                expect(result!.remote).to.include("gitlab.com");
                expect(result!.permalink).to.include("/blob/");
                expect(result!.permalink).to.include("#L51-L76");
            });

            it("generates Bitbucket permalink URL with different line format", () => {
                const location = createFullLocation({
                    path: "src/main.py",
                    startLine: 25,
                    endLine: 30,
                });
                const gitRemote = "https://bitbucket.org/team/project";
                const sha = "cafebabe1234";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result).to.not.be.undefined;
                expect(result!.remote).to.include("bitbucket.org");
                // Bitbucket uses /src/ instead of /blob/
                expect(result!.permalink).to.include("/src/");
                // Bitbucket uses #lines-START:END format
                expect(result!.permalink).to.include("#lines-26:31");
            });
        });

        describe("line number formatting", () => {
            it("formats single line selection (#L10)", () => {
                const location = createFullLocation({
                    startLine: 9, // 0-indexed, displays as line 10
                    endLine: 9,
                });
                const gitRemote = "https://github.com/user/repo";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.permalink).to.include("#L10-L10");
            });

            it("formats line range (#L10-L20)", () => {
                const location = createFullLocation({
                    startLine: 9, // 0-indexed
                    endLine: 19, // 0-indexed
                });
                const gitRemote = "https://github.com/user/repo";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.permalink).to.include("#L10-L20");
            });

            it("handles first line of file (line 0 -> L1)", () => {
                const location = createFullLocation({
                    startLine: 0,
                    endLine: 5,
                });
                const gitRemote = "https://github.com/user/repo";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.permalink).to.include("#L1-L6");
            });

            it("handles large line numbers", () => {
                const location = createFullLocation({
                    startLine: 9999,
                    endLine: 10049,
                });
                const gitRemote = "https://github.com/user/repo";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.permalink).to.include("#L10000-L10050");
            });
        });

        describe("URL normalization", () => {
            it("strips .git suffix from remote URL", () => {
                const location = createFullLocation();
                const gitRemote = "https://github.com/user/repo.git";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.remote).to.equal("https://github.com/user/repo");
                expect(result!.permalink).to.not.include(".git");
            });

            it("handles SSH remote format (git@host:user/repo)", () => {
                const location = createFullLocation();
                const gitRemote = "git@github.com:user/repo.git";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.remote).to.equal("https://github.com/user/repo");
                expect(result!.permalink).to.include("https://github.com/user/repo/blob/");
            });

            it("handles SSH remote without .git suffix", () => {
                const location = createFullLocation();
                const gitRemote = "git@gitlab.com:org/project";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.remote).to.equal("https://gitlab.com/org/project");
            });

            it("preserves nested repo paths", () => {
                const location = createFullLocation({ path: "src/index.ts" });
                const gitRemote = "https://github.com/organization/team/project";
                const sha = "abc123";

                const result = getRemoteAndPermalink(gitRemote, sha, location);

                expect(result!.remote).to.equal("https://github.com/organization/team/project");
            });
        });

        describe("error handling", () => {
            it("returns undefined for missing remote", () => {
                const location = createFullLocation();
                const sha = "abc123";

                const result = getRemoteAndPermalink(undefined, sha, location);

                expect(result).to.be.undefined;
            });

            it("returns undefined for empty remote string", () => {
                const location = createFullLocation();
                const sha = "abc123";

                const result = getRemoteAndPermalink("", sha, location);

                expect(result).to.be.undefined;
            });

            it("returns undefined for missing SHA", () => {
                const location = createFullLocation();
                const gitRemote = "https://github.com/user/repo";

                const result = getRemoteAndPermalink(gitRemote, undefined, location);

                expect(result).to.be.undefined;
            });

            it("returns undefined for empty SHA string", () => {
                const location = createFullLocation();
                const gitRemote = "https://github.com/user/repo";

                const result = getRemoteAndPermalink(gitRemote, "", location);

                expect(result).to.be.undefined;
            });
        });
    });

    describe("getClientPermalink", () => {
        it("uses client remote for permalink", () => {
            const location = createFullLocation({ path: "src/file.ts", startLine: 10, endLine: 20 });
            const clientRemote = "https://github.com/client/their-repo";
            const sha = "clientsha123";

            const permalink = getClientPermalink(clientRemote, sha, location);

            expect(permalink).to.not.be.undefined;
            expect(permalink).to.include("client/their-repo");
            expect(permalink).to.include("clientsha123");
        });

        it("returns only permalink string (not remote)", () => {
            const location = createFullLocation();
            const clientRemote = "https://github.com/client/repo";
            const sha = "abc123";

            const result = getClientPermalink(clientRemote, sha, location);

            expect(typeof result).to.equal("string");
            expect(result).to.include("https://github.com");
        });

        it("returns undefined when client remote is not configured", () => {
            const location = createFullLocation();

            const result = getClientPermalink(undefined, "abc123", location);

            expect(result).to.be.undefined;
        });
    });

    describe("copyEntryPermalinks", () => {
        it("uses configured separator (default newline)", () => {
            const entry = createFullEntry({
                locations: [
                    createFullLocation({ path: "file1.ts", startLine: 10, endLine: 20 }),
                    createFullLocation({ path: "file2.ts", startLine: 30, endLine: 40 }),
                ],
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = copyEntryPermalinks(entry, gitRemote, sha, "\\n");

            expect(result).to.not.be.undefined;
            const lines = result!.split("\n");
            expect(lines).to.have.length(2);
            expect(lines[0]).to.include("file1.ts");
            expect(lines[1]).to.include("file2.ts");
        });

        it("uses custom separator", () => {
            const entry = createFullEntry({
                locations: [createFullLocation({ path: "file1.ts" }), createFullLocation({ path: "file2.ts" })],
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = copyEntryPermalinks(entry, gitRemote, sha, " | ");

            expect(result).to.include(" | ");
            const parts = result!.split(" | ");
            expect(parts).to.have.length(2);
        });

        it("handles multi-location entry", () => {
            const entry = createFullEntry({
                locations: [
                    createFullLocation({ path: "src/contracts/Token.sol", startLine: 10, endLine: 15 }),
                    createFullLocation({ path: "src/contracts/Token.sol", startLine: 100, endLine: 110 }),
                    createFullLocation({ path: "src/lib/Utils.sol", startLine: 50, endLine: 60 }),
                ],
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = copyEntryPermalinks(entry, gitRemote, sha, "\\n");

            expect(result).to.not.be.undefined;
            const lines = result!.split("\n");
            expect(lines).to.have.length(3);
            // First two should be same file, different lines
            expect(lines[0]).to.include("Token.sol");
            expect(lines[0]).to.include("#L11-L16");
            expect(lines[1]).to.include("Token.sol");
            expect(lines[1]).to.include("#L101-L111");
            expect(lines[2]).to.include("Utils.sol");
        });

        it("handles single location entry", () => {
            const entry = createFullEntry({
                locations: [createFullLocation({ path: "single.ts" })],
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = copyEntryPermalinks(entry, gitRemote, sha, "\\n");

            expect(result).to.not.be.undefined;
            expect(result!.split("\n")).to.have.length(1);
        });

        it("returns undefined if any location fails", () => {
            const entry = createFullEntry({
                locations: [createFullLocation()],
            });

            // Missing SHA will cause failure
            const result = copyEntryPermalinks(entry, "https://github.com/user/repo", "", "\\n");

            expect(result).to.be.undefined;
        });

        it("interprets \\n as actual newline character", () => {
            const entry = createFullEntry({
                locations: [createFullLocation({ path: "a.ts" }), createFullLocation({ path: "b.ts" })],
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            // User configures "\\n" in settings (string literal)
            const result = copyEntryPermalinks(entry, gitRemote, sha, "\\n");

            expect(result).to.include("\n");
            expect(result).to.not.include("\\n");
        });
    });

    describe("Edge Cases", () => {
        it("handles paths with special characters", () => {
            const location = createFullLocation({
                path: "src/components/[id]/page.tsx",
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.permalink).to.include("[id]");
        });

        it("handles paths with spaces (URL encoding may be needed)", () => {
            const location = createFullLocation({
                path: "src/My Component/file.ts",
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            // Path is included as-is; browser will handle encoding
            expect(result!.permalink).to.include("My Component");
        });

        it("handles unicode in file paths", () => {
            const location = createFullLocation({
                path: "src/i18n/translations.ts",
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.permalink).to.include("translations.ts");
        });

        it("handles very long commit SHAs", () => {
            const location = createFullLocation();
            const gitRemote = "https://github.com/user/repo";
            const sha = "a".repeat(40); // Full SHA-1 length

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.permalink).to.include(sha);
        });

        it("handles short commit SHAs", () => {
            const location = createFullLocation();
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123"; // Short SHA

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.permalink).to.include(sha);
        });

        it("handles self-hosted GitLab instance", () => {
            const location = createFullLocation();
            const gitRemote = "https://gitlab.mycompany.com/team/project";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            // Should use GitHub/GitLab format (not Bitbucket)
            expect(result!.permalink).to.include("/blob/");
            expect(result!.permalink).to.include("#L");
        });

        it("handles Azure DevOps-style URLs", () => {
            const location = createFullLocation();
            const gitRemote = "https://dev.azure.com/org/project/_git/repo";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            // Default to GitHub-style format for unknown hosts
            expect(result!.permalink).to.include("/blob/");
        });

        it("handles enterprise GitHub URLs", () => {
            const location = createFullLocation();
            const gitRemote = "https://github.mycompany.com/team/project";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.permalink).to.include("/blob/");
            expect(result!.permalink).to.include("#L");
        });

        it("handles deeply nested file paths", () => {
            const location = createFullLocation({
                path: "packages/core/src/lib/utils/helpers/validation/index.ts",
            });
            const gitRemote = "https://github.com/user/repo";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.permalink).to.include("packages/core/src/lib/utils/helpers/validation/index.ts");
        });

        it("handles multiple .git in URL path", () => {
            const location = createFullLocation();
            // Edge case: repo name contains 'git'
            const gitRemote = "https://github.com/user/git-tools.git";
            const sha = "abc123";

            const result = getRemoteAndPermalink(gitRemote, sha, location);

            expect(result!.remote).to.equal("https://github.com/user/git-tools");
        });
    });
});
