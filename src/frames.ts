import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ExtractedFrame } from './types';

/**
 * Extract frames from video at specified FPS
 *
 * For 30s video at 2fps = 60 frames
 * This provides enough granularity to catch UI changes while keeping
 * the number of frames manageable for processing.
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  fps: number = 2
): Promise<ExtractedFrame[]> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPattern = path.join(outputDir, 'frame_%04d.png');

  try {
    // Extract frames using ffmpeg
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=${fps}" "${outputPattern}" -y 2>/dev/null`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    // ffmpeg may return non-zero even on success in some cases
    // Check if frames were actually created
  }

  // Read extracted frames
  const frames: ExtractedFrame[] = [];
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
    .sort();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const framePath = path.join(outputDir, file);

    // Calculate timestamp based on frame index and fps
    // Frame 1 = 0.5s (center of first second at 2fps)
    const timestamp = (i + 0.5) / fps;

    frames.push({
      index: i,
      path: framePath,
      timestamp: Math.round(timestamp * 10) / 10  // Round to 1 decimal
    });
  }

  return frames;
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

/**
 * Get frame count from video without extracting
 * Uses ffprobe to count frames
 */
export async function getVideoFrameCount(videoPath: string): Promise<number> {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${videoPath}"`,
      { encoding: 'utf-8' }
    );
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get video resolution
 */
export async function getVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  try {
    const output = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`,
      { encoding: 'utf-8' }
    );
    const [width, height] = output.trim().split('x').map(n => parseInt(n, 10));
    return { width: width || 0, height: height || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Validate video file exists and is readable
 */
export function validateVideoFile(videoPath: string): { valid: boolean; error?: string } {
  if (!fs.existsSync(videoPath)) {
    return { valid: false, error: 'Video file does not exist' };
  }

  const stats = fs.statSync(videoPath);
  if (stats.size === 0) {
    return { valid: false, error: 'Video file is empty' };
  }

  return { valid: true };
}
