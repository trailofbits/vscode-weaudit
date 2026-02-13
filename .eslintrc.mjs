import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import stylistic from "@stylistic/eslint-plugin";

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export default [
    {
        ignores: ["out", "dist", "**/*.d.ts", "esbuild.js"],
    },
    js.configs.recommended,
    ...tseslint.configs["flat/recommended-type-checked"],
    stylistic.configs["disable-legacy"],
    {
        files: tsFiles,
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: ["./tsconfig.json"],
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            "@stylistic": stylistic,
        },
        rules: {
            // Disable 'no-unused-vars' for variables starting with `_`
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/naming-convention": "warn",
            "@stylistic/semi": "warn",
            "@typescript-eslint/explicit-function-return-type": "warn",
            curly: "warn",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            semi: "off",
        },
    },
];
