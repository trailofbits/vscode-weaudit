import { expect } from "chai";
import * as path from "path";

import { RootPathAndLabel } from "../../src/types";

/**
 * Helper to create a RootPathAndLabel for testing
 */
function createRootPathAndLabel(rootPath: string, rootLabel?: string): RootPathAndLabel {
    return {
        rootPath,
        rootLabel: rootLabel ?? path.basename(rootPath),
    };
}

/**
 * Simulates the isInThisWorkspaceRoot function logic
 * @param rootPath The workspace root path
 * @param filePath The file path to check
 * @returns [isInRoot, relativePath]
 */
function isInThisWorkspaceRoot(rootPath: string, filePath: string): [boolean, string] {
    const relativePath = path.relative(rootPath, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return [false, ""];
    }
    return [true, relativePath];
}

/**
 * Simulates createUniqueLabels function logic
 * Creates unique labels for workspace root paths
 */
function createUniqueLabels(rootPaths: string[]): RootPathAndLabel[] {
    const rootPathsAndLabels: RootPathAndLabel[] = rootPaths.map((rootPath) => ({
        rootPath: rootPath,
        rootLabel: path.basename(rootPath),
    }));

    const rootLabels = rootPathsAndLabels.map((r) => r.rootLabel);

    if (new Set(rootLabels).size === rootPaths.length) {
        return rootPathsAndLabels;
    }

    // Find and resolve duplicates
    const duplicateMap = new Map<string, string[]>();
    for (const entry of rootPathsAndLabels) {
        const existing = duplicateMap.get(entry.rootLabel);
        if (existing === undefined) {
            duplicateMap.set(entry.rootLabel, [entry.rootPath]);
        } else {
            duplicateMap.set(entry.rootLabel, existing.concat(entry.rootPath));
        }
    }

    // Get entries that have duplicates
    const duplicates = rootPathsAndLabels.filter((entry) => duplicateMap.get(entry.rootLabel) !== undefined && duplicateMap.get(entry.rootLabel)!.length > 1);

    // Prepare for recursion by moving up one directory level
    for (const dup of duplicates) {
        dup.rootPath = path.parse(dup.rootPath).dir;
    }

    recurseUniqueLabels(duplicates);

    // Restore original rootPaths
    for (const dup of duplicates) {
        dup.rootPath = path.join(dup.rootPath, dup.rootLabel);
    }

    return rootPathsAndLabels;
}

/**
 * Recursively adds parent directory prefixes to disambiguate labels
 */
function recurseUniqueLabels(rootPathsAndLabels: RootPathAndLabel[]): void {
    for (const entry of rootPathsAndLabels) {
        const parsed = path.parse(entry.rootPath);
        const labelPrefix = parsed.base ? parsed.base : "/";
        entry.rootLabel = path.join(labelPrefix, entry.rootLabel);
        entry.rootPath = path.join(parsed.root, parsed.dir);
    }

    const labels = rootPathsAndLabels.map((e) => e.rootLabel);
    if (new Set(labels).size === rootPathsAndLabels.length) {
        return;
    }

    // Still have duplicates - recurse
    const duplicateMap = new Map<string, string[]>();
    for (const entry of rootPathsAndLabels) {
        const existing = duplicateMap.get(entry.rootLabel);
        if (existing === undefined) {
            duplicateMap.set(entry.rootLabel, [entry.rootPath]);
        } else {
            duplicateMap.set(entry.rootLabel, existing.concat(entry.rootPath));
        }
    }

    const duplicates = rootPathsAndLabels.filter((entry) => duplicateMap.get(entry.rootLabel) !== undefined && duplicateMap.get(entry.rootLabel)!.length > 1);

    recurseUniqueLabels(duplicates);
}

/**
 * Mock WARoot for testing
 */
interface MockWARoot {
    rootPath: string;
    rootLabel: string;
    isInThisWorkspaceRoot: (filePath: string) => [boolean, string];
}

function createMockWARoot(rootPath: string, rootLabel: string): MockWARoot {
    return {
        rootPath,
        rootLabel,
        isInThisWorkspaceRoot: (filePath: string) => isInThisWorkspaceRoot(rootPath, filePath),
    };
}

/**
 * Simulates getCorrespondingRootAndPath logic
 * Returns the closest matching root and the relative path
 */
