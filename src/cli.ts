#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import * as readline from 'readline';

import {
  checkFfmpegInstalled,
  getFfmpegInstallInstructions,
  checkScreenRecordingPermission,
  startRecording,
  startInteractiveRecording,
  getVideoInfo
} from './recorder';
import { captureTerminalHistory } from './terminal';
import { gatherGitContext, gatherEnvironmentInfo } from './context';
import {
  ensureStorageExists,
  getRecordingPath,
  getFormattedPath,
  saveCapture,
  listCaptures,
  getCapture,
  deleteCapture,
  getStorageStats,
  runCleanup,
  loadConfig,
  setConfigValue,
  deleteCapturesOlderThan,
  deleteAllCaptures,
  markCaptureViewed,
  parseDuration
} from './storage';
import { formatForClaude, saveFormattedOutput, formatFileSize, formatDuration } from './formatter';
import { BugCapture } from './types';

const program = new Command();

// Run cleanup silently at startup
function silentCleanup(): void {
  try {
    runCleanup();
  } catch {
    // Ignore cleanup errors
  }
}

// Helper for interactive prompts
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

program
  .name('claude-bug')
  .description('Capture visual bugs and terminal context to share with AI coding assistants')
  .version('0.1.0')
  .hook('preAction', () => {
    silentCleanup();
  });

// Helper to wait for any keypress
function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.once('data', () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve();
    });
  });
}

