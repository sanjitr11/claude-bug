import { v4 as uuidv4 } from 'uuid';
import { BugCapture, Config, RecordingResult, InteractiveRecordingHandle } from './types';
import { recordScreen, startInteractiveRecording, getVideoDuration } from './recorder';
import { extractFrames } from './frames';
import { selectKeyFrames } from './selection';
import { optimizeKeyFrames } from './optimize';
import { gatherContext } from './context';
import { formatReport, saveFormattedOutput } from './formatter';
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
