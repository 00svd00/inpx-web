const js = require('@eslint/js');
const globals = require('globals');
const babelParser = require('@babel/eslint-parser');
const babelPlugin = require('@babel/eslint-plugin');
const vuePlugin = require('eslint-plugin-vue');
const vueParser = require('vue-eslint-parser');

module.exports = [
    js.configs.recommended,
    ...vuePlugin.configs['flat/recommended'],
    {
        files: ['**/*.js', '**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: babelParser,
                sourceType: 'module',
                ecmaVersion: 'latest',
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
                LM_OK: 'readonly',
                LM_INFO: 'readonly',
                LM_WARN: 'readonly',
                LM_ERR: 'readonly',
                LM_FATAL: 'readonly',
                LM_TOTAL: 'readonly',
            },
        },

        plugins: {
            '@babel': babelPlugin,
        },

        rules: {
            'vue/html-indent': ['warn', 4, { alignAttributesVertically: false }],
            'vue/max-attributes-per-line': 'off',
            'vue/html-self-closing': 'off',
            'vue/no-v-html': 'off',
            'vue/no-v-model-argument': 'off',

            'strict': 'off',
            'indent': ['off', 4, { SwitchCase: 1 }],
            'space-before-function-paren': ['error', 'never'],
            'valid-jsdoc': ['error', { requireReturn: false, prefer: { returns: 'return' } }],
            'require-jsdoc': 'off',
            'max-len': ['warn', 200, 4, { ignoreComments: true, ignoreUrls: true }],
            'no-console': 'off',
        },
    },
];