// Helper to check if Claude CLI is available
function isClaudeCliAvailable(): boolean {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Helper to send capture to Claude with optional additional context
function sendToClaude(report: string, additionalContext: string): void {
  const fullPrompt = additionalContext
    ? `${additionalContext}\n\n${report}`
    : `Help me debug this issue:\n\n${report}`;

  console.log(chalk.cyan('\nSending to Claude...\n'));

  const claudeProcess = spawn('claude', ['-p', fullPrompt], {
    stdio: 'inherit'
  });

  claudeProcess.on('error', (err) => {
    console.error(chalk.red(`Failed to start Claude: ${err.message}`));
    process.exit(1);
  });

  claudeProcess.on('close', (code) => {
    process.exit(code || 0);
  });
}

// Capture command
program
  .command('capture')
  .description('Capture a bug with screen recording and context')
  .argument('<description>', 'Description of the bug')
  .option('-d, --duration <seconds>', 'Recording duration in seconds', '30')
  .option('-i, --interactive', 'Interactive mode: record until you press any key to stop')
  .option('--no-video', 'Skip video recording (capture context only)')
  .option('-t, --temp', 'Temporary capture (auto-deletes after first view)')
  .action(async (description: string, options: { duration: string; interactive: boolean; video: boolean; temp: boolean }) => {
    const duration = parseInt(options.duration, 10);

    if (!options.interactive && (isNaN(duration) || duration < 5 || duration > 120)) {
      console.error(chalk.red('Duration must be between 5 and 120 seconds'));
      process.exit(1);
    }

    // Check ffmpeg if recording video
    if (options.video) {
      if (!checkFfmpegInstalled()) {
        console.error(chalk.red('Error: ffmpeg not found\n'));
        console.log(getFfmpegInstallInstructions());
        process.exit(1);
      }

      const permissionCheck = checkScreenRecordingPermission();
      if (!permissionCheck.granted) {
        console.error(chalk.yellow('Warning: ' + permissionCheck.message));
      }
    }

    ensureStorageExists();

    const id = uuidv4();
    const recordingPath = getRecordingPath(id);
    const formattedPath = getFormattedPath(id);

    console.log(chalk.cyan('\n📸 claude-bug capture\n'));
    console.log(chalk.dim(`ID: ${id.substring(0, 8)}`));
    console.log(chalk.dim(`Description: ${description}`));
    if (options.temp) {
      console.log(chalk.yellow('Mode: Temporary (will delete after first view)'));
    }
    console.log('');

    // Capture terminal history before recording
    const terminalSpinner = ora('Capturing terminal history...').start();
    const terminal = captureTerminalHistory(100);
    terminalSpinner.succeed(`Captured ${terminal.commands.length} recent commands`);

    // Capture git context
    const gitSpinner = ora('Gathering git context...').start();
    const git = gatherGitContext();
    if (git.isGitRepo) {
      gitSpinner.succeed(`Git: ${git.branch} (${git.modifiedFiles.length} modified files)`);
    } else {
      gitSpinner.info('Not a git repository');
    }

    // Capture environment
    const envSpinner = ora('Gathering environment info...').start();
    const environment = gatherEnvironmentInfo();
    envSpinner.succeed(`Environment: ${environment.os} ${environment.osVersion}`);

    // Start recording if enabled
    let recordingSuccess = false;
    let actualDuration = duration;
    if (options.video) {
      console.log('');

      if (options.interactive) {
        // Interactive mode: record until user presses a key
        console.log(chalk.cyan('Starting interactive recording...'));
        console.log(chalk.dim('Press any key to stop recording.\n'));

        const handle = startInteractiveRecording({
          duration: 0, // Not used in interactive mode
          outputPath: recordingPath
        });

        const recordSpinner = ora('Recording... (press any key to stop)').start();

        // Wait for keypress to stop
        await waitForKeypress();

        recordSpinner.text = 'Stopping recording...';
        const result = await handle.stop();

        if (result.success) {
          const videoInfo = getVideoInfo(recordingPath);
          if (videoInfo) {
            actualDuration = Math.round(videoInfo.duration);
            recordSpinner.succeed(
              `Recording saved: ${formatDuration(actualDuration)}, ${formatFileSize(videoInfo.size)}`
            );
          } else {
            actualDuration = result.duration;
            recordSpinner.succeed('Recording saved');
          }
          recordingSuccess = true;
        } else {
          recordSpinner.fail(`Recording failed: ${result.error}`);
          console.log(chalk.yellow('\nContinuing without video...\n'));
        }
      } else {
        // Fixed duration mode
        const recordSpinner = ora(`Recording screen for ${duration} seconds...`).start();
        recordSpinner.text = `Recording screen for ${duration} seconds... (press Ctrl+C to stop early)`;

        const result = await startRecording({
          duration,
          outputPath: recordingPath
        });

        if (result.success) {
          const videoInfo = getVideoInfo(recordingPath);
          if (videoInfo) {
            recordSpinner.succeed(
              `Recording saved: ${formatDuration(Math.round(videoInfo.duration))}, ${formatFileSize(videoInfo.size)}`
            );
          } else {
            recordSpinner.succeed('Recording saved');
          }
          recordingSuccess = true;
        } else {
          recordSpinner.fail(`Recording failed: ${result.error}`);
          console.log(chalk.yellow('\nContinuing without video...\n'));
        }
      }
    }

    // Create bug capture object
    const capture: BugCapture = {
      id,
      description,
      timestamp: new Date(),
      recordingPath: recordingSuccess ? recordingPath : '',
      duration: recordingSuccess ? actualDuration : 0,
      terminal,
      git,
      environment
    };

    // Save capture (with temp flag if specified)
    const saveSpinner = ora('Saving capture...').start();
    const metadata = saveCapture(capture, options.temp);

    // Generate formatted output
    saveFormattedOutput(capture, formattedPath);
    saveSpinner.succeed('Capture saved');

    // Summary
    console.log(chalk.green('\n✓ Bug captured successfully!\n'));
    console.log(chalk.bold('Files:'));
    if (recordingSuccess) {
      console.log(`  Video:    ${chalk.cyan(recordingPath)}`);
    }
    console.log(`  Context:  ${chalk.cyan(metadata.contextPath)}`);
    console.log(`  Report:   ${chalk.cyan(formattedPath)}`);

    if (options.temp) {
      console.log(chalk.yellow('\n⚠ This is a temporary capture - it will be deleted after you view it once.'));
    }

    // Copy report to clipboard
    const report = formatForClaude(capture);
    try {
      execSync('pbcopy', { input: report, encoding: 'utf-8' });
      console.log(chalk.green('\n✓ Report copied to clipboard - paste into Claude Code\n'));
    } catch {
      console.log(chalk.yellow('\nCould not copy to clipboard. View with:'));
      console.log(`  ${chalk.cyan(`claude-bug view ${id.substring(0, 8)}`)}\n`);
    }
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List all captured bugs')
  .option('-n, --limit <count>', 'Number of captures to show', '10')
  .action((options: { limit: string }) => {
    const captures = listCaptures();
    const limit = parseInt(options.limit, 10) || 10;

    if (captures.length === 0) {
      console.log(chalk.dim('\nNo captures yet. Run `claude-bug capture "description"` to create one.\n'));
      return;
    }

    console.log(chalk.cyan(`\n📋 Recent captures (${Math.min(captures.length, limit)} of ${captures.length})\n`));

    const displayCaptures = captures.slice(0, limit);

    for (const capture of displayCaptures) {
      const date = new Date(capture.timestamp);
      const hasVideo = capture.recordingPath && fs.existsSync(capture.recordingPath);
      const tempBadge = capture.isTemp ? chalk.yellow(' [TEMP]') : '';

      console.log(
        chalk.bold(capture.id.substring(0, 8)) +
        tempBadge +
        chalk.dim(' | ') +
        chalk.white(capture.description.substring(0, 40)) +
        (capture.description.length > 40 ? '...' : '')
      );
      console.log(
        chalk.dim('         ') +
        date.toLocaleDateString() + ' ' + date.toLocaleTimeString() +
        chalk.dim(' | ') +
        (hasVideo ? chalk.green(`${capture.duration}s video`) : chalk.dim('no video'))
      );
      console.log('');
    }

    const stats = getStorageStats();
    const config = loadConfig();
    console.log(chalk.dim(`Total: ${stats.totalCaptures} captures, ${formatFileSize(stats.totalSize)}`));
    console.log(chalk.dim(`Auto-delete: ${config.ttlDays === 0 ? 'disabled' : `after ${config.ttlDays} days`}`));
    console.log('');
  });

// View command
program
  .command('view')
  .description('View a specific capture')
  .argument('<id>', 'Capture ID (first 8 characters are enough)')
  .option('--json', 'Output raw JSON context')
  .option('--open', 'Open video in default player')
  .action((id: string, options: { json: boolean; open: boolean }) => {
    const capture = getCapture(id);

    if (!capture) {
      console.error(chalk.red(`\nCapture not found: ${id}\n`));
      console.log(chalk.dim('Run `claude-bug list` to see available captures.'));
      process.exit(1);
    }

    // Mark as viewed (will be deleted on next cleanup if temp)
    markCaptureViewed(capture.id);

    // Check if this was a temp capture
    const captures = listCaptures();
    const meta = captures.find(c => c.id === capture.id);
    if (meta?.isTemp) {
      console.log(chalk.yellow('\n⚠ This temporary capture will be deleted on next command.\n'));
    }

    if (options.json) {
      console.log(JSON.stringify(capture, null, 2));
      return;
    }

    if (options.open && capture.recordingPath && fs.existsSync(capture.recordingPath)) {
      console.log(chalk.dim(`Opening video: ${capture.recordingPath}`));
      try {
        execSync(`open "${capture.recordingPath}"`, { stdio: 'ignore' });
      } catch {
        console.error(chalk.red('Failed to open video'));
      }
      return;
    }

    // Display formatted report
    const formattedPath = getFormattedPath(capture.id);
    if (fs.existsSync(formattedPath)) {
      const content = fs.readFileSync(formattedPath, 'utf-8');
      console.log('\n' + content);
    } else {
      // Generate on the fly if file doesn't exist
      console.log('\n' + formatForClaude(capture));
    }
  });

// Delete command
program
  .command('delete')
  .alias('rm')
  .description('Delete a capture')
  .argument('<id>', 'Capture ID to delete')
  .option('-f, --force', 'Skip confirmation')
  .action((id: string, options: { force: boolean }) => {
    const capture = getCapture(id);

    if (!capture) {
      console.error(chalk.red(`\nCapture not found: ${id}\n`));
      process.exit(1);
    }

    if (!options.force) {
      console.log(chalk.yellow(`\nThis will delete capture: ${capture.description}`));
      console.log(chalk.dim(`ID: ${capture.id}`));
      console.log(chalk.dim('\nUse --force to skip this confirmation\n'));
      process.exit(0);
    }

    const success = deleteCapture(id);

    if (success) {
      console.log(chalk.green(`\n✓ Deleted capture: ${id.substring(0, 8)}\n`));
    } else {
      console.error(chalk.red('\nFailed to delete capture\n'));
      process.exit(1);
    }
  });

// Clean command
program
  .command('clean')
  .description('Clean up captures')
  .option('-a, --all', 'Delete all captures')
  .option('-o, --older-than <duration>', 'Delete captures older than duration (e.g., 7d, 24h, 30m)')
  .option('-f, --force', 'Skip confirmation')
  .action(async (options: { all: boolean; olderThan?: string; force: boolean }) => {
    const captures = listCaptures();

    if (captures.length === 0) {
      console.log(chalk.dim('\nNo captures to clean.\n'));
      return;
    }

    // Delete all
    if (options.all) {
      if (!options.force) {
        const answer = await askQuestion(
          chalk.yellow(`\nDelete all ${captures.length} captures? [y/N] `)
        );
        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.dim('Cancelled.\n'));
          return;
        }
      }

      const result = deleteAllCaptures();
      console.log(chalk.green(`\n✓ Deleted ${result.deleted} captures\n`));
      return;
    }

    // Delete older than duration
    if (options.olderThan) {
      const ms = parseDuration(options.olderThan);
      if (ms === null) {
        console.error(chalk.red('\nInvalid duration format. Use: 7d, 24h, or 30m\n'));
        process.exit(1);
      }

      // Count how many would be deleted
      const now = Date.now();
      const toDelete = captures.filter(c => {
        const age = now - new Date(c.timestamp).getTime();
        return age > ms;
      });

      if (toDelete.length === 0) {
        console.log(chalk.dim(`\nNo captures older than ${options.olderThan}.\n`));
        return;
      }

      if (!options.force) {
        const answer = await askQuestion(
          chalk.yellow(`\nDelete ${toDelete.length} captures older than ${options.olderThan}? [y/N] `)
        );
        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.dim('Cancelled.\n'));
          return;
        }
      }

      const result = deleteCapturesOlderThan(options.olderThan);
      console.log(chalk.green(`\n✓ Deleted ${result.deleted} captures\n`));
      return;
    }

    // Interactive mode - show list and let user choose
    console.log(chalk.cyan('\n🧹 Clean up captures\n'));
    console.log('Select captures to delete (enter numbers separated by spaces, or "all"):\n');

    for (let i = 0; i < captures.length; i++) {
      const capture = captures[i];
      const date = new Date(capture.timestamp);
      const hasVideo = capture.recordingPath && fs.existsSync(capture.recordingPath);
      const tempBadge = capture.isTemp ? chalk.yellow(' [TEMP]') : '';
      const size = hasVideo ? formatFileSize(fs.statSync(capture.recordingPath).size) : '0 B';

      console.log(
        chalk.bold(`  ${i + 1}.`) +
        ` ${capture.id.substring(0, 8)}${tempBadge} - ${capture.description.substring(0, 30)}${capture.description.length > 30 ? '...' : ''}`
      );
      console.log(
        chalk.dim(`      ${date.toLocaleDateString()} ${date.toLocaleTimeString()} | ${size}`)
      );
    }

    console.log('');
    const answer = await askQuestion('Enter selection (e.g., "1 3 5" or "all"): ');

    if (!answer.trim()) {
      console.log(chalk.dim('Cancelled.\n'));
      return;
    }

    let idsToDelete: string[] = [];

    if (answer.toLowerCase() === 'all') {
      idsToDelete = captures.map(c => c.id);
    } else {
      const indices = answer.split(/\s+/).map(s => parseInt(s, 10) - 1);
      for (const idx of indices) {
        if (idx >= 0 && idx < captures.length) {
          idsToDelete.push(captures[idx].id);
        }
      }
    }

    if (idsToDelete.length === 0) {
      console.log(chalk.dim('No valid selections.\n'));
      return;
    }

    let deleted = 0;
    for (const id of idsToDelete) {
      if (deleteCapture(id)) {
        deleted++;
      }
    }

    console.log(chalk.green(`\n✓ Deleted ${deleted} captures\n`));
  });

