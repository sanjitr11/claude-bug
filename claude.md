# claude-bug — Token-Aware Visual Bug Capture

claude-bug is a CLI tool that converts visual bugs into token-optimized, structured multimodal context for Claude Code.

It is designed around a core constraint: raw screen recordings overwhelm LLM context windows, while single screenshots miss temporal causality. claude-bug bridges this gap by extracting high-signal visual moments and pairing them with precise execution context.

## What This Tool Provides

For each capture, claude-bug produces a deterministic, Claude-ready debugging report containing:

- **6–8 key visual frames** selected via perceptual diffing to represent meaningful UI state changes
- **A chronological visual timeline** showing how the bug emerges and stabilizes
- **Token-budgeted images** (1024×576 JPEG, ~1.2k tokens each)
- **Execution context**, including:
  - Recent terminal errors
  - Current git branch, commits, and diff
  - Capture metadata (timestamps, config, token estimates)

The result is a high-signal, low-noise snapshot of a visual failure, optimized for reasoning rather than replay.

## How to Reason About the Report

When analyzing a claude-bug report:

1. **Read the timeline first** — identify the first frame where behavior diverges
2. **Compare adjacent frames** — focus on what changed, not what persisted
3. **Cross-reference with git diff** — assume the bug is causally linked to recent changes unless evidence suggests otherwise
4. **Treat earlier frames as baseline** and later frames as stabilized failure state
5. **Prefer root-cause hypotheses** over surface-level visual descriptions

If information is insufficient, explicitly state:
- What additional signal would reduce uncertainty (logs, state, metrics)
- Which frame(s) would benefit from higher resolution or earlier capture

## Design Principles

- Token economy is a first-class constraint
- Temporal causality > raw visual fidelity
- Structured context > verbose narration
- Determinism over completeness

The report is intentionally minimal: every included frame, log, and diff exists because it increases the probability of identifying a root cause within a fixed context window.

## Expected Output From Claude

Given a claude-bug report, Claude should aim to:

1. Identify the most likely root cause(s)
2. Explain why the bug manifests visually
3. Propose a minimal, testable fix
4. List what additional signals would improve confidence, if any

Avoid speculative UI commentary unless directly tied to a causal hypothesis.

---

# Implementation Architecture

Production-grade CLI tool for capturing visual bugs as token-optimized context for Claude Code.

## Module Architecture

### 1. Types (`src/types.ts`)

```typescript
// Core capture data
export interface BugCapture {
  id: string;
  description: string;
  timestamp: Date;
  duration: number;
  videoPath: string;
  framesDir: string;
  keyFramesDir: string;
  reportPath: string;
  metrics: CaptureMetrics;
  context: CaptureContext;
}

export interface CaptureMetrics {
  totalFrames: number;
  keyFrames: number;
  tokenEstimate: number;
  processingTime: number;  // milliseconds
}

export interface CaptureContext {
  terminal: TerminalContext;
  git: GitContext;
}

export interface TerminalContext {
  recentOutput: string[];      // Last 50 lines
  errors: string[];            // Filtered error lines
  tokenEstimate: number;
}

export interface GitContext {
  branch: string;
  recentCommits: string[];     // Last 3 commits (oneline)
  diff: string | null;         // Only if <50 lines
  tokenEstimate: number;
}

// Frame selection
export interface ExtractedFrame {
  index: number;
  path: string;
  timestamp: number;           // Seconds into video
}

export interface KeyFrame extends ExtractedFrame {
  diffScore: number;           // % difference from previous
  reason: string;              // Why this frame was selected
  optimizedPath: string;
  tokenEstimate: number;
}

export interface FrameSelectionResult {
  keyFrames: KeyFrame[];
  totalExtracted: number;
  selectionReasons: string[];
}

// Recording options
export interface RecordingOptions {
  duration: number;            // Default: 30 seconds
  resolution: { width: number; height: number };  // Default: 1280x720
  fps: number;                 // Default: 30
  outputPath: string;
}

export interface RecordingResult {
  success: boolean;
  videoPath: string;
  duration: number;
  error?: string;
}

// Configuration
export interface Config {
  duration: number;            // Recording duration (default: 30)
  targetKeyFrames: number;     // Target key frames (default: 6)
  diffThreshold: number;       // Min % diff for key frame (default: 3)
  maxTokens: number;           // Max tokens per report (default: 10000)
  ttlDays: number;             // Auto-delete after days (default: 7)
}

// Storage metadata
export interface CaptureMetadata {
  id: string;
  description: string;
  timestamp: string;
  duration: number;
  keyFrameCount: number;
  tokenEstimate: number;
  isTemp?: boolean;
  viewedAt?: string;
}
```

---

### 2. Video Recording (`src/recorder.ts`)

```typescript
import { execSync, spawn } from 'child_process';
import { RecordingOptions, RecordingResult } from './types';

/**
 * Check if ffmpeg is installed
 */
export function checkFfmpegInstalled(): boolean;

/**
 * Get screen capture device ID (macOS AVFoundation)
 * Parses `ffmpeg -f avfoundation -list_devices true -i ""`
 */
export function getScreenDeviceId(): string;

/**
 * Check macOS screen recording permission
 * Returns guidance message if permission likely missing
 */
export function checkScreenPermission(): { ok: boolean; message: string };

/**
 * Record screen video
 *
 * ffmpeg command:
 * ffmpeg -f avfoundation -capture_cursor 1 -capture_mouse_clicks 1 \
 *   -i "<deviceId>:none" -t <duration> -r 30 \
 *   -c:v libx264 -preset fast -crf 23 \
 *   -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
 *   -pix_fmt yuv420p -y <outputPath>
 */
export async function recordScreen(options: RecordingOptions): Promise<RecordingResult>;

/**
 * Start interactive recording (records until stopped)
 * Returns handle with stop() method
 */
export function startInteractiveRecording(options: Omit<RecordingOptions, 'duration'>): {
  stop: () => Promise<RecordingResult>;
  process: ChildProcess;
};
```

**ffmpeg Settings Explained:**
- `-f avfoundation`: macOS screen capture framework
- `-capture_cursor 1`: Include cursor in recording
- `-capture_mouse_clicks 1`: Show click indicators
- `-r 30`: 30 fps recording
- `-c:v libx264 -preset fast -crf 23`: Good quality, fast encoding
- `scale=1280:720`: Normalize to 720p for consistent token costs
- `-pix_fmt yuv420p`: Compatibility format

---

### 3. Frame Extraction (`src/frames.ts`)

```typescript
import { ExtractedFrame } from './types';

/**
 * Extract frames from video at specified FPS
 *
 * ffmpeg command:
 * ffmpeg -i <videoPath> -vf fps=2 <outputDir>/frame_%04d.png
 *
 * For 30s video at 2fps = 60 frames
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  fps: number = 2
): Promise<ExtractedFrame[]>;

/**
 * Get frame count from video without extracting
 * Uses ffprobe
 */
export async function getVideoFrameCount(videoPath: string): Promise<number>;

/**
 * Get video duration in seconds
 */
export async function getVideoDuration(videoPath: string): Promise<number>;
```

**Why 2fps?**
- 30 second video → 60 frames
- Enough granularity to catch UI changes
- Not too many to process (keeps it fast)
- 90%+ will be filtered out by selection algorithm

---

### 4. Intelligent Frame Selection (`src/selection.ts`)

