import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Text,
  Modal,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import { apiClient } from '../services/api';

type RootStackParamList = {
  Home: undefined;
  InventoryManagement: undefined;
};

type InventoryManagementScreenProps = NativeStackScreenProps<RootStackParamList, 'InventoryManagement'>;

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  fullStock: number;
  createdAt: string;
}

interface Ingredient {
  id: string;
  name: string;
  unit: string;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isVegetarian: boolean;
  isEnabled: boolean;
  ingredients?: Ingredient[];
}

interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

// Unit conversion groups - units in the same group can be consolidated
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
  cups: 236.588, // ml equivalent
  tablespoons: 14.787, // ml equivalent
  teaspoons: 4.929, // ml equivalent
};

export const InventoryManagementScreen: React.FC<InventoryManagementScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingUnit, setEditingUnit] = useState('');
  const [editingCurrentStock, setEditingCurrentStock] = useState('');
  const [editingFullStock, setEditingFullStock] = useState('');
  const [editingDisplayUnit, setEditingDisplayUnit] = useState('');
  const [error, setError] = useState('');
  const [showUnitDropdown, setShowUnitDropdown] = useState(false);

  const INGREDIENT_UNITS = ['pieces', 'grams', 'ml', 'liters', 'kg', 'cups', 'tablespoons', 'teaspoons'];

  // Helper function to get unit group
  const getUnitGroup = (unit: string): string | null => {
    for (const [group, units] of Object.entries(UNIT_GROUPS)) {
      if (units.includes(unit)) return group;
    }
    return null;
  };

  // Helper function to check if two units are in the same group
  const isUnitConvertible = (unit1: string, unit2: string): boolean => {
    return getUnitGroup(unit1) === getUnitGroup(unit2) && getUnitGroup(unit1) !== null;
  };

  // Helper function to consolidate inventory items with same name but different units
  const consolidateInventory = (items: InventoryItem[]): InventoryItem[] => {
    const consolidated: { [key: string]: InventoryItem } = {};

    items.forEach(item => {
      const key = item.name.toLowerCase();

      if (!consolidated[key]) {
        consolidated[key] = { ...item };
      } else {
        // Check if units are convertible (in same group)
        const existingItem = consolidated[key];
        if (isUnitConvertible(existingItem.unit, item.unit)) {
          // Convert to base unit for display
          const group = getUnitGroup(item.unit);
          
          // Keep the first unit encountered, but add converted values
          // For now, we'll merge by showing both units, but prefer the first one
          existingItem.currentStock +=
            (item.currentStock * CONVERSION_TO_BASE[item.unit as keyof typeof CONVERSION_TO_BASE]) /
            CONVERSION_TO_BASE[existingItem.unit as keyof typeof CONVERSION_TO_BASE];
          existingItem.fullStock +=
            (item.fullStock * CONVERSION_TO_BASE[item.unit as keyof typeof CONVERSION_TO_BASE]) /
            CONVERSION_TO_BASE[existingItem.unit as keyof typeof CONVERSION_TO_BASE];
        }
        // If not convertible, keep them separate (different units for same ingredient)
      }
    });

    return Object.values(consolidated);
  };

  // Helper function to convert from display unit to storage unit (base unit)
  const convertToBaseUnit = (value: number, fromUnit: string): number => {
    return value * CONVERSION_TO_BASE[fromUnit as keyof typeof CONVERSION_TO_BASE];
  };

  // Helper function to convert from storage unit (base unit) to display unit
  const convertFromBaseUnit = (value: number, toUnit: string): number => {
    return value / CONVERSION_TO_BASE[toUnit as keyof typeof CONVERSION_TO_BASE];
  };

  // Helper function to get the best display unit (for weight: kg, for volume: liters, for count: pieces)
  const getBestDisplayUnit = (unit: string): string => {
    const group = getUnitGroup(unit);
    if (group === 'weight') return 'kg';
    if (group === 'volume') return 'liters';
    return unit; // For count group, return the same unit
  };

  useEffect(() => {
    loadInventory();
    const interval = setInterval(() => {
      syncIngredientsToInventory();
    }, 2000); // Check for new ingredients every 2 seconds

    return () => clearInterval(interval);
  }, []);

  const loadInventory = async () => {
    try {
      // Try loading from API first
      try {
        console.log('📦 Loading inventory from API...');
        const ingredients = await apiClient.listIngredients();
        const transformed = ingredients.map((ing: any) => ({
          id: ing.id,
          name: ing.name,
          unit: ing.unit,
          currentStock: ing.current_stock,
          fullStock: ing.full_stock,
          createdAt: ing.created_at,
        }));
        setInventory(transformed);
        console.log(`✅ Loaded ${ingredients.length} ingredients from API`);
      } catch (apiErr) {
        console.error('API error, falling back to AsyncStorage:', apiErr);
        const stored = await getJSONOrDefault<InventoryItem[]>('inventory', []);
        if (Array.isArray(stored) && stored.length > 0) {
          const consolidated = consolidateInventory(stored as InventoryItem[]);
          setInventory(consolidated);
        }
      }
      syncIngredientsToInventory();
      setLoading(false);
    } catch (err) {
      console.error('Error loading inventory:', err);
      setLoading(false);
    }
  };

  const syncIngredientsToInventory = async () => {
    try {
      const categories: MenuCategory[] = await getJSONOrDefault<MenuCategory[]>('menuCategories', []);
      const allIngredients: Ingredient[] = [];

      // Collect all ingredients from all categories and items
      categories.forEach(category => {
        category.items.forEach(item => {
          if (item.ingredients && item.ingredients.length > 0) {
            item.ingredients.forEach(ingredient => {
              allIngredients.push(ingredient);
            });
          }
        });
      });

      // Get current inventory
      const currentInventory = await getJSONOrDefault<InventoryItem[]>('inventory', []);
      let updatedInventory: InventoryItem[] = Array.isArray(currentInventory) ? currentInventory : [];

      // Add new ingredients that don't exist in inventory
      allIngredients.forEach(ingredient => {
        // Check if ingredient exists with same unit
        let exists = updatedInventory.some(
          inv => inv.name.toLowerCase() === ingredient.name.toLowerCase() && 
                 inv.unit === ingredient.unit
        );

        if (!exists) {
          const newInventoryItem: InventoryItem = {
            id: Date.now().toString() + Math.random(),
            name: ingredient.name,
            unit: ingredient.unit,
            currentStock: 0,
            fullStock: 0,
            createdAt: new Date().toISOString(),
          };
          updatedInventory.push(newInventoryItem);
        }
      });

      // Consolidate inventory (merge items with convertible units)
      updatedInventory = consolidateInventory(updatedInventory);

      // Save updated inventory
      await safeSetJSON('inventory', updatedInventory);
      setInventory(updatedInventory);
    } catch (err) {
      console.error('Error syncing ingredients:', err);
    }
  };

  const handleEditInventory = (item: InventoryItem) => {
    const displayUnit = getBestDisplayUnit(item.unit);
    const displayCurrentStock = convertFromBaseUnit(item.currentStock, displayUnit);
    const displayFullStock = convertFromBaseUnit(item.fullStock, displayUnit);

    setEditingInventoryId(item.id);
    setEditingName(item.name);
    setEditingUnit(item.unit);
    setEditingDisplayUnit(displayUnit);
    setEditingCurrentStock(displayCurrentStock.toString());
    setEditingFullStock(displayFullStock.toString());
    setError('');
    setShowEditModal(true);
  };

  const handleSaveInventory = async () => {
    if (!editingName.trim()) {
      setError('Please enter ingredient name');
      return;
    }

    const displayCurrentStockNum = parseFloat(editingCurrentStock) || 0;
    const displayFullStockNum = parseFloat(editingFullStock) || 0;

    if (displayCurrentStockNum < 0 || displayFullStockNum < 0) {
      setError('Stock values cannot be negative');
      return;
    }

    // Convert from display unit back to base unit for storage
    const baseCurrentStock = convertToBaseUnit(displayCurrentStockNum, editingDisplayUnit);
    const baseFullStock = convertToBaseUnit(displayFullStockNum, editingDisplayUnit);

    try {
      // Try updating via API first
      if (editingInventoryId) {
        try {
          await apiClient.updateIngredient(editingInventoryId, {
            name: editingName.trim(),
            unit: editingUnit,
            current_stock: baseCurrentStock,
            full_stock: baseFullStock,
          });
          console.log('✅ Ingredient updated via API');
          // Reload from API
          await loadInventory();
        } catch (apiErr) {
          console.error('API error, falling back to AsyncStorage:', apiErr);
          // Fallback to AsyncStorage
          const updated = inventory.map(item => {
            if (item.id === editingInventoryId) {
              return {
                ...item,
                name: editingName.trim(),
                unit: editingUnit,
                currentStock: baseCurrentStock,
                fullStock: baseFullStock,
              };
            }
            return item;
          });
          // Persist fallback edit to cache
          await safeSetJSON('inventory', updated);
          setInventory(updated);
        }
      }

      setShowEditModal(false);
      setEditingInventoryId(null);
      setError('');
    } catch (err) {
      setError('Failed to save inventory');
    }
  };

  const handleDeleteInventory = (id: string) => {
    Alert.alert('Delete Ingredient', 'Are you sure you want to remove this ingredient from inventory?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        onPress: async () => {
          try {
            // Try deleting via API first
            try {
              await apiClient.deleteIngredient(id);
              console.log('✅ Ingredient deleted via API');
              // Reload from API
              await loadInventory();
            } catch (apiErr) {
              console.error('API error, falling back to AsyncStorage:', apiErr);
              // Fallback to AsyncStorage
              const updated = inventory.filter(item => item.id !== id);
              // Persist fallback deletion to cache
              await safeSetJSON('inventory', updated);
              setInventory(updated);
            }
          } catch (err) {
            setError('Failed to delete ingredient');
          }
        },
      },
    ]);
  };

  const getStockStatus = (currentStock: number, fullStock: number) => {
    if (fullStock === 0) return '⚪'; // No target set
    const percentage = (currentStock / fullStock) * 100;
    if (percentage <= 25) return '🔴'; // Low stock
    if (percentage <= 75) return '🟡'; // Medium stock
    return '🟢'; // Full stock
  };

  const getLowStockItems = () => {
    return inventory.filter(item => {
      if (item.fullStock === 0) return false;
      const percentage = (item.currentStock / item.fullStock) * 100;
      return percentage <= 25;
    });
  };

  const getLowStockSummary = () => {
    const lowStockItems = getLowStockItems();
    if (lowStockItems.length === 0) return null;
    
    const summary = lowStockItems
      .map(item => {
        const percentage = Math.round((item.currentStock / item.fullStock) * 100);
        return `${item.name}: ${item.currentStock}/${item.fullStock} ${item.unit} (${percentage}%)`;
      })
      .join('\n');
    
    return summary;
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  const lowStockItems = getLowStockItems();
  const lowStockSummary = getLowStockSummary();

  return (
    <View style={styles.container}>
      {lowStockItems.length > 0 && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertIcon}>⚠️</Text>
          <View style={styles.alertContent}>
            <Text style={styles.alertTitle}>Low Stock Alert</Text>
            <Text style={styles.alertMessage}>{lowStockItems.length} item{lowStockItems.length > 1 ? 's' : ''} below 25%</Text>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (styles.content?.paddingBottom || 0) + insets.bottom + 12 }]} showsVerticalScrollIndicator={false}>
        {inventory.length === 0 ? (
          <View style={styles.emptyStateContainer}>
            <Text style={styles.emptyStateIcon}>📦</Text>
            <Text style={styles.emptyStateText}>No ingredients in inventory</Text>
            <Text style={styles.emptyStateSubText}>Add ingredients in Ingredient Management first</Text>
          </View>
        ) : (
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.headerIngredient}>Ingredient</Text>
              <Text style={styles.headerStock}>Current / Full</Text>
              <Text style={styles.headerUnit}>Unit</Text>
              <Text style={styles.headerActions}>Actions</Text>
            </View>

            {inventory.map(item => {
              const displayUnit = getBestDisplayUnit(item.unit);
              const displayCurrentStock = convertFromBaseUnit(item.currentStock, displayUnit);
              const displayFullStock = convertFromBaseUnit(item.fullStock, displayUnit);

              return (
              <View key={item.id} style={styles.inventoryRow}>
                <View style={styles.ingredientCell}>
                  <Text style={styles.statusIcon}>{getStockStatus(item.currentStock, item.fullStock)}</Text>
                  <Text style={styles.ingredientName}>{item.name}</Text>
                </View>

                <View style={styles.stockCell}>
                  <Text style={styles.stockValue}>
                    {displayCurrentStock.toFixed(2)}/{displayFullStock.toFixed(2)}
                  </Text>
                </View>

                <View style={styles.unitCell}>
                  <Text style={styles.unitText}>{displayUnit}</Text>
                </View>

                <View style={styles.actionsCell}>
                  <TouchableOpacity
                    onPress={() => handleEditInventory(item)}
                    style={styles.actionBtn}
                  >
                    <Text style={styles.actionIcon}>✎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteInventory(item.id)}
                    style={styles.actionBtn}
                  >
                    <Text style={styles.actionIcon}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
            })}
          </View>
        )}
      </ScrollView>

      {/* Edit Inventory Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowEditModal(false);
          setEditingInventoryId(null);
          setError('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Inventory</Text>

            {/* Ingredient Name */}
            <Text style={styles.modalLabel}>Ingredient Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ingredient name"
              value={editingName}
              onChangeText={setEditingName}
              placeholderTextColor="#999"
              editable={false}
            />

            {/* Unit */}
            <Text style={styles.modalLabel}>Unit</Text>
            <Text style={styles.unitDisplayText}>{editingUnit}</Text>
            
            {/* Unit Conversion Info */}
            <Text style={styles.unitConversionInfo}>
              {getUnitGroup(editingUnit) === 'weight'
                ? '💡 Weight units: grams & kg are automatically consolidated'
                : getUnitGroup(editingUnit) === 'volume'
                ? '💡 Volume units: ml & liters are automatically consolidated'
                : ''}
            </Text>

            {/* Current Stock */}
            <View style={styles.stockInputContainer}>
              <View style={styles.stockInputField}>
                <Text style={styles.modalLabel}>Current Stock</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="0"
                  value={editingCurrentStock}
                  onChangeText={setEditingCurrentStock}
                  placeholderTextColor="#999"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.unitBadge}>
                <Text style={styles.unitBadgeText}>{editingDisplayUnit}</Text>
              </View>
            </View>

            {/* Full Stock */}
            <View style={styles.stockInputContainer}>
              <View style={styles.stockInputField}>
                <Text style={styles.modalLabel}>Full Stock</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="0"
                  value={editingFullStock}
                  onChangeText={setEditingFullStock}
                  placeholderTextColor="#999"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.unitBadge}>
                <Text style={styles.unitBadgeText}>{editingDisplayUnit}</Text>
              </View>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => {
                  setShowEditModal(false);
                  setEditingInventoryId(null);
                  setError('');
                }}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSaveInventory}
                style={styles.modalSubmitBtn}
              >
                <Text style={styles.modalSubmitBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyStateIcon: {
    fontSize: 64,
    marginBottom: 12,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptyStateSubText: {
    fontSize: 14,
    color: '#999',
  },
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  headerIngredient: {
    flex: 3,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  headerStock: {
    flex: 2,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  headerUnit: {
    flex: 1.5,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  headerActions: {
    flex: 1.5,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  inventoryRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#7c3aed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  ingredientCell: {
    flex: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  ingredientName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  stockCell: {
    flex: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stockValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  unitCell: {
    flex: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unitText: {
    fontSize: 12,
    color: '#666',
  },
  actionsCell: {
    flex: 1.5,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  actionBtn: {
    padding: 6,
    marginRight: 8,
  },
  actionIcon: {
    fontSize: 18,
    color: '#7c3aed',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '85%',
    maxWidth: 340,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 0,
    fontSize: 14,
    color: '#333',
  },
  unitDisplayText: {
    fontSize: 14,
    color: '#666',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 0,
  },
  unitConversionInfo: {
    fontSize: 11,
    color: '#7c3aed',
    fontStyle: 'italic',
    marginTop: 6,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#d32f2f',
    marginTop: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    marginRight: 12,
    marginTop: 20,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7c3aed',
    alignItems: 'center',
    marginRight: 12,
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7c3aed',
  },
  modalSubmitBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  alertBanner: {
    backgroundColor: '#fff3cd',
    borderBottomWidth: 2,
    borderBottomColor: '#ffc107',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  alertIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#856404',
    marginBottom: 2,
  },
  alertMessage: {
    fontSize: 12,
    color: '#856404',
  },
  stockInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  stockInputField: {
    flex: 1,
    marginRight: 8,
  },
  unitBadge: {
    backgroundColor: '#ede7f6',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#7c3aed',
    minWidth: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
  },
});
