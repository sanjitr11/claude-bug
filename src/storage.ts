import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BugCapture, CaptureMetadata, CaptureMetadataExtended, Config } from './types';

const CLAUDE_BUG_DIR = path.join(os.homedir(), '.claude-bug');
const RECORDINGS_DIR = path.join(CLAUDE_BUG_DIR, 'recordings');
const METADATA_FILE = path.join(CLAUDE_BUG_DIR, 'captures.json');
const CONFIG_FILE = path.join(CLAUDE_BUG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
  ttlDays: 7
};

/**
 * Ensure the storage directories exist
 */
export function ensureStorageExists(): void {
  if (!fs.existsSync(CLAUDE_BUG_DIR)) {
    fs.mkdirSync(CLAUDE_BUG_DIR, { recursive: true });
  }
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(METADATA_FILE)) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify({ captures: [] }, null, 2));
  }
}

/**
 * Get the path for a new recording
 */
export function getRecordingPath(id: string): string {
  ensureStorageExists();
  return path.join(RECORDINGS_DIR, `${id}.mp4`);
}

/**
 * Get the path for a context JSON file
 */
export function getContextPath(id: string): string {
  ensureStorageExists();
  return path.join(RECORDINGS_DIR, `${id}.json`);
}

/**
 * Get the path for a formatted markdown file
 */
export function getFormattedPath(id: string): string {
  ensureStorageExists();
  return path.join(RECORDINGS_DIR, `${id}.md`);
}

/**
 * Save capture metadata
 */
export function saveCapture(capture: BugCapture, isTemp: boolean = false): CaptureMetadataExtended {
  ensureStorageExists();

  const metadata: CaptureMetadataExtended = {
    id: capture.id,
    description: capture.description,
    timestamp: capture.timestamp.toISOString(),
    recordingPath: capture.recordingPath,
    contextPath: getContextPath(capture.id),
    formattedPath: getFormattedPath(capture.id),
    duration: capture.duration,
    isTemp
  };

  // Save full context as JSON
  fs.writeFileSync(
    metadata.contextPath,
    JSON.stringify(capture, null, 2)
  );

  // Update metadata index
  const index = loadMetadataIndex();
  index.captures.unshift(metadata); // Add to beginning (most recent first)

  // Keep only last 100 captures in index
  if (index.captures.length > 100) {
    index.captures = index.captures.slice(0, 100);
  }

  saveMetadataIndex(index);

  return metadata;
}

/**
 * Load the metadata index
 */
function loadMetadataIndex(): { captures: CaptureMetadataExtended[] } {
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
function saveMetadataIndex(index: { captures: CaptureMetadataExtended[] }): void {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(index, null, 2));
}

/**
 * List all captures
 */
export function listCaptures(): CaptureMetadataExtended[] {
  const index = loadMetadataIndex();
  return index.captures;
}

/**
 * Get a specific capture by ID
 */
export function getCapture(id: string): BugCapture | null {
  const contextPath = getContextPath(id);

  if (!fs.existsSync(contextPath)) {
    // Try partial ID match
    const captures = listCaptures();
    const match = captures.find(c => c.id.startsWith(id));
    if (match) {
      return getCaptureByPath(match.contextPath);
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
 * Delete a capture by ID
 */
export function deleteCapture(id: string): boolean {
  const index = loadMetadataIndex();
  const captureIndex = index.captures.findIndex(c => c.id === id || c.id.startsWith(id));

  if (captureIndex === -1) {
    return false;
  }

  const capture = index.captures[captureIndex];

  // Delete files
  const filesToDelete = [
    capture.recordingPath,
    capture.contextPath,
    capture.formattedPath
  ];

  for (const file of filesToDelete) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  // Update index
  index.captures.splice(captureIndex, 1);
  fs.writeFileSync(METADATA_FILE, JSON.stringify(index, null, 2));

  return true;
}

/**
 * Get storage statistics
 */
export function getStorageStats(): { totalCaptures: number; totalSize: number; oldestCapture: Date | null } {
  const captures = listCaptures();
  let totalSize = 0;

  for (const capture of captures) {
    if (fs.existsSync(capture.recordingPath)) {
      totalSize += fs.statSync(capture.recordingPath).size;
    }
    if (fs.existsSync(capture.contextPath)) {
      totalSize += fs.statSync(capture.contextPath).size;
    }
    if (fs.existsSync(capture.formattedPath)) {
      totalSize += fs.statSync(capture.formattedPath).size;
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
 * Get the base storage directory path
 */
export function getStorageDir(): string {
  return CLAUDE_BUG_DIR;
}

/**
 * Get the recordings directory path
 */
export function getRecordingsDir(): string {
  return RECORDINGS_DIR;
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
 * Get a specific config value
 */
export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  const config = loadConfig();
  return config[key];
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
 * Returns the number of captures deleted
 */
export function deleteExpiredCaptures(): { deleted: number; ids: string[] } {
  const config = loadConfig();
  const ttlDays = config.ttlDays;

  // If TTL is 0, never auto-delete
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
 * Call this periodically to clean up temp captures that have been viewed
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
 * Call this at the start of CLI commands
 */
export function runCleanup(): { expired: number; temp: number } {
  const expiredResult = deleteExpiredCaptures();
  const tempResult = deleteViewedTempCaptures();

  return {
    expired: expiredResult.deleted,
    temp: tempResult.deleted
  };
}
