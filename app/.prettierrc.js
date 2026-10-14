module.exports = {
  useTabs: false,
  printWidth: 120,
  tabWidth: 2,
  semi: true,
  htmlWhitespaceSensitivity: "ignore",
  arrowParens: "avoid",
  bracketSpacing: true,
  proseWrap: "preserve",
  trailingComma: "none",
  overrides: [
    {
      files: ".prettierrc",
      options: {
        parser: "json"
      }
    },
    {
      files: "*.ts",
      options: {
        singleQuote: true
      }
    },
    {
      files: "*.html",
      options: {
        parser: "html",
        printWidth: 100,
        singleQuote: false
      }
    }
  ]
};
