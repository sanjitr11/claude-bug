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
}
