import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TerminalContext, GitContext, CaptureContext } from './types';
import { estimateTextTokens } from './tokens';

/**
 * Error/warning patterns to filter for
 */
const ERROR_PATTERNS = [
  /error/i,
  /Error/,
  /ERR/,
  /failed/i,
  /Failed/,
  /FAILED/,
  /exception/i,
  /Exception/,
  /warning/i,
  /Warning/,
  /WARN/,
  /TypeError/,
  /ReferenceError/,
  /SyntaxError/,
  /ENOENT/,
  /EACCES/,
  /ECONNREFUSED/,
  /npm ERR!/,
  /Cannot find/,
  /not found/i,
  /undefined/,
  /null pointer/i,
  /stack trace/i,
  /Traceback/
];

/**
 * Filter terminal output for error-related lines
 */
function filterErrorLines(lines: string[]): string[] {
  return lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return ERROR_PATTERNS.some(pattern => pattern.test(trimmed));
  });
}

/**
 * Get shell history file path based on current shell
 */
function getHistoryFilePath(): string | null {
  const shell = process.env.SHELL || '';

  if (shell.includes('zsh')) {
    return path.join(os.homedir(), '.zsh_history');
  } else if (shell.includes('bash')) {
    return path.join(os.homedir(), '.bash_history');
  }

  return null;
}

/**
 * Gather terminal context
 * - Try to get recent terminal output from history
 * - Filter for error patterns
 * - Estimate tokens
 */
export function gatherTerminalContext(maxLines: number = 50): TerminalContext {
  const emptyContext: TerminalContext = {
    recentOutput: [],
    errors: [],
    tokenEstimate: 0
  };

  try {
    // Try to get recent commands from history
    const historyPath = getHistoryFilePath();
    let recentOutput: string[] = [];

    if (historyPath && fs.existsSync(historyPath)) {
      const history = fs.readFileSync(historyPath, 'utf-8');
      const lines = history.split('\n').filter(l => l.trim());
      recentOutput = lines.slice(-maxLines);
    }

    // Also try to capture any recent error output from common log locations
    const logPaths = [
      '/tmp/claude-bug-terminal.log',  // Custom log if user sets it up
    ];

    for (const logPath of logPaths) {
      if (fs.existsSync(logPath)) {
        try {
          const logContent = fs.readFileSync(logPath, 'utf-8');
          const logLines = logContent.split('\n').filter(l => l.trim()).slice(-maxLines);
          recentOutput = [...recentOutput, ...logLines].slice(-maxLines);
        } catch {
          // Ignore read errors
        }
      }
    }

    // Filter for error lines
    const errors = filterErrorLines(recentOutput);

    // Calculate token estimate (use errors if available, otherwise recent output)
    const textForTokens = errors.length > 0 ? errors.join('\n') : recentOutput.slice(-20).join('\n');
    const tokenEstimate = Math.min(estimateTextTokens(textForTokens), 400);  // Cap at 400 tokens

    return {
      recentOutput: recentOutput.slice(-maxLines),
      errors: errors.slice(-20),  // Cap at 20 error lines
      tokenEstimate
    };
  } catch {
    return emptyContext;
  }
}

/**
 * Check if current directory is a git repository
 */
function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gather git context (if in git repo)
 * - Current branch
 * - Last 3 commits (oneline format)
 * - Uncommitted diff (only if <50 lines, otherwise summary)
 */
