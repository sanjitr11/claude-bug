#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import * as readline from 'readline';

import {
  checkFfmpegInstalled,
  getFfmpegInstallInstructions
} from './recorder';
import { runCapture, runCaptureV2, startCapture, getCaptureReport } from './capture';
import { formatReport, formatFileSize, formatCaptureSummary } from './formatter';
import { formatTokenEstimate, getTokenBreakdown } from './tokens';
import {
  ensureStorageExists,
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
import { listModelProfiles, getModelProfile } from './models';

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

// Copy text to clipboard
function copyToClipboard(text: string): boolean {
  try {
    execSync('pbcopy', { input: text, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

program
  .name('claude-bug')
  .description('Capture visual bugs as token-optimized context for Claude Code')
  .version('1.0.0')
  .hook('preAction', () => {
    silentCleanup();
  });

// Capture command
program
  .command('capture')
  .description('Capture a visual bug')
  .argument('<description>', 'Bug description')
  .option('-i, --interactive', 'Interactive mode - stop recording on keypress')
  .option('-t, --temp', 'Temporary capture - auto-delete after first view')
  .option('-m, --model <name>', 'Target model profile (claude-code, claude-sonnet, claude-opus, claude-haiku)')
  .option('-b, --budget <tokens>', 'Override token budget')
  .action(async (description: string, options: { interactive: boolean; temp: boolean; model?: string; budget?: string }) => {
    const config = loadConfig();

    // Check ffmpeg
    if (!checkFfmpegInstalled()) {
      console.error(chalk.red('Error: ffmpeg not found\n'));
      console.log(getFfmpegInstallInstructions());
      process.exit(1);
    }

    ensureStorageExists();

    // Determine whether to use v2 pipeline
    const useV2 = options.model !== undefined;
    const modelName = options.model || config.defaultModel || 'claude-code';
    const overrideBudget = options.budget ? parseInt(options.budget, 10) : undefined;

    console.log(chalk.cyan('\nclaude-bug capture\n'));
    console.log(chalk.dim(`Description: ${description}`));
    console.log(chalk.dim(`Duration: ${config.duration}s | Target frames: ${config.targetKeyFrames}`));
    if (useV2) {
      console.log(chalk.dim(`Model: ${modelName}${overrideBudget ? ` (budget: ${overrideBudget})` : ''}`));
    }
    if (options.temp) {
      console.log(chalk.yellow('Mode: Temporary (will delete after first view)'));
    }
    console.log('');

    const spinner = ora();

    try {
      if (options.interactive && !useV2) {
        // Note: v2 doesn't support interactive mode yet
        // Interactive mode
        console.log(chalk.cyan('Starting recording...'));
        console.log(chalk.dim('Press any key to stop.\n'));

        const handle = startCapture(description, config, (stage, progress, message) => {
          if (stage === 'recording') {
            spinner.text = 'Recording... (press any key to stop)';
          } else {
            spinner.text = message || stage;
          }
        });

        spinner.start('Recording... (press any key to stop)');

        await waitForKeypress();

        spinner.text = 'Processing...';
        const capture = await handle.stop();

        spinner.succeed('Capture complete');

        // Show summary
        console.log(chalk.green('\nCapture complete!'));
        console.log(formatCaptureSummary(capture));

        // Copy to clipboard
        const report = getCaptureReport(capture);
        if (copyToClipboard(report)) {
          console.log(chalk.green('\nReport copied to clipboard - paste into Claude Code'));
        } else {
          console.log(chalk.yellow(`\nView with: claude-bug view ${capture.id.substring(0, 8)}`));
        }

      } else {
        // Fixed duration mode
        spinner.start(`Recording ${config.duration}s...`);

        let capture;

        if (useV2) {
          // Use v2 model-aware pipeline
          capture = await runCaptureV2(
            {
              description,
              model: modelName,
              temporary: options.temp,
              overrideBudget
            },
            config,
            (stage, progress, message) => {
              switch (stage) {
                case 'recording':
                  spinner.text = `Recording... ${Math.round(progress)}%`;
                  break;
                case 'extracting':
                  spinner.text = message || 'Extracting frames...';
                  break;
                case 'selecting':
                  spinner.text = message || 'Selecting key frames...';
                  break;
                case 'optimizing':
                  spinner.text = message || 'Optimizing images...';
                  break;
                case 'context':
                  spinner.text = 'Gathering context...';
                  break;
                case 'formatting':
                  spinner.text = message || 'Generating report...';
                  break;
                case 'saving':
                  spinner.text = 'Saving...';
                  break;
              }
            }
          );
        } else {
          // Use v1 pipeline
          capture = await runCapture(description, config, (stage, progress, message) => {
            switch (stage) {
              case 'recording':
                spinner.text = `Recording... ${Math.round(progress)}%`;
                break;
              case 'extracting':
                spinner.text = message || 'Extracting frames...';
                break;
              case 'selecting':
                spinner.text = message || 'Selecting key frames...';
                break;
              case 'optimizing':
                spinner.text = message || 'Optimizing images...';
                break;
              case 'context':
                spinner.text = 'Gathering context...';
                break;
              case 'formatting':
                spinner.text = 'Generating report...';
                break;
              case 'saving':
                spinner.text = 'Saving...';
                break;
            }
          });
        }

        spinner.succeed('Capture complete');

        // Show summary
        console.log(chalk.green('\nCapture complete!'));
        console.log(formatCaptureSummary(capture));

        // Copy to clipboard
        const report = getCaptureReport(capture);
        if (copyToClipboard(report)) {
          console.log(chalk.green('\nReport copied to clipboard - paste into Claude Code'));
        } else {
          console.log(chalk.yellow(`\nView with: claude-bug view ${capture.id.substring(0, 8)}`));
        }
      }

    } catch (error) {
      spinner.fail(`Capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }

    console.log('');
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
        chalk.green(`${capture.keyFrameCount} frames, ${formatTokenEstimate(capture.tokenEstimate)} tokens`)
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
  .description('View a capture and copy report to clipboard')
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

    // Copy to clipboard and display summary
    const report = formatReport(capture);
    if (copyToClipboard(report)) {
      console.log(chalk.green('\nReport copied to clipboard\n'));
    }

    // Show summary
    const breakdown = getTokenBreakdown(capture);
    console.log(chalk.cyan(`Bug: ${capture.description}`));
    console.log(chalk.dim(`ID: ${capture.id.substring(0, 8)}`));
    console.log(chalk.dim(`Captured: ${capture.timestamp.toLocaleString()}`));
    console.log(chalk.dim(`Duration: ${capture.duration}s`));
    console.log('');
    console.log(chalk.bold('Key Frames:'));
    for (const frame of capture.keyFrames) {
      console.log(`  ${frame.timestamp.toFixed(1)}s - ${frame.reason}`);
    }
    console.log('');
    console.log(chalk.bold('Token Estimate:'));
    console.log(`  Images: ${formatTokenEstimate(breakdown.images)}`);
    console.log(`  Context: ${formatTokenEstimate(breakdown.terminal + breakdown.git)}`);
    console.log(`  Total: ${formatTokenEstimate(breakdown.total)}`);
    console.log('');
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
      console.log(chalk.green(`\nDeleted capture: ${id.substring(0, 8)}\n`));
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
      console.log(chalk.green(`\nDeleted ${result.deleted} captures\n`));
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
      console.log(chalk.green(`\nDeleted ${result.deleted} captures\n`));
      return;
    }

    console.log(chalk.dim('\nUse --all or --older-than to specify what to clean.\n'));
  });

// Config command
program
  .command('config')
  .description('View or set configuration')
  .argument('[key]', 'Config key (duration, targetFrames, diffThreshold, maxTokens, ttl)')
  .argument('[value]', 'Value to set')
  .action((key?: string, value?: string) => {
    const config = loadConfig();

    if (!key) {
      console.log(chalk.cyan('\nConfiguration\n'));
      console.log(`  duration: ${config.duration} seconds (recording length)`);
      console.log(`  targetFrames: ${config.targetKeyFrames} frames (target key frames)`);
      console.log(`  diffThreshold: ${config.diffThreshold}% (min visual difference)`);
      console.log(`  maxTokens: ${config.maxTokens} tokens (token budget)`);
      console.log(`  ttl: ${config.ttlDays === 0 ? 'disabled' : `${config.ttlDays} days`} (auto-delete)`);
      console.log(chalk.dim('\nSet with: claude-bug config <key> <value>'));
      console.log(chalk.dim('Example: claude-bug config duration 30\n'));
      return;
    }

    if (!value) {
      switch (key) {
        case 'duration':
          console.log(`duration: ${config.duration} seconds`);
          break;
        case 'targetFrames':
          console.log(`targetFrames: ${config.targetKeyFrames} frames`);
          break;
        case 'diffThreshold':
          console.log(`diffThreshold: ${config.diffThreshold}%`);
          break;
        case 'maxTokens':
          console.log(`maxTokens: ${config.maxTokens} tokens`);
          break;
        case 'ttl':
          console.log(`ttl: ${config.ttlDays} days`);
          break;
        default:
          console.error(chalk.red(`Unknown config key: ${key}`));
          process.exit(1);
      }
      return;
    }

    const numValue = parseInt(value, 10);

    switch (key) {
      case 'duration':
        if (isNaN(numValue) || numValue < 5 || numValue > 120) {
          console.error(chalk.red('Duration must be between 5 and 120 seconds'));
          process.exit(1);
        }
        setConfigValue('duration', numValue);
        console.log(chalk.green(`\nDuration set to ${numValue} seconds\n`));
        break;

      case 'targetFrames':
        if (isNaN(numValue) || numValue < 3 || numValue > 15) {
          console.error(chalk.red('Target frames must be between 3 and 15'));
          process.exit(1);
        }
        setConfigValue('targetKeyFrames', numValue);
        console.log(chalk.green(`\nTarget frames set to ${numValue}\n`));
        break;

      case 'diffThreshold':
        if (isNaN(numValue) || numValue < 1 || numValue > 20) {
          console.error(chalk.red('Diff threshold must be between 1 and 20 percent'));
          process.exit(1);
        }
        setConfigValue('diffThreshold', numValue);
        console.log(chalk.green(`\nDiff threshold set to ${numValue}%\n`));
        break;

      case 'maxTokens':
        if (isNaN(numValue) || numValue < 5000 || numValue > 50000) {
          console.error(chalk.red('Max tokens must be between 5000 and 50000'));
          process.exit(1);
        }
        setConfigValue('maxTokens', numValue);
        console.log(chalk.green(`\nMax tokens set to ${numValue}\n`));
        break;

      case 'ttl':
        if (isNaN(numValue) || numValue < 0) {
          console.error(chalk.red('TTL must be a non-negative number (0 = never delete)'));
          process.exit(1);
        }
        setConfigValue('ttlDays', numValue);
        console.log(chalk.green(`\nTTL set to ${numValue === 0 ? 'disabled' : `${numValue} days`}\n`));
        break;

      default:
        console.error(chalk.red(`Unknown config key: ${key}`));
        console.log(chalk.dim('Valid keys: duration, targetFrames, diffThreshold, maxTokens, ttl'));
        process.exit(1);
    }
  });

// Models command
program
  .command('models')
  .description('List or show model profiles')
  .argument('[name]', 'Profile name to show details')
  .action((name?: string) => {
    if (name) {
      // Show specific profile details
      const profile = getModelProfile(name);
      console.log(chalk.cyan(`\nModel Profile: ${profile.name}\n`));
      console.log(chalk.bold('Context Budget:'), `${profile.maxTokens.toLocaleString()} tokens`);
      console.log(chalk.bold('Image Token Estimate:'), `~${profile.imageTokenEstimate} tokens per image`);
      console.log(chalk.bold('Preferred Frames:'), profile.preferredFrames);
      console.log(chalk.bold('Max Frames:'), profile.maxFrames);
      console.log(chalk.bold('\nContext Bias:'));
      console.log(`  Visual: ${(profile.contextBias.visual * 100).toFixed(0)}%`);
      console.log(`  Code: ${(profile.contextBias.code * 100).toFixed(0)}%`);
      console.log(`  Execution: ${(profile.contextBias.execution * 100).toFixed(0)}%`);
      console.log(chalk.bold('\nPrompt Style:'));
      console.log(`  Verbosity: ${profile.promptStyle.verbosity}`);
      console.log(`  Timeline Refs: ${profile.promptStyle.includeTimelineRefs ? 'yes' : 'no'}`);
      console.log(`  Diff Correlation: ${profile.promptStyle.includeDiffCorrelation ? 'yes' : 'no'}`);
      console.log(`  Uncertainty Guidance: ${profile.promptStyle.includeUncertaintyGuidance ? 'yes' : 'no'}`);
      console.log(`  Causal Focus: ${profile.promptStyle.causalFocusLevel}`);
      console.log('');
    } else {
      // List all profiles
      const profiles = listModelProfiles();
      console.log(chalk.cyan('\nAvailable Model Profiles\n'));
      for (const profileName of profiles) {
        const profile = getModelProfile(profileName);
        console.log(chalk.bold(profile.name));
        console.log(chalk.dim(`  ${profile.maxTokens.toLocaleString()} token budget | ${profile.preferredFrames} preferred frames`));
      }
      console.log(chalk.dim('\nUse with: claude-bug capture "description" --model <profile>\n'));
      console.log(chalk.dim('View details: claude-bug models <profile>\n'));
    }
  });

// Status command
program
  .command('status')
  .description('Show status and storage stats')
  .action(() => {
    console.log(chalk.cyan('\nclaude-bug status\n'));

    const hasFfmpeg = checkFfmpegInstalled();
    console.log(
      chalk.bold('ffmpeg: ') +
      (hasFfmpeg ? chalk.green('installed') : chalk.red('not found'))
    );

    const stats = getStorageStats();
    const config = loadConfig();

    console.log(chalk.bold('\nConfiguration:'));
    console.log(`  Recording duration: ${config.duration}s`);
    console.log(`  Target key frames: ${config.targetKeyFrames}`);
    console.log(`  Diff threshold: ${config.diffThreshold}%`);
    console.log(`  Token budget: ${config.maxTokens}`);

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
