import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Robust AsyncStorage helpers.
 * - Handles JSON parse/stringify safely
 * - Returns typed defaults on parse errors or missing values
 * - Centralizes logging for easier diagnostics
 */

const safeParse = <T>(input: string | null, fallback: T): T => {
  if (input === null || input === undefined) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch (err) {
    console.warn('[storageHelpers] JSON parse failed, returning fallback', err);
    return fallback;
  }
};

export const getJSONOrDefault = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return safeParse<T>(raw, fallback);
  } catch (err) {
    console.error('[storageHelpers] getJSONOrDefault error', err);
    return fallback;
  }
};

export const safeSetJSON = async <T>(key: string, value: T): Promise<void> => {
  try {
    const payload = JSON.stringify(value);
    await AsyncStorage.setItem(key, payload);
  } catch (err) {
    console.error('[storageHelpers] safeSetJSON error storing', key, err);
  }
};

export const safeRemove = async (key: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.error('[storageHelpers] safeRemove error removing', key, err);
  }
};

export const safeMultiGetJSON = async <T>(keys: string[], fallbackValue: T): Promise<T[]> => {
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([, val]) => safeParse<T>(val, fallbackValue));
  } catch (err) {
    console.error('[storageHelpers] safeMultiGetJSON error', err);
    return keys.map(() => fallbackValue);
  }
};

export default {
  getJSONOrDefault,
  safeSetJSON,
  safeRemove,
  safeMultiGetJSON,
};
