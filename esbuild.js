const { build } = require("esbuild");

const baseConfig = {
    bundle: true,
    minify: process.env.NODE_ENV === "production",
    sourcemap: process.env.NODE_ENV !== "production",
};

const extensionConfig = {
    ...baseConfig,
    platform: "node",
    mainFields: ["module", "main"],
    format: "cjs",
    loader: {
        ".html": "text",
    },
    entryPoints: ["./src/extension.ts"],
    outfile: "./out/extension.js",
    external: ["vscode"],
};

(async () => {
    try {
        await build(extensionConfig);
        console.log("build complete");
    } catch (err) {
        process.stderr.write(err.stderr);
        process.exit(1);
    }
})();

const watchConfig = {
    watch: {
        onRebuild(error, result) {
            console.log("[watch] build started");
            if (error) {
                error.errors.forEach((error) =>
                    console.error(`> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`),
                );
            } else {
                console.log("[watch] build finished");
            }
        },
    },
};

(async () => {
    const args = process.argv.slice(2);
    try {
        if (args.includes("--watch")) {
            // Build and watch source code
            console.log("[watch] build started");
            await build({
                ...extensionConfig,
                ...watchConfig,
            });
            console.log("[watch] build finished");
        } else {
            // Build source code
            await build(extensionConfig);
            console.log("build complete");
        }
    } catch (err) {
        process.stderr.write(err.stderr);
        process.exit(1);
    }
})();

const webviewConfig = {
    ...baseConfig,
    target: "es2020",
    format: "esm",
    entryPoints: ["./src/webview/findingDetailsMain.ts"],
    outfile: "./out/findingDetailsWebview.js",
};

const gitConfigWebviewConfig = {
    ...baseConfig,
    target: "es2020",
    format: "esm",
    entryPoints: ["./src/webview/gitConfigMain.ts"],
    outfile: "./out/gitConfigWebview.js",
};

(async () => {
    const args = process.argv.slice(2);
    try {
        if (args.includes("--watch")) {
            // Build and watch extension and webview code
            console.log("[watch] build started");
            await build({
                ...extensionConfig,
                ...watchConfig,
            });
            await build({
                ...webviewConfig,
                ...watchConfig,
            });
            await build({
                ...gitConfigWebviewConfig,
                ...watchConfig,
            });
            console.log("[watch] build finished");
        } else {
            // Build extension and webview code
            await build(extensionConfig);
            await build(webviewConfig);
            await build(gitConfigWebviewConfig);
            console.log("build complete");
        }
    } catch (err) {
        process.stderr.write(err.stderr);
        process.exit(1);
    }
})();
