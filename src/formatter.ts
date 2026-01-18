import * as fs from 'fs';
import { BugCapture } from './types';

/**
 * Format a bug capture for Claude Code - simple frames + description
 */
export function formatForClaude(capture: BugCapture): string {
  const lines: string[] = [];

  lines.push(`# Bug: ${capture.description}`);
  lines.push('');
  lines.push(`**Captured:** ${capture.timestamp.toLocaleString()}`);
  lines.push(`**Duration:** ${capture.duration} seconds`);
  lines.push(`**Frames:** ${capture.frames.length}`);
  lines.push('');

  // List all frame paths
  for (const frame of capture.frames) {
    lines.push(`- ${frame}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Save formatted output to a file
 */
export function saveFormattedOutput(capture: BugCapture, outputPath: string): void {
  const formatted = formatForClaude(capture);
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