// Config command
program
  .command('config')
  .description('View or set configuration')
  .argument('[key]', 'Config key to get/set (ttl)')
  .argument('[value]', 'Value to set')
  .action((key?: string, value?: string) => {
    const config = loadConfig();

    // Show all config
    if (!key) {
      console.log(chalk.cyan('\n⚙️  Configuration\n'));
      console.log(`  ttl: ${config.ttlDays === 0 ? 'disabled (never auto-delete)' : `${config.ttlDays} days`}`);
      console.log(chalk.dim('\nSet with: claude-bug config ttl <days>'));
      console.log(chalk.dim('Disable auto-delete: claude-bug config ttl 0\n'));
      return;
    }

    // Get specific config
    if (!value) {
      if (key === 'ttl') {
        console.log(`ttl: ${config.ttlDays} days`);
      } else {
        console.error(chalk.red(`Unknown config key: ${key}`));
        process.exit(1);
      }
      return;
    }

    // Set config
    if (key === 'ttl') {
      const days = parseInt(value, 10);
      if (isNaN(days) || days < 0) {
        console.error(chalk.red('TTL must be a non-negative number of days (0 = never delete)'));
        process.exit(1);
      }
      setConfigValue('ttlDays', days);
      if (days === 0) {
        console.log(chalk.green('\n✓ Auto-delete disabled\n'));
      } else {
        console.log(chalk.green(`\n✓ Captures will auto-delete after ${days} days\n`));
      }
    } else {
      console.error(chalk.red(`Unknown config key: ${key}`));
      process.exit(1);
    }
  });

