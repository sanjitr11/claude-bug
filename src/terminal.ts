import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TerminalOutput } from './types';

/**
 * Get the path to the shell history file based on current shell
 */
function getHistoryFilePath(): string | null {
  const shell = process.env.SHELL || '/bin/zsh';
  const home = os.homedir();

  if (shell.includes('zsh')) {
    return path.join(home, '.zsh_history');
  } else if (shell.includes('bash')) {
    // Check for bash_history in different locations
    const bashHistory = path.join(home, '.bash_history');
    if (fs.existsSync(bashHistory)) {
      return bashHistory;
    }
    return path.join(home, '.history');
  } else if (shell.includes('fish')) {
    return path.join(home, '.local/share/fish/fish_history');
  }

  return null;
}

/**
 * Parse zsh history file format
 * Zsh history format: ": timestamp:0;command" or just "command"
 */
function parseZshHistory(content: string): string[] {
  const lines = content.split('\n');
  const commands: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Zsh extended history format
    const match = line.match(/^:\s*\d+:\d+;(.+)$/);
    if (match) {
      commands.push(match[1]);
    } else if (!line.startsWith(':')) {
      // Plain command (no timestamp)
      commands.push(line);
    }
  }

  return commands;
}

/**
 * Parse bash history file (simple line-by-line format)
 */
function parseBashHistory(content: string): string[] {
  return content
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'));
}

/**
 * Parse fish history file format
 * Fish history format: "- cmd: command\n  when: timestamp"
 */
function parseFishHistory(content: string): string[] {
  const commands: string[] = [];
  const matches = content.matchAll(/- cmd: (.+)/g);

  for (const match of matches) {
    commands.push(match[1]);
  }

  return commands;
}

/**
 * Capture recent terminal history
 */
export function captureTerminalHistory(lineCount: number = 100): TerminalOutput {
  const historyPath = getHistoryFilePath();
  const shell = process.env.SHELL || '/bin/zsh';

  const output: TerminalOutput = {
    output: [],
    errors: [],
    commands: []
  };

  if (!historyPath || !fs.existsSync(historyPath)) {
    output.errors.push(`Could not find shell history file for ${shell}`);
    return output;
  }

  try {
    const content = fs.readFileSync(historyPath, 'utf-8');

    let commands: string[];
    if (shell.includes('zsh')) {
      commands = parseZshHistory(content);
    } else if (shell.includes('fish')) {
      commands = parseFishHistory(content);
    } else {
      commands = parseBashHistory(content);
    }

    // Get the last N commands
    const recentCommands = commands.slice(-lineCount);

    // Categorize commands - identify potential error-related ones
    for (const cmd of recentCommands) {
      output.commands.push(cmd);

      // Heuristic: commands that might show errors
      if (
        cmd.includes('npm') ||
        cmd.includes('yarn') ||
        cmd.includes('node') ||
        cmd.includes('python') ||
        cmd.includes('pytest') ||
        cmd.includes('jest') ||
        cmd.includes('cargo') ||
        cmd.includes('go ') ||
        cmd.includes('make') ||
        cmd.includes('git')
      ) {
        output.output.push(cmd);
      }
    }

    // If we found too few "relevant" commands, just include all recent ones
    if (output.output.length < 10) {
      output.output = recentCommands.slice(-50);
    }
  } catch (error) {
    output.errors.push(`Failed to read history: ${error instanceof Error ? error.message : String(error)}`);
  }

  return output;
}

/**
 * Filter terminal output to highlight errors and warnings
 */
export function filterForErrors(lines: string[]): string[] {
  const errorPatterns = [
    /error/i,
    /ERR!/,
    /failed/i,
    /failure/i,
    /exception/i,
    /warning/i,
    /WARN/,
    /cannot/i,
    /could not/i,
    /undefined/i,
    /null/i,
    /not found/i,
    /no such/i,
    /permission denied/i,
    /segmentation fault/i,
    /stack trace/i,
    /traceback/i,
    /panic/i,
  ];

  return lines.filter(line => {
    return errorPatterns.some(pattern => pattern.test(line));
  });
}

/**
 * Get current shell information
 */
export function getShellInfo(): { shell: string; version: string | null } {
  const shell = process.env.SHELL || 'unknown';

  let version: string | null = null;

  try {
    const { execSync } = require('child_process');
    if (shell.includes('zsh')) {
      version = execSync('zsh --version 2>/dev/null', { encoding: 'utf-8' }).trim();
    } else if (shell.includes('bash')) {
      version = execSync('bash --version 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
    } else if (shell.includes('fish')) {
      version = execSync('fish --version 2>/dev/null', { encoding: 'utf-8' }).trim();
    }
  } catch {
    // Ignore version detection errors
  }

  return { shell, version };
}
