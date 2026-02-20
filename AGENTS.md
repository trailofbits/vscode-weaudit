# AGENTS.md

Guidelines for autonomous contributors working on this repository.

1. **Understand the extension scope**
   - This is a VS Code extension that manages audit findings. Read `README.md` and `src/codeMarker.ts` before implementing changes so you respect the existing UX flows (tree view, highlights, saved findings, etc.).

2. **Keep edits scoped and explainable**
   - Prefer incremental, targeted fixes. When touching large files such as `src/codeMarker.ts`, describe the rationale for every change in comments or PR descriptions so human reviewers can follow along.

3. **Document new behavior**
   - If you add or change a feature that affects users, update `README.md` or other relevant docs/screenshots in the same change set.

4. **Always add docstrings for new functions**
   - Whether it’s TypeScript, shell scripts, or build helpers, any newly introduced function or class must include a concise docstring explaining its role. Update existing docstrings when behavior changes.

5. **Tests and validation**
   - Always run the test suite, linter, and formatter before considering a coding task complete. If something can’t be run in the current environment, clearly state what remains unverified.
   - Run any other available automated checks relevant to your change (e.g., packaging). If something can’t be run in the current environment, clearly state what remains unverified.

6. **Commit messaging**
   - When suggesting or creating commit titles, always follow the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: add highlight toggle command`). Include scope when it adds clarity.

7. **Preserve default behavior**
   - Never change the extension's current default behavior without a clear, justified reason. Existing users rely on established workflows; breaking them requires explicit approval.

8. **Do not remove or alter unrelated features**
   - When implementing a new feature, do not remove existing features or change other parts of the UI that are not directly related to the task at hand. Keep changes isolated to the feature being worked on.

9. **Consider cross-tool compatibility**
   - Any change involving external commands (callable by other extensions), the GitHub export, finding severity, or finding difficulty must account for the broader tooling ecosystem. These interfaces are consumed by other tools (e.g., audit reporting pipelines), so changes must maintain compatibility and be coordinated with those dependencies.

10. **Backward compatibility of persisted data**
    - The extension saves audit state (findings, annotations, etc.) to files. Any change to serialization formats or data structures must be able to load data saved by previous versions without loss. Never silently drop fields or change schemas without a migration path.

11. **Stability of contributed extension points**
    - Command IDs, view IDs, and configuration keys in `package.json` are public API. Renaming or removing them breaks user keybindings, settings, and other extensions that depend on them.

12. **Minimize new dependencies**
    - Keep the extension lightweight. Don't add new `node_modules` dependencies without justification; prefer using VS Code's built-in APIs or small self-contained implementations.

Following these rules keeps the repository friendly to both human maintainers and future AI agents. Thanks for contributing!
