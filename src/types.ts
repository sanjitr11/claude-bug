export interface BugCapture {
  id: string;
  description: string;
  timestamp: Date;
  frames: string[];  // Paths to frame images
  duration: number;  // Total capture duration in seconds
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
