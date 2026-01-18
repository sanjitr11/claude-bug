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
