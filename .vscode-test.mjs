import { defineConfig } from "@vscode/test-cli";
import * as path from "path";
import * as fs from "fs";

const sharedStorageDir = path.resolve(".test-extensions");
const userDataDir = path.join(sharedStorageDir, "user-data");
const extensionsDir = path.join(sharedStorageDir, "extensions");
const localCodeExecutable = process.env.VSCODE_EXECUTABLE_PATH || ["/usr/local/bin/code", "/usr/bin/code"].find((candidate) => fs.existsSync(candidate));

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });

export default defineConfig({
    files: "out/test/extension/suite/**/*.test.js",
    version: process.env.VSCODE_VERSION || "stable",
    workspaceFolder: path.resolve("test/extension/fixtures/sample-workspace"),
    mocha: {
        ui: "tdd",
        timeout: 60000,
    },
    useInstallation: localCodeExecutable ? { fromPath: localCodeExecutable } : undefined,
    launchArgs: ["--disable-extensions", "--disable-gpu", "--disable-workspace-trust", "--user-data-dir", userDataDir, "--extensions-dir", extensionsDir],
    extensionDevelopmentPath: path.resolve("."),
});
