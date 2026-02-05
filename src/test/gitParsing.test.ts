import * as assert from "node:assert";

/**
 * Tests for git config parsing logic used in codeMarker.ts
 *
 * The actual git parsing methods (findGitRemote, findGitSha) are tightly coupled
 * to VS Code API and filesystem operations. These tests verify the regex patterns
 * and URL transformation logic used within those methods.
 */
describe("Git Config Parsing Logic", () => {
    // This is the regex pattern used in codeMarker.ts:378
    const remoteUrlPattern = /url = (.*)/g;

    describe("remote URL extraction", () => {
        it("should extract HTTPS URL from git config", () => {
            const gitConfig = `[remote "origin"]
    url = https://github.com/trailofbits/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/origin/*`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            assert.strictEqual(matches.length, 1);
            assert.ok(matches[0].includes("https://github.com/trailofbits/vscode-weaudit.git"));
        });

        it("should extract SSH URL from git config", () => {
            const gitConfig = `[remote "origin"]
    url = git@github.com:trailofbits/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/origin/*`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            assert.strictEqual(matches.length, 1);
            assert.ok(matches[0].includes("git@github.com:trailofbits/vscode-weaudit.git"));
        });

        it("should extract multiple remotes from git config", () => {
            const gitConfig = `[remote "origin"]
    url = https://github.com/trailofbits/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/origin/*
[remote "upstream"]
    url = git@github.com:client/vscode-weaudit.git
    fetch = +refs/heads/*:refs/remotes/upstream/*`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            assert.strictEqual(matches.length, 2);
        });

        it("should handle URL with credentials", () => {
            const gitConfig = `[remote "origin"]
    url = https://user:token=abc123@github.com/org/repo.git`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.ok(matches);
            // Should match the entire URL including credentials with '='
            assert.ok(matches[0].includes("user:token=abc123"));
        });

        it("should return null for config without remotes", () => {
            const gitConfig = `[core]
    repositoryformatversion = 0
    filemode = true`;

            const matches = gitConfig.match(remoteUrlPattern);
            assert.strictEqual(matches, null);
        });
    });

    describe("SSH to HTTPS URL transformation", () => {
        // This transformation is done in codeMarker.ts:403-405
        function transformSshToHttps(url: string): string {
            if (url.startsWith("git@github.com:")) {
                return url.replace("git@github.com:", "https://github.com/");
            }
            return url;
        }

        it("should convert SSH URL to HTTPS URL", () => {
            const sshUrl = "git@github.com:trailofbits/vscode-weaudit.git";
            const result = transformSshToHttps(sshUrl);
            assert.strictEqual(result, "https://github.com/trailofbits/vscode-weaudit.git");
        });

        it("should preserve HTTPS URLs unchanged", () => {
            const httpsUrl = "https://github.com/trailofbits/vscode-weaudit.git";
            const result = transformSshToHttps(httpsUrl);
            assert.strictEqual(result, httpsUrl);
        });

        it("should handle SSH URLs with nested paths", () => {
            const sshUrl = "git@github.com:org/team/project.git";
            const result = transformSshToHttps(sshUrl);
            assert.strictEqual(result, "https://github.com/org/team/project.git");
        });

        it("should not transform other SSH-style URLs", () => {
            const gitlabUrl = "git@gitlab.com:org/repo.git";
            const result = transformSshToHttps(gitlabUrl);
            // This URL uses the same pattern but different host
            assert.strictEqual(result, gitlabUrl);
        });
    });

    describe(".git suffix removal", () => {
        // This transformation is done in codeMarker.ts:409-411
        function removeGitSuffix(url: string): string {
            if (url.endsWith(".git")) {
                return url.slice(0, -".git".length);
            }
            return url;
        }

        it("should remove .git suffix", () => {
            const url = "https://github.com/trailofbits/vscode-weaudit.git";
            const result = removeGitSuffix(url);
            assert.strictEqual(result, "https://github.com/trailofbits/vscode-weaudit");
        });

        it("should preserve URLs without .git suffix", () => {
            const url = "https://github.com/trailofbits/vscode-weaudit";
            const result = removeGitSuffix(url);
            assert.strictEqual(result, url);
        });

        it("should only remove .git at the end, not in the middle", () => {
            const url = "https://github.com/org/dotgit-project";
            const result = removeGitSuffix(url);
            assert.strictEqual(result, url);
        });

        it("should handle URL with .git in path but also as suffix", () => {
            // Edge case: .git appears in path AND as suffix
            const url = "https://github.com/my.git.org/repo.git";
            const result = removeGitSuffix(url);
            assert.strictEqual(result, "https://github.com/my.git.org/repo");
        });
    });

    describe("git SHA parsing", () => {
        // This pattern is from codeMarker.ts:461
        const refPattern = /ref: (.*)/;

        it("should extract ref path from HEAD file content", () => {
            const headContent = "ref: refs/heads/main";
            const match = headContent.match(refPattern);
            assert.ok(match);
            assert.strictEqual(match[1], "refs/heads/main");
        });

        it("should extract ref for feature branch", () => {
            const headContent = "ref: refs/heads/feature/my-feature";
            const match = headContent.match(refPattern);
            assert.ok(match);
            assert.strictEqual(match[1], "refs/heads/feature/my-feature");
        });

        it("should return null for detached HEAD (direct SHA)", () => {
            const headContent = "abc123def456789012345678901234567890abcd";
            const match = headContent.match(refPattern);
            assert.strictEqual(match, null);
        });

        it("should validate SHA length for detached HEAD", () => {
            // This validation is done in codeMarker.ts:466-468
            const validSha = "abc123def456789012345678901234567890abcd"; // 40 chars
            const invalidSha = "abc123"; // Too short

            assert.strictEqual(validSha.trim().length, 40);
            assert.notStrictEqual(invalidSha.trim().length, 40);
        });
    });

    describe("organization matching", () => {
        // This logic is from codeMarker.ts:396-408
        function findOrgRemote(remotes: string[], orgName: string): string | undefined {
            for (const remote of remotes) {
                if (!remote.includes(orgName)) {
                    continue;
                }
                let remotePath = remote.split("=")[1].trim();
                if (remotePath.startsWith("git@github.com:")) {
                    remotePath = remotePath.replace("git@github.com:", "https://github.com/");
                }
                if (remotePath.includes(`github.com/${orgName}/`)) {
                    if (remotePath.endsWith(".git")) {
                        remotePath = remotePath.slice(0, -".git".length);
                    }
                    return remotePath;
                }
            }
            return undefined;
        }

        it("should find remote matching organization name", () => {
            const remotes = ["url = https://github.com/trailofbits/vscode-weaudit.git", "url = https://github.com/client/original-repo.git"];
            const result = findOrgRemote(remotes, "trailofbits");
            assert.strictEqual(result, "https://github.com/trailofbits/vscode-weaudit");
        });

        it("should convert SSH URL when matching", () => {
            const remotes = ["url = git@github.com:trailofbits/vscode-weaudit.git"];
            const result = findOrgRemote(remotes, "trailofbits");
            assert.strictEqual(result, "https://github.com/trailofbits/vscode-weaudit");
        });

        it("should return undefined when no org match found", () => {
            const remotes = ["url = https://github.com/other-org/repo.git"];
            const result = findOrgRemote(remotes, "trailofbits");
            assert.strictEqual(result, undefined);
        });

        it("should skip remote if org appears but not in github.com/org/ pattern", () => {
            // e.g., org name appears in repo name, not as org
            const remotes = ["url = https://github.com/someone/trailofbits-fork.git"];
            const result = findOrgRemote(remotes, "trailofbits");
            assert.strictEqual(result, undefined);
        });
    });

    describe("Central sync repo key selection", () => {
        /**
         * Normalize a remote URL into a stable https form without credentials.
         */
        function normalizeRemoteUrl(remoteUrl: string): string {
            let value = remoteUrl.trim();
            if (value.length === 0) {
                return "";
            }

            const scpLikeMatch = value.match(/^[^@]+@([^:]+):(.+)$/);
            if (scpLikeMatch) {
                value = `https://${scpLikeMatch[1]}/${scpLikeMatch[2]}`;
            }

            if (value.startsWith("ssh://")) {
                try {
                    const parsed = new URL(value);
                    value = `https://${parsed.host}${parsed.pathname}`;
                } catch (_error) {
                    return value;
                }
            }

            if (value.startsWith("git://")) {
                value = `https://${value.slice("git://".length)}`;
            }

            if (value.startsWith("http://") || value.startsWith("https://")) {
                try {
                    const parsed = new URL(value);
                    value = `https://${parsed.host}${parsed.pathname}`;
                } catch (_error) {
                    return value;
                }
            }

            if (value.endsWith(".git")) {
                value = value.slice(0, -".git".length);
            }

            return value.replace(/\/+$/, "");
        }

        /**
         * Convert a normalized remote URL into a filesystem-safe repo key.
         */
        function formatRepoKey(normalizedUrl: string): string {
            const withoutScheme = normalizedUrl.replace(/^[a-z]+:\/\//i, "");
            const sanitized = withoutScheme.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
            return sanitized;
        }

        /**
         * Check if a normalized remote URL belongs to the preferred GitHub organization.
         */
        function isPreferredOrgRemote(normalizedUrl: string, orgName: string): boolean {
            try {
                const parsed = new URL(normalizedUrl);
                return parsed.hostname.toLowerCase() === "github.com" && parsed.pathname.toLowerCase().startsWith(`/${orgName}/`);
            } catch (_error) {
                return normalizedUrl.toLowerCase().includes(`github.com/${orgName.toLowerCase()}/`);
            }
        }

        /**
         * Select the preferred remote URL, prioritizing a specific GitHub organization.
         */
        function selectPreferredRemoteUrl(normalizedRemotes: string[], orgName: string): string | undefined {
            for (const remote of normalizedRemotes) {
                if (isPreferredOrgRemote(remote, orgName)) {
                    return remote;
                }
            }
            return normalizedRemotes[0];
        }

        it("should prefer trailofbits remote when present", () => {
            const remotes = [
                normalizeRemoteUrl("https://github.com/client/project.git"),
                normalizeRemoteUrl("git@github.com:trailofbits/audit-repo.git"),
            ];
            const selected = selectPreferredRemoteUrl(remotes, "trailofbits");
            assert.strictEqual(selected, "https://github.com/trailofbits/audit-repo");
        });

        it("should normalize SSH remotes and strip .git suffix", () => {
            const normalized = normalizeRemoteUrl("git@github.com:trailofbits/vscode-weaudit.git");
            assert.strictEqual(normalized, "https://github.com/trailofbits/vscode-weaudit");
        });

        it("should strip credentials from https remotes", () => {
            const normalized = normalizeRemoteUrl("https://user:token@github.com/org/repo.git");
            assert.strictEqual(normalized, "https://github.com/org/repo");
        });

        it("should format repo keys as safe slugs", () => {
            const normalized = "https://github.com/trailofbits/vscode-weaudit";
            const repoKey = formatRepoKey(normalized);
            assert.strictEqual(repoKey, "github.com_trailofbits_vscode-weaudit");
        });
    });
});
