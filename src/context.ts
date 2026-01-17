import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GitContext, EnvironmentInfo } from './types';

/**
 * Execute a command and return output, or null on error
 */
function safeExec(command: string, cwd?: string): string | null {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if we're in a git repository
 */
export function isGitRepository(cwd: string = process.cwd()): boolean {
  const result = safeExec('git rev-parse --is-inside-work-tree', cwd);
  return result === 'true';
}

/**
 * Gather git context information
 */
export function gatherGitContext(cwd: string = process.cwd()): GitContext {
  const context: GitContext = {
    branch: '',
    recentCommits: [],
    diff: '',
    modifiedFiles: [],
    isGitRepo: false
  };

  if (!isGitRepository(cwd)) {
    return context;
  }

  context.isGitRepo = true;

  // Get current branch
  const branch = safeExec('git branch --show-current', cwd);
  context.branch = branch || 'HEAD (detached)';

  // Get recent commits (last 5)
  const commits = safeExec('git log --oneline -5 2>/dev/null', cwd);
  if (commits) {
    context.recentCommits = commits.split('\n').filter(line => line.trim());
  }

  // Get modified files (staged and unstaged)
  const status = safeExec('git status --porcelain', cwd);
  if (status) {
    context.modifiedFiles = status
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const status = line.substring(0, 2);
        const file = line.substring(3);
        return `[${status.trim() || 'M'}] ${file}`;
      });
  }

  // Get diff of uncommitted changes (limit to 500 lines to avoid huge diffs)
  const diff = safeExec('git diff HEAD --stat 2>/dev/null | head -50', cwd);
  if (diff) {
    context.diff = diff;
  }

  // If no diff stat, try to get actual diff (limited)
  if (!context.diff) {
    const actualDiff = safeExec('git diff HEAD 2>/dev/null | head -100', cwd);
    if (actualDiff) {
      context.diff = actualDiff;
    }
  }

  return context;
}

/**
 * Detect the framework being used in the project
 */
function detectFramework(cwd: string = process.cwd()): string | null {
  // Check package.json for common frameworks
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      // Check for frameworks in order of specificity
      if (deps['next']) return `Next.js ${deps['next']}`;
      if (deps['nuxt']) return `Nuxt ${deps['nuxt']}`;
      if (deps['@angular/core']) return `Angular ${deps['@angular/core']}`;
      if (deps['vue']) return `Vue ${deps['vue']}`;
      if (deps['svelte']) return `Svelte ${deps['svelte']}`;
      if (deps['react']) return `React ${deps['react']}`;
      if (deps['express']) return `Express ${deps['express']}`;
      if (deps['fastify']) return `Fastify ${deps['fastify']}`;
      if (deps['nestjs'] || deps['@nestjs/core']) return `NestJS`;
      if (deps['electron']) return `Electron ${deps['electron']}`;
    } catch {
      // Ignore JSON parse errors
    }
  }

  // Check for other project types
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'Rust/Cargo';
  if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'Go';
  if (fs.existsSync(path.join(cwd, 'requirements.txt'))) return 'Python';
  if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) return 'Python';
  if (fs.existsSync(path.join(cwd, 'Gemfile'))) return 'Ruby';
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) return 'Java/Maven';
  if (fs.existsSync(path.join(cwd, 'build.gradle'))) return 'Java/Gradle';

  return null;
}

/**
 * Gather environment information
 */
export function gatherEnvironmentInfo(cwd: string = process.cwd()): EnvironmentInfo {
  const info: EnvironmentInfo = {
    nodeVersion: null,
    pythonVersion: null,
    os: os.platform(),
    osVersion: os.release(),
    shell: process.env.SHELL || 'unknown',
    framework: null,
    workingDirectory: cwd
  };

  // Node.js version
  info.nodeVersion = safeExec('node --version');

  // Python version
  const pythonVersion = safeExec('python3 --version') || safeExec('python --version');
  if (pythonVersion) {
    info.pythonVersion = pythonVersion.replace('Python ', '');
  }

  // Detect framework
  info.framework = detectFramework(cwd);

  return info;
}

/**
 * Get a summary of the project structure
 */
export function getProjectSummary(cwd: string = process.cwd()): string {
  const summary: string[] = [];

  // List top-level files and directories
  try {
    const items = fs.readdirSync(cwd);
    const dirs: string[] = [];
    const files: string[] = [];

    for (const item of items) {
      if (item.startsWith('.') && item !== '.env.example') continue;
      if (item === 'node_modules') continue;

      const stat = fs.statSync(path.join(cwd, item));
      if (stat.isDirectory()) {
        dirs.push(item + '/');
      } else {
        files.push(item);
      }
    }

    if (dirs.length > 0) {
      summary.push('Directories: ' + dirs.slice(0, 10).join(', '));
    }
    if (files.length > 0) {
      summary.push('Key files: ' + files.slice(0, 10).join(', '));
    }
  } catch {
    summary.push('Could not read directory structure');
  }

  return summary.join('\n');
}