export function gatherGitContext(): GitContext {
  const emptyContext: GitContext = {
    branch: '',
    recentCommits: [],
    diff: null,
    tokenEstimate: 0
  };

  if (!isGitRepo()) {
    return emptyContext;
  }

  try {
    // Get current branch
    let branch = '';
    try {
      branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    } catch {
      // Fallback for detached HEAD
      branch = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    }

    // Get last 3 commits
    let recentCommits: string[] = [];
    try {
      const commits = execSync('git log --oneline -3', { encoding: 'utf-8' }).trim();
      recentCommits = commits.split('\n').filter(l => l.trim());
    } catch {
      // No commits yet
    }

    // Get uncommitted diff
    let diff: string | null = null;
    try {
      const diffOutput = execSync('git diff --stat', { encoding: 'utf-8' }).trim();

      if (diffOutput) {
        // Count lines in full diff
        const fullDiff = execSync('git diff', { encoding: 'utf-8' });
        const lineCount = fullDiff.split('\n').length;

        if (lineCount <= 50) {
          diff = fullDiff;
        } else {
          // Use stat summary for large diffs
          diff = `${diffOutput}\n\n(Full diff omitted - ${lineCount} lines)`;
        }
      }
    } catch {
      // No diff or git error
    }

    // Calculate token estimate
    let text = `Branch: ${branch}\n`;
    text += recentCommits.join('\n') + '\n';
    if (diff) text += diff;

    const tokenEstimate = Math.min(estimateTextTokens(text), 200);  // Cap at 200 tokens

    return {
      branch,
      recentCommits,
      diff,
      tokenEstimate
    };
  } catch {
    return emptyContext;
  }
}

/**
 * Gather all context (terminal + git)
 */
export function gatherContext(): CaptureContext {
  return {
    terminal: gatherTerminalContext(),
    git: gatherGitContext()
  };
}

/**
 * Trim terminal context to fit within budget allocation
 * Prioritizes error lines over recent output
 */
export function trimTerminalContext(context: TerminalContext, maxLines: number): TerminalContext {
  // If already within limits, return as-is
  if (context.errors.length <= maxLines && context.recentOutput.length <= maxLines) {
    return context;
  }

  // Prioritize errors - they're more valuable for debugging
  const trimmedErrors = context.errors.slice(0, maxLines);

  // For recent output, keep roughly 1.5x the error limit but cap at original size
  const outputLimit = Math.min(Math.ceil(maxLines * 1.5), context.recentOutput.length);
  const trimmedOutput = context.recentOutput.slice(-outputLimit);

  // Recalculate token estimate
  const textForTokens = trimmedErrors.length > 0
    ? trimmedErrors.join('\n')
    : trimmedOutput.slice(-20).join('\n');
  const tokenEstimate = Math.min(estimateTextTokens(textForTokens), 400);

  return {
    recentOutput: trimmedOutput,
    errors: trimmedErrors,
    tokenEstimate
  };
}

/**
 * Trim git context to fit within budget allocation
 * Controls diff size and whether to include full diff
 */
export function trimGitContext(
  context: GitContext,
  maxDiffLines: number,
  includeFullDiff: boolean
): GitContext {
  // If no diff or already within limits, minimal changes needed
  if (!context.diff) {
    return context;
  }

  const diffLines = context.diff.split('\n');

  // If diff is within limits and we want full diff, return as-is
  if (diffLines.length <= maxDiffLines && includeFullDiff) {
    return context;
  }

  let trimmedDiff: string | null;

  if (!includeFullDiff) {
    // Use stat summary only
    try {
      const statOutput = execSync('git diff --stat', { encoding: 'utf-8' }).trim();
      trimmedDiff = `${statOutput}\n\n(Full diff omitted - ${diffLines.length} lines)`;
    } catch {
      trimmedDiff = `(Diff summary unavailable - ${diffLines.length} lines total)`;
    }
  } else if (diffLines.length > maxDiffLines) {
    // Truncate to max lines with indicator
    const truncated = diffLines.slice(0, maxDiffLines);
    trimmedDiff = truncated.join('\n') + `\n\n... (truncated, ${diffLines.length - maxDiffLines} more lines)`;
  } else {
    trimmedDiff = context.diff;
  }

  // Recalculate token estimate
  let text = `Branch: ${context.branch}\n`;
  text += context.recentCommits.join('\n') + '\n';
  if (trimmedDiff) text += trimmedDiff;
  const tokenEstimate = Math.min(estimateTextTokens(text), 200);

  return {
    ...context,
    diff: trimmedDiff,
    tokenEstimate
  };
}
