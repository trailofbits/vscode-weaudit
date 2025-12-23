import { defineConfig } from "@vscode/test-cli";
import * as path from "path";

export default defineConfig({
    files: "out/test/extension/suite/**/*.test.js",
    version: process.env.VSCODE_VERSION || "stable",
    workspaceFolder: path.resolve("test/extension/fixtures/sample-workspace"),
    mocha: {
        ui: "tdd",
        timeout: 60000,
    },
    launchArgs: ["--disable-extensions", "--disable-gpu", "--disable-workspace-trust"],
    extensionDevelopmentPath: path.resolve("."),
});
