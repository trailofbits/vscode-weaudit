const js = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const stylistic = require("@stylistic/eslint-plugin");

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

module.exports = [
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
