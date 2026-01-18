import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RecordingOptions, RecordingResult, InteractiveRecordingHandle } from './types';

// Get the path to the overlay binary
function getOverlayPath(): string {
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
  return {
    granted: true,
    message: 'Screen recording permission status unknown. If capture fails, grant permission in System Preferences > Privacy & Security > Screen Recording.'
  };
}

/**
 * Get screen capture device ID (macOS AVFoundation)
 * Parses ffmpeg device list to find screen capture device
 */
export function getScreenDeviceId(): string {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', {
      encoding: 'utf-8'
    });

    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/\[(\d+)\] Capture screen/);
      if (match) {
        return match[1];
      }
    }

    return '3'; // Default fallback
  } catch {
    return '3';
  }
}

/**
 * Record screen video using ffmpeg
 *
 * Settings:
 * - 30fps recording
 * - 1280x720 resolution (720p)
 * - H.264 codec with fast preset
 * - Includes cursor and click indicators
 */
export async function recordScreen(options: RecordingOptions): Promise<RecordingResult> {
  const {
    duration,
    resolution = { width: 1280, height: 720 },
    fps = 30,
    outputPath
  } = options;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const displayId = getScreenDeviceId();

  // Start the recording overlay
  const overlay = startOverlay();

  return new Promise((resolve) => {
    const startTime = Date.now();

    // Build ffmpeg command
    // Using scale with padding to ensure consistent resolution
    const scaleFilter = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;

    const args = [
      '-f', 'avfoundation',
      '-capture_cursor', '1',
      '-capture_mouse_clicks', '1',
      '-i', `${displayId}:none`,
      '-t', String(duration),
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-vf', scaleFilter,
      '-pix_fmt', 'yuv420p',
      '-y',
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    ffmpeg.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      // Stop the overlay
      stopOverlay(overlay);

      const actualDuration = Math.round((Date.now() - startTime) / 1000);

      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({
          success: true,
          videoPath: outputPath,
          duration: actualDuration
        });
      } else {
        resolve({
          success: false,
          videoPath: outputPath,
          duration: 0,
          error: `Recording failed (exit code ${code}): ${stderr.slice(-500)}`
        });
      }
    });

    ffmpeg.on('error', (err) => {
      stopOverlay(overlay);
      resolve({
        success: false,
        videoPath: outputPath,
        duration: 0,
        error: `Failed to start ffmpeg: ${err.message}`
      });
    });
  });
}

/**
 * Start interactive recording (records until stopped)
 * Returns handle with stop() method
 */
export function startInteractiveRecording(
  options: Omit<RecordingOptions, 'duration'>
): InteractiveRecordingHandle {
  const {
    resolution = { width: 1280, height: 720 },
    fps = 30,
    outputPath
  } = options;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const displayId = getScreenDeviceId();

  // Start the recording overlay
  const overlay = startOverlay();

  const startTime = Date.now();

  // Build ffmpeg command (no duration limit)
  const scaleFilter = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;

  const args = [
    '-f', 'avfoundation',
    '-capture_cursor', '1',
    '-capture_mouse_clicks', '1',
    '-i', `${displayId}:none`,
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-vf', scaleFilter,
    '-pix_fmt', 'yuv420p',
    '-y',
    outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stderr = '';
  ffmpeg.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  let resolved = false;

  const stop = (): Promise<RecordingResult> => {
    return new Promise((resolve) => {
      if (resolved) {
        resolve({
          success: false,
          videoPath: outputPath,
          duration: 0,
          error: 'Recording already stopped'
        });
        return;
      }

      ffmpeg.on('close', (code) => {
        resolved = true;
        stopOverlay(overlay);

        const actualDuration = Math.round((Date.now() - startTime) / 1000);

        if ((code === 0 || code === 255) && fs.existsSync(outputPath)) {
          resolve({
            success: true,
            videoPath: outputPath,
            duration: actualDuration
          });
        } else {
          resolve({
            success: false,
            videoPath: outputPath,
            duration: 0,
            error: `Recording failed (exit code ${code}): ${stderr.slice(-500)}`
          });
        }
      });

      // Send 'q' to ffmpeg to gracefully stop recording
      ffmpeg.stdin?.write('q');
      ffmpeg.stdin?.end();

      // Fallback: kill after 3 seconds if not stopped
      setTimeout(() => {
        if (!resolved) {
          ffmpeg.kill('SIGTERM');
        }
      }, 3000);
    });
  };

  return { stop };
}

/**
 * Get video duration in seconds using ffprobe
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf-8' }
    );
    return Math.round(parseFloat(output.trim()));
  } catch {
    return 0;
  }
}
