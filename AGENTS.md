# Repository instructions

## Commits to `main`

Before creating a commit on the `main` branch, run:

    npm --prefix agroBimi test

Do not commit if the test command fails. Report the failure and fix it first.
Do not bypass the repository's pre-commit hook with `--no-verify`.

To enable the local Git hook in a clone, run once:

    git config core.hooksPath .githooks