```typescript
import Jimp from 'jimp';
import { ExtractedFrame, KeyFrame, FrameSelectionResult } from './types';

/**
 * Select key frames using perceptual image diffing
 *
 * Algorithm:
 * 1. Always include first frame (reason: "start of capture")
 * 2. Always include last frame (reason: "end of capture")
 * 3. For each consecutive pair, calculate pixel difference %
 * 4. Frames with >diffThreshold% difference are candidates
 * 5. Sort candidates by diff magnitude
 * 6. Take top (targetCount - 2) candidates
 * 7. Return all selected frames in chronological order
 */
export async function selectKeyFrames(
  frames: ExtractedFrame[],
  targetCount: number = 6,
  diffThreshold: number = 3
): Promise<FrameSelectionResult>;

/**
 * Calculate perceptual difference between two images
 * Uses Jimp's pixelMatch or custom diff algorithm
 * Returns percentage of pixels that differ significantly
 */
export async function calculateFrameDiff(
  framePath1: string,
  framePath2: string
): Promise<number>;

/**
 * Generate human-readable reason for frame selection
 */
function generateSelectionReason(
  frame: ExtractedFrame,
  diffScore: number,
  isFirst: boolean,
  isLast: boolean
): string;
```

**Diff Algorithm Details:**
```typescript
async function calculateFrameDiff(path1: string, path2: string): Promise<number> {
  const img1 = await Jimp.read(path1);
  const img2 = await Jimp.read(path2);

  // Resize to same dimensions for comparison
  const width = Math.min(img1.getWidth(), img2.getWidth());
  const height = Math.min(img1.getHeight(), img2.getHeight());
  img1.resize(width, height);
  img2.resize(width, height);

  // Count significantly different pixels
  let diffPixels = 0;
  const totalPixels = width * height;
  const threshold = 25;  // Color difference threshold (0-255)

  img1.scan(0, 0, width, height, (x, y, idx) => {
    const r1 = img1.bitmap.data[idx];
    const g1 = img1.bitmap.data[idx + 1];
    const b1 = img1.bitmap.data[idx + 2];

    const r2 = img2.bitmap.data[idx];
    const g2 = img2.bitmap.data[idx + 1];
    const b2 = img2.bitmap.data[idx + 2];

    const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    if (diff > threshold * 3) {
      diffPixels++;
    }
  });

  return (diffPixels / totalPixels) * 100;
}
```

**Selection Reasons Examples:**
- "Start of capture"
- "End of capture"
- "15.2% visual change - significant UI update"
- "8.7% visual change - modal appeared"
- "4.1% visual change - content loaded"

---

### 5. Image Optimization (`src/optimize.ts`)

```typescript
import Jimp from 'jimp';
import { KeyFrame } from './types';

/**
 * Optimize key frames for token efficiency
 *
 * Operations:
 * 1. Resize to 1024x576 (16:9, fits Claude's sweet spot)
 * 2. Convert to JPEG at 85% quality
 * 3. Calculate final token estimate
 */
export async function optimizeKeyFrames(
  keyFrames: KeyFrame[],
  outputDir: string
): Promise<KeyFrame[]>;

/**
 * Optimize single image
 * Returns path to optimized image and token estimate
 */
export async function optimizeImage(
  inputPath: string,
  outputPath: string,
  maxWidth: number = 1024,
  quality: number = 85
): Promise<{ path: string; tokenEstimate: number }>;

/**
 * Estimate tokens for an image based on dimensions
 * Claude's image token formula (approximate):
 * - Base: ~85 tokens
 * - Per 1000 pixels: ~1.5 tokens
 * - 1024x576 ≈ 1,200 tokens
 */
export function estimateImageTokens(width: number, height: number): number;
```

**Token Optimization Strategy:**
| Resolution | Pixels | Est. Tokens | Notes |
|------------|--------|-------------|-------|
| 1920x1080 | 2.07M | ~1,600 | Too expensive |
| 1280x720 | 0.92M | ~1,400 | Original capture |
| 1024x576 | 0.59M | ~1,200 | **Target** |
| 800x450 | 0.36M | ~900 | Too small, loses detail |

---

### 6. Context Gathering (`src/context.ts`)

```typescript
import { TerminalContext, GitContext, CaptureContext } from './types';

/**
 * Gather terminal context
 * - Read last 50 lines from shell history
 * - Filter for error patterns
 * - Estimate tokens
 */
export function gatherTerminalContext(maxLines: number = 50): TerminalContext;

/**
 * Gather git context (if in git repo)
 * - Current branch
 * - Last 3 commits (oneline format)
 * - Uncommitted diff (only if <50 lines, otherwise summary)
 */
export function gatherGitContext(): GitContext;

/**
 * Gather all context
 */
export function gatherContext(): CaptureContext;

/**
 * Filter terminal output for error-related lines
 * Patterns: error, Error, ERR, failed, Failed, FAILED,
 *          exception, Exception, warning, Warning, WARN
 */
function filterErrorLines(lines: string[]): string[];

/**
 * Estimate tokens for text content
 * Rough formula: characters / 4
 */
export function estimateTextTokens(text: string): number;
```

**Context Token Budgets:**
- Terminal context: ~400 tokens max (truncate if needed)
- Git context: ~200 tokens max
- Total context: ~600 tokens

---

### 7. Report Formatting (`src/formatter.ts`)

```typescript
import { BugCapture, KeyFrame } from './types';

/**
 * Generate markdown report optimized for Claude Code
 */
export function formatReport(capture: BugCapture): string;

/**
 * Format visual timeline section
 */
function formatVisualTimeline(keyFrames: KeyFrame[]): string;

/**
 * Format context section (terminal + git)
 */
function formatContext(context: CaptureContext): string;

/**
 * Format token summary footer
 */
function formatTokenSummary(capture: BugCapture): string;
```

**Report Template:**
```markdown
# Bug Report: {description}

**ID:** `{id}`
**Captured:** {timestamp}
**Duration:** {duration}s

---

## Visual Timeline

{for each keyFrame}
### Frame {n} - {timestamp}s
**Selection reason:** {reason}

![Frame {n}]({optimizedPath})

{end for}

---

## Terminal Context

### Recent Errors/Warnings
```
{filtered terminal output}
```

---

## Git Context

**Branch:** `{branch}`

### Recent Commits
```
{last 3 commits}
```

### Uncommitted Changes
```diff
{diff or "No uncommitted changes" or "Large diff omitted (X files changed)"}
```

---

## Token Estimate

| Component | Tokens |
|-----------|--------|
| Images ({n} frames) | {imageTokens} |
| Terminal context | {terminalTokens} |
| Git context | {gitTokens} |
| Report structure | ~100 |
| **Total** | **{totalTokens}** |

*Optimized for Claude Code. Paste this report to share full visual context.*
```

---

### 8. Token Estimation (`src/tokens.ts`)

```typescript
/**
 * Estimate tokens for image based on dimensions
 * Formula derived from Claude's documentation
 */
export function estimateImageTokens(width: number, height: number): number {
  const pixels = width * height;
  const baseTokens = 85;
  const tokensPerThousandPixels = 1.5;
  return Math.ceil(baseTokens + (pixels / 1000) * tokensPerThousandPixels);
}

/**
 * Estimate tokens for text
 * Conservative estimate: ~4 characters per token
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total token estimate for capture
 */
export function estimateTotalTokens(capture: BugCapture): number;

/**
 * Check if capture is within token budget
 */
export function isWithinBudget(capture: BugCapture, maxTokens: number = 10000): boolean;

/**
 * Suggest optimizations if over budget
 */
export function suggestOptimizations(capture: BugCapture, maxTokens: number): string[];
```

