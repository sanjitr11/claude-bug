# claude-bug

Capture visual bugs and terminal context to share with AI coding assistants like Claude Code.

## Installation

```bash
# Clone and install
git clone <repo-url> claude-bug
cd claude-bug
npm install
npm run build
npm link  # Makes `claude-bug` available globally
```

### Prerequisites

- **Node.js 18+**
- **ffmpeg** (for screen recording)

```bash
# Install ffmpeg on macOS
brew install ffmpeg
```

## Usage

### Capture a bug

```bash
claude-bug capture "Button doesn't respond to clicks"
```

This will:
1. Record your screen for 30 seconds
2. Capture recent terminal commands
3. Gather git context (branch, modified files, recent commits)
4. Collect environment info (Node version, framework, etc.)
5. Generate a formatted report optimized for Claude Code

### Options

```bash
# Custom recording duration (5-120 seconds)
claude-bug capture "Bug description" --duration 60

# Skip video recording (context only)
claude-bug capture "Bug description" --no-video
```

### List captures

```bash
claude-bug list
claude-bug ls -n 20  # Show last 20
```

### View a capture

```bash
claude-bug view <id>
claude-bug view abc123 --json   # Raw JSON output
claude-bug view abc123 --open   # Open video in player
```

### Delete a capture

```bash
claude-bug delete <id> --force
```

### Check status

```bash
claude-bug status
```

## Output

Captures are stored in `~/.claude-bug/recordings/` with three files per capture:

- `<id>.mp4` - Screen recording
- `<id>.json` - Full context data
- `<id>.md` - Formatted report for Claude Code

### Example Report

```markdown
# Bug Report: Button doesn't respond to clicks

**Captured:** 1/17/2026, 2:30:00 PM
**ID:** `abc12345-...`

## Visual Evidence

**Recording:** `~/.claude-bug/recordings/abc12345.mp4`
**Duration:** 30 seconds

## Terminal Context

### Recent Commands
$ npm run dev
$ git status
$ npm test

## Git Context

**Branch:** `feature/new-button`

### Modified Files
[M] src/components/Button.tsx
[M] src/App.tsx

### Recent Commits
abc1234 Fix button styling
def5678 Add click handler

## Environment

- **OS:** darwin 24.0.0
- **Node.js:** v20.10.0
- **Framework:** React 18.2.0
```

## Permissions (macOS)

Screen recording requires permission. If recording fails:

1. Open **System Preferences > Privacy & Security > Screen Recording**
2. Add your terminal app (Terminal, iTerm2, VS Code, etc.)
3. Restart the terminal

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Run locally
node dist/cli.js capture "test"
```

## License

MIT
