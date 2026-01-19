import { v4 as uuidv4 } from 'uuid';
import { BugCapture, Config, RecordingResult, InteractiveRecordingHandle, ModelAwareCaptureOptions, ScoredFrame } from './types';
import { recordScreen, startInteractiveRecording, getVideoDuration } from './recorder';
import { extractFrames } from './frames';
import { selectKeyFrames } from './selection';
import { optimizeKeyFrames } from './optimize';
import { gatherContext } from './context';
import { formatReport, saveFormattedOutput, formatReportV2 } from './formatter';
import { estimateTotalTokens } from './tokens';
import {
  getCaptureDir,
  getVideoPath,
  getFramesDir,
  getKeyFramesDir,
  getFormattedPath,
  saveCapture,
  ensureStorageExists
} from './storage';
import { getModelProfile } from './models';
import { calculateBudgetAllocation, calculateTokenUtilization, validateBudget } from './budget';
import { selectModelAlignedFrames, dropFramesForBudget } from './model-selection';
import { generateModelAlignedPrompt, estimatePromptTokens } from './prompt';
import * as fs from 'fs';

export type ProgressStage = 'recording' | 'extracting' | 'selecting' | 'optimizing' | 'context' | 'formatting' | 'saving';

export interface ProgressCallback {
  (stage: ProgressStage, progress: number, message?: string): void;
}

/**
 * Main capture orchestration
 *
 * Pipeline:
 * 1. Check prerequisites (ffmpeg, permissions)
 * 2. Record video with overlay indicator
 * 3. Extract frames at 2fps
 * 4. Select key frames using diff algorithm
 * 5. Optimize selected frames
 * 6. Gather context (terminal, git)
 * 7. Generate report
 * 8. Save capture
 * 9. Return capture
 */
export async function runCapture(
  description: string,
  config: Config,
  onProgress?: ProgressCallback
): Promise<BugCapture> {
  const startTime = Date.now();
  const id = uuidv4();

  // Ensure storage exists
  ensureStorageExists();

  // Set up paths
  const captureDir = getCaptureDir(id);
  const videoPath = getVideoPath(id);
  const framesDir = getFramesDir(id);
  const keyFramesDir = getKeyFramesDir(id);
  const reportPath = getFormattedPath(id);

  // Stage 1: Record video (0-40%)
  onProgress?.('recording', 0, 'Starting video recording...');

  const recordingResult = await recordScreen({
    duration: config.duration,
    resolution: { width: 1280, height: 720 },
    fps: 30,
    outputPath: videoPath
  });

  if (!recordingResult.success) {
    throw new Error(`Recording failed: ${recordingResult.error}`);
  }

  onProgress?.('recording', 40, 'Recording complete');

  // Stage 2: Extract frames (40-55%)
  onProgress?.('extracting', 40, 'Extracting frames from video...');

  const frames = await extractFrames(videoPath, framesDir, 2);  // 2fps

  if (frames.length === 0) {
    throw new Error('No frames extracted from video');
  }

  onProgress?.('extracting', 55, `Extracted ${frames.length} frames`);

  // Stage 3: Select key frames (55-70%)
  onProgress?.('selecting', 55, 'Selecting key frames...');

  const selectionResult = await selectKeyFrames(
    frames,
    config.targetKeyFrames,
    config.diffThreshold
  );

  onProgress?.('selecting', 70, `Selected ${selectionResult.keyFrames.length} key frames`);

  // Stage 4: Optimize key frames (70-85%)
  onProgress?.('optimizing', 70, 'Optimizing images...');

  const optimizedFrames = await optimizeKeyFrames(selectionResult.keyFrames, keyFramesDir);

  onProgress?.('optimizing', 85, 'Images optimized');

  // Stage 5: Gather context (85-90%)
  onProgress?.('context', 85, 'Gathering context...');

  const context = gatherContext();

  onProgress?.('context', 90, 'Context gathered');

  // Stage 6: Create capture object (90-95%)
  onProgress?.('formatting', 90, 'Generating report...');

  const processingTime = Date.now() - startTime;

  const capture: BugCapture = {
    id,
    description,
    timestamp: new Date(),
    duration: recordingResult.duration,
    videoPath,
    framesDir,
    keyFramesDir,
    reportPath,
    metrics: {
      totalFrames: frames.length,
      keyFrames: optimizedFrames.length,
      tokenEstimate: 0,  // Will be calculated
      processingTime
    },
    context,
    keyFrames: optimizedFrames
  };

  // Calculate token estimate
  capture.metrics.tokenEstimate = estimateTotalTokens(capture);

  // Generate and save report
  saveFormattedOutput(capture, reportPath);

  onProgress?.('formatting', 95, 'Report generated');

  // Stage 7: Save capture (95-100%)
  onProgress?.('saving', 95, 'Saving capture...');

  saveCapture(capture, false);

  onProgress?.('saving', 100, 'Capture complete');

  return capture;
}

