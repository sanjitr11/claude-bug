import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TerminalContext, GitContext, EnvironmentInfo, GitCommit } from './types';

/**
 * Collect terminal context - recent commands from shell history
 */
export function collectTerminalContext(): TerminalContext {
  const workingDirectory = process.cwd();
  const shell = process.env.SHELL || 'unknown';
  const recentCommands: string[] = [];

  try {
    // Try to read shell history
    const historyFile = getHistoryFile();
    if (historyFile && fs.existsSync(historyFile)) {
      const historyContent = fs.readFileSync(historyFile, 'utf-8');
      const lines = historyContent.split('\n').filter(line => line.trim());

      // Get last 10 commands (excluding duplicates)
      const uniqueCommands = [...new Set(lines)];
      recentCommands.push(...uniqueCommands.slice(-10).reverse());
    }
  } catch (error) {
    // If we can't read history, that's okay
  }

  return {
    recentCommands,
    workingDirectory,
    shell
  };
}

/**
 * Get the shell history file path based on the current shell
 */
function getHistoryFile(): string | null {
  const home = os.homedir();
  const shell = process.env.SHELL || '';

  if (shell.includes('zsh')) {
    return path.join(home, '.zsh_history');
  } else if (shell.includes('bash')) {
    return path.join(home, '.bash_history');
  } else if (shell.includes('fish')) {
    return path.join(home, '.local/share/fish/fish_history');
  }

  return null;
}

/**
 * Collect git context - branch, modified files, recent commits
 */
export function collectGitContext(workingDir?: string): GitContext {
  const cwd = workingDir || process.cwd();

  // Check if we're in a git repository
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
  } catch {
    return { isRepo: false };
  }

  const context: GitContext = { isRepo: true };

  try {
    // Get current branch
    context.branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8'
    }).trim();
  } catch {
    // Ignore errors
  }

  try {
    // Get modified files (both staged and unstaged)
    const statusOutput = execSync('git status --short', {
      cwd,
      encoding: 'utf-8'
    });

    if (statusOutput.trim()) {
      context.hasUncommittedChanges = true;
      context.modifiedFiles = statusOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.trim());
    }
  } catch {
    // Ignore errors
  }

  try {
    // Get recent commits (last 5)
    const logOutput = execSync(
      'git log -5 --pretty=format:"%h|%s|%an|%ad" --date=short',
      { cwd, encoding: 'utf-8' }
    );

    context.recentCommits = logOutput
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date };
      });
  } catch {
    // Ignore errors
  }

  return context;
}

/**
 * Collect environment information - Node version, framework, etc.
 */
export function collectEnvironmentInfo(workingDir?: string): EnvironmentInfo {
  const cwd = workingDir || process.cwd();

  const environment: EnvironmentInfo = {
    os: `${os.platform()} ${os.release()}`
  };

  try {
    // Get Node version
    environment.nodeVersion = process.version;
  } catch {
    // Ignore errors
  }

  try {
    // Detect framework from package.json
    const packageJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      // Detect framework
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      if (deps['react']) {
        environment.framework = `React ${deps['react']}`;
      } else if (deps['vue']) {
        environment.framework = `Vue ${deps['vue']}`;
      } else if (deps['@angular/core']) {
        environment.framework = `Angular ${deps['@angular/core']}`;
      } else if (deps['next']) {
        environment.framework = `Next.js ${deps['next']}`;
      } else if (deps['nuxt']) {
        environment.framework = `Nuxt ${deps['nuxt']}`;
      } else if (deps['svelte']) {
        environment.framework = `Svelte ${deps['svelte']}`;
      }

      // Detect package manager
      if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
        environment.packageManager = 'pnpm';
      } else if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
        environment.packageManager = 'yarn';
      } else if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
        environment.packageManager = 'npm';
      } else if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
        environment.packageManager = 'bun';
      }
    }
  } catch {
    // Ignore errors
  }

  return environment;
}

/**
 * Collect all context at once
 */
export function collectAllContext(workingDir?: string): {
  terminal: TerminalContext;
  git: GitContext;
  environment: EnvironmentInfo;
} {
  const terminal = collectTerminalContext();
  const git = collectGitContext(workingDir);
  const environment = collectEnvironmentInfo(workingDir);

  return { terminal, git, environment };
}
