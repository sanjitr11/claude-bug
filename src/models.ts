import { ModelProfile } from './types';

/**
 * Built-in model profiles
 *
 * These define how context is shaped for each target model.
 * Profiles are based on empirical testing of model behavior
 * and documented context window sizes.
 */
export const MODEL_PROFILES: Record<string, ModelProfile> = {
  'claude-code': {
    name: 'claude-code',
    maxTokens: 100000,
    imageTokenEstimate: 1200,
    preferredFrames: 6,
    maxFrames: 10,
    contextBias: {
      visual: 0.4,
      code: 0.4,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'minimal',
      includeTimelineRefs: true,
      includeDiffCorrelation: true,
      includeUncertaintyGuidance: true,
      causalFocusLevel: 'high'
    }
  },

  'claude-sonnet': {
    name: 'claude-sonnet',
    maxTokens: 200000,
    imageTokenEstimate: 1200,
    preferredFrames: 8,
    maxFrames: 12,
    contextBias: {
      visual: 0.5,
      code: 0.3,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'standard',
      includeTimelineRefs: true,
      includeDiffCorrelation: true,
      includeUncertaintyGuidance: true,
      causalFocusLevel: 'high'
    }
  },

  'claude-opus': {
    name: 'claude-opus',
    maxTokens: 200000,
    imageTokenEstimate: 1200,
    preferredFrames: 10,
    maxFrames: 15,
    contextBias: {
      visual: 0.45,
      code: 0.35,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'detailed',
      includeTimelineRefs: true,
      includeDiffCorrelation: true,
      includeUncertaintyGuidance: true,
      causalFocusLevel: 'high'
    }
  },

  'claude-haiku': {
    name: 'claude-haiku',
    maxTokens: 200000,
    imageTokenEstimate: 1200,
    preferredFrames: 4,
    maxFrames: 6,
    contextBias: {
      visual: 0.5,
      code: 0.3,
      execution: 0.2
    },
    promptStyle: {
      verbosity: 'minimal',
      includeTimelineRefs: true,
      includeDiffCorrelation: false,
      includeUncertaintyGuidance: false,
      causalFocusLevel: 'medium'
    }
  }
};

/**
 * Get model profile by name (case-insensitive)
 * Falls back to claude-code if not found
 */
export function getModelProfile(name: string): ModelProfile {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, '-');
  return MODEL_PROFILES[normalized] ?? MODEL_PROFILES['claude-code'];
}

/**
 * List available model profiles
 */
export function listModelProfiles(): string[] {
  return Object.keys(MODEL_PROFILES);
}

/**
 * Register a custom model profile
 */
export function registerModelProfile(profile: ModelProfile): void {
  MODEL_PROFILES[profile.name.toLowerCase()] = profile;
}
