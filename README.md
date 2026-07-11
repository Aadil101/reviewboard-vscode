# Review Board Extension for VSCode

A VSCode extension for browsing Review Board review requests directly in your editor — similar to the GitHub Pull Requests extension, but for Review Board + Perforce workflows.

## Features

- **Sidebar explorer** — Browse open and incoming review requests in a dedicated Activity Bar panel, with owner and relative timestamp shown inline
- **Review detail panel** — Click a review to open a rich webview showing summary, description (rendered as markdown), testing done, reviewers, branch, gecks, approval status, and more
- **Ship It / issue indicators** — Reviews with Ship Its show a green checkmark; those with open issues show a warning icon
- **File diffs** — Click any file to view the original vs. patched diff in VSCode's built-in diff editor
- **File status indicators** — Perforce-style badges (A/E/D/M) show whether files were added, edited, deleted, or moved
- **Branch validation** — Validates that your local Perforce workspace branch matches the review's target branch before applying changes
- **API token auth** — Sign in with a revocable API token instead of your account password

## Getting Started

1. Install dependencies: `npm install`
2. Compile: `npm run compile`
3. Press `F5` in VSCode to launch the Extension Development Host

## Authentication

Run **Review Board: Sign In** from the command palette, or click **Sign In** in the Review Board panel. You will be asked for your server URL (HTTPS only) and then a credential:

- **API token** (recommended) — Generate one under Account Settings → API Tokens on your Review Board server; the sign-in prompt has a button that opens the page for you. Tokens can be revoked from Review Board at any time, can be scoped read-only, and never expose your account password.
- **Username & password** — Falls back to HTTP Basic auth, which sends your password on every request.

Credentials are validated against the server before being stored, and are kept in VSCode's SecretStorage — never in plaintext settings. The only setting written is `reviewBoard.serverUrl`; the active user is whoever the server authenticates you as.

If the server ever rejects your credential, it is cleared immediately (so a stale password is not replayed against servers that lock accounts out) and you are prompted to sign in again. **Review Board: Sign Out** clears it on demand.

OAuth2 is not supported. Review Board's OAuth2 requires registering an application per server to obtain a client ID and secret, which is more setup than an API token rather than less — and a VSCode extension cannot keep a client secret.

## Development

```bash
npm run compile   # Build once
npm run watch     # Build on file changes
npm run lint      # Run ESLint
npm test          # Run tests
```