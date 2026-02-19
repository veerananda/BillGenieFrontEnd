import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

// Unit conversion groups
const UNIT_GROUPS = {
  weight: ['grams', 'kg'],
  volume: ['ml', 'liters'],
  count: ['pieces', 'cups', 'tablespoons', 'teaspoons'],
};

// Conversion rates to base units
const CONVERSION_TO_BASE = {
  grams: 1,
  kg: 1000,
  ml: 1,
  liters: 1000,
  pieces: 1,
  cups: 236.588,
  tablespoons: 14.787,
  teaspoons: 4.929,
};

// Helper function to get unit group
const getUnitGroup = (unit: string): string | null => {
  for (const [group, units] of Object.entries(UNIT_GROUPS)) {
    if (units.includes(unit)) return group;
  }
  return null;
};

// Convert value to base unit
export const convertToBaseUnit = (value: number, fromUnit: string): number => {
  return value * CONVERSION_TO_BASE[fromUnit as keyof typeof CONVERSION_TO_BASE];
};

// Convert from base unit to display unit
export const convertFromBaseUnit = (value: number, toUnit: string): number => {
  return value / CONVERSION_TO_BASE[toUnit as keyof typeof CONVERSION_TO_BASE];
};

// Get best display unit for a given unit
export const getBestDisplayUnit = (unit: string): string => {
  const group = getUnitGroup(unit);
  if (group === 'weight') return 'kg';
  if (group === 'volume') return 'liters';
  return unit;
};

// Check if two units are in the same group (convertible)
const isUnitConvertible = (unit1: string, unit2: string): boolean => {
  return getUnitGroup(unit1) === getUnitGroup(unit2) && getUnitGroup(unit1) !== null;
};

// Deduct ingredient from inventory
export const deductIngredientFromInventory = async (
  ingredientName: string,
  quantityToDeduct: number,
  quantityUnit: string
): Promise<boolean> => {
  try {
    logger.inventory(`deductIngredientFromInventory called: ${ingredientName}, qty: ${quantityToDeduct} ${quantityUnit}`);

    let inventoryStored = await AsyncStorage.getItem('inventory');
    let inventory: any[] = inventoryStored ? JSON.parse(inventoryStored) : [];

    logger.inventory(`Total inventory items: ${inventory.length}`);

    // Find inventory item matching ingredient name
    const itemIndex = inventory.findIndex(
      (item: any) =>
        item.name.toLowerCase() === ingredientName.toLowerCase() &&
        isUnitConvertible(item.unit, quantityUnit)
    );

    if (itemIndex === -1) {
      logger.warn(`Ingredient "${ingredientName}" not found in inventory`);
      logger.inventory(`Available items: ${inventory.map((i: any) => `${i.name} (${i.unit})`).join(', ')}`);
      return false;
    }

    const inventoryItem = inventory[itemIndex];
    logger.inventory(`Found inventory item: ${inventoryItem.name} (${inventoryItem.unit})`);
    logger.inventory(`Current stock: ${inventoryItem.currentStock} ${inventoryItem.unit}`);

    // Convert quantity to deduct to base unit (same as stored in inventory)
    const quantityInBaseUnit = convertToBaseUnit(quantityToDeduct, quantityUnit);
    logger.inventory(`Converted to base unit: ${quantityInBaseUnit} (from ${quantityToDeduct} ${quantityUnit})`);

    // Check if sufficient stock
    if (inventoryItem.currentStock < quantityInBaseUnit) {
      logger.warn(
        `Insufficient stock for "${ingredientName}". Have: ${inventoryItem.currentStock}, Need: ${quantityInBaseUnit}`
      );
      return false;
    }

    // Deduct from inventory
    const previousStock = inventoryItem.currentStock;
    inventoryItem.currentStock -= quantityInBaseUnit;
    inventory[itemIndex] = inventoryItem;

    // Save updated inventory
    await AsyncStorage.setItem('inventory', JSON.stringify(inventory));
    logger.inventory(`Deducted successfully: ${previousStock} → ${inventoryItem.currentStock}`);

    return true;
  } catch (error) {
    logger.error('Error deducting ingredient from inventory:', error);
    return false;
  }
};

