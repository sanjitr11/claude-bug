import * as fs from 'fs';
import { BugCapture } from './types';
import { filterForErrors } from './terminal';

/**
 * Format a bug capture into a markdown file optimized for Claude Code
 */
export function formatForClaude(capture: BugCapture): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Bug Report: ${capture.description}`);
  lines.push('');
  lines.push(`**Captured:** ${capture.timestamp.toLocaleString()}`);
  lines.push(`**ID:** \`${capture.id}\``);
  lines.push('');

  // Visual Evidence
  lines.push('## Visual Evidence');
  lines.push('');
  lines.push(`**Recording:** \`${capture.recordingPath}\``);
  lines.push(`**Duration:** ${capture.duration} seconds`);
  lines.push('');
  lines.push('> Open the video file to see the visual bug reproduction.');
  lines.push('');

  // Terminal Output
  lines.push('## Terminal Context');
  lines.push('');

  if (capture.terminal.commands.length > 0) {
    lines.push('### Recent Commands');
    lines.push('```bash');
    // Show last 20 commands
    const recentCommands = capture.terminal.commands.slice(-20);
    for (const cmd of recentCommands) {
      lines.push(`$ ${cmd}`);
    }
    lines.push('```');
    lines.push('');
  }

  // Highlight errors if any
  const errors = filterForErrors(capture.terminal.output);
  if (errors.length > 0) {
    lines.push('### Errors/Warnings Detected');
    lines.push('```');
    for (const error of errors.slice(0, 20)) {
      lines.push(error);
    }
    lines.push('```');
    lines.push('');
  }

  // Git Context
  if (capture.git.isGitRepo) {
    lines.push('## Git Context');
    lines.push('');
    lines.push(`**Branch:** \`${capture.git.branch}\``);
    lines.push('');

    if (capture.git.modifiedFiles.length > 0) {
      lines.push('### Modified Files');
      lines.push('```');
      for (const file of capture.git.modifiedFiles) {
        lines.push(file);
      }
      lines.push('```');
      lines.push('');
    }

    if (capture.git.recentCommits.length > 0) {
      lines.push('### Recent Commits');
      lines.push('```');
      for (const commit of capture.git.recentCommits) {
        lines.push(commit);
      }
      lines.push('```');
      lines.push('');
    }

    if (capture.git.diff) {
      lines.push('### Uncommitted Changes Summary');
      lines.push('```diff');
      lines.push(capture.git.diff);
      lines.push('```');
      lines.push('');
    }
  }

  // Environment
  lines.push('## Environment');
  lines.push('');
  lines.push(`- **OS:** ${capture.environment.os} ${capture.environment.osVersion}`);
  lines.push(`- **Shell:** ${capture.environment.shell}`);
  lines.push(`- **Working Directory:** \`${capture.environment.workingDirectory}\``);

  if (capture.environment.nodeVersion) {
    lines.push(`- **Node.js:** ${capture.environment.nodeVersion}`);
  }
  if (capture.environment.pythonVersion) {
    lines.push(`- **Python:** ${capture.environment.pythonVersion}`);
  }
  if (capture.environment.framework) {
    lines.push(`- **Framework:** ${capture.environment.framework}`);
  }
  lines.push('');

  // Instructions for Claude Code
  lines.push('---');
  lines.push('');
  lines.push('## Instructions for Claude Code');
  lines.push('');
  lines.push('1. Watch the video recording to understand the visual bug');
  lines.push('2. Review the terminal context for error messages');
  lines.push('3. Check the git diff for recent changes that might have caused the bug');
  lines.push('4. Consider the environment when suggesting fixes');
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
 * Generate a short summary for CLI output
 */
export function generateSummary(capture: BugCapture): string {
  const lines: string[] = [];

  lines.push(`Bug: ${capture.description}`);
  lines.push(`ID: ${capture.id.substring(0, 8)}`);
  lines.push(`Time: ${capture.timestamp.toLocaleString()}`);
  lines.push(`Recording: ${capture.duration}s`);

  if (capture.git.isGitRepo) {
    lines.push(`Branch: ${capture.git.branch}`);
    lines.push(`Modified: ${capture.git.modifiedFiles.length} files`);
  }

  return lines.join('\n');
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