function getCorrespondingRootAndPath(
    roots: MockWARoot[],
    filePath: string,
    cache: Map<string, [MockWARoot | undefined, string, boolean]>,
): [MockWARoot | undefined, string, boolean] {
    const cached = cache.get(filePath);
    if (cached !== undefined) {
        return cached;
    }

    let currentBest: [MockWARoot | undefined, string] = [undefined, ""];
    let currentDistance = -1;
    let inMultipleRoots = false;

    for (const root of roots) {
        const [inWS, relativePath] = root.isInThisWorkspaceRoot(filePath);
        if (inWS) {
            if (currentBest[0] === undefined) {
                currentBest = [root, relativePath];
                currentDistance = relativePath.length;
                cache.set(filePath, [root, relativePath, false]);
            } else {
                inMultipleRoots = true;
                if (relativePath.length < currentDistance) {
                    currentBest = [root, relativePath];
                    currentDistance = relativePath.length;
                    cache.set(filePath, [root, relativePath, true]);
                }
            }
        }
    }
    return [...currentBest, inMultipleRoots];
}

/**
 * Simulates getAllCorrespondingRootsAndPaths logic
 */
function getAllCorrespondingRootsAndPaths(roots: MockWARoot[], filePath: string, cache: Map<string, [MockWARoot, string][]>): [MockWARoot, string][] {
    const cached = cache.get(filePath);
    if (cached !== undefined) {
        return cached;
    }

    const result: [MockWARoot, string][] = [];
    for (const root of roots) {
        const [inWS, relativePath] = root.isInThisWorkspaceRoot(filePath);
        if (inWS) {
            result.push([root, relativePath]);
        }
    }

    cache.set(filePath, result);
    return result;
}

