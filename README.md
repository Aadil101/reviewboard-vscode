# Review Board Extension for VSCode

A VSCode extension for browsing ReviewBoard review requests directly in your editor — similar to the GitHub Pull Requests extension, but for ReviewBoard + Perforce workflows.

## Features

- **Sidebar explorer** — Browse open and incoming review requests in a dedicated Activity Bar panel, with owner and relative timestamp shown inline
- **Review detail panel** — Click a review to open a rich webview showing summary, description (rendered as markdown), testing done, reviewers, branch, gecks, approval status, and more
- **Ship It / issue indicators** — Reviews with Ship Its show a green checkmark; those with open issues show a warning icon
- **File diffs** — Click any file to view the original vs. patched diff in VSCode's built-in diff editor
- **File status indicators** — Perforce-style badges (A/E/D/M) show whether files were added, edited, deleted, or moved
- **Branch validation** — Validates that your local Perforce workspace branch matches the review's target branch before applying changes

## Getting Started

1. Install dependencies: `npm install`
2. Compile: `npm run compile`
3. Press `F5` in VSCode to launch the Extension Development Host

## Configuration

On first activation, a setup wizard prompts for your ReviewBoard server URL, username, and password. Credentials are stored securely in VSCode's SecretStorage. You can update your password at any time via the command palette: **ReviewBoard: Set Password**.

## Development

```bash
npm run compile   # Build once
npm run watch     # Build on file changes
npm run lint      # Run ESLint
npm test          # Run tests
```