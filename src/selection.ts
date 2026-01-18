import Jimp from 'jimp';
import { ExtractedFrame, KeyFrame, FrameSelectionResult } from './types';

/**
 * Calculate perceptual difference between two images
 * Returns percentage of pixels that differ significantly
 */
export async function calculateFrameDiff(
  framePath1: string,
  framePath2: string
): Promise<number> {
  try {
    const img1 = await Jimp.read(framePath1);
    const img2 = await Jimp.read(framePath2);

    // Resize to same dimensions for comparison (use smaller dimensions)
    const width = Math.min(img1.getWidth(), img2.getWidth());
    const height = Math.min(img1.getHeight(), img2.getHeight());
    img1.resize(width, height);
    img2.resize(width, height);

    // Count significantly different pixels
    let diffPixels = 0;
    const totalPixels = width * height;
    const threshold = 25;  // Color difference threshold (0-255)

    img1.scan(0, 0, width, height, function(x, y, idx) {
      const r1 = this.bitmap.data[idx];
      const g1 = this.bitmap.data[idx + 1];
      const b1 = this.bitmap.data[idx + 2];

      const r2 = img2.bitmap.data[idx];
      const g2 = img2.bitmap.data[idx + 1];
      const b2 = img2.bitmap.data[idx + 2];

      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      if (diff > threshold * 3) {
        diffPixels++;
      }
    });

    return (diffPixels / totalPixels) * 100;
  } catch (error) {
    // If we can't compare, assume significant difference
    return 100;
  }
}

/**
 * Generate human-readable reason for frame selection
 */
function generateSelectionReason(
  diffScore: number,
  isFirst: boolean,
  isLast: boolean
): string {
  if (isFirst) {
    return 'Start of capture';
  }
  if (isLast) {
    return 'End of capture';
  }

  const score = diffScore.toFixed(1);

  if (diffScore >= 20) {
    return `${score}% visual change - major UI update`;
  } else if (diffScore >= 10) {
    return `${score}% visual change - significant change`;
  } else if (diffScore >= 5) {
    return `${score}% visual change - content update`;
  } else {
    return `${score}% visual change - minor change`;
  }
}

interface FrameCandidate {
  frame: ExtractedFrame;
  diffScore: number;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * Select key frames using perceptual image diffing
 *
 * Algorithm:
 * 1. Always include first frame (reason: "start of capture")
 * 2. Always include last frame (reason: "end of capture")
 * 3. For each consecutive pair, calculate pixel difference %
 * 4. Frames with >diffThreshold% difference are candidates
 * 5. Sort candidates by diff magnitude
 * 6. Take top (targetCount - 2) candidates
 * 7. Return all selected frames in chronological order
 */
export async function selectKeyFrames(
  frames: ExtractedFrame[],
  targetCount: number = 6,
  diffThreshold: number = 3
): Promise<FrameSelectionResult> {
  if (frames.length === 0) {
    return {
      keyFrames: [],
      totalExtracted: 0,
      selectionReasons: []
    };
  }

  if (frames.length <= targetCount) {
    // If we have fewer frames than target, use all of them
    const keyFrames: KeyFrame[] = frames.map((frame, i) => ({
      ...frame,
      diffScore: 0,
      reason: i === 0 ? 'Start of capture' : i === frames.length - 1 ? 'End of capture' : 'Selected frame',
      optimizedPath: '',
      tokenEstimate: 0
    }));

    return {
      keyFrames,
      totalExtracted: frames.length,
      selectionReasons: keyFrames.map(f => f.reason)
    };
  }

  // Calculate diff scores for all consecutive pairs
  const candidates: FrameCandidate[] = [];

  for (let i = 0; i < frames.length; i++) {
    const isFirst = i === 0;
    const isLast = i === frames.length - 1;

    let diffScore = 0;
    if (i > 0) {
      diffScore = await calculateFrameDiff(frames[i - 1].path, frames[i].path);
    }

    candidates.push({
      frame: frames[i],
      diffScore,
      isFirst,
      isLast
    });
  }

  // Always include first and last
  const selected: FrameCandidate[] = [
    candidates[0],
    candidates[candidates.length - 1]
  ];

  // Get middle candidates that exceed threshold
  const middleCandidates = candidates
    .slice(1, -1)
    .filter(c => c.diffScore >= diffThreshold)
    .sort((a, b) => b.diffScore - a.diffScore);

  // Take top (targetCount - 2) candidates from middle
  const toSelect = Math.min(middleCandidates.length, targetCount - 2);
  selected.push(...middleCandidates.slice(0, toSelect));

  // If we still don't have enough, add evenly spaced frames
  if (selected.length < targetCount) {
    const remaining = targetCount - selected.length;
    const selectedIndices = new Set(selected.map(c => c.frame.index));

    // Get evenly spaced indices
    const step = Math.floor(frames.length / (remaining + 1));
    for (let i = 1; i <= remaining; i++) {
      const idx = i * step;
      if (idx > 0 && idx < frames.length - 1 && !selectedIndices.has(idx)) {
        selected.push(candidates[idx]);
        selectedIndices.add(idx);
      }
    }
  }

  // Sort by index (chronological order)
  selected.sort((a, b) => a.frame.index - b.frame.index);

  // Convert to KeyFrame objects
  const keyFrames: KeyFrame[] = selected.map(c => ({
    ...c.frame,
    diffScore: c.diffScore,
    reason: generateSelectionReason(c.diffScore, c.isFirst, c.isLast),
    optimizedPath: '',  // Will be set during optimization
    tokenEstimate: 0    // Will be set during optimization
  }));

  return {
    keyFrames,
    totalExtracted: frames.length,
    selectionReasons: keyFrames.map(f => f.reason)
  };
}

/**
 * Fallback: select evenly-spaced frames when all frames are similar
 */
export function selectEvenlySpacedFrames(
  frames: ExtractedFrame[],
  targetCount: number
): KeyFrame[] {
  if (frames.length === 0) return [];
  if (frames.length <= targetCount) {
    return frames.map((f, i) => ({
      ...f,
      diffScore: 0,
      reason: i === 0 ? 'Start of capture' : i === frames.length - 1 ? 'End of capture' : 'Evenly-spaced frame',
      optimizedPath: '',
      tokenEstimate: 0
    }));
  }

  const keyFrames: KeyFrame[] = [];
  const step = (frames.length - 1) / (targetCount - 1);

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.round(i * step);
    const frame = frames[idx];
    const isFirst = idx === 0;
    const isLast = idx === frames.length - 1;

    keyFrames.push({
      ...frame,
      diffScore: 0,
      reason: isFirst ? 'Start of capture' : isLast ? 'End of capture' : 'Evenly-spaced frame',
      optimizedPath: '',
      tokenEstimate: 0
    });
  }

  return keyFrames;
}