---

### 9. Storage (`src/storage.ts`)

```typescript
import { BugCapture, CaptureMetadata, Config } from './types';

// Paths
const CLAUDE_BUG_DIR = '~/.claude-bug';
const CAPTURES_DIR = '~/.claude-bug/captures';
const CONFIG_FILE = '~/.claude-bug/config.json';
const METADATA_FILE = '~/.claude-bug/captures.json';

/**
 * Directory structure for each capture:
 * ~/.claude-bug/captures/<id>/
 *   ├── recording.mp4      # Original video
 *   ├── frames/            # All extracted frames
 *   │   ├── frame_0001.png
 *   │   ├── frame_0002.png
 *   │   └── ...
 *   ├── key_frames/        # Selected + optimized frames
 *   │   ├── key_001.jpg
 *   │   ├── key_002.jpg
 *   │   └── ...
 *   ├── capture.json       # Full capture data
 *   └── report.md          # Formatted report
 */

export function ensureStorageExists(): void;
export function getCaptureDir(id: string): string;
export function saveCapture(capture: BugCapture): CaptureMetadata;
export function getCapture(id: string): BugCapture | null;
export function listCaptures(): CaptureMetadata[];
export function deleteCapture(id: string): boolean;
export function loadConfig(): Config;
export function saveConfig(config: Partial<Config>): void;
export function runCleanup(): { deleted: number };
```

---

### 10. Main Orchestration (`src/capture.ts`)

```typescript
import { BugCapture, Config } from './types';

/**
 * Main capture orchestration
 *
 * Pipeline:
 * 1. Check prerequisites (ffmpeg, permissions)
 * 2. Record video with overlay indicator
 * 3. Extract frames at 2fps
 * 4. Select key frames using diff algorithm
 * 5. Optimize selected frames
 * 6. Gather context (terminal, git)
 * 7. Generate report
 * 8. Save capture
 * 9. Copy report to clipboard
 * 10. Return summary
 */
export async function runCapture(
  description: string,
  config: Config,
  onProgress: (stage: string, progress: number) => void
): Promise<BugCapture>;

/**
 * Progress stages:
 * - "recording" (0-40%)
 * - "extracting" (40-55%)
 * - "selecting" (55-70%)
 * - "optimizing" (70-85%)
 * - "formatting" (85-95%)
 * - "saving" (95-100%)
 */
```

---

### 11. CLI Interface (`src/cli.ts`)

```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('claude-bug')
  .description('Capture visual bugs as token-optimized context for Claude Code')
  .version('1.0.0');

/**
 * capture - Main capture command
 *
 * claude-bug capture "description"
 * claude-bug capture "description" -i          # Interactive (stop on keypress)
 * claude-bug capture "description" -t          # Temporary (delete after view)
 */
program
  .command('capture')
  .description('Capture a visual bug')
  .argument('<description>', 'Bug description')
  .option('-i, --interactive', 'Interactive mode - stop recording on keypress')
  .option('-t, --temp', 'Temporary capture - auto-delete after first view')
  .action(captureCommand);

/**
 * view - View capture and copy to clipboard
 *
 * claude-bug view <id>
 * claude-bug view <id> --json    # Output raw JSON
 */
program
  .command('view')
  .description('View capture and copy report to clipboard')
  .argument('<id>', 'Capture ID (partial match supported)')
  .option('--json', 'Output raw JSON data')
  .action(viewCommand);

/**
 * list - List all captures
 *
 * claude-bug list
 * claude-bug list -n 5    # Show only 5
 */
program
  .command('list')
  .alias('ls')
  .description('List all captures')
  .option('-n, --limit <count>', 'Number to show', '10')
  .action(listCommand);

/**
 * delete - Delete a capture
 *
 * claude-bug delete <id>
 * claude-bug delete <id> -f    # Skip confirmation
 */
program
  .command('delete')
  .alias('rm')
  .description('Delete a capture')
  .argument('<id>', 'Capture ID')
  .option('-f, --force', 'Skip confirmation')
  .action(deleteCommand);

/**
 * clean - Clean old captures
 *
 * claude-bug clean --older-than 7d
 * claude-bug clean --all -f
 */
program
  .command('clean')
  .description('Clean up old captures')
  .option('-a, --all', 'Delete all captures')
  .option('-o, --older-than <duration>', 'Delete older than (e.g., 7d, 24h)')
  .option('-f, --force', 'Skip confirmation')
  .action(cleanCommand);

/**
 * config - View/set configuration
 *
 * claude-bug config                    # Show all
 * claude-bug config duration           # Show specific
 * claude-bug config duration 30        # Set value
 */
program
  .command('config')
  .description('View or set configuration')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Value to set')
  .action(configCommand);

/**
 * status - Show system status
 */
program
  .command('status')
  .description('Show status and storage stats')
  .action(statusCommand);

program.parse();
```

**Config Keys:**
| Key | Default | Description |
|-----|---------|-------------|
| `duration` | 30 | Recording duration (seconds) |
| `targetFrames` | 6 | Target key frame count |
| `diffThreshold` | 3 | Min % diff for key frame |
| `maxTokens` | 10000 | Max tokens per report |
| `ttl` | 7 | Auto-delete after days (0 = never) |

---

## Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                        CAPTURE PIPELINE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. RECORD (0-40%)                                              │
│     ┌──────────────┐                                            │
│     │   Screen     │──▶ recording.mp4 (30s, 720p, ~15MB)       │
│     │  + Overlay   │                                            │
│     └──────────────┘                                            │
│            │                                                    │
│            ▼                                                    │
│  2. EXTRACT (40-55%)                                            │
│     ┌──────────────┐                                            │
│     │   ffmpeg     │──▶ frames/frame_0001.png ... (60 frames)  │
│     │   fps=2      │                                            │
│     └──────────────┘                                            │
│            │                                                    │
│            ▼                                                    │
│  3. SELECT (55-70%)                                             │
│     ┌──────────────┐                                            │
│     │    Jimp      │──▶ 6-8 key frames with reasons            │
│     │  diff algo   │    (90% reduction)                        │
│     └──────────────┘                                            │
│            │                                                    │
│            ▼                                                    │
│  4. OPTIMIZE (70-85%)                                           │
│     ┌──────────────┐                                            │
│     │    Jimp      │──▶ key_frames/key_001.jpg (1024x576)      │
│     │ resize+jpeg  │    (~1,200 tokens each)                   │
│     └──────────────┘                                            │
│            │                                                    │
│            ▼                                                    │
│  5. CONTEXT (85-90%)                                            │
│     ┌──────────────┐                                            │
│     │  Terminal    │──▶ Error lines (~400 tokens)              │
│     │    + Git     │──▶ Branch, commits, diff (~200 tokens)    │
│     └──────────────┘                                            │
│            │                                                    │
│            ▼                                                    │
│  6. FORMAT (90-95%)                                             │
│     ┌──────────────┐                                            │
│     │  Markdown    │──▶ report.md                              │
│     │  generator   │    (~7,800 total tokens)                  │
│     └──────────────┘                                            │
│            │                                                    │
│            ▼                                                    │
│  7. SAVE & COPY (95-100%)                                       │
│     ┌──────────────┐                                            │
│     │   Storage    │──▶ ~/.claude-bug/captures/<id>/           │
│     │  + pbcopy    │──▶ Report in clipboard                    │
│     └──────────────┘                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling Strategy

