// Core capture data
export interface BugCapture {
  id: string;
  description: string;
  timestamp: Date;
  duration: number;
  videoPath: string;
  framesDir: string;
  keyFramesDir: string;
  reportPath: string;
  metrics: CaptureMetrics;
  context: CaptureContext;
  keyFrames: KeyFrame[];
}

export interface CaptureMetrics {
  totalFrames: number;
  keyFrames: number;
  tokenEstimate: number;
  processingTime: number;  // milliseconds
}

export interface CaptureContext {
  terminal: TerminalContext;
  git: GitContext;
}

export interface TerminalContext {
  recentOutput: string[];      // Last 50 lines
  errors: string[];            // Filtered error lines
  tokenEstimate: number;
}

export interface GitContext {
  branch: string;
  recentCommits: string[];     // Last 3 commits (oneline)
  diff: string | null;         // Only if <50 lines
  tokenEstimate: number;
}

// Frame selection
export interface ExtractedFrame {
  index: number;
  path: string;
  timestamp: number;           // Seconds into video
}

export interface KeyFrame extends ExtractedFrame {
  diffScore: number;           // % difference from previous
  reason: string;              // Why this frame was selected
  optimizedPath: string;
  tokenEstimate: number;
}

export interface FrameSelectionResult {
  keyFrames: KeyFrame[];
  totalExtracted: number;
  selectionReasons: string[];
}

// Recording options
export interface RecordingOptions {
  duration: number;            // Default: 30 seconds
  resolution: { width: number; height: number };  // Default: 1280x720
  fps: number;                 // Default: 30
  outputPath: string;
}

export interface RecordingResult {
  success: boolean;
  videoPath: string;
  duration: number;
  error?: string;
}

// Interactive recording handle
export interface InteractiveRecordingHandle {
  stop: () => Promise<RecordingResult>;
}

// Configuration
export interface Config {
  duration: number;            // Recording duration (default: 30)
  targetKeyFrames: number;     // Target key frames (default: 6)
  diffThreshold: number;       // Min % diff for key frame (default: 3)
  maxTokens: number;           // Max tokens per report (default: 10000)
  ttlDays: number;             // Auto-delete after days (default: 7)
  defaultModel?: string;       // Default model profile (default: "claude-code")
  customModels?: Record<string, ModelProfile>;  // User-defined model profiles
}

// Storage metadata
export interface CaptureMetadata {
  id: string;
  description: string;
  timestamp: string;
  duration: number;
  keyFrameCount: number;
  tokenEstimate: number;
  isTemp?: boolean;
  viewedAt?: string;
  model?: string;              // Model profile used for this capture
}

// ============================================
// V2 MODEL-AWARE TYPES
// ============================================

/**
 * Model profile defining context shaping parameters
 */
export interface ModelProfile {
  name: string;                      // e.g., "claude-code", "claude-sonnet", "claude-opus"
  maxTokens: number;                 // Maximum safe context budget
  imageTokenEstimate: number;        // Base tokens per optimized image
  preferredFrames: number;           // Ideal frame count for this model
  maxFrames: number;                 // Absolute maximum frames
  contextBias: ContextBias;          // Balance between signal types
  promptStyle: PromptStyle;          // How to structure guidance
}

/**
 * Balance between different signal types
 * Values are relative weights (should sum to ~1.0)
 */
export interface ContextBias {
  visual: number;      // Weight toward image frames (0.0-1.0)
  code: number;        // Weight toward git diff/code context (0.0-1.0)
  execution: number;   // Weight toward terminal/logs (0.0-1.0)
}

/**
 * Prompt generation style for the model
 */
export interface PromptStyle {
  verbosity: 'minimal' | 'standard' | 'detailed';
  includeTimelineRefs: boolean;
  includeDiffCorrelation: boolean;
  includeUncertaintyGuidance: boolean;
  causalFocusLevel: 'low' | 'medium' | 'high';
}

/**
 * Token utilization report
 */
export interface TokenUtilization {
  visual: number;           // Tokens used by images
  text: number;             // Tokens used by text (context + report)
  prompt: number;           // Tokens used by suggested prompt
  total: number;            // Total tokens
  budget: number;           // Model's max budget
  utilization: number;      // Percentage of budget used (0-100)
  breakdown: TokenBreakdown;
}

export interface TokenBreakdown {
  frames: { count: number; tokens: number };
  terminalContext: { lines: number; tokens: number };
  gitContext: { diffLines: number; tokens: number };
  reportStructure: number;
  suggestedPrompt: number;
}

/**
 * Frame with entropy scoring for model-aware selection
 */
export interface ScoredFrame extends KeyFrame {
  entropyScore: number;     // Information density (0-1)
  reasoningValue: number;   // Expected value for model reasoning (0-1)
  dropPriority: number;     // Lower = more likely to keep under budget
}

/**
 * Budget allocation result
 */
export interface BudgetAllocation {
  frameCount: number;
  frameResolution: { width: number; height: number };
  frameQuality: number;     // JPEG quality (0-100)
  terminalLines: number;
  gitDiffLines: number;
  includeCommits: boolean;
  includeFullDiff: boolean;
  adjustments: string[];    // Descriptions of what was adjusted
}

/**
 * Capture options with model awareness
 */
export interface ModelAwareCaptureOptions {
  description: string;
  model: string;            // Model profile name
  interactive?: boolean;
  temporary?: boolean;
  overrideBudget?: number;  // Override model's default budget
}
