import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RecordingOptions, RecordingResult, InteractiveRecordingHandle } from './types';

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
 * Get installation instructions for ffmpeg
 */
export function getFfmpegInstallInstructions(): string {
  return `ffmpeg is required but not installed.

Install with Homebrew:
  brew install ffmpeg

Or download from: https://ffmpeg.org/download.html`;
}

/**
 * Check if screen recording permission is granted on macOS
 * Returns true if we can likely record, false if permission is definitely missing
 */
export function checkScreenRecordingPermission(): { granted: boolean; message: string } {
  // On macOS, we can't directly check permissions, but we can detect if ffmpeg
  // fails with a permission error. For now, we'll return a helpful message.
  return {
    granted: true, // Assume granted, will fail gracefully if not
    message: `Screen recording requires permission on macOS.

If recording fails, grant permission in:
  System Preferences > Privacy & Security > Screen Recording

Add your terminal app (Terminal, iTerm2, etc.) to the allowed list.`
  };
}

/**
 * Get available screen capture devices on macOS
 */
export function getAvailableDisplays(): string[] {
  try {
    // List available avfoundation devices
    const result = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', {
      encoding: 'utf-8'
    });

    const displays: string[] = [];
    const lines = result.split('\n');
    let inVideoSection = false;

    for (const line of lines) {
      if (line.includes('AVFoundation video devices')) {
        inVideoSection = true;
        continue;
      }
      if (line.includes('AVFoundation audio devices')) {
        break;
      }
      if (inVideoSection && line.includes('[')) {
        const match = line.match(/\[(\d+)\]\s+(.+)/);
        if (match) {
          displays.push(`${match[1]}: ${match[2]}`);
        }
      }
    }

    return displays;
  } catch {
    return ['0: Default screen'];
  }
}

/**
 * Start screen recording using ffmpeg
 */
export async function startRecording(options: RecordingOptions): Promise<RecordingResult> {
  const { duration, outputPath, displayId = '3' } = options;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return new Promise((resolve) => {
    // ffmpeg command for macOS screen recording
    // -f avfoundation: use macOS AVFoundation framework
    // -i "1": capture screen (device index 1 is usually the screen)
    // -t duration: recording duration in seconds
    // -r 30: 30 fps
    // -c:v libx264: use H.264 codec
    // -crf 28: quality level (lower = better quality, 28 is good balance)
    // -preset fast: encoding speed
    // -pix_fmt yuv420p: pixel format for compatibility
    // -vf scale: scale to max 1920x1080, maintaining aspect ratio
    const args = [
      '-f', 'avfoundation',
      '-capture_cursor', '1',
      '-capture_mouse_clicks', '1',
      '-i', `${displayId}:none`, // screen:audio (none = no audio)
      '-t', duration.toString(),
      '-r', '30',
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-y', // overwrite output file if exists
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on('error', (error) => {
      resolve({
        success: false,
        path: outputPath,
        duration: 0,
        error: `Failed to start ffmpeg: ${error.message}`
      });
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        // Verify the file was created
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          resolve({
            success: true,
            path: outputPath,
            duration: duration
          });
        } else {
          resolve({
            success: false,
            path: outputPath,
            duration: 0,
            error: 'Recording completed but output file was not created'
          });
        }
      } else {
        // Check for common errors
        let errorMessage = `ffmpeg exited with code ${code}`;

        if (stderr.includes('Permission Denied') || stderr.includes('Screen recording permission')) {
          errorMessage = `Screen recording permission denied.

Grant permission in:
  System Preferences > Privacy & Security > Screen Recording

Add your terminal app to the allowed list, then restart the terminal.`;
        } else if (stderr.includes('Invalid device')) {
          errorMessage = `Invalid display device. Try running 'claude-bug list-displays' to see available screens.`;
        } else if (stderr) {
          // Extract relevant error from stderr
          const lines = stderr.split('\n').filter(line =>
            line.includes('Error') || line.includes('error') || line.includes('failed')
          );
          if (lines.length > 0) {
            errorMessage = lines.join('\n');
          }
        }

        resolve({
          success: false,
          path: outputPath,
          duration: 0,
          error: errorMessage
        });
      }
    });
  });
}

/**
 * Get video file information
 */
export function getVideoInfo(videoPath: string): { duration: number; size: number } | null {
  try {
    if (!fs.existsSync(videoPath)) {
      return null;
    }

    const stats = fs.statSync(videoPath);
    const size = stats.size;

    // Get duration using ffprobe
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf-8' }
    );

    const duration = parseFloat(result.trim());

    return { duration, size };
  } catch {
    return null;
  }
}

/**
 * Start an interactive screen recording that runs until manually stopped.
 * Returns a handle with a stop() method to end the recording.
 */
export function startInteractiveRecording(options: RecordingOptions): InteractiveRecordingHandle {
  const { outputPath, displayId = '3' } = options;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const startTime = Date.now();

  // ffmpeg command for macOS screen recording (no duration limit)
  const args = [
    '-f', 'avfoundation',
    '-capture_cursor', '1',
    '-capture_mouse_clicks', '1',
    '-i', `${displayId}:none`,
    '-r', '30',
    '-c:v', 'libx264',
    '-crf', '28',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-y',
    outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stderr = '';
  let stopped = false;

  ffmpeg.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const stop = (): Promise<RecordingResult> => {
    return new Promise((resolve) => {
      if (stopped) {
        resolve({
          success: false,
          path: outputPath,
          duration: 0,
          error: 'Recording already stopped'
        });
        return;
      }

      stopped = true;

      ffmpeg.on('close', (code) => {
        const duration = Math.round((Date.now() - startTime) / 1000);

        if (fs.existsSync(outputPath)) {
          const videoInfo = getVideoInfo(outputPath);
          resolve({
            success: true,
            path: outputPath,
            duration: videoInfo?.duration ? Math.round(videoInfo.duration) : duration
          });
        } else if (code === 0 || code === 255) {
          // ffmpeg returns 255 when killed with SIGINT, which is expected
          resolve({
            success: false,
            path: outputPath,
            duration: 0,
            error: 'Recording completed but output file was not created'
          });
        } else {
          let errorMessage = `ffmpeg exited with code ${code}`;

          if (stderr.includes('Permission Denied') || stderr.includes('Screen recording permission')) {
            errorMessage = `Screen recording permission denied.

Grant permission in:
  System Preferences > Privacy & Security > Screen Recording

Add your terminal app to the allowed list, then restart the terminal.`;
          } else if (stderr.includes('Invalid device')) {
            errorMessage = `Invalid display device. Try running 'claude-bug list-displays' to see available screens.`;
          }

          resolve({
            success: false,
            path: outputPath,
            duration: 0,
            error: errorMessage
          });
        }
      });

      // Send 'q' to ffmpeg's stdin to gracefully stop recording
      // This is the cleanest way to stop ffmpeg and ensures proper file finalization
      if (ffmpeg.stdin) {
        ffmpeg.stdin.write('q');
        ffmpeg.stdin.end();
      } else {
        // Fallback to SIGINT if stdin is not available
        ffmpeg.kill('SIGINT');
      }
    });
  };

  // Handle process errors
  ffmpeg.on('error', (error) => {
    stopped = true;
    console.error(`Failed to start ffmpeg: ${error.message}`);
  });

  return {
    stop,
    process: ffmpeg
  };
}