| Component | Error | Handling |
|-----------|-------|----------|
| Recording | ffmpeg not found | Exit with install instructions |
| Recording | No permission | Exit with macOS permission guide |
| Recording | Recording failed | Exit with ffmpeg error output |
| Extraction | No frames extracted | Exit with video validation error |
| Selection | Jimp read error | Skip frame, continue with others |
| Selection | All frames identical | Use evenly-spaced frames as fallback |
| Optimization | Jimp write error | Use original frame, warn user |
| Context | Not a git repo | Skip git context, continue |
| Context | History unreadable | Skip terminal context, continue |
| Clipboard | pbcopy failed | Show report path, instruct manual copy |

**Graceful Degradation Priority:**
1. Always produce a report (even if minimal)
2. Prefer fewer optimized frames over failure
3. Context is optional - capture should work without it
4. Clipboard is convenience - show path as fallback

---

## File System Layout

```
~/.claude-bug/
├── config.json                    # User configuration
├── captures.json                  # Metadata index
└── captures/
    └── <uuid>/
        ├── recording.mp4          # Original video (~15MB)
        ├── capture.json           # Full capture data
        ├── report.md              # Formatted report
        ├── frames/                # Extracted frames (~60 files)
        │   ├── frame_0001.png
        │   ├── frame_0002.png
        │   └── ...
        └── key_frames/            # Optimized key frames (~6 files)
            ├── key_001.jpg
            ├── key_002.jpg
            └── ...
```

**Storage Estimates per Capture:**
- Video: ~15MB (30s at 720p)
- Extracted frames: ~30MB (60 × 500KB)
- Key frames: ~2MB (6 × 350KB optimized)
- Metadata: ~10KB
- **Total: ~50MB per capture**

---

## Dependencies

```json
{
  "dependencies": {
    "commander": "^11.0.0",
    "chalk": "^4.1.2",
    "ora": "^5.4.1",
    "uuid": "^9.0.0",
    "jimp": "^0.22.10"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.0",
    "typescript": "^5.0.0"
  }
}
```

**External Requirements:**
- ffmpeg (`brew install ffmpeg`)
- macOS screen recording permission
- Swift compiler for overlay (included in Xcode CLI tools)

---

## Implementation Notes

### 1. Jimp Performance
- Jimp is pure JavaScript, no native deps (good for portability)
- Processing 60 frames takes ~10-15 seconds
- Consider using worker threads for parallel diff calculation

### 2. ffmpeg Gotchas
- AVFoundation device index varies by system (auto-detect it)
- Screen recording permission is checked lazily (first capture may prompt)
- `-pix_fmt yuv420p` required for QuickTime compatibility

### 3. Token Estimation Accuracy
- Image token formula is approximate (~10% variance)
- Text tokens are conservative estimate
- Always show user the estimate with "~" prefix

### 4. Overlay Binary
- Compile once: `swiftc -o dist/recording-overlay src/overlay/RecordingOverlay.swift -framework Cocoa`
- Bundle with npm package or compile on first run
- Graceful fallback if overlay unavailable

### 5. Clipboard Limitations
- pbcopy has size limits (~1MB safe)
- Report with image paths only, not embedded images
- User pastes into Claude Code which reads the image files

### 6. Frame Selection Edge Cases
- Blank screen: All frames look same → use evenly spaced
- Rapid changes: Too many candidates → sort by magnitude, take top N
- Video artifacts: May cause false positives → use higher threshold

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Total time | <45s | Start to clipboard |
| Token count | <10,000 | Estimated total |
| Key frames | 6-8 | From 60 extracted |
| Frame reduction | >85% | Key/total frames |
| User satisfaction | High | Bug reproduction fidelity |

---

## Future Enhancements (v2+)

- [ ] Linux support (X11/Wayland capture)
- [ ] Windows support (GDI/DirectX capture)
- [ ] Audio capture option
- [ ] Annotation overlay (arrows, highlights)
- [ ] Multiple monitor support
- [ ] Custom region capture
- [ ] Automatic error detection in frames
- [ ] Cloud backup option

---

# Model-Aware Debug Context (v2)

## Overview

claude-bug v2 introduces model-aware context shaping. All outputs are generated relative to a target Claude model's context limits and multimodal token economics, not as fixed artifacts.

Each capture is tuned to maximize reasoning signal per token for the selected model. This transforms claude-bug from a generic capture tool into a model-aligned debugging interface.

**Core Insight:** Visual debugging fails when tools treat LLMs as passive consumers of data. claude-bug instead treats the model as a bounded reasoning system with known constraints and biases. By shaping context around those constraints, we increase the probability that Claude identifies a correct root cause within a single pass.

---

## System Architecture

### New Types (`src/types.ts` additions)

```typescript
/**
 * Model profile defining context shaping parameters
 */
export interface ModelProfile {
  name: string;                      // e.g., "claude-code", "claude-sonnet", "claude-opus"
  maxTokens: number;                 // Maximum safe context budget
  imageTokenEstimate: number;        // Base tokens per optimized image
  preferredFrames: number;           // Ideal frame count for this model
  maxFrames: number;                 // Absolute maximum frames
  contextBias: ContextBias;          // Balance between signal types
  promptStyle: PromptStyle;          // How to structure guidance
}

/**
 * Balance between different signal types
 * Values are relative weights (should sum to ~1.0)
 */
export interface ContextBias {
  visual: number;      // Weight toward image frames (0.0-1.0)
  code: number;        // Weight toward git diff/code context (0.0-1.0)
  execution: number;   // Weight toward terminal/logs (0.0-1.0)
}

/**
 * Prompt generation style for the model
 */
export interface PromptStyle {
  verbosity: 'minimal' | 'standard' | 'detailed';
  includeTimelineRefs: boolean;
  includeDiffCorrelation: boolean;
  includeUncertaintyGuidance: boolean;
  causalFocusLevel: 'low' | 'medium' | 'high';
}

/**
 * Token utilization report
 */
export interface TokenUtilization {
  visual: number;           // Tokens used by images
  text: number;             // Tokens used by text (context + report)
  prompt: number;           // Tokens used by suggested prompt
  total: number;            // Total tokens
  budget: number;           // Model's max budget
  utilization: number;      // Percentage of budget used (0-100)
  breakdown: TokenBreakdown;
}

export interface TokenBreakdown {
  frames: { count: number; tokens: number };
  terminalContext: { lines: number; tokens: number };
  gitContext: { diffLines: number; tokens: number };
  reportStructure: number;
  suggestedPrompt: number;
}

/**
 * Frame with entropy scoring for model-aware selection
 */
export interface ScoredFrame extends KeyFrame {
  entropyScore: number;     // Information density (0-1)
  reasoningValue: number;   // Expected value for model reasoning (0-1)
  dropPriority: number;     // Lower = more likely to keep under budget
}

/**
 * Budget allocation result
 */
export interface BudgetAllocation {
  frameCount: number;
  frameResolution: { width: number; height: number };
  frameQuality: number;     // JPEG quality (0-100)
  terminalLines: number;
  gitDiffLines: number;
  includeCommits: boolean;
  includeFullDiff: boolean;
  adjustments: string[];    // Descriptions of what was adjusted
}

/**
 * Capture options with model awareness
 */
export interface ModelAwareCaptureOptions {
  description: string;
  model: string;            // Model profile name
  interactive?: boolean;
  temporary?: boolean;
  overrideBudget?: number;  // Override model's default budget
}
```

