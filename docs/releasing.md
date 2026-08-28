# Releasing weAudit

A release is created by pushing a `v*` tag. The [publish workflow](../.github/workflows/publish.yml) builds the vsix, creates the GitHub release with the vsix attached, and publishes the extension to the VSCode Marketplace and to OpenVSX.

1. Merge a PR that bumps `version` in `package.json`, running `npm install` to carry the version into `package-lock.json`.

2. Tag the bump commit on `main` and push the tag:

   ```bash
   VERSION=v?.?.?

   git checkout main && git pull
   git tag "$VERSION"
   git push origin "$VERSION"
   ```

3. Approve the deployment on the workflow run. The `publish` job waits for a reviewer, so nothing
   reaches the Marketplace or OpenVSX until it is approved.

Do not create the release through the GitHub web UI. Releases in this repository are immutable, so
the vsix cannot be attached after the release is published.

## Troubleshooting

If the Marketplace step fails with `Access Denied: The Personal Access Token used has expired`,
`WEAUDIT_VSCODE_MARKETPLACE_TOKEN` needs a new [Azure DevOps](https://dev.azure.com) token with the
`Marketplace > Publish` scope. They are capped at one year. The OpenVSX equivalent is
`WEAUDIT_OPENVSX_TOKEN`.
