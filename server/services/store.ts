import fs from 'node:fs';
import path from 'node:path';
import type { ActivityLogEntry, ClimateTelemetry, FieldRecord } from '../types';
import { INITIAL_ACTIVITIES, INITIAL_FIELDS } from '../seedData';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'cosmic_crisp_store.json');
const CACHE_PATH = path.join(DATA_DIR, 'nasa_power_cache.json');

interface StoreState {
  fields: FieldRecord[];
  activities: ActivityLogEntry[];
}

interface TelemetryCacheEntry {
  telemetry: ClimateTelemetry;
  storedAtMs: number;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadStore(): StoreState {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    const initial: StoreState = {
      fields: INITIAL_FIELDS,
      activities: INITIAL_ACTIVITIES,
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as StoreState;
    if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
      return { fields: INITIAL_FIELDS, activities: INITIAL_ACTIVITIES };
    }
    const seedById = new Map(INITIAL_FIELDS.map((f) => [f.id, f]));
    const hydratedFields = parsed.fields.map((f) => {
      if (!f.soil.om_history || f.soil.om_history.length === 0) {
        const seeded = seedById.get(f.id);
        if (seeded?.soil.om_history) {
          return {
            ...f,
            soil: {
              ...f.soil,
              om_history: seeded.soil.om_history,
            },
          };
        }
      }
      return f;
    });
    return { ...parsed, fields: hydratedFields };
  } catch {
    return { fields: INITIAL_FIELDS, activities: INITIAL_ACTIVITIES };
  }
}

export function saveStore(state: StoreState): void {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

const TTL_24H_MS = 24 * 60 * 60 * 1000;

export function getCachedNasaTelemetry(cacheKey: string): ClimateTelemetry | null {
  ensureDataDir();
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    const cache = JSON.parse(raw) as Record<string, TelemetryCacheEntry>;
    const entry = cache[cacheKey];
    if (!entry) return null;
    if (Date.now() - entry.storedAtMs > TTL_24H_MS) {
      return null;
    }
    return {
      ...entry.telemetry,
      cache_hit: true,
    };
  } catch {
    return null;
  }
}

export function setCachedNasaTelemetry(cacheKey: string, telemetry: ClimateTelemetry): void {
  ensureDataDir();
  let cache: Record<string, TelemetryCacheEntry> = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as Record<string, TelemetryCacheEntry>;
    } catch {
      cache = {};
    }
  }
  cache[cacheKey] = {
    telemetry,
    storedAtMs: Date.now(),
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}
