import {
  ModelProfile,
  BudgetAllocation,
  TokenUtilization,
  ScoredFrame,
  CaptureContext
} from './types';

/**
 * Token Budget Engine
 *
 * Manages dynamic allocation of the model's context budget
 * across visual, code, and execution signals.
 */

/**
 * Calculate optimal budget allocation for a capture
 *
 * Algorithm:
 * 1. Reserve 5% for report structure and prompt
 * 2. Allocate remaining budget according to model's contextBias
 * 3. Calculate max frames that fit in visual budget
 * 4. Calculate text limits that fit in code/execution budget
 * 5. If total exceeds budget, reduce frames before text
 */
export function calculateBudgetAllocation(
  profile: ModelProfile,
  availableFrames: number,
  context: CaptureContext
): BudgetAllocation {
  const safetyMargin = 0.95;  // Use 95% of budget max
  const availableBudget = profile.maxTokens * safetyMargin;

  // Reserve tokens for structure
  const structureReserve = 500;  // Report markdown, prompt, etc.
  const workingBudget = availableBudget - structureReserve;

  // Allocate by bias
  const visualBudget = workingBudget * profile.contextBias.visual;
  const codeBudget = workingBudget * profile.contextBias.code;
  const execBudget = workingBudget * profile.contextBias.execution;

  // Calculate frame allocation
  const baseImageTokens = profile.imageTokenEstimate;
  let frameCount = Math.min(
    Math.floor(visualBudget / baseImageTokens),
    profile.preferredFrames,
    availableFrames
  );

  // Determine optimal resolution/quality to maximize frame count
  let resolution = { width: 1024, height: 576 };
  let quality = 85;

  // If we can't fit preferred frames, try reducing quality
  if (frameCount < profile.preferredFrames && frameCount < availableFrames) {
    // Try 75% quality (saves ~15% tokens)
    const reducedTokens = baseImageTokens * 0.85;
    const reducedFrameCount = Math.floor(visualBudget / reducedTokens);
    if (reducedFrameCount > frameCount) {
      quality = 75;
      frameCount = Math.min(reducedFrameCount, profile.preferredFrames, availableFrames);
    }
  }

  // Calculate text allocations
  const terminalLines = Math.floor(execBudget / 4);  // ~4 chars per token
  const gitDiffLines = Math.floor(codeBudget / 4);

  const adjustments: string[] = [];
  if (quality < 85) {
    adjustments.push(`Reduced image quality to ${quality}% to fit ${frameCount} frames`);
  }
  if (frameCount < profile.preferredFrames) {
    adjustments.push(`Limited to ${frameCount} frames (preferred: ${profile.preferredFrames})`);
  }

  return {
    frameCount,
    frameResolution: resolution,
    frameQuality: quality,
    terminalLines: Math.min(terminalLines, 100),
    gitDiffLines: Math.min(gitDiffLines, 150),
    includeCommits: codeBudget > 200,
    includeFullDiff: codeBudget > 500,
    adjustments
  };
}

/**
 * Calculate token utilization for a completed capture
 */
export function calculateTokenUtilization(
  profile: ModelProfile,
  frames: ScoredFrame[],
  context: CaptureContext,
  promptTokens: number
): TokenUtilization {
  const visualTokens = frames.reduce((sum, f) => sum + f.tokenEstimate, 0);
  const textTokens = context.terminal.tokenEstimate + context.git.tokenEstimate;
  const structureTokens = 100;  // Report markdown overhead

  const total = visualTokens + textTokens + structureTokens + promptTokens;

  return {
    visual: visualTokens,
    text: textTokens,
    prompt: promptTokens,
    total,
    budget: profile.maxTokens,
    utilization: (total / profile.maxTokens) * 100,
    breakdown: {
      frames: { count: frames.length, tokens: visualTokens },
      terminalContext: {
        lines: context.terminal.recentOutput.length,
        tokens: context.terminal.tokenEstimate
      },
      gitContext: {
        diffLines: context.git.diff?.split('\n').length ?? 0,
        tokens: context.git.tokenEstimate
      },
      reportStructure: structureTokens,
      suggestedPrompt: promptTokens
    }
  };
}

/**
 * Check if capture is within budget and suggest adjustments if not
 */
export function validateBudget(
  utilization: TokenUtilization
): { valid: boolean; suggestions: string[] } {
  if (utilization.utilization <= 95) {
    return { valid: true, suggestions: [] };
  }

  const suggestions: string[] = [];
  const overage = utilization.total - (utilization.budget * 0.95);

  // Suggest frame reduction first
  if (utilization.breakdown.frames.count > 4) {
    const frameTokens = utilization.visual / utilization.breakdown.frames.count;
    const framesToDrop = Math.ceil(overage / frameTokens);
    suggestions.push(`Remove ${framesToDrop} lowest-entropy frames`);
  }

  // Then suggest text truncation
  if (utilization.text > 500) {
    suggestions.push('Truncate terminal context to error lines only');
  }
  if (utilization.breakdown.gitContext.diffLines > 50) {
    suggestions.push('Use diff summary instead of full diff');
  }

  return { valid: false, suggestions };
}
