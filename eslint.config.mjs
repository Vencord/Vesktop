/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import licenseHeader from "eslint-plugin-license-header";
import pathAlias from "eslint-plugin-path-alias";
import prettier from "eslint-plugin-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";

export default [
    {
        ignores: ["**/dist", "**/node_modules"]
    },
    {
        files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.mjs"],

        plugins: {
            "@typescript-eslint": typescriptEslint,
            "license-header": licenseHeader,
            "simple-import-sort": simpleImportSort,
            "unused-imports": unusedImports,
            "path-alias": pathAlias,
            prettier
        },

        languageOptions: {
            parser: tsParser
        },

        settings: {
            "import/resolver": {
                alias: {
                    map: []
                }
            }
        },

        rules: {
            "license-header/header": ["error", "scripts/header.txt"],

            eqeqeq: [
                "error",
                "always",
                {
                    null: "ignore"
                }
            ],

            "spaced-comment": [
                "error",
                "always",
                {
                    markers: ["!"]
                }
            ],

            yoda: "error",

            "prefer-destructuring": [
                "error",
                {
                    VariableDeclarator: {
                        array: false,
                        object: true
                    },

                    AssignmentExpression: {
                        array: false,
                        object: false
                    }
                }
            ],

            "operator-assignment": ["error", "always"],
            "no-useless-computed-key": "error",

            "no-unneeded-ternary": [
                "error",
                {
                    defaultAssignment: false
                }
            ],

            "no-invalid-regexp": "error",

            "no-constant-condition": [
                "error",
                {
                    checkLoops: false
                }
            ],

            "no-duplicate-imports": "error",
            "no-extra-semi": "error",
            "dot-notation": "error",
            "no-useless-escape": "error",
            "no-fallthrough": "error",
            "for-direction": "error",
            "no-async-promise-executor": "error",
            "no-cond-assign": "error",
            "no-dupe-else-if": "error",
            "no-duplicate-case": "error",
            "no-irregular-whitespace": "error",
            "no-loss-of-precision": "error",
            "no-misleading-character-class": "error",
            "no-prototype-builtins": "error",
            "no-regex-spaces": "error",
            "no-shadow-restricted-names": "error",
            "no-unexpected-multiline": "error",
            "no-unsafe-optional-chaining": "error",
            "no-useless-backreference": "error",
            "use-isnan": "error",
            "prefer-const": "error",
            "prefer-spread": "error",
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "unused-imports/no-unused-imports": "error",
            "path-alias/no-relative": "error",
            "prettier/prettier": "error"
        }
    }
];