---

### New Module: Model Profiles (`src/models.ts`)

```typescript
import { ModelProfile } from './types';

/**
 * Built-in model profiles
 *
 * These define how context is shaped for each target model.
 * Profiles are based on empirical testing of model behavior
 * and documented context window sizes.
 */
export const MODEL_PROFILES: Record<string, ModelProfile> = {
  'claude-code': {
    name: 'claude-code',
    maxTokens: 100000,
    imageTokenEstimate: 1200,
    preferredFrames: 6,
    maxFrames: 10,
    contextBias: {
      visual: 0.4,
      code: 0.4,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'minimal',
      includeTimelineRefs: true,
      includeDiffCorrelation: true,
      includeUncertaintyGuidance: true,
      causalFocusLevel: 'high'
    }
  },

  'claude-sonnet': {
    name: 'claude-sonnet',
    maxTokens: 200000,
    imageTokenEstimate: 1200,
    preferredFrames: 8,
    maxFrames: 12,
    contextBias: {
      visual: 0.5,
      code: 0.3,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'standard',
      includeTimelineRefs: true,
      includeDiffCorrelation: true,
      includeUncertaintyGuidance: true,
      causalFocusLevel: 'high'
    }
  },

  'claude-opus': {
    name: 'claude-opus',
    maxTokens: 200000,
    imageTokenEstimate: 1200,
    preferredFrames: 10,
    maxFrames: 15,
    contextBias: {
      visual: 0.45,
      code: 0.35,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'detailed',
      includeTimelineRefs: true,
      includeDiffCorrelation: true,
      includeUncertaintyGuidance: true,
      causalFocusLevel: 'high'
    }
  },

  'claude-haiku': {
    name: 'claude-haiku',
    maxTokens: 200000,
    imageTokenEstimate: 1200,
    preferredFrames: 4,
    maxFrames: 6,
    contextBias: {
      visual: 0.5,
      code: 0.3,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'minimal',
      includeTimelineRefs: true,
      includeDiffCorrelation: false,
      includeUncertaintyGuidance: false,
      causalFocusLevel: 'medium'
    }
  }
};

/**
 * Get model profile by name (case-insensitive)
 * Falls back to claude-code if not found
 */
export function getModelProfile(name: string): ModelProfile {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, '-');
  return MODEL_PROFILES[normalized] ?? MODEL_PROFILES['claude-code'];
}

/**
 * List available model profiles
 */
export function listModelProfiles(): string[] {
  return Object.keys(MODEL_PROFILES);
}

/**
 * Register a custom model profile
 */
export function registerModelProfile(profile: ModelProfile): void {
  MODEL_PROFILES[profile.name.toLowerCase()] = profile;
}
```

---

### New Module: Token Budget Engine (`src/budget.ts`)

```typescript
import {
  ModelProfile,
  BudgetAllocation,
  TokenUtilization,
  ScoredFrame,
  CaptureContext
} from './types';

/**
 * Token Budget Engine
 *
 * Manages dynamic allocation of the model's context budget
 * across visual, code, and execution signals.
 */

/**
 * Calculate optimal budget allocation for a capture
 *
 * Algorithm:
 * 1. Reserve 5% for report structure and prompt
 * 2. Allocate remaining budget according to model's contextBias
 * 3. Calculate max frames that fit in visual budget
 * 4. Calculate text limits that fit in code/execution budget
 * 5. If total exceeds budget, reduce frames before text
 */
export function calculateBudgetAllocation(
  profile: ModelProfile,
  availableFrames: number,
  context: CaptureContext
): BudgetAllocation {
  const safetyMargin = 0.95;  // Use 95% of budget max
  const availableBudget = profile.maxTokens * safetyMargin;

  // Reserve tokens for structure
  const structureReserve = 500;  // Report markdown, prompt, etc.
  const workingBudget = availableBudget - structureReserve;

  // Allocate by bias
  const visualBudget = workingBudget * profile.contextBias.visual;
  const codeBudget = workingBudget * profile.contextBias.code;
  const execBudget = workingBudget * profile.contextBias.execution;

  // Calculate frame allocation
  const baseImageTokens = profile.imageTokenEstimate;
  let frameCount = Math.min(
    Math.floor(visualBudget / baseImageTokens),
    profile.preferredFrames,
    availableFrames
  );

  // Determine optimal resolution/quality to maximize frame count
  let resolution = { width: 1024, height: 576 };
  let quality = 85;

  // If we can't fit preferred frames, try reducing quality
  if (frameCount < profile.preferredFrames && frameCount < availableFrames) {
    // Try 75% quality (saves ~15% tokens)
    const reducedTokens = baseImageTokens * 0.85;
    const reducedFrameCount = Math.floor(visualBudget / reducedTokens);
    if (reducedFrameCount > frameCount) {
      quality = 75;
      frameCount = Math.min(reducedFrameCount, profile.preferredFrames, availableFrames);
    }
  }

  // Calculate text allocations
  const terminalLines = Math.floor(execBudget / 4);  // ~4 chars per token
  const gitDiffLines = Math.floor(codeBudget / 4);

  const adjustments: string[] = [];
  if (quality < 85) {
    adjustments.push(`Reduced image quality to ${quality}% to fit ${frameCount} frames`);
  }
  if (frameCount < profile.preferredFrames) {
    adjustments.push(`Limited to ${frameCount} frames (preferred: ${profile.preferredFrames})`);
  }

  return {
    frameCount,
    frameResolution: resolution,
    frameQuality: quality,
    terminalLines: Math.min(terminalLines, 100),
    gitDiffLines: Math.min(gitDiffLines, 150),
    includeCommits: codeBudget > 200,
    includeFullDiff: codeBudget > 500,
    adjustments
  };
}

/**
 * Calculate token utilization for a completed capture
 */
export function calculateTokenUtilization(
  profile: ModelProfile,
  frames: ScoredFrame[],
  context: CaptureContext,
  promptTokens: number
): TokenUtilization {
  const visualTokens = frames.reduce((sum, f) => sum + f.tokenEstimate, 0);
  const textTokens = context.terminal.tokenEstimate + context.git.tokenEstimate;
  const structureTokens = 100;  // Report markdown overhead

  const total = visualTokens + textTokens + structureTokens + promptTokens;

  return {
    visual: visualTokens,
    text: textTokens,
    prompt: promptTokens,
    total,
    budget: profile.maxTokens,
    utilization: (total / profile.maxTokens) * 100,
    breakdown: {
      frames: { count: frames.length, tokens: visualTokens },
      terminalContext: {
        lines: context.terminal.recentOutput.length,
        tokens: context.terminal.tokenEstimate
      },
      gitContext: {
        diffLines: context.git.diff?.split('\n').length ?? 0,
        tokens: context.git.tokenEstimate
      },
      reportStructure: structureTokens,
      suggestedPrompt: promptTokens
    }
  };
}

/**
 * Check if capture is within budget and suggest adjustments if not
 */
export function validateBudget(
  utilization: TokenUtilization
): { valid: boolean; suggestions: string[] } {
  if (utilization.utilization <= 95) {
    return { valid: true, suggestions: [] };
  }

  const suggestions: string[] = [];
  const overage = utilization.total - (utilization.budget * 0.95);

  // Suggest frame reduction first
  if (utilization.breakdown.frames.count > 4) {
    const frameTokens = utilization.visual / utilization.breakdown.frames.count;
    const framesToDrop = Math.ceil(overage / frameTokens);
    suggestions.push(`Remove ${framesToDrop} lowest-entropy frames`);
  }

  // Then suggest text truncation
  if (utilization.text > 500) {
    suggestions.push('Truncate terminal context to error lines only');
  }
  if (utilization.breakdown.gitContext.diffLines > 50) {
    suggestions.push('Use diff summary instead of full diff');
  }

  return { valid: false, suggestions };
}
```