// Send command - capture and send directly to Claude
program
  .command('send')
  .description('Send to Claude: no args = send recent capture, with description = capture new and send')
  .argument('[description]', 'Description of the bug (omit to send most recent capture)')
  .option('-s, --save', 'Save a copy of the capture')
  .option('-p, --prompt <text>', 'Custom prompt for Claude', 'Help me debug this issue:')
  .action(async (description: string | undefined, options: { save: boolean; prompt: string }) => {
    // Check if claude CLI is available
    try {
      execSync('which claude', { stdio: 'ignore' });
    } catch {
      console.error(chalk.red('Error: Claude CLI not found\n'));
      console.log('Install Claude Code: npm install -g @anthropic-ai/claude-code');
      process.exit(1);
    }

    let report: string;

    // If no description, send the most recent capture
    if (!description) {
      const captures = listCaptures();
      if (captures.length === 0) {
        console.error(chalk.red('\nNo captures found. Create one first:\n'));
        console.log('  claude-bug capture "description"');
        console.log('  claude-bug send "description"');
        process.exit(1);
      }

      const recent = captures[0];
      const capture = getCapture(recent.id);
      if (!capture) {
        console.error(chalk.red('\nFailed to load recent capture\n'));
        process.exit(1);
      }

      console.log(chalk.cyan(`\nSending recent capture: ${recent.description}\n`));
      report = formatForClaude(capture);
    } else {
      // Capture new context
      const spinner = ora('Gathering context...').start();

      const terminal = captureTerminalHistory(100);
      const git = gatherGitContext();
      const environment = gatherEnvironmentInfo();

      spinner.text = 'Formatting report...';

      // Build a concise report for Claude
      const lines: string[] = [];
      lines.push(`# Bug: ${description}\n`);

      // Terminal context
      if (terminal.commands.length > 0) {
        lines.push('## Recent Commands');
        lines.push('```bash');
        const recentCmds = terminal.commands.slice(-15);
        for (const cmd of recentCmds) {
          lines.push(`$ ${cmd}`);
        }
        lines.push('```\n');
      }

      // Git context
      if (git.isGitRepo) {
        lines.push('## Git Context');
        lines.push(`Branch: \`${git.branch}\``);
        if (git.modifiedFiles.length > 0) {
          lines.push('\nModified files:');
          for (const file of git.modifiedFiles.slice(0, 10)) {
            lines.push(`- ${file}`);
          }
        }
        if (git.diff) {
          lines.push('\n```diff');
          lines.push(git.diff);
          lines.push('```');
        }
        lines.push('');
      }

      // Environment
      lines.push('## Environment');
      lines.push(`- OS: ${environment.os} ${environment.osVersion}`);
      if (environment.nodeVersion) lines.push(`- Node: ${environment.nodeVersion}`);
      if (environment.framework) lines.push(`- Framework: ${environment.framework}`);
      lines.push(`- Directory: \`${environment.workingDirectory}\``);

      report = lines.join('\n');

      // Save if requested
      if (options.save) {
        const id = uuidv4();
        const capture: BugCapture = {
          id,
          description,
          timestamp: new Date(),
          recordingPath: '',
          duration: 0,
          terminal,
          git,
          environment
        };
        saveCapture(capture, true);
        spinner.succeed(`Context captured (saved as ${id.substring(0, 8)})`);
      } else {
        spinner.succeed('Context captured');
      }
    }

    // Prompt for additional context
    console.log(chalk.dim('Add context for Claude (optional, press Enter to skip):'));
    const additionalContext = await askQuestion(chalk.cyan('> '));

    const userPrompt = additionalContext.trim() || options.prompt;
    sendToClaude(report, userPrompt);
  });

