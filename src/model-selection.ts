import { ExtractedFrame, ScoredFrame, ModelProfile } from './types';
import { calculateFrameDiff } from './selection';

/**
 * Model-Aligned Frame Selection
 *
 * Selects frames not just by perceptual difference, but by
 * expected reasoning value under the target model.
 *
 * Principles:
 * - Early frames establish baseline state
 * - Mid-sequence frames capture divergence
 * - Late frames capture stabilized failure
 * - Low-entropy frames are dropped first under budget pressure
 */

/**
 * Calculate entropy score for a frame
 *
 * Higher entropy = more information content = higher value
 * Based on:
 * - Visual complexity (edge density, color variance)
 * - Temporal position (boundary frames get bonus)
 * - Change magnitude (larger changes = higher value)
 */
export async function calculateEntropyScore(
  frame: ExtractedFrame,
  prevFrame: ExtractedFrame | null,
  nextFrame: ExtractedFrame | null,
  totalFrames: number
): Promise<number> {
  let score = 0.5;  // Base score

  // Temporal position bonus
  const position = frame.index / totalFrames;
  if (position < 0.1) score += 0.2;       // First 10% - baseline
  if (position > 0.9) score += 0.2;       // Last 10% - final state
  if (position > 0.4 && position < 0.6) score += 0.1;  // Middle - transition

  // Change magnitude bonus
  if (prevFrame) {
    const diffFromPrev = await calculateFrameDiff(prevFrame.path, frame.path);
    score += Math.min(diffFromPrev / 100, 0.3);  // Up to 0.3 for large changes
  }

  return Math.min(score, 1.0);
}

/**
 * Calculate reasoning value for a frame under target model
 *
 * Combines entropy with model-specific biases
 */
export function calculateReasoningValue(
  entropyScore: number,
  position: 'start' | 'middle' | 'end',
  profile: ModelProfile
): number {
  let value = entropyScore;

  // Model-specific adjustments
  if (profile.promptStyle.causalFocusLevel === 'high') {
    // High causal focus: boost transition frames
    if (position === 'middle') value *= 1.2;
  }

  // Visual bias increases frame value
  value *= (0.5 + profile.contextBias.visual);

  return Math.min(value, 1.0);
}

/**
 * Select frames optimized for model reasoning
 *
 * Algorithm:
 * 1. Score all frames for entropy and reasoning value
 * 2. Always include first and last frames (anchors)
 * 3. Select highest-value frames up to budget
 * 4. Ensure temporal coverage (no large gaps)
 * 5. Assign drop priority for budget overflow handling
 */
export async function selectModelAlignedFrames(
  frames: ExtractedFrame[],
  profile: ModelProfile,
  targetCount: number
): Promise<ScoredFrame[]> {
  const scored: ScoredFrame[] = [];

  // Score all frames
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const prev = i > 0 ? frames[i - 1] : null;
    const next = i < frames.length - 1 ? frames[i + 1] : null;

    const entropyScore = await calculateEntropyScore(frame, prev, next, frames.length);
    const position = i === 0 ? 'start' : i === frames.length - 1 ? 'end' : 'middle';
    const reasoningValue = calculateReasoningValue(entropyScore, position, profile);

    scored.push({
      ...frame,
      diffScore: 0,  // Will be set later
      reason: '',    // Will be set later
      optimizedPath: '',
      tokenEstimate: profile.imageTokenEstimate,
      entropyScore,
      reasoningValue,
      dropPriority: 1 - reasoningValue  // Lower value = keep
    });
  }

  // Always include anchors
  const anchors = [scored[0], scored[scored.length - 1]];
  anchors[0].reason = 'Start of capture - baseline state';
  anchors[0].dropPriority = 0;  // Never drop
  anchors[anchors.length - 1].reason = 'End of capture - final failure state';
  anchors[anchors.length - 1].dropPriority = 0;  // Never drop

  // Select top candidates excluding anchors
  const candidates = scored
    .slice(1, -1)
    .sort((a, b) => b.reasoningValue - a.reasoningValue)
    .slice(0, targetCount - 2);

  // Generate reasons for selected candidates
  for (const frame of candidates) {
    if (frame.reasoningValue > 0.7) {
      frame.reason = `High-entropy transition - ${Math.round(frame.entropyScore * 100)}% information density`;
    } else if (frame.entropyScore > 0.5) {
      frame.reason = `State change detected - temporal divergence point`;
    } else {
      frame.reason = `Coverage frame - maintains temporal continuity`;
    }
  }

  // Combine and sort chronologically
  const selected = [...anchors.slice(0, 1), ...candidates, ...anchors.slice(-1)]
    .sort((a, b) => a.index - b.index);

  // Ensure no large temporal gaps (fill if needed)
  const filled = ensureTemporalCoverage(selected, scored, targetCount);

  return filled;
}

/**
 * Ensure no temporal gaps larger than 25% of total duration
 */
function ensureTemporalCoverage(
  selected: ScoredFrame[],
  allFrames: ScoredFrame[],
  maxCount: number
): ScoredFrame[] {
  const result = [...selected];
  const maxGap = allFrames.length * 0.25;

  for (let i = 0; i < result.length - 1 && result.length < maxCount; i++) {
    const gap = result[i + 1].index - result[i].index;
    if (gap > maxGap) {
      // Find best frame in gap
      const midIndex = Math.floor((result[i].index + result[i + 1].index) / 2);
      const fillFrame = allFrames.find(f => f.index === midIndex);
      if (fillFrame && !result.includes(fillFrame)) {
        fillFrame.reason = 'Coverage frame - filling temporal gap';
        result.splice(i + 1, 0, fillFrame);
      }
    }
  }

  return result.sort((a, b) => a.index - b.index);
}

/**
 * Drop frames to fit budget, starting with highest dropPriority
 */
export function dropFramesForBudget(
  frames: ScoredFrame[],
  targetCount: number
): ScoredFrame[] {
  if (frames.length <= targetCount) return frames;

  // Sort by drop priority (keep lowest)
  const sorted = [...frames].sort((a, b) => a.dropPriority - b.dropPriority);

  // Keep top N by priority
  const kept = sorted.slice(0, targetCount);

  // Return in chronological order
  return kept.sort((a, b) => a.index - b.index);
}