---

### New Module: Model-Aligned Selection (`src/model-selection.ts`)

```typescript
import { ExtractedFrame, ScoredFrame, ModelProfile } from './types';
import { calculateFrameDiff } from './selection';

/**
 * Model-Aligned Frame Selection
 *
 * Selects frames not just by perceptual difference, but by
 * expected reasoning value under the target model.
 *
 * Principles:
 * - Early frames establish baseline state
 * - Mid-sequence frames capture divergence
 * - Late frames capture stabilized failure
 * - Low-entropy frames are dropped first under budget pressure
 */

/**
 * Calculate entropy score for a frame
 *
 * Higher entropy = more information content = higher value
 * Based on:
 * - Visual complexity (edge density, color variance)
 * - Temporal position (boundary frames get bonus)
 * - Change magnitude (larger changes = higher value)
 */
export async function calculateEntropyScore(
  frame: ExtractedFrame,
  prevFrame: ExtractedFrame | null,
  nextFrame: ExtractedFrame | null,
  totalFrames: number
): Promise<number> {
  let score = 0.5;  // Base score

  // Temporal position bonus
  const position = frame.index / totalFrames;
  if (position < 0.1) score += 0.2;       // First 10% - baseline
  if (position > 0.9) score += 0.2;       // Last 10% - final state
  if (position > 0.4 && position < 0.6) score += 0.1;  // Middle - transition

  // Change magnitude bonus
  if (prevFrame) {
    const diffFromPrev = await calculateFrameDiff(prevFrame.path, frame.path);
    score += Math.min(diffFromPrev / 100, 0.3);  // Up to 0.3 for large changes
  }

  return Math.min(score, 1.0);
}

/**
 * Calculate reasoning value for a frame under target model
 *
 * Combines entropy with model-specific biases
 */
export function calculateReasoningValue(
  entropyScore: number,
  position: 'start' | 'middle' | 'end',
  profile: ModelProfile
): number {
  let value = entropyScore;

  // Model-specific adjustments
  if (profile.promptStyle.causalFocusLevel === 'high') {
    // High causal focus: boost transition frames
    if (position === 'middle') value *= 1.2;
  }

  // Visual bias increases frame value
  value *= (0.5 + profile.contextBias.visual);

  return Math.min(value, 1.0);
}

/**
 * Select frames optimized for model reasoning
 *
 * Algorithm:
 * 1. Score all frames for entropy and reasoning value
 * 2. Always include first and last frames (anchors)
 * 3. Select highest-value frames up to budget
 * 4. Ensure temporal coverage (no large gaps)
 * 5. Assign drop priority for budget overflow handling
 */
export async function selectModelAlignedFrames(
  frames: ExtractedFrame[],
  profile: ModelProfile,
  targetCount: number
): Promise<ScoredFrame[]> {
  const scored: ScoredFrame[] = [];

  // Score all frames
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const prev = i > 0 ? frames[i - 1] : null;
    const next = i < frames.length - 1 ? frames[i + 1] : null;

    const entropyScore = await calculateEntropyScore(frame, prev, next, frames.length);
    const position = i === 0 ? 'start' : i === frames.length - 1 ? 'end' : 'middle';
    const reasoningValue = calculateReasoningValue(entropyScore, position, profile);

    scored.push({
      ...frame,
      diffScore: 0,  // Will be set later
      reason: '',    // Will be set later
      optimizedPath: '',
      tokenEstimate: profile.imageTokenEstimate,
      entropyScore,
      reasoningValue,
      dropPriority: 1 - reasoningValue  // Lower value = keep
    });
  }

  // Always include anchors
  const anchors = [scored[0], scored[scored.length - 1]];
  anchors[0].reason = 'Start of capture - baseline state';
  anchors[0].dropPriority = 0;  // Never drop
  anchors[anchors.length - 1].reason = 'End of capture - final failure state';
  anchors[anchors.length - 1].dropPriority = 0;  // Never drop

  // Select top candidates excluding anchors
  const candidates = scored
    .slice(1, -1)
    .sort((a, b) => b.reasoningValue - a.reasoningValue)
    .slice(0, targetCount - 2);

  // Generate reasons for selected candidates
  for (const frame of candidates) {
    if (frame.reasoningValue > 0.7) {
      frame.reason = `High-entropy transition - ${Math.round(frame.entropyScore * 100)}% information density`;
    } else if (frame.entropyScore > 0.5) {
      frame.reason = `State change detected - temporal divergence point`;
    } else {
      frame.reason = `Coverage frame - maintains temporal continuity`;
    }
  }

  // Combine and sort chronologically
  const selected = [...anchors.slice(0, 1), ...candidates, ...anchors.slice(-1)]
    .sort((a, b) => a.index - b.index);

  // Ensure no large temporal gaps (fill if needed)
  const filled = ensureTemporalCoverage(selected, scored, targetCount);

  return filled;
}

/**
 * Ensure no temporal gaps larger than 25% of total duration
 */
function ensureTemporalCoverage(
  selected: ScoredFrame[],
  allFrames: ScoredFrame[],
  maxCount: number
): ScoredFrame[] {
  const result = [...selected];
  const maxGap = allFrames.length * 0.25;

  for (let i = 0; i < result.length - 1 && result.length < maxCount; i++) {
    const gap = result[i + 1].index - result[i].index;
    if (gap > maxGap) {
      // Find best frame in gap
      const midIndex = Math.floor((result[i].index + result[i + 1].index) / 2);
      const fillFrame = allFrames.find(f => f.index === midIndex);
      if (fillFrame && !result.includes(fillFrame)) {
        fillFrame.reason = 'Coverage frame - filling temporal gap';
        result.splice(i + 1, 0, fillFrame);
      }
    }
  }

  return result.sort((a, b) => a.index - b.index);
}

/**
 * Drop frames to fit budget, starting with highest dropPriority
 */
export function dropFramesForBudget(
  frames: ScoredFrame[],
  targetCount: number
): ScoredFrame[] {
  if (frames.length <= targetCount) return frames;

  // Sort by drop priority (keep lowest)
  const sorted = [...frames].sort((a, b) => a.dropPriority - b.dropPriority);

  // Keep top N by priority
  const kept = sorted.slice(0, targetCount);

  // Return in chronological order
  return kept.sort((a, b) => a.index - b.index);
}
```

---

### New Module: Prompt Generator (`src/prompt.ts`)

