export interface BugCapture {
  id: string;
  description: string;
  timestamp: Date;
  frames: string[];  // Paths to frame images
  duration: number;  // Total capture duration in seconds
  terminalContext?: TerminalContext;
  gitContext?: GitContext;
  environment?: EnvironmentInfo;
}

export interface TerminalContext {
  recentCommands: string[];
  workingDirectory: string;
  shell: string;
}

export interface GitContext {
  isRepo: boolean;
  branch?: string;
  modifiedFiles?: string[];
  recentCommits?: GitCommit[];
  hasUncommittedChanges?: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface EnvironmentInfo {
  os: string;
  nodeVersion?: string;
  framework?: string;
  packageManager?: string;
}

export interface CaptureMetadata {
  id: string;
  description: string;
  timestamp: string;
  frames: string[];
  duration: number;
  isTemp?: boolean;
  viewedAt?: string;
}

export interface CaptureOptions {
  duration: number;
  outputDir: string;
  displayId?: string;
  frameInterval?: number;  // Seconds between frames (default: 1)
}

export interface CaptureResult {
  success: boolean;
  frames: string[];
  duration: number;
  error?: string;
}

export interface InteractiveCaptureHandle {
  stop: () => Promise<CaptureResult>;
}

export interface Config {
  ttlDays: number;      // Auto-delete after X days (default 7, 0 = never)
  duration: number;     // Default capture duration in seconds (default 5)
}