// Status command
program
  .command('status')
  .description('Show storage status and system info')
  .action(() => {
    console.log(chalk.cyan('\n📊 claude-bug status\n'));

    // Check ffmpeg
    const hasFfmpeg = checkFfmpegInstalled();
    console.log(
      chalk.bold('ffmpeg: ') +
      (hasFfmpeg ? chalk.green('✓ installed') : chalk.red('✗ not found'))
    );

    if (!hasFfmpeg) {
      console.log(chalk.dim('  Install: brew install ffmpeg'));
    }

    // Storage stats
    const stats = getStorageStats();
    const config = loadConfig();
    console.log(chalk.bold('\nStorage:'));
    console.log(`  Captures: ${stats.totalCaptures}`);
    console.log(`  Size: ${formatFileSize(stats.totalSize)}`);
    if (stats.oldestCapture) {
      console.log(`  Oldest: ${stats.oldestCapture.toLocaleDateString()}`);
    }
    console.log(`  Auto-delete: ${config.ttlDays === 0 ? 'disabled' : `after ${config.ttlDays} days`}`);

    // Environment
    const env = gatherEnvironmentInfo();
    console.log(chalk.bold('\nEnvironment:'));
    console.log(`  OS: ${env.os} ${env.osVersion}`);
    console.log(`  Shell: ${env.shell}`);
    if (env.nodeVersion) console.log(`  Node: ${env.nodeVersion}`);
    if (env.framework) console.log(`  Framework: ${env.framework}`);

    console.log('');
  });

// Parse and run
program.parse();
