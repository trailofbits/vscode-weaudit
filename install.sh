npx vsce package
mv weaudit-*.vsix weaudit.vsix
code --install-extension weaudit.vsix --force
