const { build, context } = require("esbuild");

const isProduction =
    process.argv.includes("--production") || process.env.NODE_ENV === "production";

const baseConfig = {
    bundle: true,
    minify: isProduction,
    sourcemap: !isProduction,
};

const extensionConfig = {
    ...baseConfig,
    platform: "node",
    mainFields: ["module", "main"],
    format: "cjs",
    loader: { ".html": "text" },
    entryPoints: ["./src/extension.ts"],
    outfile: "./out/extension.js",
    external: ["vscode"],
};

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

const watchPlugin = {
    name: "watch-plugin",
    setup(build) {
        build.onStart(() => {
            console.log(`[watch] build started (${build.initialOptions.outfile})`);
        });

        build.onEnd((result) => {
            console.log(
                `${result.errors.length > 0 ? "[watch] build finished with errors" : "[watch] build finished successfully"} (${build.initialOptions.outfile})`,
            );
        });
    },
};

(async () => {
    const args = process.argv.slice(2);
    try {
        if (args.includes("--watch")) {
            // Build and watch extension and webview code
            const extensionContext = await context({
                ...extensionConfig,
                plugins: [watchPlugin],
            });
            const webviewContext = await context({
                ...webviewConfig,
                plugins: [watchPlugin],
            });
            const gitConfigWebviewContext = await context({
                ...gitConfigWebviewConfig,
                plugins: [watchPlugin],
            });

            await extensionContext.watch();
            await webviewContext.watch();
            await gitConfigWebviewContext.watch();
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
