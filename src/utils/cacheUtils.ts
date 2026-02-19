/**
 * Cache utilities for managing data freshness with TTL
 */

const CACHE_TTL_MS = {
  ORDERS: 2 * 60 * 1000, // 2 minutes
  MENU: 15 * 60 * 1000, // 15 minutes
  PROFILE: 30 * 60 * 1000, // 30 minutes
  TABLES: 30 * 60 * 1000, // 30 minutes
  INVENTORY: 5 * 60 * 1000, // 5 minutes
};

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface CacheState {
  orders: number | null;
  menu: number | null;
  profile: number | null;
  tables: number | null;
  inventory: number | null;
}

/**
 * Check if cached data is still fresh
 */
export const isCacheFresh = (cacheTimestamp: number | null, ttl: number): boolean => {
  if (cacheTimestamp === null) return false;
  return Date.now() - cacheTimestamp < ttl;
};

/**
 * Check if orders cache is fresh
 */
export const isOrdersCacheFresh = (cacheTimestamp: number | null): boolean => {
  return isCacheFresh(cacheTimestamp, CACHE_TTL_MS.ORDERS);
};

/**
 * Check if menu cache is fresh
 */
export const isMenuCacheFresh = (cacheTimestamp: number | null): boolean => {
  return isCacheFresh(cacheTimestamp, CACHE_TTL_MS.MENU);
};

/**
 * Check if profile cache is fresh
 */
export const isProfileCacheFresh = (cacheTimestamp: number | null): boolean => {
  return isCacheFresh(cacheTimestamp, CACHE_TTL_MS.PROFILE);
};

/**
 * Check if tables cache is fresh
 */
export const isTablesCacheFresh = (cacheTimestamp: number | null): boolean => {
  return isCacheFresh(cacheTimestamp, CACHE_TTL_MS.TABLES);
};

/**
 * Get cache age in seconds (for logging/debugging)
 */
export const getCacheAge = (cacheTimestamp: number | null): number => {
  if (cacheTimestamp === null) return -1;
  return Math.floor((Date.now() - cacheTimestamp) / 1000);
};

export default {
  CACHE_TTL_MS,
  isCacheFresh,
  isOrdersCacheFresh,
  isMenuCacheFresh,
  isProfileCacheFresh,
  isTablesCacheFresh,
  getCacheAge,
};
