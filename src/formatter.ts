import * as fs from 'fs';
import { BugCapture, KeyFrame, CaptureContext, TokenUtilization, ModelProfile, ScoredFrame } from './types';
import { getTokenBreakdown, formatTokenEstimate } from './tokens';

/**
 * Format visual timeline section with key frames
 */
function formatVisualTimeline(keyFrames: KeyFrame[]): string {
  const lines: string[] = [];

  lines.push('## Visual Timeline');
  lines.push('');

  for (let i = 0; i < keyFrames.length; i++) {
    const frame = keyFrames[i];
    const frameNum = i + 1;

    lines.push(`### Frame ${frameNum} - ${frame.timestamp.toFixed(1)}s`);
    lines.push(`**Selection reason:** ${frame.reason}`);
    lines.push('');
    lines.push(`![Frame ${frameNum}](${frame.optimizedPath})`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format context section (terminal + git)
 */
function formatContext(context: CaptureContext): string {
  const lines: string[] = [];

  // Terminal context
  if (context.terminal.errors.length > 0) {
    lines.push('## Terminal Context');
    lines.push('');
    lines.push('### Recent Errors/Warnings');
    lines.push('```');
    lines.push(context.terminal.errors.join('\n'));
    lines.push('```');
    lines.push('');
  }

  // Git context
  if (context.git.branch) {
    lines.push('## Git Context');
    lines.push('');
    lines.push(`**Branch:** \`${context.git.branch}\``);
    lines.push('');

    if (context.git.recentCommits.length > 0) {
      lines.push('### Recent Commits');
      lines.push('```');
      lines.push(context.git.recentCommits.join('\n'));
      lines.push('```');
      lines.push('');
    }

    if (context.git.diff) {
      lines.push('### Uncommitted Changes');
      lines.push('```diff');
      lines.push(context.git.diff);
      lines.push('```');
      lines.push('');
    } else {
      lines.push('*No uncommitted changes*');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format token summary footer
 */
function formatTokenSummary(capture: BugCapture): string {
  const breakdown = getTokenBreakdown(capture);
  const lines: string[] = [];

  lines.push('## Token Estimate');
  lines.push('');
  lines.push('| Component | Tokens |');
  lines.push('|-----------|--------|');
  lines.push(`| Images (${capture.keyFrames.length} frames) | ${formatTokenEstimate(breakdown.images)} |`);
  lines.push(`| Terminal context | ${formatTokenEstimate(breakdown.terminal)} |`);
  lines.push(`| Git context | ${formatTokenEstimate(breakdown.git)} |`);
  lines.push(`| Report structure | ${formatTokenEstimate(breakdown.structure)} |`);
  lines.push(`| **Total** | **${formatTokenEstimate(breakdown.total)}** |`);
  lines.push('');
  lines.push('*Optimized for Claude Code. Paste this report to share full visual context.*');

  return lines.join('\n');
}

/**
 * Generate markdown report optimized for Claude Code
 */
export function formatReport(capture: BugCapture): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Bug Report: ${capture.description}`);
  lines.push('');
  lines.push(`**ID:** \`${capture.id.substring(0, 8)}\``);
  lines.push(`**Captured:** ${capture.timestamp.toLocaleString()}`);
  lines.push(`**Duration:** ${capture.duration}s`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Visual timeline
  lines.push(formatVisualTimeline(capture.keyFrames));
  lines.push('---');
  lines.push('');

  // Context (terminal + git)
  const contextSection = formatContext(capture.context);
  if (contextSection.trim()) {
    lines.push(contextSection);
    lines.push('---');
    lines.push('');
  }

  // Token summary
  lines.push(formatTokenSummary(capture));

  return lines.join('\n');
}

/**
 * Save formatted output to a file
 */
export function saveFormattedOutput(capture: BugCapture, outputPath: string): void {
  const formatted = formatReport(capture);
  fs.writeFileSync(outputPath, formatted);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Generate a simple summary for CLI output
 */
export function formatCaptureSummary(capture: BugCapture): string {
  const breakdown = getTokenBreakdown(capture);
  const lines: string[] = [];

  lines.push(`  ID: ${capture.id.substring(0, 8)}`);
  lines.push(`  Description: ${capture.description}`);
  lines.push(`  Key frames: ${capture.keyFrames.length} (from ${capture.metrics.totalFrames} extracted)`);
  lines.push(`  Tokens: ${formatTokenEstimate(breakdown.total)}`);
  lines.push(`  Processing time: ${(capture.metrics.processingTime / 1000).toFixed(1)}s`);

  return lines.join('\n');
}

// ============================================
// V2 MODEL-AWARE FORMATTING
// ============================================

/**
 * Format visual timeline with entropy scores (v2)
 */
export function formatVisualTimelineV2(frames: ScoredFrame[]): string {
  const lines: string[] = [];

  lines.push('## Visual Timeline');
  lines.push('');

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const frameNum = i + 1;

    lines.push(`### Frame ${frameNum} - ${frame.timestamp.toFixed(1)}s`);
    lines.push(`**Selection reason:** ${frame.reason}`);
    lines.push(`**Entropy:** ${frame.entropyScore.toFixed(2)} | **Reasoning value:** ${frame.reasoningValue.toFixed(2)}`);
    lines.push('');
    lines.push(`![Frame ${frameNum}](${frame.optimizedPath})`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format token utilization summary (v2)
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
 * Format model profile summary (v2)
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

/**
 * Generate markdown report with model-aware features (v2)
 */
export function formatReportV2(
  capture: BugCapture,
  profile: ModelProfile,
  utilization: TokenUtilization,
  suggestedPrompt: string
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Bug Report: ${capture.description}`);
  lines.push('');
  lines.push(`**ID:** \`${capture.id.substring(0, 8)}\``);
  lines.push(`**Captured:** ${capture.timestamp.toLocaleString()}`);
  lines.push(`**Duration:** ${capture.duration}s`);
  lines.push(`**Model:** ${profile.name}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Model profile
  lines.push(formatModelProfile(profile));
  lines.push('---');
  lines.push('');

  // Visual timeline with entropy scores
  lines.push(formatVisualTimelineV2(capture.keyFrames as ScoredFrame[]));
  lines.push('---');
  lines.push('');

  // Context (terminal + git)
  const contextSection = formatContext(capture.context);
  if (contextSection.trim()) {
    lines.push(contextSection);
    lines.push('---');
    lines.push('');
  }

  // Token utilization
  lines.push(formatTokenUtilization(utilization));
  lines.push('');
  lines.push('---');
  lines.push('');

  // Suggested prompt
  lines.push('## Suggested Prompt');
  lines.push('');
  lines.push(suggestedPrompt);

  return lines.join('\n');
}
