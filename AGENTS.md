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
   - Always run the test suite and linter before considering a coding task complete. If something can’t be run in the current environment, clearly state what remains unverified.
   - Run any other available automated checks relevant to your change (e.g., packaging). If something can’t be run in the current environment, clearly state what remains unverified.

6. **Commit messaging**
   - When suggesting or creating commit titles, always follow the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: add highlight toggle command`). Include scope when it adds clarity.

Following these rules keeps the repository friendly to both human maintainers and future AI agents. Thanks for contributing!
