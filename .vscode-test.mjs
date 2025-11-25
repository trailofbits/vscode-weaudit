import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
    files: "out/test/extension/**/*.test.js",
    version: process.env.VSCODE_VERSION || "stable",
    mocha: {
        ui: "bdd",
        timeout: 60000,
    },
    launchArgs: ["--disable-extensions", "--disable-gpu"],
});
