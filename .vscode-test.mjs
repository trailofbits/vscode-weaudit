import { defineConfig } from "@vscode/test-cli";
import * as path from "path";
import * as fs from "fs";

const sharedStorageDir = path.resolve(".test-extensions");
const userDataDir = path.join(sharedStorageDir, "integration-user-data");
const extensionsDir = path.join(sharedStorageDir, "extensions");

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });

// A workspace file lets tests add and remove roots without converting a folder window.
const workspaceFile = path.join(sharedStorageDir, "integration.code-workspace");
fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: path.resolve("test/extension/fixtures/sample-workspace") }] }));

// Bulk lifecycle commands need a host without the other suites' saved findings.
const stateWorkspaceRoot = path.join(sharedStorageDir, "audit-state-workspace");
const stateWorkspaceFile = path.join(sharedStorageDir, "audit-state.code-workspace");
fs.mkdirSync(stateWorkspaceRoot, { recursive: true });
fs.writeFileSync(stateWorkspaceFile, JSON.stringify({ folders: [{ path: stateWorkspaceRoot }] }));

const sharedConfig = {
    version: process.env.VSCODE_VERSION || "stable",
    mocha: { ui: "tdd", timeout: 60000 },
    launchArgs: ["--disable-extensions", "--disable-gpu", "--disable-workspace-trust", "--user-data-dir", userDataDir, "--extensions-dir", extensionsDir],
    extensionDevelopmentPath: path.resolve("."),
};

export default defineConfig({
    tests: [
        {
            ...sharedConfig,
            label: "integration",
            files: "out/test/extension/suite/**/*.test.js",
            workspaceFolder: workspaceFile,
        },
        {
            ...sharedConfig,
            label: "audit-state",
            files: "out/test/extension/state/**/*.test.js",
            workspaceFolder: stateWorkspaceFile,
        },
    ],
    coverage: {
        includeAll: true,
        // Include the bundle so V8 can map executed code back to the TypeScript sources.
        include: ["**/src/**/*.ts", "**/out/extension.js"],
        exclude: ["**/node_modules/**", "**/test/**", "**/src/webview/**", "**/*.d.ts"],
        reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
    },
});