// Process order for inventory deduction
export const processOrderForInventoryDeduction = async (order: any): Promise<boolean> => {
  try {
    logger.inventory(`Starting inventory deduction for order ${order.id}`);
    logger.inventory(`Order has ${order.items?.length || 0} items`);

    let menuCategoriesStored = await AsyncStorage.getItem('menuCategories');
    let menuCategories: any[] = menuCategoriesStored ? JSON.parse(menuCategoriesStored) : [];

    if (!menuCategories.length) {
      logger.warn(`No menu categories found`);
      return false;
    }

    logger.inventory(`Found ${menuCategories.length} menu categories`);

    // Track if any deduction failed
    let allSuccessful = true;
    let deductedItemIds: string[] = [];
    let deductedQuantities: { [key: string]: number } = {};

    // Iterate through order items
    for (const orderItem of order.items || []) {
      logger.inventory(`Processing order item: ${orderItem.name} (id: ${orderItem.id})`);

      // Find the menu item to get its ingredients
      let menuItem: any = null;

      for (const category of menuCategories) {
        const foundItem = category.items?.find((item: any) => item.id === orderItem.id);
        if (foundItem) {
          menuItem = foundItem;
          logger.inventory(`Found menu item in category: ${category.name}`);
          break;
        }
      }

      if (!menuItem) {
        console.warn(`⚠️ Menu item "${orderItem.name}" (id: ${orderItem.id}) not found in any category`);
        continue;
      }

      if (!menuItem.ingredients || menuItem.ingredients.length === 0) {
        console.warn(`⚠️ Menu item "${orderItem.name}" has no ingredients defined`);
        continue;
      }

      console.log(`🥘 Menu item has ${menuItem.ingredients.length} ingredients`);

      // Check if this item was already deducted (for edited orders)
      const previousQuantity = order.previousDeductedQuantities?.[orderItem.id] || 0;
      const currentQuantity = orderItem.quantity || 0;
      const quantityToDeduce = currentQuantity - previousQuantity;

      console.log(
        `📊 Item quantity - Current: ${currentQuantity}, Previous: ${previousQuantity}, To Deduct: ${quantityToDeduce}`
      );

      // Only deduct if there are new quantities
      if (quantityToDeduce <= 0) {
        console.log(`ℹ️ No new quantity to deduct for this item`);
        deductedItemIds.push(orderItem.id);
        deductedQuantities[orderItem.id] = currentQuantity;
        continue;
      }

      // Deduct each ingredient for this item (multiplied by quantity ordered)
      let itemSuccess = true;
      for (const ingredient of menuItem.ingredients) {
        const totalQuantityNeeded = (ingredient.quantityUsed || 0) * quantityToDeduce;

        if (totalQuantityNeeded > 0) {
          console.log(
            `  🧂 Deducting: ${ingredient.name} - Qty: ${totalQuantityNeeded} ${ingredient.unit}`
          );

          const success = await deductIngredientFromInventory(
            ingredient.name,
            totalQuantityNeeded,
            ingredient.unit
          );

          if (!success) {
            console.warn(`  ❌ Failed to deduct ${ingredient.name}`);
            itemSuccess = false;
            allSuccessful = false;
          } else {
            console.log(`  ✅ Successfully deducted ${ingredient.name}`);
          }
        }
      }

      if (itemSuccess) {
        deductedItemIds.push(orderItem.id);
        deductedQuantities[orderItem.id] = currentQuantity;
      }
    }

    // Update order with deduction info
    order.deductedItems = deductedItemIds;
    order.previousDeductedQuantities = deductedQuantities;
    order.ingredientsDeducted = allSuccessful;

    if (allSuccessful) {
      console.log(`✅ Order ${order.id} inventory deduction COMPLETED successfully`);
    } else {
      console.warn(`⚠️ Order ${order.id} had some deduction issues`);
    }

    return allSuccessful;
  } catch (error) {
    logger.error('Error processing order for inventory deduction:', error);
    return false;
  }
};

// Check if low stock warning needed (≤ 15%)
export const isLowStock = (currentStock: number, fullStock: number): boolean => {
  if (fullStock <= 0) return false;
  const percentage = (currentStock / fullStock) * 100;
  return percentage <= 15;
};

// Get stock warning level (GREEN, YELLOW, RED)
export const getStockWarningLevel = (currentStock: number, fullStock: number): 'GREEN' | 'YELLOW' | 'RED' => {
  if (fullStock <= 0) return 'GREEN';
  const percentage = (currentStock / fullStock) * 100;

  if (percentage <= 5) return 'RED';
  if (percentage <= 15) return 'YELLOW';
  return 'GREEN';
};

// Process a single order by id immediately (helper for testing)
export const processOrderById = async (orderId: string): Promise<boolean> => {
  try {
    const ordersStored = await AsyncStorage.getItem('orders');
    const orders: any[] = ordersStored ? JSON.parse(ordersStored) : [];

    const idx = orders.findIndex((o: any) => o.id === orderId);
    if (idx === -1) {
      console.warn(`Order with id ${orderId} not found`);
      return false;
    }

    const order = orders[idx];
    const success = await processOrderForInventoryDeduction(order);

    if (success) {
      // persist updated order info (deduction flags, quantities)
      orders[idx] = {
        ...order,
        ingredientsDeducted: order.ingredientsDeducted,
        deductedItems: order.deductedItems || [],
        previousDeductedQuantities: order.previousDeductedQuantities || {},
      };
      await AsyncStorage.setItem('orders', JSON.stringify(orders));
      console.log(`processOrderById: Order ${orderId} processed and saved`);
    }

    return success;
  } catch (error) {
    logger.error('Error in processOrderById:', error);
    return false;
  }
};

// Process all pending orders immediately (ignores 2-minute timer) - helper for testing
export const processAllPendingOrdersNow = async (): Promise<number> => {
  try {
    const ordersStored = await AsyncStorage.getItem('orders');
    const orders: any[] = ordersStored ? JSON.parse(ordersStored) : [];

    let processedCount = 0;
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (order && !order.ingredientsDeducted) {
        const success = await processOrderForInventoryDeduction(order);
        if (success) {
          orders[i] = {
            ...order,
            ingredientsDeducted: order.ingredientsDeducted,
            deductedItems: order.deductedItems || [],
            previousDeductedQuantities: order.previousDeductedQuantities || {},
          };
          processedCount++;
        }
      }
    }

    if (processedCount > 0) {
      await AsyncStorage.setItem('orders', JSON.stringify(orders));
    }

    console.log(`processAllPendingOrdersNow: processed ${processedCount} orders`);
    return processedCount;
  } catch (error) {
    logger.error('Error in processAllPendingOrdersNow:', error);
    return 0;
  }
};
