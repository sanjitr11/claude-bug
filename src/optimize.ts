import Jimp from 'jimp';
import * as path from 'path';
import * as fs from 'fs';
import { KeyFrame } from './types';
import { estimateImageTokens } from './tokens';

/**
 * Target dimensions for optimized images
 * 1024x576 = 16:9 aspect ratio, ~1,200 tokens per image
 */
const TARGET_WIDTH = 1024;
const TARGET_HEIGHT = 576;
const JPEG_QUALITY = 85;

/**
 * Optimize a single image for token efficiency
 * - Resize to target dimensions
 * - Convert to JPEG at specified quality
 * - Calculate token estimate
 */
export async function optimizeImage(
  inputPath: string,
  outputPath: string,
  maxWidth: number = TARGET_WIDTH,
  quality: number = JPEG_QUALITY
): Promise<{ path: string; tokenEstimate: number; width: number; height: number }> {
  try {
    const image = await Jimp.read(inputPath);

    // Calculate target dimensions maintaining aspect ratio
    const aspectRatio = image.getWidth() / image.getHeight();
    let width = maxWidth;
    let height = Math.round(maxWidth / aspectRatio);

    // If height is too large, scale by height instead
    const maxHeight = Math.round(maxWidth * 9 / 16);  // 16:9 ratio
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.round(height * aspectRatio);
    }

    // Resize and save as JPEG
    await image
      .resize(width, height)
      .quality(quality)
      .writeAsync(outputPath);

    const tokenEstimate = estimateImageTokens(width, height);

    return {
      path: outputPath,
      tokenEstimate,
      width,
      height
    };
  } catch (error) {
    // If optimization fails, try to use original
    if (fs.existsSync(inputPath)) {
      try {
        const image = await Jimp.read(inputPath);
        return {
          path: inputPath,
          tokenEstimate: estimateImageTokens(image.getWidth(), image.getHeight()),
          width: image.getWidth(),
          height: image.getHeight()
        };
      } catch {
        // Fall through to default
      }
    }

    return {
      path: inputPath,
      tokenEstimate: 1200,  // Default estimate
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT
    };
  }
}

/**
 * Optimize all key frames for token efficiency
 * Creates optimized versions in the output directory
 */
export async function optimizeKeyFrames(
  keyFrames: KeyFrame[],
  outputDir: string
): Promise<KeyFrame[]> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const optimizedFrames: KeyFrame[] = [];

  for (let i = 0; i < keyFrames.length; i++) {
    const frame = keyFrames[i];
    const outputFilename = `key_${String(i + 1).padStart(3, '0')}.jpg`;
    const outputPath = path.join(outputDir, outputFilename);

    const result = await optimizeImage(frame.path, outputPath);

    optimizedFrames.push({
      ...frame,
      optimizedPath: result.path,
      tokenEstimate: result.tokenEstimate
    });
  }

  return optimizedFrames;
}

/**
 * Get total token estimate for all key frames
 */
export function getTotalImageTokens(keyFrames: KeyFrame[]): number {
  return keyFrames.reduce((sum, frame) => sum + frame.tokenEstimate, 0);
}
