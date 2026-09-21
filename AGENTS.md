# AGENTS.md

Guidelines for autonomous contributors working on this repository.

1. **Understand the extension scope**
   - This is a VS Code extension that manages audit findings. Read `README.md` and the relevant implementation before changing behavior so you respect the existing UX flows (tree view, highlights, saved findings, etc.).

2. **Keep edits scoped and explainable**
   - Prefer incremental, targeted fixes, and simple processes. Briefly describe non-obvious pieces of code.
   - Follow Hoare's principle: "... to make it so simple that there are obviously no deficiencies."
   - Prefer straightforward control flow and existing patterns; introduce abstractions only when they simplify the current task.
   - Keep changes isolated to the task. Do not remove or alter unrelated features or UI behavior.

3. **Document new behavior**
   - If you add or change a feature that affects users, update `README.md` or other relevant docs/screenshots in the same change set.

4. **Document intent and contracts**
   - Add concise docstrings for public APIs and non-obvious functions or classes, including shell scripts and build helpers. Explain intent, assumptions, or constraints rather than restating the code; trivial helpers do not need redundant docstrings. Update existing docstrings when behavior changes.

5. **Tests and validation**
   - For bug fixes, add a regression test that fails before the fix when practical. Run checks relevant to your change and report their results. If something can’t be run in the current environment, clearly state what remains unverified.
   - Available checks include `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:ext` (VS Code integration tests), `npm run test:ui` (UI tests), and `npm run package` (production build).

6. **Commit messaging**
   - When suggesting or creating commit titles, always follow the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: add highlight toggle command`). Include scope when it adds clarity.

7. **Preserve default behavior**
   - Preserve established workflows outside the requested change. The requested behavior change is authorized; seek approval for additional breaking changes outside that scope.

8. **Protect existing work**
   - Preserve unrelated working-tree changes; do not revert or overwrite them.

9. **Consider cross-tool compatibility**
   - Any change involving external commands (callable by other extensions), the GitHub export, finding severity, or finding difficulty must account for the broader tooling ecosystem. These interfaces are consumed by other tools (e.g., audit reporting pipelines), so changes must maintain compatibility and be coordinated with those dependencies.

10. **Backward compatibility of persisted data**
    - The extension saves audit state (findings, annotations, etc.) to files. Any change to serialization formats or data structures must be able to load data saved by previous versions without loss. Never silently drop fields or change schemas without a migration path.

11. **Stability of contributed extension points**
    - Command IDs, view IDs, and configuration keys in `package.json` are public API. Renaming or removing them breaks user keybindings, settings, and other extensions that depend on them.

12. **Minimize new dependencies**
    - Keep the extension lightweight. Don't add new `node_modules` dependencies without justification; prefer using VS Code's built-in APIs or small self-contained implementations.

Following these rules keeps the repository friendly to both human maintainers and future AI agents. Thanks for contributing!