/**
 * Run interactive capture (records until stopped)
 * Returns a handle with stop() method
 */
export function startCapture(
  description: string,
  config: Config,
  onProgress?: ProgressCallback
): {
  stop: () => Promise<BugCapture>;
  recordingHandle: InteractiveRecordingHandle;
} {
  const startTime = Date.now();
  const id = uuidv4();

  // Ensure storage exists
  ensureStorageExists();

  // Set up paths
  const captureDir = getCaptureDir(id);
  const videoPath = getVideoPath(id);
  const framesDir = getFramesDir(id);
  const keyFramesDir = getKeyFramesDir(id);
  const reportPath = getFormattedPath(id);

  // Start recording
  onProgress?.('recording', 0, 'Starting video recording...');

  const recordingHandle = startInteractiveRecording({
    resolution: { width: 1280, height: 720 },
    fps: 30,
    outputPath: videoPath
  });

  const stop = async (): Promise<BugCapture> => {
    // Stop recording
    const recordingResult = await recordingHandle.stop();

    if (!recordingResult.success) {
      throw new Error(`Recording failed: ${recordingResult.error}`);
    }

    onProgress?.('recording', 40, 'Recording complete');

    // Stage 2: Extract frames (40-55%)
    onProgress?.('extracting', 40, 'Extracting frames from video...');

    const frames = await extractFrames(videoPath, framesDir, 2);

    if (frames.length === 0) {
      throw new Error('No frames extracted from video');
    }

    onProgress?.('extracting', 55, `Extracted ${frames.length} frames`);

    // Stage 3: Select key frames (55-70%)
    onProgress?.('selecting', 55, 'Selecting key frames...');

    const selectionResult = await selectKeyFrames(
      frames,
      config.targetKeyFrames,
      config.diffThreshold
    );

    onProgress?.('selecting', 70, `Selected ${selectionResult.keyFrames.length} key frames`);

    // Stage 4: Optimize key frames (70-85%)
    onProgress?.('optimizing', 70, 'Optimizing images...');

    const optimizedFrames = await optimizeKeyFrames(selectionResult.keyFrames, keyFramesDir);

    onProgress?.('optimizing', 85, 'Images optimized');

    // Stage 5: Gather context (85-90%)
    onProgress?.('context', 85, 'Gathering context...');

    const context = gatherContext();

    onProgress?.('context', 90, 'Context gathered');

    // Stage 6: Create capture object (90-95%)
    onProgress?.('formatting', 90, 'Generating report...');

    const processingTime = Date.now() - startTime;

    const capture: BugCapture = {
      id,
      description,
      timestamp: new Date(),
      duration: recordingResult.duration,
      videoPath,
      framesDir,
      keyFramesDir,
      reportPath,
      metrics: {
        totalFrames: frames.length,
        keyFrames: optimizedFrames.length,
        tokenEstimate: 0,
        processingTime
      },
      context,
      keyFrames: optimizedFrames
    };

    // Calculate token estimate
    capture.metrics.tokenEstimate = estimateTotalTokens(capture);

    // Generate and save report
    saveFormattedOutput(capture, reportPath);

    onProgress?.('formatting', 95, 'Report generated');

    // Stage 7: Save capture (95-100%)
    onProgress?.('saving', 95, 'Saving capture...');

    saveCapture(capture, false);

    onProgress?.('saving', 100, 'Capture complete');

    return capture;
  };

  return { stop, recordingHandle };
}