```typescript
import { ModelProfile, BugCapture, TokenUtilization } from './types';

/**
 * Generate model-aligned debugging prompt
 *
 * The prompt is optimized to reduce interpretation overhead
 * and let Claude spend tokens on reasoning.
 */

export function generateModelAlignedPrompt(
  capture: BugCapture,
  profile: ModelProfile
): string {
  const style = profile.promptStyle;
  const parts: string[] = [];

  // Core instruction
  parts.push('Analyze this visual bug capture and identify the root cause.');

  // Timeline reference guidance
  if (style.includeTimelineRefs) {
    parts.push('');
    parts.push('## Timeline Analysis');
    parts.push(`The capture contains ${capture.metrics.keyFrames} key frames spanning ${capture.duration}s.`);
    parts.push('- Frame 1 shows the baseline/initial state');
    parts.push('- Intermediate frames show state transitions');
    parts.push(`- Frame ${capture.metrics.keyFrames} shows the final failure state`);
    parts.push('');
    parts.push('Identify which frame first shows incorrect behavior and why.');
  }

  // Diff correlation guidance
  if (style.includeDiffCorrelation && capture.context.git.diff) {
    parts.push('');
    parts.push('## Code Correlation');
    parts.push('The git diff shows recent uncommitted changes.');
    parts.push('Assume the bug is causally linked to these changes unless evidence suggests otherwise.');
    parts.push('Cross-reference visual symptoms with code modifications.');
  }

  // Causal focus
  if (style.causalFocusLevel === 'high') {
    parts.push('');
    parts.push('## Causal Analysis');
    parts.push('Focus on root cause, not symptoms:');
    parts.push('- What state change caused the visual failure?');
    parts.push('- Which code path is responsible?');
    parts.push('- What is the minimal fix?');
  }

  // Uncertainty guidance
  if (style.includeUncertaintyGuidance) {
    parts.push('');
    parts.push('## Uncertainty Handling');
    parts.push('If information is insufficient:');
    parts.push('- State what additional signal would help (logs, state, network)');
    parts.push('- Rank hypotheses by probability');
    parts.push('- Indicate confidence level for each conclusion');
  }

  // Expected output format
  parts.push('');
  parts.push('## Expected Output');
  parts.push('1. **Root Cause**: Most likely cause of the bug');
  parts.push('2. **Visual Evidence**: Which frames support this conclusion');
  parts.push('3. **Code Link**: Connection to recent changes (if applicable)');
  parts.push('4. **Fix**: Minimal, testable fix');
  if (style.verbosity === 'detailed') {
    parts.push('5. **Alternatives**: Other possible causes if primary is uncertain');
    parts.push('6. **Confidence**: Assessment of diagnostic confidence');
  }

  return parts.join('\n');
}

/**
 * Estimate tokens for generated prompt
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
```

---

### Updated Formatter (`src/formatter.ts` additions)

```typescript
import { TokenUtilization, ModelProfile } from './types';

/**
 * Format token utilization summary
 */
export function formatTokenUtilization(util: TokenUtilization): string {
  const lines = [
    '## Token Utilization',
    '',
    '| Component | Tokens | % of Budget |',
    '|-----------|--------|-------------|',
    `| Visual (${util.breakdown.frames.count} frames) | ${util.visual.toLocaleString()} | ${((util.visual / util.budget) * 100).toFixed(1)}% |`,
    `| Terminal context | ${util.breakdown.terminalContext.tokens.toLocaleString()} | ${((util.breakdown.terminalContext.tokens / util.budget) * 100).toFixed(1)}% |`,
    `| Git context | ${util.breakdown.gitContext.tokens.toLocaleString()} | ${((util.breakdown.gitContext.tokens / util.budget) * 100).toFixed(1)}% |`,
    `| Report structure | ${util.breakdown.reportStructure} | ${((util.breakdown.reportStructure / util.budget) * 100).toFixed(1)}% |`,
    `| Suggested prompt | ${util.breakdown.suggestedPrompt} | ${((util.breakdown.suggestedPrompt / util.budget) * 100).toFixed(1)}% |`,
    `| **Total** | **${util.total.toLocaleString()}** | **${util.utilization.toFixed(1)}%** |`,
    '',
    `*Target model: ${util.budget.toLocaleString()} token context window*`
  ];

  return lines.join('\n');
}

/**
 * Format model profile summary
 */
export function formatModelProfile(profile: ModelProfile): string {
  return [
    '## Model Profile',
    '',
    `**Target:** ${profile.name}`,
    `**Context Budget:** ${profile.maxTokens.toLocaleString()} tokens`,
    `**Preferred Frames:** ${profile.preferredFrames}`,
    `**Context Bias:** visual=${profile.contextBias.visual}, code=${profile.contextBias.code}, exec=${profile.contextBias.execution}`,
    ''
  ].join('\n');
}
```

---

### Updated CLI (`src/cli.ts` additions)

```typescript
/**
 * capture command with model awareness
 *
 * claude-bug capture "description"                    # Default: claude-code profile
 * claude-bug capture "description" --model sonnet    # Use claude-sonnet profile
 * claude-bug capture "description" --model opus      # Use claude-opus profile
 * claude-bug capture "description" --budget 50000    # Override token budget
 */
program
  .command('capture')
  .description('Capture a visual bug')
  .argument('<description>', 'Bug description')
  .option('-i, --interactive', 'Interactive mode - stop recording on keypress')
  .option('-t, --temp', 'Temporary capture - auto-delete after first view')
  .option('-m, --model <name>', 'Target model profile (claude-code, claude-sonnet, claude-opus, claude-haiku)', 'claude-code')
  .option('-b, --budget <tokens>', 'Override token budget')
  .action(captureCommand);

/**
 * models command - list available model profiles
 *
 * claude-bug models              # List all profiles
 * claude-bug models claude-code  # Show specific profile details
 */
program
  .command('models')
  .description('List or show model profiles')
  .argument('[name]', 'Profile name to show details')
  .action(modelsCommand);
```

---

### Updated Capture Pipeline (`src/capture.ts`)

The capture pipeline gains model-awareness:

```typescript
import { getModelProfile } from './models';
import { calculateBudgetAllocation, calculateTokenUtilization } from './budget';
import { selectModelAlignedFrames, dropFramesForBudget } from './model-selection';
import { generateModelAlignedPrompt, estimatePromptTokens } from './prompt';

/**
 * Model-aware capture pipeline
 *
 * Changes from v1:
 * 1. Load model profile at start
 * 2. Calculate budget allocation before frame selection
 * 3. Use model-aligned frame selection
 * 4. Dynamically adjust frames/quality to fit budget
 * 5. Generate model-specific prompt
 * 6. Include token utilization in report
 */
export async function runCapture(
  options: ModelAwareCaptureOptions,
  config: Config,
  onProgress: (stage: string, progress: number) => void
): Promise<BugCapture> {
  // 1. Load model profile
  const profile = getModelProfile(options.model);
  if (options.overrideBudget) {
    profile.maxTokens = options.overrideBudget;
  }

  // 2-3. Record and extract (unchanged)
  onProgress('recording', 0);
  const recording = await recordScreen({ /* ... */ });

  onProgress('extracting', 40);
  const frames = await extractFrames(recording.videoPath, framesDir);

  // 4. Gather context first (needed for budget calculation)
  onProgress('context', 50);
  const context = gatherContext();

  // 5. Calculate budget allocation
  const allocation = calculateBudgetAllocation(profile, frames.length, context);

  // 6. Model-aligned frame selection
  onProgress('selecting', 55);
  let keyFrames = await selectModelAlignedFrames(
    frames,
    profile,
    allocation.frameCount
  );

  // 7. Optimize frames with budget-aware quality
  onProgress('optimizing', 70);
  keyFrames = await optimizeKeyFrames(
    keyFrames,
    keyFramesDir,
    allocation.frameResolution,
    allocation.frameQuality
  );

  // 8. Trim context to budget
  context.terminal = trimTerminalContext(context.terminal, allocation.terminalLines);
  context.git = trimGitContext(context.git, allocation.gitDiffLines, allocation.includeFullDiff);

  // 9. Generate model-aligned prompt
  const suggestedPrompt = generateModelAlignedPrompt(capture, profile);
  const promptTokens = estimatePromptTokens(suggestedPrompt);

  // 10. Calculate token utilization
  const utilization = calculateTokenUtilization(profile, keyFrames, context, promptTokens);

  // 11. Validate budget (drop frames if needed)
  const validation = validateBudget(utilization);
  if (!validation.valid) {
    keyFrames = dropFramesForBudget(keyFrames, allocation.frameCount - 1);
    // Recalculate utilization
  }

  // 12. Generate report with utilization
  onProgress('formatting', 90);
  const report = formatReport(capture, profile, utilization, suggestedPrompt);

  // 13. Save and return
  onProgress('saving', 95);
  return saveCapture(capture);
}
```

