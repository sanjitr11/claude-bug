export interface TerminalOutput {
  output: string[];
  errors: string[];
  commands: string[];
}

export interface GitContext {
  branch: string;
  recentCommits: string[];
  diff: string;
  modifiedFiles: string[];
  isGitRepo: boolean;
}

export interface EnvironmentInfo {
  nodeVersion: string | null;
  pythonVersion: string | null;
  os: string;
  osVersion: string;
  shell: string;
  framework: string | null;
  workingDirectory: string;
}

export interface BugCapture {
  id: string;
  description: string;
  timestamp: Date;
  recordingPath: string;
  duration: number;
  terminal: TerminalOutput;
  git: GitContext;
  environment: EnvironmentInfo;
}

export interface CaptureMetadata {
  id: string;
  description: string;
  timestamp: string;
  recordingPath: string;
  contextPath: string;
  formattedPath: string;
  duration: number;
}

export interface RecordingOptions {
  duration: number;
  outputPath: string;
  displayId?: string;
  interactive?: boolean;  // If true, record until stopped manually
}

export interface InteractiveRecordingHandle {
  stop: () => Promise<RecordingResult>;
  process: import('child_process').ChildProcess;
}

export interface RecordingResult {
  success: boolean;
  path: string;
  duration: number;
  error?: string;
}

export interface Config {
  ttlDays: number;  // Auto-delete after X days (default 7, 0 = never)
}

export interface CaptureMetadataExtended extends CaptureMetadata {
  isTemp?: boolean;  // If true, delete after first view
  viewedAt?: string; // When it was first viewed (for temp captures)
}
