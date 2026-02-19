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
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import apiClient from '../services/api';

type RootStackParamList = {
  Home: undefined;
  IngredientManagement: undefined;
};

type IngredientManagementScreenProps = NativeStackScreenProps<RootStackParamList, 'IngredientManagement'>;

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  quantityUsed: number;
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

const INGREDIENT_UNITS = ['pieces', 'grams', 'ml', 'liters', 'kg', 'cups', 'tablespoons', 'teaspoons'];

export const IngredientManagementScreen: React.FC<IngredientManagementScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddIngredientModal, setShowAddIngredientModal] = useState(false);
  const [ingredientName, setIngredientName] = useState('');
  const [ingredientUnit, setIngredientUnit] = useState('pieces');
  const [ingredientQuantity, setIngredientQuantity] = useState('');
  const [error, setError] = useState('');
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null);
  const [showUnitDropdown, setShowUnitDropdown] = useState(false);

  useEffect(() => {
    loadCategories();
  }, []);

  // Reload categories when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      console.log('IngredientManagementScreen focused - reloading categories');
      loadCategories();
    }, [])
  );

  const loadCategories = async () => {
    try {
      setLoading(true);
      
      // Try loading from backend API
      const response = await apiClient.listMenuItems();
      
      console.log('API Response for ingredients:', response);
      
      // Group menu items by category
      const categoryMap = new Map<string, MenuItem[]>();
      
      // Ensure response is an array
      const items = Array.isArray(response) ? response : [];
      
      items.forEach((item: any) => {
        const categoryName = item.category || 'Uncategorized';
        if (!categoryMap.has(categoryName)) {
          categoryMap.set(categoryName, []);
        }
        categoryMap.get(categoryName)!.push({
          id: item.id,
          name: item.name,
          price: item.price || 0,
          isVegetarian: item.is_veg || false,
          isEnabled: item.is_available !== false,
          ingredients: item.ingredients || [],
        });
      });

      // Convert map to array
      const loadedCategories = Array.from(categoryMap, ([name, items]) => ({
        id: name.replace(/\s+/g, '_').toLowerCase(),
        name,
        items,
      }));

      console.log('Loaded categories:', loadedCategories);
      
      setCategories(loadedCategories);
      
      // Save to AsyncStorage as backup
      await safeSetJSON('menuCategories', loadedCategories);
      
      setLoading(false);
    } catch (err) {
      console.error('Error loading menu from API:', err);
      // Fallback to AsyncStorage
      try {
        const stored = await getJSONOrDefault<MenuCategory[]>('menuCategories', []);
        if (Array.isArray(stored) && stored.length > 0) {
          setCategories(stored);
          console.log('Loaded categories from AsyncStorage');
        } else {
          console.log('No categories found in AsyncStorage');
        }
      } catch (storageErr) {
        console.error('Error loading from AsyncStorage:', storageErr);
      }
      setLoading(false);
    }
  };

  const saveCategories = async (updatedCategories: MenuCategory[]) => {
    try {
      await safeSetJSON('menuCategories', updatedCategories);
      setCategories(updatedCategories);
    } catch (err) {
      console.error('Error saving categories:', err);
      setError('Failed to save ingredients');
    }
  };

  // Helper function to update inventory when ingredient name changes
  const updateInventoryOnIngredientNameChange = async (
    oldIngredient: Ingredient,
    newIngredient: Ingredient
  ) => {
    try {
      let inventory = await getJSONOrDefault<any[]>('inventory', []);
      // Find and update inventory items with the old ingredient name
      inventory = inventory.map((item: any) => {
        if (
          item.name.toLowerCase() === oldIngredient.name.toLowerCase() &&
          item.unit === oldIngredient.unit
        ) {
          return {
            ...item,
            name: newIngredient.name,
            unit: newIngredient.unit,
          };
        }
        return item;
      });

      await safeSetJSON('inventory', inventory);
    } catch (err) {
      console.error('Error updating inventory:', err);
    }
  };

  // Helper function to remove ingredient from inventory
  const removeIngredientFromInventory = async (ingredient: Ingredient) => {
    try {
      let inventory = await getJSONOrDefault<any[]>('inventory', []);
      // Remove inventory items that match this ingredient
      // But only remove if this ingredient is no longer used anywhere else
      const allIngredients: Ingredient[] = [];
      categories.forEach(cat => {
        cat.items.forEach(item => {
          if (item.ingredients && item.ingredients.length > 0) {
            item.ingredients.forEach(ing => {
              if (ing.id !== ingredient.id) { // Exclude the one being deleted
                allIngredients.push(ing);
              }
            });
          }
        });
      });

      // Check if this ingredient is still used elsewhere (by name and unit)
      const stillUsed = allIngredients.some(
        ing =>
          ing.name.toLowerCase() === ingredient.name.toLowerCase() &&
          ing.unit === ingredient.unit
      );

      // Only remove from inventory if not used anywhere else
      if (!stillUsed) {
        inventory = inventory.filter(
          (item: any) =>
            !(
              item.name.toLowerCase() === ingredient.name.toLowerCase() &&
              item.unit === ingredient.unit
            )
        );

        await safeSetJSON('inventory', inventory);
      }
    } catch (err) {
      console.error('Error removing from inventory:', err);
    }
  };

  const handleAddIngredient = async () => {
    if (!ingredientName.trim()) {
      setError('Please enter ingredient name');
      return;
    }

    if (!ingredientQuantity.trim()) {
      setError('Please enter quantity used');
      return;
    }

    if (!selectedCategoryId || !selectedItemId) {
      setError('Category or item not selected');
      return;
    }

    const newIngredient: Ingredient = {
      id: Date.now().toString(),
      name: ingredientName.trim(),
      unit: ingredientUnit,
      quantityUsed: parseFloat(ingredientQuantity),
    };

    const updated = categories.map(cat => {
      if (cat.id === selectedCategoryId) {
        return {
          ...cat,
          items: cat.items.map(item => {
            if (item.id === selectedItemId) {
              return {
                ...item,
                ingredients: [...(item.ingredients || []), newIngredient],
              };
            }
            return item;
          }),
        };
      }
      return cat;
    });

    await saveCategories(updated);
    setIngredientName('');
    setIngredientUnit('pieces');
    setIngredientQuantity('');
    setShowAddIngredientModal(false);
    setError('');
  };

  const handleDeleteIngredient = (ingredientId: string) => {
    Alert.alert('Delete Ingredient', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        onPress: async () => {
          // Find the ingredient being deleted to get its details
          const selectedItem = categories
            .find(c => c.id === selectedCategoryId)
            ?.items.find(i => i.id === selectedItemId);
          
          const ingredientToDelete = selectedItem?.ingredients?.find(
            ing => ing.id === ingredientId
          );

          const updated = categories.map(cat => {
            if (cat.id === selectedCategoryId) {
              return {
                ...cat,
                items: cat.items.map(item => {
                  if (item.id === selectedItemId) {
                    return {
                      ...item,
                      ingredients: (item.ingredients || []).filter(ing => ing.id !== ingredientId),
                    };
                  }
                  return item;
                }),
              };
            }
            return cat;
          });
          
          await saveCategories(updated);

          // Remove from inventory if ingredient is not used elsewhere
          if (ingredientToDelete) {
            await removeIngredientFromInventory(ingredientToDelete);
          }
        },
      },
    ]);
  };

  const handleEditIngredient = (ingredient: Ingredient) => {
    setEditingIngredientId(ingredient.id);
    setIngredientName(ingredient.name);
    setIngredientUnit(ingredient.unit);
    setIngredientQuantity(ingredient.quantityUsed ? ingredient.quantityUsed.toString() : '');
    setShowAddIngredientModal(true);
  };

  const handleUpdateIngredient = async () => {
    if (!ingredientName.trim()) {
      setError('Please enter ingredient name');
      return;
    }

    if (!ingredientQuantity.trim()) {
      setError('Please enter quantity used');
      return;
    }

    // Find the old ingredient before updating
    const selectedItem = categories
      .find(c => c.id === selectedCategoryId)
      ?.items.find(i => i.id === selectedItemId);
    
    const oldIngredient = selectedItem?.ingredients?.find(
      ing => ing.id === editingIngredientId
    );

    const updated = categories.map(cat => {
      if (cat.id === selectedCategoryId) {
        return {
          ...cat,
          items: cat.items.map(item => {
            if (item.id === selectedItemId) {
              return {
                ...item,
                ingredients: (item.ingredients || []).map(ing => {
                  if (ing.id === editingIngredientId) {
                    return {
                      ...ing,
                      name: ingredientName.trim(),
                      unit: ingredientUnit,
                      quantityUsed: parseFloat(ingredientQuantity),
                    };
                  }
                  return ing;
                }),
              };
            }
            return item;
          }),
        };
      }
      return cat;
    });

    await saveCategories(updated);

    // Update inventory if ingredient name or unit changed
    if (oldIngredient && 
        (oldIngredient.name !== ingredientName.trim() || 
         oldIngredient.unit !== ingredientUnit)) {
      const newIngredient: Ingredient = {
        id: oldIngredient.id,
        name: ingredientName.trim(),
        unit: ingredientUnit,
        quantityUsed: parseFloat(ingredientQuantity),
      };
      await updateInventoryOnIngredientNameChange(oldIngredient, newIngredient);
    }

    setIngredientName('');
    setIngredientUnit('pieces');
    setIngredientQuantity('');
    setEditingIngredientId(null);
    setShowAddIngredientModal(false);
    setError('');
  };

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);
  const selectedItem = selectedCategory?.items.find(i => i.id === selectedItemId);
  const categoryItems = selectedCategory?.items || [];

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (styles.content?.paddingBottom || 0) + insets.bottom + 12 }]} showsVerticalScrollIndicator={false}>
        {/* Select Menu Category Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Menu Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoriesScroll}>
            <View style={styles.categoriesContainer}>
              {categories.length === 0 ? (
                <Text style={styles.emptyText}>No categories found</Text>
              ) : (
                categories.map(category => (
                  <TouchableOpacity
                    key={category.id}
                    onPress={() => {
                      setSelectedCategoryId(category.id);
                      setSelectedItemId(null); // Reset item selection
                    }}
                    style={[
                      styles.categoryCard,
                      selectedCategoryId === category.id && styles.categoryCardSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryCardText,
                        selectedCategoryId === category.id && styles.categoryCardTextSelected,
                      ]}
                    >
                      {category.name}
                    </Text>
                    <Text
                      style={[
                        styles.categoryCardSubtext,
                        selectedCategoryId === category.id && styles.categoryCardSubtextSelected,
                      ]}
                    >
                      Category
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </ScrollView>
        </View>

        {/* Select Menu Item Section */}
        {selectedCategory && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Menu Item</Text>
            {categoryItems.length === 0 ? (
              <Text style={styles.emptyText}>No items in this category</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.itemsScroll}
              >
                <View style={styles.itemsContainer}>
                  {categoryItems.map(item => (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => setSelectedItemId(item.id)}
                      style={[
                        styles.itemCard,
                        selectedItemId === item.id && styles.itemCardSelected,
                      ]}
                    >
                      <View style={styles.itemCardContent}>
                        <View style={styles.itemIconContainer}>
                          <Text style={styles.itemIcon}>{item.isVegetarian ? '🌱' : '🍖'}</Text>
                        </View>
                        <View style={styles.itemInfo}>
                          <Text
                            style={[
                              styles.itemName,
                              selectedItemId === item.id && styles.itemNameSelected,
                            ]}
                          >
                            {item.name}
                          </Text>
                          <Text
                            style={[
                              styles.itemPrice,
                              selectedItemId === item.id && styles.itemPriceSelected,
                            ]}
                          >
                            ₹{item.price.toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* Selected Item Display */}
        {selectedItem && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Selected Item</Text>
            <View style={styles.selectedItemCard}>
              <Text style={styles.selectedItemIcon}>{selectedItem.isVegetarian ? '🌱' : '🍖'}</Text>
              <View style={styles.selectedItemContent}>
                <Text style={styles.selectedItemName}>{selectedItem.name}</Text>
                <Text style={styles.selectedItemPrice}>₹{selectedItem.price.toFixed(2)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Ingredients Section */}
        {selectedItem && (
          <View style={styles.section}>
            <View style={styles.ingredientsHeader}>
              <Text style={styles.sectionTitle}>Ingredients</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditingIngredientId(null);
                  setIngredientName('');
                  setIngredientUnit('pieces');
                  setShowAddIngredientModal(true);
                }}
                style={styles.addIngredientHeaderBtn}
              >
                <Text style={styles.addIngredientHeaderBtnText}>+ ADD INGREDIENT</Text>
              </TouchableOpacity>
            </View>

            {(selectedItem.ingredients || []).length === 0 ? (
              <View style={styles.emptyIngredientsContainer}>
                <Text style={styles.emptyIngredientsIcon}>🥘</Text>
                <Text style={styles.emptyIngredientsText}>No ingredients added yet</Text>
              </View>
            ) : (
              <View style={styles.ingredientsList}>
                {(selectedItem.ingredients || []).map(ingredient => (
                  <View key={ingredient.id} style={styles.ingredientItem}>
                    <View style={styles.ingredientItemContent}>
                      <Text style={styles.ingredientItemName}>{ingredient.name}</Text>
                      <Text style={styles.ingredientItemUnit}>
                        {ingredient.quantityUsed} {ingredient.unit}
                      </Text>
                    </View>
                    <View style={styles.ingredientItemActions}>
                      <TouchableOpacity
                        onPress={() => handleEditIngredient(ingredient)}
                        style={styles.ingredientActionBtn}
                      >
                        <Text style={styles.ingredientActionText}>✎</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteIngredient(ingredient.id)}
                        style={styles.ingredientActionBtn}
                      >
                        <Text style={styles.ingredientActionText}>🗑</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Empty State */}
        {!selectedItem && (
          <View style={styles.emptyStateContainer}>
            <Text style={styles.emptyStateIcon}>🍽️</Text>
            <Text style={styles.emptyStateText}>Select a menu item to manage its ingredients</Text>
          </View>
        )}
      </ScrollView>

      {/* Add/Edit Ingredient Modal */}
      <Modal
        visible={showAddIngredientModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowAddIngredientModal(false);
          setIngredientName('');
          setIngredientUnit('pieces');
          setIngredientQuantity('');
          setEditingIngredientId(null);
          setError('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingIngredientId ? 'Edit Ingredient' : 'Add Ingredient'}
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ingredient name"
              value={ingredientName}
              onChangeText={setIngredientName}
              placeholderTextColor="#999"
            />

            <Text style={styles.unitLabel}>Unit</Text>
            <TouchableOpacity
              onPress={() => setShowUnitDropdown(!showUnitDropdown)}
              style={styles.dropdownButton}
            >
              <Text style={styles.dropdownButtonText}>{ingredientUnit}</Text>
              <Text style={styles.dropdownArrow}>{showUnitDropdown ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {showUnitDropdown && (
              <View style={styles.dropdownList}>
                <FlatList
                  data={INGREDIENT_UNITS}
                  keyExtractor={(item) => item}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      onPress={() => {
                        setIngredientUnit(item);
                        setShowUnitDropdown(false);
                      }}
                      style={[
                        styles.dropdownItem,
                        ingredientUnit === item && styles.dropdownItemSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          ingredientUnit === item && styles.dropdownItemTextSelected,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            <Text style={styles.unitLabel}>Quantity Used</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g., 50 for 50 grams"
              value={ingredientQuantity}
              onChangeText={setIngredientQuantity}
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => {
                  setShowAddIngredientModal(false);
                  setIngredientName('');
                  setIngredientUnit('pieces');
                  setIngredientQuantity('');
                  setEditingIngredientId(null);
                  setError('');
                }}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={editingIngredientId ? handleUpdateIngredient : handleAddIngredient}
                style={styles.modalSubmitBtn}
              >
                <Text style={styles.modalSubmitBtnText}>
                  {editingIngredientId ? 'Update' : 'Add'}
                </Text>
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7c3aed',
    marginBottom: 12,
  },
  categoriesScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  categoriesContainer: {
    flexDirection: 'row',
    marginRight: 12,
  },
  itemsScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  itemsContainer: {
    flexDirection: 'row',
    marginRight: 12,
  },
  categoryCard: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    minWidth: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryCardSelected: {
    borderColor: '#7c3aed',
    backgroundColor: '#f3e8ff',
  },
  categoryCardText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  categoryCardTextSelected: {
    color: '#7c3aed',
  },
  categoryCardSubtext: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  categoryCardSubtextSelected: {
    color: '#7c3aed',
  },
  itemCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    marginRight: 12,
    minWidth: 140,
  },
  itemCardSelected: {
    borderColor: '#7c3aed',
    backgroundColor: '#f3e8ff',
  },
  itemCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  itemIconContainer: {
    width: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemIcon: {
    fontSize: 24,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  itemNameSelected: {
    color: '#7c3aed',
  },
  itemPrice: {
    fontSize: 13,
    color: '#999',
  },
  itemPriceSelected: {
    color: '#7c3aed',
    fontWeight: '600',
  },
  selectedItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#7c3aed',
    backgroundColor: '#f3e8ff',
  },
  selectedItemIcon: {
    fontSize: 28,
  },
  selectedItemContent: {
    flex: 1,
  },
  selectedItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7c3aed',
    marginBottom: 2,
  },
  selectedItemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  ingredientsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addIngredientHeaderBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  addIngredientHeaderBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7c3aed',
  },
  emptyIngredientsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#f0f0f0',
    borderStyle: 'dashed',
  },
  emptyIngredientsIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyIngredientsText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  ingredientsList: {
    marginBottom: 10,
  },
  ingredientItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#7c3aed',
    marginBottom: 10,
  },
  ingredientItemContent: {
    flex: 1,
  },
  ingredientItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  ingredientItemUnit: {
    fontSize: 12,
    color: '#999',
  },
  ingredientItemActions: {
    flexDirection: 'row',
    marginRight: 12,
  },
  ingredientActionBtn: {
    padding: 6,
    marginRight: 12,
  },
  ingredientActionText: {
    fontSize: 18,
    color: '#7c3aed',
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
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
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
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    fontSize: 14,
    color: '#333',
  },
  unitLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  dropdownButtonText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: 'bold',
  },
  dropdownList: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: '#fff',
    maxHeight: 200,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dropdownItemSelected: {
    backgroundColor: '#ede7f6',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#666',
  },
  dropdownItemTextSelected: {
    color: '#7c3aed',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#d32f2f',
    marginBottom: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    marginRight: 12,
    marginTop: 16,
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
});
