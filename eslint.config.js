const js = require("@eslint/js");
const globals = require("globals");
module.exports = [
  js.configs.recommended,
  { files: ["site/js/**/*.js"], languageOptions: { ecmaVersion: 2017, sourceType: "script", globals: { ...globals.browser } } },
  { files: ["tests/**/*.js", "eslint.config.js"], languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node, ...globals.browser } } },
];
