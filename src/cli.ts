#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as readline from 'readline';

import {
  checkFfmpegInstalled,
  getFfmpegInstallInstructions,
  captureFrames,
  startInteractiveCapture
} from './recorder';
import {
  ensureStorageExists,
  getCaptureDir,
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

program
  .name('claude-bug')
  .description('Capture visual bugs to share with Claude Code')
  .version('0.2.0')
  .hook('preAction', () => {
    silentCleanup();
  });

// Capture command
program
  .command('capture')
  .description('Capture screenshots of a bug')
  .argument('<description>', 'Description of the bug')
  .option('-i, --interactive', 'Interactive mode: capture until you press any key to stop')
  .option('-t, --temp', 'Temporary capture (auto-deletes after first view)')
  .action(async (description: string, options: { interactive: boolean; temp: boolean }) => {
    const config = loadConfig();
    const duration = config.duration;

    // Check ffmpeg
    if (!checkFfmpegInstalled()) {
      console.error(chalk.red('Error: ffmpeg not found\n'));
      console.log(getFfmpegInstallInstructions());
      process.exit(1);
    }

    ensureStorageExists();

    const id = uuidv4();
    const captureDir = getCaptureDir(id);
    const formattedPath = getFormattedPath(id);

    console.log(chalk.cyan('\nclaude-bug capture\n'));
    console.log(chalk.dim(`ID: ${id.substring(0, 8)}`));
    console.log(chalk.dim(`Description: ${description}`));
    if (options.temp) {
      console.log(chalk.yellow('Mode: Temporary (will delete after first view)'));
    }
    console.log('');

    let result;

    if (options.interactive) {
      // Interactive mode: capture until keypress
      console.log(chalk.cyan('Starting capture...'));
      console.log(chalk.dim('Press any key to stop.\n'));

      const handle = startInteractiveCapture({
        duration: 0,
        outputDir: captureDir
      });

      const captureSpinner = ora('Capturing... (press any key to stop)').start();

      await waitForKeypress();

      captureSpinner.text = 'Stopping capture...';
      result = await handle.stop();

      if (result.success) {
        captureSpinner.succeed(`Captured ${result.frames.length} frames over ${result.duration}s`);
      } else {
        captureSpinner.fail(`Capture failed: ${result.error}`);
        process.exit(1);
      }
    } else {
      // Fixed duration mode
      const captureSpinner = ora(`Capturing ${duration} frames over ${duration}s...`).start();

      result = await captureFrames({
        duration,
        outputDir: captureDir
      });

      if (result.success) {
        captureSpinner.succeed(`Captured ${result.frames.length} frames`);
      } else {
        captureSpinner.fail(`Capture failed: ${result.error}`);
        process.exit(1);
      }
    }

    // Create bug capture object
    const capture: BugCapture = {
      id,
      description,
      timestamp: new Date(),
      frames: result.frames,
      duration: result.duration
    };

    // Save capture
    const saveSpinner = ora('Saving capture...').start();
    saveCapture(capture, options.temp);
    saveFormattedOutput(capture, formattedPath);
    saveSpinner.succeed('Capture saved');

    if (options.temp) {
      console.log(chalk.yellow('\nThis is a temporary capture - it will be deleted after you view it once.'));
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
  .description('List all captures')
  .option('-n, --limit <count>', 'Number of captures to show', '10')
  .action((options: { limit: string }) => {
    const captures = listCaptures();
    const limit = parseInt(options.limit, 10) || 10;

    if (captures.length === 0) {
      console.log(chalk.dim('\nNo captures yet. Run `claude-bug capture "description"` to create one.\n'));
      return;
    }

    console.log(chalk.cyan(`\nRecent captures (${Math.min(captures.length, limit)} of ${captures.length})\n`));

    const displayCaptures = captures.slice(0, limit);

    for (const capture of displayCaptures) {
      const date = new Date(capture.timestamp);
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
        chalk.green(`${capture.frames.length} frames, ${capture.duration}s`)
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
  .description('View a capture and copy to clipboard')
  .argument('<id>', 'Capture ID (first 8 characters are enough)')
  .option('--json', 'Output raw JSON')
  .action((id: string, options: { json: boolean }) => {
    const capture = getCapture(id);

    if (!capture) {
      console.error(chalk.red(`\nCapture not found: ${id}\n`));
      console.log(chalk.dim('Run `claude-bug list` to see available captures.'));
      process.exit(1);
    }

    markCaptureViewed(capture.id);

    const captures = listCaptures();
    const meta = captures.find(c => c.id === capture.id);
    if (meta?.isTemp) {
      console.log(chalk.yellow('\nThis temporary capture will be deleted on next command.\n'));
    }

    if (options.json) {
      console.log(JSON.stringify(capture, null, 2));
      return;
    }

    // Copy to clipboard and display
    const report = formatForClaude(capture);
    try {
      execSync('pbcopy', { input: report, encoding: 'utf-8' });
      console.log(chalk.green('\n✓ Report copied to clipboard\n'));
    } catch {
      // Continue even if clipboard fails
    }

    console.log(report);
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
  .option('-o, --older-than <duration>', 'Delete captures older than duration (e.g., 7d, 24h)')
  .option('-f, --force', 'Skip confirmation')
  .action(async (options: { all: boolean; olderThan?: string; force: boolean }) => {
    const captures = listCaptures();

    if (captures.length === 0) {
      console.log(chalk.dim('\nNo captures to clean.\n'));
      return;
    }

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

    if (options.olderThan) {
      const ms = parseDuration(options.olderThan);
      if (ms === null) {
        console.error(chalk.red('\nInvalid duration format. Use: 7d, 24h, or 30m\n'));
        process.exit(1);
      }

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

    console.log(chalk.dim('\nUse --all or --older-than to specify what to clean.\n'));
  });

// Config command
program
  .command('config')
  .description('View or set configuration')
  .argument('[key]', 'Config key (duration, ttl)')
  .argument('[value]', 'Value to set')
  .action((key?: string, value?: string) => {
    const config = loadConfig();

    if (!key) {
      console.log(chalk.cyan('\nConfiguration\n'));
      console.log(`  duration: ${config.duration} seconds`);
      console.log(`  ttl: ${config.ttlDays === 0 ? 'disabled' : `${config.ttlDays} days`}`);
      console.log(chalk.dim('\nSet with: claude-bug config <key> <value>'));
      console.log(chalk.dim('Example: claude-bug config duration 10\n'));
      return;
    }

    if (!value) {
      if (key === 'duration') {
        console.log(`duration: ${config.duration} seconds`);
      } else if (key === 'ttl') {
        console.log(`ttl: ${config.ttlDays} days`);
      } else {
        console.error(chalk.red(`Unknown config key: ${key}`));
        process.exit(1);
      }
      return;
    }

    if (key === 'duration') {
      const seconds = parseInt(value, 10);
      if (isNaN(seconds) || seconds < 1 || seconds > 60) {
        console.error(chalk.red('Duration must be between 1 and 60 seconds'));
        process.exit(1);
      }
      setConfigValue('duration', seconds);
      console.log(chalk.green(`\n✓ Duration set to ${seconds} seconds\n`));
    } else if (key === 'ttl') {
      const days = parseInt(value, 10);
      if (isNaN(days) || days < 0) {
        console.error(chalk.red('TTL must be a non-negative number (0 = never delete)'));
        process.exit(1);
      }
      setConfigValue('ttlDays', days);
      console.log(chalk.green(`\n✓ TTL set to ${days === 0 ? 'disabled' : `${days} days`}\n`));
    } else {
      console.error(chalk.red(`Unknown config key: ${key}`));
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show storage status')
  .action(() => {
    console.log(chalk.cyan('\nclaude-bug status\n'));

    const hasFfmpeg = checkFfmpegInstalled();
    console.log(
      chalk.bold('ffmpeg: ') +
      (hasFfmpeg ? chalk.green('✓ installed') : chalk.red('✗ not found'))
    );

    const stats = getStorageStats();
    const config = loadConfig();
    console.log(chalk.bold('\nStorage:'));
    console.log(`  Captures: ${stats.totalCaptures}`);
    console.log(`  Size: ${formatFileSize(stats.totalSize)}`);
    if (stats.oldestCapture) {
      console.log(`  Oldest: ${stats.oldestCapture.toLocaleDateString()}`);
    }
    console.log(`  Auto-delete: ${config.ttlDays === 0 ? 'disabled' : `after ${config.ttlDays} days`}`);
    console.log('');
  });

program.parse();
