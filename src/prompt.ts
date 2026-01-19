import { ModelProfile, BugCapture } from './types';

/**
 * Generate model-aligned debugging prompt
 *
 * The prompt is optimized to reduce interpretation overhead
 * and let Claude spend tokens on reasoning.
 */

export function generateModelAlignedPrompt(
  capture: BugCapture,
  profile: ModelProfile
): string {
  const style = profile.promptStyle;
  const parts: string[] = [];

  // Core instruction
  parts.push('Analyze this visual bug capture and identify the root cause.');

  // Timeline reference guidance
  if (style.includeTimelineRefs) {
    parts.push('');
    parts.push('## Timeline Analysis');
    parts.push(`The capture contains ${capture.metrics.keyFrames} key frames spanning ${capture.duration}s.`);
    parts.push('- Frame 1 shows the baseline/initial state');
    parts.push('- Intermediate frames show state transitions');
    parts.push(`- Frame ${capture.metrics.keyFrames} shows the final failure state`);
    parts.push('');
    parts.push('Identify which frame first shows incorrect behavior and why.');
  }

  // Diff correlation guidance
  if (style.includeDiffCorrelation && capture.context.git.diff) {
    parts.push('');
    parts.push('## Code Correlation');
    parts.push('The git diff shows recent uncommitted changes.');
    parts.push('Assume the bug is causally linked to these changes unless evidence suggests otherwise.');
    parts.push('Cross-reference visual symptoms with code modifications.');
  }

  // Causal focus
  if (style.causalFocusLevel === 'high') {
    parts.push('');
    parts.push('## Causal Analysis');
    parts.push('Focus on root cause, not symptoms:');
    parts.push('- What state change caused the visual failure?');
    parts.push('- Which code path is responsible?');
    parts.push('- What is the minimal fix?');
  }

  // Uncertainty guidance
  if (style.includeUncertaintyGuidance) {
    parts.push('');
    parts.push('## Uncertainty Handling');
    parts.push('If information is insufficient:');
    parts.push('- State what additional signal would help (logs, state, network)');
    parts.push('- Rank hypotheses by probability');
    parts.push('- Indicate confidence level for each conclusion');
  }

  // Expected output format
  parts.push('');
  parts.push('## Expected Output');
  parts.push('1. **Root Cause**: Most likely cause of the bug');
  parts.push('2. **Visual Evidence**: Which frames support this conclusion');
  parts.push('3. **Code Link**: Connection to recent changes (if applicable)');
  parts.push('4. **Fix**: Minimal, testable fix');
  if (style.verbosity === 'detailed') {
    parts.push('5. **Alternatives**: Other possible causes if primary is uncertain');
    parts.push('6. **Confidence**: Assessment of diagnostic confidence');
  }

  return parts.join('\n');
}

/**
 * Estimate tokens for generated prompt
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
