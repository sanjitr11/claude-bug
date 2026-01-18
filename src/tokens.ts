import { BugCapture, KeyFrame } from './types';

/**
 * Estimate tokens for image based on dimensions
 *
 * Formula derived from Claude's documentation (approximate):
 * - Base: ~85 tokens
 * - Per 1000 pixels: ~1.5 tokens
 *
 * Examples:
 * - 1920x1080 (2.07M pixels) ≈ 1,600 tokens
 * - 1280x720 (0.92M pixels) ≈ 1,400 tokens
 * - 1024x576 (0.59M pixels) ≈ 1,200 tokens
 * - 800x450 (0.36M pixels) ≈ 900 tokens
 */
export function estimateImageTokens(width: number, height: number): number {
  const pixels = width * height;
  const baseTokens = 85;
  const tokensPerThousandPixels = 1.5;
  return Math.ceil(baseTokens + (pixels / 1000) * tokensPerThousandPixels);
}

/**
 * Estimate tokens for text content
 * Conservative estimate: ~4 characters per token
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Calculate total token estimate for all key frames
 */
export function estimateKeyFrameTokens(keyFrames: KeyFrame[]): number {
  return keyFrames.reduce((sum, frame) => sum + frame.tokenEstimate, 0);
}

/**
 * Calculate total token estimate for capture
 */
export function estimateTotalTokens(capture: BugCapture): number {
  // Image tokens
  const imageTokens = capture.keyFrames.reduce((sum, f) => sum + f.tokenEstimate, 0);

  // Context tokens
  const terminalTokens = capture.context.terminal.tokenEstimate;
  const gitTokens = capture.context.git.tokenEstimate;

  // Report structure overhead (headers, formatting, etc.)
  const structureTokens = 100;

  return imageTokens + terminalTokens + gitTokens + structureTokens;
}

/**
 * Check if capture is within token budget
 */
export function isWithinBudget(capture: BugCapture, maxTokens: number = 10000): boolean {
  return estimateTotalTokens(capture) <= maxTokens;
}

/**
 * Suggest optimizations if over budget
 */
export function suggestOptimizations(capture: BugCapture, maxTokens: number = 10000): string[] {
  const suggestions: string[] = [];
  const totalTokens = estimateTotalTokens(capture);

  if (totalTokens <= maxTokens) {
    return suggestions;
  }

  const overBy = totalTokens - maxTokens;

  // Suggest reducing key frames
  if (capture.keyFrames.length > 4) {
    const avgFrameTokens = capture.keyFrames.reduce((s, f) => s + f.tokenEstimate, 0) / capture.keyFrames.length;
    const framesToRemove = Math.ceil(overBy / avgFrameTokens);
    if (framesToRemove > 0 && capture.keyFrames.length - framesToRemove >= 3) {
      suggestions.push(`Reduce key frames from ${capture.keyFrames.length} to ${capture.keyFrames.length - framesToRemove}`);
    }
  }

  // Suggest reducing context
  if (capture.context.terminal.tokenEstimate > 200) {
    suggestions.push('Reduce terminal context (currently showing too many lines)');
  }

  if (capture.context.git.tokenEstimate > 150 && capture.context.git.diff) {
    suggestions.push('Omit git diff to save tokens');
  }

  // Suggest lower image resolution
  const avgImageTokens = capture.keyFrames.reduce((s, f) => s + f.tokenEstimate, 0) / capture.keyFrames.length;
  if (avgImageTokens > 1000) {
    suggestions.push('Use smaller image resolution (800x450 instead of 1024x576)');
  }

  return suggestions;
}

/**
 * Format token estimate for display
 */
export function formatTokenEstimate(tokens: number): string {
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}k`;
  }
  return `~${tokens}`;
}

/**
 * Get token breakdown for display
 */
export function getTokenBreakdown(capture: BugCapture): {
  images: number;
  terminal: number;
  git: number;
  structure: number;
  total: number;
} {
  const images = capture.keyFrames.reduce((sum, f) => sum + f.tokenEstimate, 0);
  const terminal = capture.context.terminal.tokenEstimate;
  const git = capture.context.git.tokenEstimate;
  const structure = 100;

  return {
    images,
    terminal,
    git,
    structure,
    total: images + terminal + git + structure
  };
}