---

## Data Flow with Model Awareness

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MODEL-AWARE CAPTURE PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  INPUT: "Button not responding" --model claude-sonnet                   │
│                                                                         │
│  ┌──────────────────┐                                                   │
│  │  LOAD PROFILE    │──▶ claude-sonnet: 200k tokens, 8 frames          │
│  │  (src/models.ts) │    contextBias: visual=0.5, code=0.3             │
│  └────────┬─────────┘                                                   │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │  RECORD SCREEN   │──▶ recording.mp4 (unchanged)                     │
│  └────────┬─────────┘                                                   │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │ EXTRACT + GATHER │──▶ 60 frames + terminal/git context              │
│  │     CONTEXT      │                                                   │
│  └────────┬─────────┘                                                   │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │ CALCULATE BUDGET │──▶ BudgetAllocation {                            │
│  │ (src/budget.ts)  │      frameCount: 8,                              │
│  └────────┬─────────┘      frameQuality: 85,                           │
│           │                terminalLines: 50,                           │
│           │                gitDiffLines: 75                             │
│           │              }                                              │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │  MODEL-ALIGNED   │──▶ 8 ScoredFrames with:                          │
│  │ FRAME SELECTION  │    - entropyScore (information density)          │
│  │ (src/model-      │    - reasoningValue (model-specific)             │
│  │  selection.ts)   │    - dropPriority (budget overflow order)        │
│  └────────┬─────────┘                                                   │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │ OPTIMIZE + TRIM  │──▶ key_frames/ (8 JPEG @ 85%)                    │
│  │    CONTEXT       │    terminal: 50 lines                            │
│  └────────┬─────────┘    git: 75 line diff                             │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │ GENERATE PROMPT  │──▶ Model-aligned debugging prompt                │
│  │ (src/prompt.ts)  │    (~300 tokens)                                 │
│  └────────┬─────────┘                                                   │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │ CALC UTILIZATION │──▶ TokenUtilization {                            │
│  │                  │      visual: 9600,                               │
│  └────────┬─────────┘      text: 450,                                  │
│           │                prompt: 300,                                 │
│           │                total: 10450,                                │
│           │                utilization: 5.2%                            │
│           │              }                                              │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │ FORMAT REPORT    │──▶ report.md with:                               │
│  │                  │    - Visual timeline                             │
│  └────────┬─────────┘    - Context sections                            │
│           │              - Token utilization table                      │
│           │              - Suggested prompt                             │
│           │                                                             │
│  ┌────────▼─────────┐                                                   │
│  │    OUTPUT        │──▶ Clipboard + ~/.claude-bug/captures/<id>/      │
│  └──────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Configuration Updates

**Updated config schema:**

```json
{
  "duration": 30,
  "targetKeyFrames": 6,
  "diffThreshold": 3,
  "maxTokens": 10000,
  "ttlDays": 7,
  "defaultModel": "claude-code",
  "customModels": {}
}
```

**New config options:**

| Key | Default | Description |
|-----|---------|-------------|
| `defaultModel` | "claude-code" | Model profile used when --model not specified |
| `customModels` | {} | User-defined model profiles |

---

## Report Output Changes

The v2 report includes new sections:

```markdown
# Bug Report: Button not responding

**ID:** `abc123`
**Captured:** 2024-01-15 14:30:00
**Duration:** 30s
**Model:** claude-sonnet

---

## Model Profile

**Target:** claude-sonnet
**Context Budget:** 200,000 tokens
**Preferred Frames:** 8
**Context Bias:** visual=0.5, code=0.3, exec=0.2

---

## Visual Timeline

### Frame 1 - 0.5s
**Selection reason:** Start of capture - baseline state
**Entropy:** 0.72 | **Reasoning value:** 0.86

![Frame 1](path/to/key_001.jpg)

### Frame 2 - 5.3s
**Selection reason:** High-entropy transition - 78% information density
**Entropy:** 0.78 | **Reasoning value:** 0.91

![Frame 2](path/to/key_002.jpg)

... (6 more frames)

---

## Terminal Context
... (unchanged)

---

## Git Context
... (unchanged)

---

## Token Utilization

| Component | Tokens | % of Budget |
|-----------|--------|-------------|
| Visual (8 frames) | 9,600 | 4.8% |
| Terminal context | 200 | 0.1% |
| Git context | 250 | 0.1% |
| Report structure | 100 | 0.05% |
| Suggested prompt | 300 | 0.15% |
| **Total** | **10,450** | **5.2%** |

*Target model: 200,000 token context window*

---

## Suggested Prompt

Analyze this visual bug capture and identify the root cause.

## Timeline Analysis
The capture contains 8 key frames spanning 30s.
- Frame 1 shows the baseline/initial state
- Intermediate frames show state transitions
- Frame 8 shows the final failure state

Identify which frame first shows incorrect behavior and why.

## Code Correlation
The git diff shows recent uncommitted changes.
Assume the bug is causally linked to these changes unless evidence suggests otherwise.
Cross-reference visual symptoms with code modifications.

## Causal Analysis
Focus on root cause, not symptoms:
- What state change caused the visual failure?
- Which code path is responsible?
- What is the minimal fix?

## Uncertainty Handling
If information is insufficient:
- State what additional signal would help (logs, state, network)
- Rank hypotheses by probability
- Indicate confidence level for each conclusion

## Expected Output
1. **Root Cause**: Most likely cause of the bug
2. **Visual Evidence**: Which frames support this conclusion
3. **Code Link**: Connection to recent changes (if applicable)
4. **Fix**: Minimal, testable fix
5. **Alternatives**: Other possible causes if primary is uncertain
6. **Confidence**: Assessment of diagnostic confidence
```

---

## Implementation Checklist

- [ ] Create `src/models.ts` with built-in profiles
- [ ] Create `src/budget.ts` with token budget engine
- [ ] Create `src/model-selection.ts` with entropy-based selection
- [ ] Create `src/prompt.ts` with model-aligned prompt generation
- [ ] Update `src/types.ts` with new interfaces
- [ ] Update `src/formatter.ts` with utilization formatting
- [ ] Update `src/capture.ts` with model-aware pipeline
- [ ] Update `src/cli.ts` with --model and --budget flags
- [ ] Update `src/storage.ts` to persist model info with captures
- [ ] Add `models` command to CLI
- [ ] Update config schema for defaultModel and customModels
- [ ] Add tests for budget calculation edge cases
- [ ] Add tests for frame selection with different model profiles
