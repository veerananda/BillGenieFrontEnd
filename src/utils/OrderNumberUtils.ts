import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../services/api';
import { logger } from './logger';

const ORDER_NUMBER_KEY = 'order_number_counter';
const ORDER_NUMBER_DATE_KEY = 'order_number_date';

/**
 * Get the next order number based on highest completed order from API
 * @returns Next order number
 */
export const getNextOrderNumber = async (): Promise<number> => {
  try {
    // First, try to get the highest order number from API for today
    try {
      const response = await apiClient.listOrders('completed', 1000, 0); // Get recent completed orders
      if (response.orders && response.orders.length > 0) {
        const today = new Date().toDateString();
        // Filter orders from today
        const todayOrders = response.orders.filter((order: any) => {
          const orderDate = new Date(order.createdAt || order.created_at).toDateString();
          return orderDate === today;
        });
        if (todayOrders.length > 0) {
          const highestOrderNumber = Math.max(...todayOrders.map(order => order.order_number || 0));
          logger.orders(`Highest order number from API today: ${highestOrderNumber}`);
          return highestOrderNumber + 1;
        } else {
          // No orders today, start from 1
          logger.orders('No orders today from API, starting from 1');
          return 1;
        }
      }
    } catch (apiError) {
      logger.warn('Could not fetch from API, falling back to local storage:', apiError);
    }

    // Fallback to local logic
    const today = new Date().toDateString();
    const storedDate = await AsyncStorage.getItem(ORDER_NUMBER_DATE_KEY);
    
    logger.orders('Order number check - Today:', today, 'Stored date:', storedDate);
    
    // If date changed, reset to find highest from today's orders
    if (storedDate !== today) {
      logger.orders('Date changed - finding highest order number from today');
      await AsyncStorage.setItem(ORDER_NUMBER_DATE_KEY, today);
      await AsyncStorage.setItem(ORDER_NUMBER_KEY, '0');
    }
    
    // Get completed orders to find the highest order number
    try {
      const ordersStr = await AsyncStorage.getItem('orders');
      const orders = ordersStr ? JSON.parse(ordersStr) : [];
      
      // Filter completed orders from today
      const todayOrders = orders.filter((order: any) => {
        const orderDate = new Date(order.createdAt).toDateString();
        return orderDate === today && order.status === 'completed';
      });
      
      // Find the highest order number from completed orders
      let highestOrderNumber = 0;
      if (todayOrders.length > 0) {
        highestOrderNumber = Math.max(...todayOrders.map((o: any) => o.orderNumber || 0));
        logger.orders(`Highest completed order number today: ${highestOrderNumber}`);
      }
      
      const nextNumber = highestOrderNumber + 1;
      
      logger.orders(`Next order number: ${nextNumber}`);
      
      return nextNumber;
    } catch (err) {
      logger.error('Error reading orders:', err);
      // Fallback to stored counter
      const counterStr = await AsyncStorage.getItem(ORDER_NUMBER_KEY);
      const counter = counterStr ? parseInt(counterStr, 10) : 0;
      return counter + 1;
    }
  } catch (error) {
    logger.error('Error getting next order number:', error);
    // Fallback to random number if storage fails
    return Math.floor(Math.random() * 10000);
  }
};

/**
 * Reset order number counter (for testing) - temporarily disabled
 */
export const resetOrderNumbers = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(ORDER_NUMBER_KEY);
    await AsyncStorage.removeItem(ORDER_NUMBER_DATE_KEY);
    logger.orders('Order numbers reset');
  } catch (error) {
    logger.error('Error resetting order numbers:', error);
  }
};

/**
 * Get current order number (without incrementing)
 */
export const getCurrentOrderNumber = async (): Promise<number> => {
  try {
    const today = new Date().toDateString();
    const storedDate = await AsyncStorage.getItem(ORDER_NUMBER_DATE_KEY);
    
    // If date changed, return 0 (will be reset on next getNextOrderNumber call)
    if (storedDate !== today) {
      return 0;
    }
    
    const counterStr = await AsyncStorage.getItem(ORDER_NUMBER_KEY);
    const counter = counterStr ? parseInt(counterStr, 10) : 0;
    
    return counter;
  } catch (error) {
    logger.error('Error getting current order number:', error);
    return 0;
  }
};
