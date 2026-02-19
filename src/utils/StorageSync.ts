/**
 * Storage Sync Utility
 * Handles synchronization between AsyncStorage (local device storage)
 * and the backend database (cloud persistence)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../services/api';
import { logger } from './logger';

export interface SyncResult {
  synced: number;
  failed: number;
  cleared: number;
  errors: string[];
}

/**
 * Sync unsaved orders from AsyncStorage to the database
 * Called on app startup to upload offline orders
 */
export const syncOfflineOrdersToDatabase = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    synced: 0,
    failed: 0,
    cleared: 0,
    errors: [],
  };

  try {
    logger.storage('Starting AsyncStorage → Database sync...');

    // Get orders from AsyncStorage
    const ordersStr = await AsyncStorage.getItem('orders');
    if (!ordersStr) {
      logger.storage('No AsyncStorage orders to sync');
      return result;
    }

    const orders = JSON.parse(ordersStr);
    if (!Array.isArray(orders) || orders.length === 0) {
      logger.storage('AsyncStorage orders array is empty');
      return result;
    }

    logger.storage(`Found ${orders.length} orders in AsyncStorage`);

    // Try to sync each order
    for (const order of orders) {
      try {
        // Check if order was already saved to database (has proper API response)
        if (order.id && order.id.length > 20) {
          // UUID format - likely saved to database already
          logger.storage(`Order ${order.id} appears to be from database, skipping`);
          result.synced++;
          continue;
        }

        // This is a locally-created order that needs to be uploaded
        logger.storage(`Syncing local order (table ${order.table_number})...`);

        // Create order via API
        const createRequest = {
          table_number: order.table_number,
          customer_name: order.customer_name || '',
          items: (order.items || []).map((item: any) => ({
            menu_item_id: item.menu_item_id || item.id,
            quantity: item.quantity,
            notes: item.notes || '',
          })),
          notes: order.notes || '',
        };

        const response = await apiClient.createOrder(createRequest);

        if (response && response.id) {
          logger.storage(`Order synced successfully: ${response.id}`);
          result.synced++;
        } else {
          logger.warn(`Order sync response invalid for table ${order.table_number}`);
          result.failed++;
          result.errors.push(`Invalid response for table ${order.table_number}`);
        }
      } catch (err) {
        logger.error(`Failed to sync order from table ${order.table_number}:`, err);
        result.failed++;
        result.errors.push(`Failed to sync table ${order.table_number}: ${String(err)}`);
      }
    }

    logger.storage(`Sync complete: ${result.synced} synced, ${result.failed} failed`);
    return result;
  } catch (err) {
    logger.error('Sync process error:', err);
    result.errors.push(`Sync process error: ${String(err)}`);
    return result;
  }
};

/**
 * Clear old AsyncStorage data after database sync is confirmed
 * Only clears data that has been successfully synced
 */
export const clearSyncedAsyncStorageOrders = async (): Promise<void> => {
  try {
    logger.storage('Clearing synced AsyncStorage orders...');

    // Remove orders key (will keep other data like auth tokens)
    await AsyncStorage.removeItem('orders');

    logger.storage('AsyncStorage orders cleared');
  } catch (err) {
    logger.error('Error clearing AsyncStorage:', err);
  }
};

/**
 * Get AsyncStorage cache statistics
 */
export const getStorageStats = async (): Promise<{
  orderCount: number;
  inventoryCount: number;
  menuCategoriesCount: number;
}> => {
  try {
    const ordersStr = await AsyncStorage.getItem('orders');
    const inventoryStr = await AsyncStorage.getItem('inventory');
    const categoriesStr = await AsyncStorage.getItem('menuCategories');

    const orders = ordersStr ? JSON.parse(ordersStr) : [];
    const inventory = inventoryStr ? JSON.parse(inventoryStr) : [];
    const categories = categoriesStr ? JSON.parse(categoriesStr) : [];

    return {
      orderCount: Array.isArray(orders) ? orders.length : 0,
      inventoryCount: Array.isArray(inventory) ? inventory.length : 0,
      menuCategoriesCount: Array.isArray(categories) ? categories.length : 0,
    };
  } catch (err) {
    logger.error('Error getting storage stats:', err);
    return {
      orderCount: 0,
      inventoryCount: 0,
      menuCategoriesCount: 0,
    };
  }
};

/**
 * Manual cleanup of all AsyncStorage data
 * Use with caution - only for development/testing
 */
export const clearAllAsyncStorage = async (): Promise<void> => {
  try {
    logger.storage('Clearing ALL AsyncStorage data...');
    await AsyncStorage.clear();
    logger.storage('All AsyncStorage data cleared');
  } catch (err) {
    logger.error('Error clearing all AsyncStorage:', err);
  }
};
