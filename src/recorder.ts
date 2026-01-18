import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CaptureOptions, CaptureResult, InteractiveCaptureHandle } from './types';

// Get the path to the overlay binary
function getOverlayPath(): string {
  // Check multiple locations
  const locations = [
    path.join(__dirname, '..', 'dist', 'recording-overlay'),
    path.join(__dirname, 'recording-overlay'),
    path.join(process.cwd(), 'dist', 'recording-overlay')
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  return '';
}

// Start the recording overlay
function startOverlay(): ChildProcess | null {
  const overlayPath = getOverlayPath();
  if (!overlayPath) {
    return null;
  }

  try {
    const overlay = spawn(overlayPath, [], {
      detached: true,
      stdio: 'ignore'
    });
    overlay.unref();
    return overlay;
  } catch {
    return null;
  }
}

// Stop the recording overlay
function stopOverlay(overlay: ChildProcess | null): void {
  if (overlay && overlay.pid) {
    try {
      process.kill(overlay.pid, 'SIGTERM');
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Check if ffmpeg is installed on the system
 */
export function checkFfmpegInstalled(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get ffmpeg installation instructions
 */
export function getFfmpegInstallInstructions(): string {
  return `ffmpeg is required but not installed.

Install with Homebrew:
  brew install ffmpeg

Or download from: https://ffmpeg.org/download.html`;
}

/**
 * Check screen recording permission on macOS
 */
export function checkScreenRecordingPermission(): { granted: boolean; message: string } {
  // On macOS, we can't programmatically check screen recording permission
  // The best we can do is try to capture and see if it fails
  return {
    granted: true,
    message: 'Screen recording permission status unknown. If capture fails, grant permission in System Preferences > Privacy & Security > Screen Recording.'
  };
}

/**
 * Get available display devices
 */
export function getAvailableDisplays(): string[] {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', {
      encoding: 'utf-8'
    });

    const displays: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(/\[(\d+)\] Capture screen/);
      if (match) {
        displays.push(match[1]);
      }
    }

    return displays.length > 0 ? displays : ['3']; // Default to 3 if none found
  } catch {
    return ['3'];
  }
}

/**
 * Capture a single screenshot using ffmpeg
 */
function captureFrame(displayId: string, outputPath: string): boolean {
  try {
    execSync(
      `ffmpeg -f avfoundation -capture_cursor 1 -i "${displayId}:none" -frames:v 1 -y "${outputPath}" 2>/dev/null`,
      { timeout: 5000 }
    );
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Capture frames at regular intervals for a fixed duration
 */
export async function captureFrames(options: CaptureOptions): Promise<CaptureResult> {
  const { duration, outputDir, displayId = '3', frameInterval = 1 } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Start the recording overlay
  const overlay = startOverlay();

  const frames: string[] = [];
  const numFrames = Math.ceil(duration / frameInterval);
  const startTime = Date.now();

  for (let i = 0; i < numFrames; i++) {
    const frameNum = String(i + 1).padStart(3, '0');
    const framePath = path.join(outputDir, `frame_${frameNum}.png`);

    const success = captureFrame(displayId, framePath);
    if (success) {
      frames.push(framePath);
    }

    // Wait for next frame (unless this is the last one)
    if (i < numFrames - 1) {
      await sleep(frameInterval * 1000);
    }
  }

  // Stop the overlay
  stopOverlay(overlay);

  const actualDuration = Math.round((Date.now() - startTime) / 1000);

  if (frames.length === 0) {
    return {
      success: false,
      frames: [],
      duration: 0,
      error: 'Failed to capture any frames. Check screen recording permissions.'
    };
  }

  return {
    success: true,
    frames,
    duration: actualDuration
  };
}

/**
 * Start interactive frame capture (captures until stopped)
 */
export function startInteractiveCapture(options: CaptureOptions): InteractiveCaptureHandle {
  const { outputDir, displayId = '3', frameInterval = 1 } = options;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Start the recording overlay
  const overlay = startOverlay();

  const frames: string[] = [];
  let stopped = false;
  let frameCount = 0;
  const startTime = Date.now();

  // Start capturing frames in background
  const captureLoop = async () => {
    while (!stopped) {
      frameCount++;
      const frameNum = String(frameCount).padStart(3, '0');
      const framePath = path.join(outputDir, `frame_${frameNum}.png`);

      const success = captureFrame(displayId, framePath);
      if (success) {
        frames.push(framePath);
      }

      if (!stopped) {
        await sleep(frameInterval * 1000);
      }
    }
  };

  // Start the capture loop
  const loopPromise = captureLoop();

  const stop = async (): Promise<CaptureResult> => {
    stopped = true;
    await loopPromise;

    // Stop the overlay
    stopOverlay(overlay);

    const actualDuration = Math.round((Date.now() - startTime) / 1000);

    if (frames.length === 0) {
      return {
        success: false,
        frames: [],
        duration: 0,
        error: 'Failed to capture any frames. Check screen recording permissions.'
      };
    }

    return {
      success: true,
      frames,
      duration: actualDuration
    };
  };

  return { stop };
}
