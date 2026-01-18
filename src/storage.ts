import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BugCapture, CaptureMetadata, Config } from './types';

const CLAUDE_BUG_DIR = path.join(os.homedir(), '.claude-bug');
const CAPTURES_DIR = path.join(CLAUDE_BUG_DIR, 'captures');
const METADATA_FILE = path.join(CLAUDE_BUG_DIR, 'captures.json');
const CONFIG_FILE = path.join(CLAUDE_BUG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
  duration: 30,           // 30 second recording
  targetKeyFrames: 6,     // 6 key frames
  diffThreshold: 3,       // 3% difference threshold
  maxTokens: 10000,       // 10k token budget
  ttlDays: 7              // Auto-delete after 7 days
};

/**
 * Ensure the storage directories exist
 */
export function ensureStorageExists(): void {
  if (!fs.existsSync(CLAUDE_BUG_DIR)) {
    fs.mkdirSync(CLAUDE_BUG_DIR, { recursive: true });
  }
  if (!fs.existsSync(CAPTURES_DIR)) {
    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  }
  if (!fs.existsSync(METADATA_FILE)) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify({ captures: [] }, null, 2));
  }
}

/**
 * Get the base directory for a capture
 */
export function getCaptureDir(id: string): string {
  ensureStorageExists();
  return path.join(CAPTURES_DIR, id);
}

/**
 * Get path to video file
 */
export function getVideoPath(id: string): string {
  return path.join(getCaptureDir(id), 'recording.mp4');
}

/**
 * Get path to frames directory
 */
export function getFramesDir(id: string): string {
  return path.join(getCaptureDir(id), 'frames');
}

/**
 * Get path to key frames directory
 */
export function getKeyFramesDir(id: string): string {
  return path.join(getCaptureDir(id), 'key_frames');
}

/**
 * Get path to capture JSON file
 */
export function getContextPath(id: string): string {
  return path.join(getCaptureDir(id), 'capture.json');
}

/**
 * Get path to formatted report
 */
export function getFormattedPath(id: string): string {
  return path.join(getCaptureDir(id), 'report.md');
}

/**
 * Load the metadata index
 */
function loadMetadataIndex(): { captures: CaptureMetadata[] } {
  ensureStorageExists();

  try {
    const content = fs.readFileSync(METADATA_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { captures: [] };
  }
}

/**
 * Save the metadata index
 */
function saveMetadataIndex(index: { captures: CaptureMetadata[] }): void {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(index, null, 2));
}

/**
 * Save capture metadata and full capture data
 */
export function saveCapture(capture: BugCapture, isTemp: boolean = false): CaptureMetadata {
  ensureStorageExists();

  const captureDir = getCaptureDir(capture.id);
  if (!fs.existsSync(captureDir)) {
    fs.mkdirSync(captureDir, { recursive: true });
  }

  // Create metadata
  const metadata: CaptureMetadata = {
    id: capture.id,
    description: capture.description,
    timestamp: capture.timestamp.toISOString(),
    duration: capture.duration,
    keyFrameCount: capture.keyFrames.length,
    tokenEstimate: capture.metrics.tokenEstimate,
    isTemp
  };

  // Save full capture data as JSON
  const captureData = {
    ...capture,
    timestamp: capture.timestamp.toISOString()
  };
  fs.writeFileSync(
    getContextPath(capture.id),
    JSON.stringify(captureData, null, 2)
  );

  // Update metadata index
  const index = loadMetadataIndex();
  index.captures.unshift(metadata);  // Add to beginning (most recent first)

  // Keep only last 100 captures in index
  if (index.captures.length > 100) {
    index.captures = index.captures.slice(0, 100);
  }

  saveMetadataIndex(index);

  return metadata;
}

/**
 * List all captures
 */
export function listCaptures(): CaptureMetadata[] {
  const index = loadMetadataIndex();
  return index.captures;
}

/**
 * Get a specific capture by ID (supports partial ID matching)
 */
export function getCapture(id: string): BugCapture | null {
  const contextPath = getContextPath(id);

  if (!fs.existsSync(contextPath)) {
    // Try partial ID match
    const captures = listCaptures();
    const match = captures.find(c => c.id.startsWith(id));
    if (match) {
      return getCaptureByPath(getContextPath(match.id));
    }
    return null;
  }

  return getCaptureByPath(contextPath);
}

/**
 * Load capture from context file path
 */
function getCaptureByPath(contextPath: string): BugCapture | null {
  try {
    const content = fs.readFileSync(contextPath, 'utf-8');
    const data = JSON.parse(content);
    // Convert timestamp string back to Date
    data.timestamp = new Date(data.timestamp);
    return data as BugCapture;
  } catch {
    return null;
  }
}

/**
 * Delete a capture by ID (including all files)
 */
