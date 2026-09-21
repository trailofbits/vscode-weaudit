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

export default defineConfig({
    files: "out/test/extension/suite/**/*.test.js",
    version: process.env.VSCODE_VERSION || "stable",
    workspaceFolder: workspaceFile,
    mocha: {
        ui: "tdd",
        timeout: 60000,
    },
    launchArgs: ["--disable-extensions", "--disable-gpu", "--disable-workspace-trust", "--user-data-dir", userDataDir, "--extensions-dir", extensionsDir],
    extensionDevelopmentPath: path.resolve("."),
});
