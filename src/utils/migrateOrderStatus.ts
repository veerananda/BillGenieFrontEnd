import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

/**
 * Migrate existing orders to add item-level status field
 * This ensures all order items have a status property
 */
export const migrateOrderStatus = async () => {
  try {
    const ordersStored = await AsyncStorage.getItem('orders');
    if (!ordersStored) {
      logger.orders('No orders to migrate');
      return;
    }

    const orders = JSON.parse(ordersStored);
    logger.orders(`Found ${orders.length} orders to check for migration`);

    let migrationCount = 0;
    const migratedOrders = orders.map((order: any) => {
      const migratedItems = (order.items || []).map((item: any) => {
        // If item doesn't have status field, add it as 'pending'
        if (!item.status) {
          migrationCount++;
          return {
            ...item,
            status: 'pending',
            statusUpdatedAt: Date.now(),
          };
        }
        return item;
      });

      return {
        ...order,
        items: migratedItems,
      };
    });

    if (migrationCount > 0) {
      await AsyncStorage.setItem('orders', JSON.stringify(migratedOrders));
      logger.orders(`Migrated ${migrationCount} items to have status field`);
    } else {
      logger.orders('All items already have status field - no migration needed');
    }

    return migrationCount;
  } catch (error) {
    logger.error('Error migrating order status:', error);
    return 0;
  }
};