export function deleteCapture(id: string): boolean {
  const index = loadMetadataIndex();
  const captureIndex = index.captures.findIndex(c => c.id === id || c.id.startsWith(id));

  if (captureIndex === -1) {
    return false;
  }

  const capture = index.captures[captureIndex];
  const captureDir = getCaptureDir(capture.id);

  // Delete entire capture directory
  if (fs.existsSync(captureDir)) {
    fs.rmSync(captureDir, { recursive: true, force: true });
  }

  // Update index
  index.captures.splice(captureIndex, 1);
  saveMetadataIndex(index);

  return true;
}

/**
 * Get storage statistics
 */
export function getStorageStats(): { totalCaptures: number; totalSize: number; oldestCapture: Date | null } {
  const captures = listCaptures();
  let totalSize = 0;

  for (const capture of captures) {
    const captureDir = getCaptureDir(capture.id);
    if (fs.existsSync(captureDir)) {
      totalSize += getDirSize(captureDir);
    }
  }

  const oldestCapture = captures.length > 0
    ? new Date(captures[captures.length - 1].timestamp)
    : null;

  return {
    totalCaptures: captures.length,
    totalSize,
    oldestCapture
  };
}

/**
 * Get directory size recursively
 */
function getDirSize(dirPath: string): number {
  let size = 0;

  if (!fs.existsSync(dirPath)) return 0;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      size += getDirSize(filePath);
    } else {
      size += stat.size;
    }
  }

  return size;
}

/**
 * Get the base storage directory path
 */
export function getStorageDir(): string {
  return CLAUDE_BUG_DIR;
}

/**
 * Get the captures directory path
 */
export function getCapturesDir(): string {
  return CAPTURES_DIR;
}

// ============ Config Management ============

/**
 * Load config from file
 */
export function loadConfig(): Config {
  ensureStorageExists();

  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save config to file
 */
export function saveConfig(config: Config): void {
  ensureStorageExists();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Set a specific config value
 */
export function setConfigValue<K extends keyof Config>(key: K, value: Config[K]): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

// ============ Auto-Expiration ============

/**
 * Parse duration string (e.g., "7d", "24h", "30m") to milliseconds
 */
export function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: return null;
  }
}

/**
 * Delete expired captures based on TTL setting
 */
export function deleteExpiredCaptures(): { deleted: number; ids: string[] } {
  const config = loadConfig();
  const ttlDays = config.ttlDays;

  if (ttlDays === 0) {
    return { deleted: 0, ids: [] };
  }

  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const captures = listCaptures();
  const deletedIds: string[] = [];

  for (const capture of captures) {
    const captureTime = new Date(capture.timestamp).getTime();
    const age = now - captureTime;

    if (age > ttlMs) {
      if (deleteCapture(capture.id)) {
        deletedIds.push(capture.id);
      }
    }
  }

  return { deleted: deletedIds.length, ids: deletedIds };
}

/**
 * Delete captures older than a specific duration
 */
export function deleteCapturesOlderThan(duration: string): { deleted: number; ids: string[] } {
  const ms = parseDuration(duration);
  if (ms === null) {
    return { deleted: 0, ids: [] };
  }

  const now = Date.now();
  const captures = listCaptures();
  const deletedIds: string[] = [];

  for (const capture of captures) {
    const captureTime = new Date(capture.timestamp).getTime();
    const age = now - captureTime;

    if (age > ms) {
      if (deleteCapture(capture.id)) {
        deletedIds.push(capture.id);
      }
    }
  }

  return { deleted: deletedIds.length, ids: deletedIds };
}

/**
 * Delete all captures
 */
export function deleteAllCaptures(): { deleted: number; ids: string[] } {
  const captures = listCaptures();
  const deletedIds: string[] = [];

  for (const capture of captures) {
    if (deleteCapture(capture.id)) {
      deletedIds.push(capture.id);
    }
  }

  return { deleted: deletedIds.length, ids: deletedIds };
}

// ============ Temp Capture Support ============

/**
 * Mark a capture as viewed (for temp captures)
 */
export function markCaptureViewed(id: string): void {
  const index = loadMetadataIndex();
  const capture = index.captures.find(c => c.id === id || c.id.startsWith(id));

  if (capture && capture.isTemp && !capture.viewedAt) {
    capture.viewedAt = new Date().toISOString();
    saveMetadataIndex(index);
  }
}

/**
 * Delete viewed temp captures
 */
export function deleteViewedTempCaptures(): { deleted: number; ids: string[] } {
  const captures = listCaptures();
  const deletedIds: string[] = [];

  for (const capture of captures) {
    if (capture.isTemp && capture.viewedAt) {
      if (deleteCapture(capture.id)) {
        deletedIds.push(capture.id);
      }
    }
  }

  return { deleted: deletedIds.length, ids: deletedIds };
}

/**
 * Run cleanup: delete expired captures and viewed temp captures
 */
export function runCleanup(): { expired: number; temp: number } {
  const expiredResult = deleteExpiredCaptures();
  const tempResult = deleteViewedTempCaptures();

  return {
    expired: expiredResult.deleted,
    temp: tempResult.deleted
  };
}