/**
 * Get the formatted report for a capture
 */
export function getCaptureReport(capture: BugCapture): string {
  return formatReport(capture);
}

// ============================================
// V2 MODEL-AWARE CAPTURE
// ============================================

/**
 * Model-aware capture pipeline (v2)
 *
 * Changes from v1:
 * 1. Load model profile at start
 * 2. Calculate budget allocation before frame selection
 * 3. Use model-aligned frame selection
 * 4. Dynamically adjust frames/quality to fit budget
 * 5. Generate model-specific prompt
 * 6. Include token utilization in report
 */
export async function runCaptureV2(
  options: ModelAwareCaptureOptions,
  config: Config,
  onProgress?: ProgressCallback
): Promise<BugCapture> {
  const startTime = Date.now();
  const id = uuidv4();

  // 1. Load model profile
  const profile = getModelProfile(options.model);
  if (options.overrideBudget) {
    profile.maxTokens = options.overrideBudget;
  }

  // Ensure storage exists
  ensureStorageExists();

  // Set up paths
  const captureDir = getCaptureDir(id);
  const videoPath = getVideoPath(id);
  const framesDir = getFramesDir(id);
  const keyFramesDir = getKeyFramesDir(id);
  const reportPath = getFormattedPath(id);

  // Stage 1: Record video (0-40%)
  onProgress?.('recording', 0, `Starting video recording (target: ${profile.name})...`);

  const recordingResult = await recordScreen({
    duration: config.duration,
    resolution: { width: 1280, height: 720 },
    fps: 30,
    outputPath: videoPath
  });

  if (!recordingResult.success) {
    throw new Error(`Recording failed: ${recordingResult.error}`);
  }

  onProgress?.('recording', 40, 'Recording complete');

  // Stage 2: Extract frames (40-50%)
  onProgress?.('extracting', 40, 'Extracting frames from video...');

  const frames = await extractFrames(videoPath, framesDir, 2);

  if (frames.length === 0) {
    throw new Error('No frames extracted from video');
  }

  onProgress?.('extracting', 50, `Extracted ${frames.length} frames`);

  // Stage 3: Gather context (50-55%)
  onProgress?.('context', 50, 'Gathering context...');

  const context = gatherContext();

  onProgress?.('context', 55, 'Context gathered');

  // Stage 4: Calculate budget allocation (55-60%)
  onProgress?.('selecting', 55, 'Calculating budget allocation...');

  const allocation = calculateBudgetAllocation(profile, frames.length, context);

  if (allocation.adjustments.length > 0) {
    onProgress?.('selecting', 57, `Budget adjustments: ${allocation.adjustments.join('; ')}`);
  }

  // Stage 5: Model-aligned frame selection (60-70%)
  onProgress?.('selecting', 60, `Selecting ${allocation.frameCount} key frames...`);

  let keyFrames = await selectModelAlignedFrames(
    frames,
    profile,
    allocation.frameCount
  );

  onProgress?.('selecting', 70, `Selected ${keyFrames.length} key frames`);

  // Stage 6: Optimize frames with budget-aware quality (70-85%)
  onProgress?.('optimizing', 70, 'Optimizing images...');

  // Apply resolution and quality from allocation
  const optimizedFrames = await optimizeKeyFramesV2(
    keyFrames,
    keyFramesDir,
    allocation.frameResolution.width,
    allocation.frameQuality
  );

  onProgress?.('optimizing', 85, 'Images optimized');

  // Stage 7: Generate model-aligned prompt (85-90%)
  onProgress?.('formatting', 85, 'Generating model-aligned prompt...');

  const processingTime = Date.now() - startTime;

  const capture: BugCapture = {
    id,
    description: options.description,
    timestamp: new Date(),
    duration: recordingResult.duration,
    videoPath,
    framesDir,
    keyFramesDir,
    reportPath,
    metrics: {
      totalFrames: frames.length,
      keyFrames: optimizedFrames.length,
      tokenEstimate: 0,  // Will be calculated
      processingTime
    },
    context,
    keyFrames: optimizedFrames
  };

  const suggestedPrompt = generateModelAlignedPrompt(capture, profile);
  const promptTokens = estimatePromptTokens(suggestedPrompt);

  // Stage 8: Calculate token utilization (90-92%)
  onProgress?.('formatting', 90, 'Calculating token utilization...');

  const utilization = calculateTokenUtilization(profile, optimizedFrames, context, promptTokens);

  // Stage 9: Validate budget (drop frames if needed) (92-94%)
  const validation = validateBudget(utilization);
  if (!validation.valid) {
    onProgress?.('formatting', 92, `Over budget, applying adjustments...`);
    const newFrameCount = optimizedFrames.length - 1;
    const trimmedFrames = dropFramesForBudget(optimizedFrames, newFrameCount);
    capture.keyFrames = trimmedFrames;
    capture.metrics.keyFrames = trimmedFrames.length;

    // Recalculate utilization
    const newUtilization = calculateTokenUtilization(profile, trimmedFrames, context, promptTokens);

    // Generate report with new utilization
    const report = formatReportV2(capture, profile, newUtilization, suggestedPrompt);
    fs.writeFileSync(reportPath, report);
  } else {
    // Generate report
    const report = formatReportV2(capture, profile, utilization, suggestedPrompt);
    fs.writeFileSync(reportPath, report);
  }

  // Update token estimate
  capture.metrics.tokenEstimate = utilization.total;

  onProgress?.('formatting', 95, 'Report generated');

  // Stage 10: Save capture (95-100%)
  onProgress?.('saving', 95, 'Saving capture...');

  saveCapture(capture, options.temporary || false, options.model);

  onProgress?.('saving', 100, 'Capture complete');

  return capture;
}

