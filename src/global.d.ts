// Global type declarations for non-TypeScript modules

declare module "*.html" {
    const content: string;
    export default content;
}

// VSCode webview API type declaration
interface VscodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VscodeApi;
