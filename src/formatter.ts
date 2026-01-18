import * as fs from 'fs';
import { BugCapture } from './types';

/**
 * Format a bug capture for Claude Code - comprehensive report
 */
export function formatForClaude(capture: BugCapture): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Bug Report: ${capture.description}`);
  lines.push('');
  lines.push(`**Captured:** ${capture.timestamp.toLocaleString()}`);
  lines.push(`**ID:** \`${capture.id.substring(0, 8)}\``);
  lines.push('');

  // Visual Evidence
  lines.push('## Visual Evidence');
  lines.push('');
  lines.push(`**Frames:** ${capture.frames.length}`);
  lines.push(`**Duration:** ${capture.duration} seconds`);
  lines.push('');

  // List frame paths
  lines.push('### Frame Files');
  for (const frame of capture.frames) {
    lines.push(`- \`${frame}\``);
  }
  lines.push('');

  // Terminal Context
  if (capture.terminalContext) {
    lines.push('## Terminal Context');
    lines.push('');
    lines.push(`**Working Directory:** \`${capture.terminalContext.workingDirectory}\``);
    lines.push(`**Shell:** ${capture.terminalContext.shell}`);
    lines.push('');

    if (capture.terminalContext.recentCommands.length > 0) {
      lines.push('### Recent Commands');
      lines.push('```bash');
      for (const cmd of capture.terminalContext.recentCommands.slice(0, 10)) {
        lines.push(cmd);
      }
      lines.push('```');
      lines.push('');
    }
  }

  // Git Context
  if (capture.gitContext?.isRepo) {
    lines.push('## Git Context');
    lines.push('');

    if (capture.gitContext.branch) {
      lines.push(`**Branch:** \`${capture.gitContext.branch}\``);
      lines.push('');
    }

    if (capture.gitContext.hasUncommittedChanges && capture.gitContext.modifiedFiles) {
      lines.push('### Modified Files');
      for (const file of capture.gitContext.modifiedFiles) {
        lines.push(file);
      }
      lines.push('');
    }

    if (capture.gitContext.recentCommits && capture.gitContext.recentCommits.length > 0) {
      lines.push('### Recent Commits');
      for (const commit of capture.gitContext.recentCommits) {
        lines.push(`\`${commit.hash}\` ${commit.message}`);
      }
      lines.push('');
    }
  }

  // Environment
  if (capture.environment) {
    lines.push('## Environment');
    lines.push('');
    lines.push(`- **OS:** ${capture.environment.os}`);

    if (capture.environment.nodeVersion) {
      lines.push(`- **Node.js:** ${capture.environment.nodeVersion}`);
    }

    if (capture.environment.framework) {
      lines.push(`- **Framework:** ${capture.environment.framework}`);
    }

    if (capture.environment.packageManager) {
      lines.push(`- **Package Manager:** ${capture.environment.packageManager}`);
    }

    lines.push('');
  }

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