/**
 * Helper function to optimize key frames with custom parameters (v2)
 */
async function optimizeKeyFramesV2(
  keyFrames: ScoredFrame[],
  outputDir: string,
  maxWidth: number,
  quality: number
): Promise<ScoredFrame[]> {
  const Jimp = require('jimp');
  const path = require('path');

  const optimized: ScoredFrame[] = [];

  for (let i = 0; i < keyFrames.length; i++) {
    const frame = keyFrames[i];
    const outputPath = path.join(outputDir, `key_${String(i + 1).padStart(3, '0')}.jpg`);

    try {
      const image = await Jimp.read(frame.path);

      // Resize maintaining aspect ratio
      if (image.getWidth() > maxWidth) {
        image.resize(maxWidth, Jimp.AUTO);
      }

      // Save as JPEG with specified quality
      await image.quality(quality).writeAsync(outputPath);

      // Calculate token estimate based on dimensions
      const pixels = image.getWidth() * image.getHeight();
      const tokenEstimate = Math.ceil(85 + (pixels / 1000) * 1.5);

      optimized.push({
        ...frame,
        optimizedPath: outputPath,
        tokenEstimate
      });
    } catch (error) {
      // Fallback: use original frame
      console.warn(`Failed to optimize frame ${i + 1}, using original`);
      optimized.push({
        ...frame,
        optimizedPath: frame.path
      });
    }
  }

  return optimized;
}
