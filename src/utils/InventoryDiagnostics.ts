import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSONOrDefault, safeRemove } from './storageHelpers';

/**
 * Diagnostic tool to identify issues with inventory deduction
 * Add this to your app for debugging
 */

export const diagnoseInventoryIssues = async () => {
  console.log('\n🔍 ===== INVENTORY DIAGNOSTICS START =====\n');

  try {
    // 1. Check menu categories and items
    const menuCategories = await getJSONOrDefault<any[]>('menuCategories', []);

    console.log(`📂 Menu Categories: ${menuCategories.length}`);
    
    for (const category of menuCategories) {
      console.log(`\n  📁 Category: ${category.name}`);
      for (const item of category.items || []) {
        console.log(`    🍽️  Item: ${item.name} (id: ${item.id})`);
        if (item.ingredients && item.ingredients.length > 0) {
          for (const ingredient of item.ingredients) {
            console.log(
              `      🧂 Ingredient: ${ingredient.name}, Qty: ${ingredient.quantityUsed} ${ingredient.unit}`
            );
          }
        } else {
          console.warn(`      ⚠️  NO INGREDIENTS DEFINED!`);
        }
      }
    }

    // 2. Check inventory
    console.log(`\n\n📦 Inventory Items:`);
    const inventory = await getJSONOrDefault<any[]>('inventory', []);

    console.log(`Total: ${inventory.length}`);
    for (const item of inventory) {
      console.log(
        `  ${item.name}: ${item.currentStock} / ${item.fullStock} ${item.unit}`
      );
    }

    // 3. Check orders
    console.log(`\n\n📋 Orders:`);
    const orders = await getJSONOrDefault<any[]>('orders', []);

    console.log(`Total: ${orders.length}`);
    for (const order of orders) {
      console.log(`\n  Order ID: ${order.id}`);
      console.log(`  Table: ${order.tableNumber}, Customer: ${order.customerName}`);
      console.log(`  Created: ${new Date(order.createdAt).toLocaleTimeString()}`);
      console.log(`  Saved: ${order.savedAt ? new Date(order.savedAt).toLocaleTimeString() : 'N/A'}`);
      console.log(`  Ingredients Deducted: ${order.ingredientsDeducted ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  Items: ${order.items?.length || 0}`);
      
      for (const item of order.items || []) {
        console.log(`    - ${item.name} x${item.quantity} (id: ${item.id})`);
      }

      if (order.deductedItems) {
        console.log(`  Deducted Items: ${order.deductedItems.join(', ')}`);
      }

      if (order.previousDeductedQuantities) {
        console.log(`  Previous Quantities:`, order.previousDeductedQuantities);
      }
    }

    console.log(`\n\n🔍 ===== DIAGNOSTICS END =====\n`);
  } catch (error) {
    console.error('Error running diagnostics:', error);
  }
};

/**
 * Clear all data (for testing purposes)
 */
export const clearAllData = async () => {
  try {
    await safeRemove('menuCategories');
    await safeRemove('inventory');
    await safeRemove('orders');
    console.log('✅ All data cleared');
  } catch (error) {
    console.error('Error clearing data:', error);
  }
};