describe("Multi-Root Workspace Management", () => {
    describe("createUniqueLabels", () => {
        it("uses basename for single root", () => {
            const rootPaths = ["/home/user/projects/myapp"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(1);
            expect(labels[0].rootLabel).to.equal("myapp");
            expect(labels[0].rootPath).to.equal("/home/user/projects/myapp");
        });

        it("uses basename for multiple roots with unique names", () => {
            const rootPaths = ["/home/user/projects/frontend", "/home/user/projects/backend", "/home/user/projects/shared"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(3);
            expect(labels[0].rootLabel).to.equal("frontend");
            expect(labels[1].rootLabel).to.equal("backend");
            expect(labels[2].rootLabel).to.equal("shared");
        });

        it("disambiguates duplicates by adding parent directory", () => {
            const rootPaths = ["/home/user/project-a/src", "/home/user/project-b/src"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(2);
            // Labels should include parent directory to disambiguate
            expect(labels[0].rootLabel).to.include("project-a");
            expect(labels[1].rootLabel).to.include("project-b");
            // Both should end with 'src'
            expect(labels[0].rootLabel).to.match(/src$/);
            expect(labels[1].rootLabel).to.match(/src$/);
        });

        it("handles three roots with same basename", () => {
            const rootPaths = ["/home/alice/code/src", "/home/bob/code/src", "/home/charlie/code/src"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(3);
            // All should be unique
            const labelSet = new Set(labels.map((l) => l.rootLabel));
            expect(labelSet.size).to.equal(3);
        });

        it("handles empty root paths array", () => {
            const rootPaths: string[] = [];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(0);
        });

        it("handles root at filesystem root", () => {
            const rootPaths = ["/"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(1);
            // basename of "/" is ""
            expect(labels[0].rootLabel).to.equal("");
        });
    });

    describe("recurseUniqueLabels", () => {
        it("resolves deeply nested duplicates", () => {
            // Same name at multiple nested levels
            const rootPaths = ["/home/team-a/repos/client/app/src", "/home/team-b/repos/client/app/src"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(2);
            // Should have recursed enough to differentiate
            const labelSet = new Set(labels.map((l) => l.rootLabel));
            expect(labelSet.size).to.equal(2);
            // Both should include distinguishing parent paths
            expect(labels[0].rootLabel).to.not.equal(labels[1].rootLabel);
        });

        it("stops recursion when labels become unique", () => {
            // Duplicates that differ at first parent level
            const rootPaths = ["/workspace/project1/src", "/workspace/project2/src"];

            const labels = createUniqueLabels(rootPaths);

            // Should find unique labels at project level
            expect(labels[0].rootLabel).to.include("project1");
            expect(labels[1].rootLabel).to.include("project2");
        });

        it("handles mix of unique and duplicate basenames", () => {
            const rootPaths = ["/home/user/frontend", "/home/user/backend", "/work/other/backend"];

            const labels = createUniqueLabels(rootPaths);

            expect(labels).to.have.length(3);
            // frontend should remain simple
            expect(labels[0].rootLabel).to.equal("frontend");
            // Both backends need disambiguation
            const backendLabels = labels.filter((l) => l.rootLabel.includes("backend"));
            expect(backendLabels).to.have.length(2);
            expect(backendLabels[0].rootLabel).to.not.equal(backendLabels[1].rootLabel);
        });
    });

    describe("getCorrespondingRootAndPath", () => {
        it("finds correct root for file path", () => {
            const roots = [createMockWARoot("/workspace/project1", "project1"), createMockWARoot("/workspace/project2", "project2")];
            const cache = new Map<string, [MockWARoot | undefined, string, boolean]>();

            const [root, relativePath, inMultiple] = getCorrespondingRootAndPath(roots, "/workspace/project1/src/file.ts", cache);

            expect(root).to.not.be.undefined;
            expect(root!.rootPath).to.equal("/workspace/project1");
            expect(relativePath).to.equal("src/file.ts");
            expect(inMultiple).to.be.false;
        });

        it("handles nested roots - returns closest (shortest relative path)", () => {
            // Nested roots: project2 is inside project1
            const roots = [createMockWARoot("/workspace/project1", "project1"), createMockWARoot("/workspace/project1/nested", "nested")];
            const cache = new Map<string, [MockWARoot | undefined, string, boolean]>();

            const [root, relativePath, inMultiple] = getCorrespondingRootAndPath(roots, "/workspace/project1/nested/src/file.ts", cache);

            expect(root).to.not.be.undefined;
            // Should return the nested root (closer match)
            expect(root!.rootPath).to.equal("/workspace/project1/nested");
            expect(relativePath).to.equal("src/file.ts");
            expect(inMultiple).to.be.true;
        });

        it("caches results for repeated lookups", () => {
            const roots = [createMockWARoot("/workspace/project", "project")];
            const cache = new Map<string, [MockWARoot | undefined, string, boolean]>();
            const filePath = "/workspace/project/src/file.ts";

            // First call
            const result1 = getCorrespondingRootAndPath(roots, filePath, cache);
            expect(cache.has(filePath)).to.be.true;

            // Second call - should use cache
            const result2 = getCorrespondingRootAndPath(roots, filePath, cache);
            expect(result1[0]).to.equal(result2[0]);
            expect(result1[1]).to.equal(result2[1]);
        });

        it("returns undefined for file outside all roots", () => {
            const roots = [createMockWARoot("/workspace/project1", "project1"), createMockWARoot("/workspace/project2", "project2")];
            const cache = new Map<string, [MockWARoot | undefined, string, boolean]>();

            const [root, relativePath, inMultiple] = getCorrespondingRootAndPath(roots, "/other/location/file.ts", cache);

            expect(root).to.be.undefined;
            expect(relativePath).to.equal("");
            expect(inMultiple).to.be.false;
        });

        it("handles empty roots array", () => {
            const roots: MockWARoot[] = [];
            const cache = new Map<string, [MockWARoot | undefined, string, boolean]>();

            const [root, relativePath, inMultiple] = getCorrespondingRootAndPath(roots, "/any/path/file.ts", cache);

            expect(root).to.be.undefined;
            expect(relativePath).to.equal("");
            expect(inMultiple).to.be.false;
        });
    });

    describe("getAllCorrespondingRootsAndPaths", () => {
        it("returns all matching roots for nested workspace roots", () => {
            const roots = [createMockWARoot("/workspace/project1", "project1"), createMockWARoot("/workspace/project1/submodule", "submodule")];
            const cache = new Map<string, [MockWARoot, string][]>();

            const result = getAllCorrespondingRootsAndPaths(roots, "/workspace/project1/submodule/file.ts", cache);

            expect(result).to.have.length(2);
            // Both roots should contain this path
            const rootPaths = result.map((r) => r[0].rootPath);
            expect(rootPaths).to.include("/workspace/project1");
            expect(rootPaths).to.include("/workspace/project1/submodule");
        });

        it("returns empty array for file outside all roots", () => {
            const roots = [createMockWARoot("/workspace/project", "project")];
            const cache = new Map<string, [MockWARoot, string][]>();

            const result = getAllCorrespondingRootsAndPaths(roots, "/other/location/file.ts", cache);

            expect(result).to.have.length(0);
        });

        it("returns single root for non-nested workspace", () => {
            const roots = [createMockWARoot("/workspace/project1", "project1"), createMockWARoot("/workspace/project2", "project2")];
            const cache = new Map<string, [MockWARoot, string][]>();

            const result = getAllCorrespondingRootsAndPaths(roots, "/workspace/project1/src/file.ts", cache);

            expect(result).to.have.length(1);
            expect(result[0][0].rootPath).to.equal("/workspace/project1");
            expect(result[0][1]).to.equal("src/file.ts");
        });

        it("caches results", () => {
            const roots = [createMockWARoot("/workspace/project", "project")];
            const cache = new Map<string, [MockWARoot, string][]>();
            const filePath = "/workspace/project/src/file.ts";

            getAllCorrespondingRootsAndPaths(roots, filePath, cache);
            expect(cache.has(filePath)).to.be.true;

            // Verify cache is returned
            const cachedResult = cache.get(filePath);
            const result = getAllCorrespondingRootsAndPaths(roots, filePath, cache);
            expect(result).to.equal(cachedResult);
        });
    });

    describe("isInThisWorkspaceRoot", () => {
        it("returns true for file inside workspace root", () => {
            const rootPath = "/workspace/project";
            const filePath = "/workspace/project/src/components/Button.tsx";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("src/components/Button.tsx");
        });

        it("returns true for file directly in workspace root", () => {
            const rootPath = "/workspace/project";
            const filePath = "/workspace/project/package.json";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("package.json");
        });

        it("returns false for file outside workspace root", () => {
            const rootPath = "/workspace/project1";
            const filePath = "/workspace/project2/src/file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.false;
            expect(relativePath).to.equal("");
        });

        it("returns false for parent directory of workspace root", () => {
            const rootPath = "/workspace/project";
            const filePath = "/workspace/other.txt";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.false;
            expect(relativePath).to.equal("");
        });

        it("returns false for sibling directory", () => {
            const rootPath = "/workspace/project";
            const filePath = "/workspace/sibling/file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.false;
            expect(relativePath).to.equal("");
        });

        it("handles deeply nested file paths", () => {
            const rootPath = "/workspace/project";
            const filePath = "/workspace/project/src/deep/nested/path/to/file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("src/deep/nested/path/to/file.ts");
        });

        it("handles workspace root being the filesystem root", () => {
            const rootPath = "/";
            const filePath = "/any/path/file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("any/path/file.ts");
        });
    });

    describe("Edge Cases", () => {
        it("handles paths with special characters", () => {
            const rootPath = "/workspace/my-project_v2";
            const filePath = "/workspace/my-project_v2/src/[id]/page.tsx";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("src/[id]/page.tsx");
        });

        it("handles paths with spaces", () => {
            const rootPath = "/workspace/My Project";
            const filePath = "/workspace/My Project/src/file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("src/file.ts");
        });

        it("handles symbolic-link-like paths (relative path traversal blocked)", () => {
            const rootPath = "/workspace/project";
            // Trying to escape via relative path
            const filePath = "/workspace/project/../other/file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, path.resolve(filePath));

            // path.resolve normalizes, so this becomes /workspace/other/file.ts
            expect(isIn).to.be.false;
        });

        it("handles case sensitivity (Unix-style)", () => {
            const rootPath = "/workspace/Project";
            const filePath = "/workspace/project/file.ts";

            const [isIn, _relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            // On case-sensitive systems, these are different paths
            // This test documents expected behavior on Unix
            expect(isIn).to.be.false;
        });

        it("handles same path for root and file", () => {
            const rootPath = "/workspace/project";
            const filePath = "/workspace/project";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, filePath);

            expect(isIn).to.be.true;
            expect(relativePath).to.equal("");
        });

        it("handles very long paths", () => {
            const rootPath = "/workspace/project";
            const deepPath = "/workspace/project/" + "deep/".repeat(50) + "file.ts";

            const [isIn, relativePath] = isInThisWorkspaceRoot(rootPath, deepPath);

            expect(isIn).to.be.true;
            expect(relativePath).to.include("deep/");
        });

        it("correctly identifies root at same level but different name", () => {
            const roots = [createMockWARoot("/workspace/frontend", "frontend"), createMockWARoot("/workspace/backend", "backend")];
            const cache = new Map<string, [MockWARoot | undefined, string, boolean]>();

            const [frontendRoot] = getCorrespondingRootAndPath(roots, "/workspace/frontend/app.ts", cache);
            const [backendRoot] = getCorrespondingRootAndPath(roots, "/workspace/backend/server.ts", cache);

            expect(frontendRoot!.rootLabel).to.equal("frontend");
            expect(backendRoot!.rootLabel).to.equal("backend");
        });
    });
});
