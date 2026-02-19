import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Text,
  Switch,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import apiClient from '../services/api';

type RootStackParamList = {
  Home: undefined;
  AddMenuPricing: undefined;
};

type QuickAddMenuScreenProps = NativeStackScreenProps<RootStackParamList, 'AddMenuPricing'>;

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isVegetarian: boolean;
  isEnabled: boolean;
}

interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export const QuickAddMenuScreen: React.FC<QuickAddMenuScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemVegetarian, setNewItemVegetarian] = useState(false);
  const [error, setError] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemPrice, setEditItemPrice] = useState('');
  const [editItemVegetarian, setEditItemVegetarian] = useState(false);
  const [editItemEnabled, setEditItemEnabled] = useState(true);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  // Load categories from AsyncStorage on mount
  useEffect(() => {
    loadCategories();
  }, []);

  // Reload categories when screen is focused (to get fresh data from API)
  useFocusEffect(
    React.useCallback(() => {
      console.log('Screen focused - reloading categories');
      loadCategories();
    }, [])
  );

  // Debug: Log when editing state changes
  useEffect(() => {
    console.log('Editing Item ID:', editingItemId);
    console.log('Edit Item Name:', editItemName);
    console.log('Edit Item Price:', editItemPrice);
  }, [editingItemId, editItemName, editItemPrice]);

  const loadCategories = async () => {
    try {
      // Try loading from backend API
      const response = await apiClient.listMenuItems();
      
      console.log('Raw API Response:', JSON.stringify(response, null, 2));
      
      // Group menu items by category
      const categoryMap = new Map<string, MenuItem[]>();
      
      // Ensure response is an array
      const items = Array.isArray(response) ? response : [];
      
      console.log('Items array length:', items.length);
      console.log('First item:', items[0]);
      
      items.forEach((item: any, idx: number) => {
        console.log(`Item ${idx}:`, { 
          id: item.id, 
          name: item.name, 
          is_veg: item.is_veg,
          allKeys: Object.keys(item)
        });
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
        });
      });
      
      // Convert to categories array
      const loadedCategories: MenuCategory[] = Array.from(categoryMap.entries()).map(
        ([name, items]) => ({
          id: name.toLowerCase().replace(/\\s+/g, '-'),
          name,
          items,
        })
      );
      
      console.log('Loaded categories:', JSON.stringify(loadedCategories, null, 2));
      
      setCategories(loadedCategories);
      setLoading(false);
    } catch (err) {
      console.error('Error loading menu from API:', err);
      // Fallback to AsyncStorage
      try {
        // Fallback to cached categories
        const stored = await getJSONOrDefault<MenuCategory[]>('menuCategories', []);
        if (Array.isArray(stored) && stored.length > 0) setCategories(stored);
      } catch (storageErr) {
        console.error('Error loading from AsyncStorage:', storageErr);
      }
      setLoading(false);
    }
  };

  const saveCategories = async (updatedCategories: MenuCategory[]) => {
    try {
      // Persist categories cache
      await safeSetJSON('menuCategories', updatedCategories);
      setCategories(updatedCategories);
    } catch (err) {
      console.error('Error saving categories:', err);
      setError('Failed to save categories');
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      setError('Please enter a category name');
      return;
    }

    const categoryExists = categories.some(
      c => c.name.toLowerCase() === newCategoryName.toLowerCase()
    );
    if (categoryExists) {
      setError('Category already exists');
      return;
    }

    const newCategory: MenuCategory = {
      id: Date.now().toString(),
      name: newCategoryName.trim(),
      items: [],
    };

    const updated = [...categories, newCategory];
    await saveCategories(updated);
    setNewCategoryName('');
    setShowCategoryModal(false);
    setError('');
  };

  const handleAddItem = async () => {
    if (!selectedCategoryId || !newItemName.trim() || !newItemPrice.trim()) {
      setError('Please fill in all fields');
      return;
    }

    const price = parseFloat(newItemPrice);
    if (isNaN(price) || price < 0) {
      setError('Please enter a valid price');
      return;
    }

    try {
      // Get category name from selectedCategoryId
      const category = categories.find(c => c.id === selectedCategoryId);
      const categoryName = category?.name || 'Uncategorized';

      console.log('Creating menu item:', { newItemName, price, is_veg: newItemVegetarian, category: categoryName });

      // Create menu item via API
      const createdItem = await apiClient.createMenuItem({
        name: newItemName.trim(),
        price,
        is_veg: newItemVegetarian,
        is_available: true,
        category: categoryName,
      });

      console.log('✅ Menu item created successfully:', createdItem);

      // Handle both API response formats
      const itemPrice = createdItem.price || price;

      // Update local state
      const newItem: MenuItem = {
        id: createdItem.id,
        name: createdItem.name,
        price: typeof itemPrice === 'number' ? itemPrice : parseFloat(itemPrice),
        isVegetarian: createdItem.is_veg || false,
        isEnabled: createdItem.is_available !== false,
      };

      const updated = categories.map(cat => {
        if (cat.id === selectedCategoryId) {
          return { ...cat, items: [...cat.items, newItem] };
        }
        return cat;
      });

      setCategories(updated);
      
      // Also save to AsyncStorage as backup
      await saveCategories(updated);
      
      setNewItemName('');
      setNewItemPrice('');
      setNewItemVegetarian(false);
      setShowItemModal(false);
      setError('');
      
      // Reload fresh data from API after a short delay
      setTimeout(() => {
        loadCategories();
      }, 500);
    } catch (err) {
      console.error('❌ Error creating menu item:', err);
      setError('Failed to create menu item. Please try again.');
    }
  };

  const handleDeleteCategory = (categoryId: string) => {
    Alert.alert('Delete Category', 'Are you sure you want to delete this category and all its items?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Delete',
        onPress: async () => {
          try {
            console.log('Deleting category:', categoryId);
            
            // Get the category to access all its items
            const category = categories.find(c => c.id === categoryId);
            if (!category) return;

            console.log(`Deleting ${category.items.length} items in category "${category.name}"`);

            // Delete all items in this category via API
            for (const item of category.items) {
              try {
                await apiClient.deleteMenuItem(item.id);
                console.log(`✅ Deleted item: ${item.name}`);
              } catch (err) {
                console.error(`❌ Failed to delete item ${item.name}:`, err);
              }
            }

            // Update local state
            const updated = categories.filter(c => c.id !== categoryId);
            await saveCategories(updated);
            
            console.log('✅ Category deleted successfully');
          } catch (err) {
            console.error('❌ Error deleting category:', err);
            setError('Failed to delete category');
          }
        },
        style: 'destructive',
      },
    ]);
  };

  const handleToggleItemStatus = async (categoryId: string, itemId: string) => {
    try {
      // Find the item to get its current state
      const category = categories.find(c => c.id === categoryId);
      const item = category?.items.find(i => i.id === itemId);
      
      if (!item) return;

      console.log('Toggling item status:', itemId, 'current:', item.isEnabled);

      // Update via API
      await apiClient.updateMenuItem(itemId, {
        is_available: !item.isEnabled,
      });

      // Update local state
      const updated = categories.map(cat => {
        if (cat.id === categoryId) {
          return {
            ...cat,
            items: cat.items.map(it => {
              if (it.id === itemId) {
                return { ...it, isEnabled: !it.isEnabled };
              }
              return it;
            }),
          };
        }
        return cat;
      });
      
      setCategories(updated);
      await saveCategories(updated);
    } catch (err) {
      console.error('❌ Error toggling item status:', err);
      setError('Failed to update item status');
    }
  };

  const handleDeleteItem = (categoryId: string, itemId: string) => {
    Alert.alert('Delete Item', 'Are you sure you want to delete this item?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Delete',
        onPress: async () => {
          try {
            console.log('Deleting item:', itemId);
            
            // Delete via API first
            await apiClient.deleteMenuItem(itemId);
            
            // Then update local state
            const updated = categories.map(cat => {
              if (cat.id === categoryId) {
                return { ...cat, items: cat.items.filter(item => item.id !== itemId) };
              }
              return cat;
            });
            await saveCategories(updated);
            
            console.log('✅ Item deleted successfully');
          } catch (err) {
            console.error('❌ Error deleting item:', err);
            setError('Failed to delete item');
          }
        },
        style: 'destructive',
      },
    ]);
  };

  const handleEditCategory = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    if (category) {
      setEditingCategoryId(categoryId);
      setEditCategoryName(category.name);
      setShowCategoryModal(true);
    }
  };

  const handleSaveEditCategory = async () => {
    if (!editCategoryName.trim()) {
      setError('Please enter a category name');
      return;
    }

    const categoryExists = categories.some(
      c => c.id !== editingCategoryId && c.name.toLowerCase() === editCategoryName.toLowerCase()
    );
    if (categoryExists) {
      setError('Category already exists');
      return;
    }

    const updated = categories.map(cat => {
      if (cat.id === editingCategoryId) {
        return { ...cat, name: editCategoryName.trim() };
      }
      return cat;
    });

    await saveCategories(updated);
    setEditingCategoryId(null);
    setEditCategoryName('');
    setShowCategoryModal(false);
    setError('');
  };

  const handleEditItem = (categoryId: string, item: MenuItem) => {
    console.log('Opening edit for item:', item);
    setEditingItemId(item.id);
    setEditItemName(item.name);
    setEditItemPrice(item.price.toString());
    setEditItemVegetarian(item.isVegetarian);
    setEditItemEnabled(item.isEnabled);
    setSelectedCategoryId(categoryId);
    setShowItemModal(true);
  };

  const handleSaveEditItem = async () => {
    if (!selectedCategoryId || !editItemName.trim() || !editItemPrice.trim()) {
      setError('Please fill in all fields');
      return;
    }

    const price = parseFloat(editItemPrice);
    if (isNaN(price) || price < 0) {
      setError('Please enter a valid price');
      return;
    }

    try {
      console.log('Updating item:', editingItemId);

      // Update via API
      await apiClient.updateMenuItem(editingItemId!, {
        name: editItemName.trim(),
        price,
        is_veg: editItemVegetarian,
        is_available: editItemEnabled,
      });

      console.log('✅ Item updated successfully');

      // Update local state
      const updated = categories.map(cat => {
        if (cat.id === selectedCategoryId) {
          return {
            ...cat,
            items: cat.items.map(item => {
              if (item.id === editingItemId) {
                return {
                  ...item,
                  name: editItemName.trim(),
                  price,
                  isVegetarian: editItemVegetarian,
                  isEnabled: editItemEnabled,
                };
              }
              return item;
            }),
          };
        }
        return cat;
      });

      await saveCategories(updated);
      setEditingItemId(null);
      setEditItemName('');
      setEditItemPrice('');
      setEditItemVegetarian(false);
      setEditItemEnabled(true);
      setShowItemModal(false);
      setError('');
      
      // Reload fresh data from API
      setTimeout(() => {
        loadCategories();
      }, 500);
    } catch (err) {
      console.error('❌ Error updating item:', err);
      setError('Failed to update item. Please try again.');
    }
    setShowItemModal(false);
    setError('');
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (styles.content?.paddingBottom || 0) + insets.bottom + 12 }]}>
        {categories.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No categories yet</Text>
            <Text style={styles.emptySubText}>Add a category to get started</Text>
          </View>
        ) : (
          categories.map(category => (
            <View key={category.id} style={styles.categorySection}>
              <TouchableOpacity
                onPress={() => setExpandedCategoryId(expandedCategoryId === category.id ? null : category.id)}
                style={styles.categoryHeader}
              >
                <View style={styles.categoryHeaderLeft}>
                  <Text style={styles.expandIcon}>
                    {expandedCategoryId === category.id ? '▼' : '▶'}
                  </Text>
                  <Text style={styles.categoryTitle}>{category.name}</Text>
                </View>
                <View style={styles.categoryActionButtons}>
                  <TouchableOpacity
                    onPress={() => handleEditCategory(category.id)}
                    style={styles.iconButton}
                  >
                    <Text style={styles.iconText}>✎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteCategory(category.id)}
                    style={styles.iconButton}
                  >
                    <Text style={styles.iconText}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>

              {expandedCategoryId === category.id && (
                <>
                  {/* Types/Flavours Header */}
                  <View style={styles.typesFlavoursRow}>
                    <Text style={styles.typesFlavoursText}>Types / Flavours</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedCategoryId(category.id);
                        setShowItemModal(true);
                      }}
                      style={styles.typesFlavoursAddBtn}
                    >
                      <Text style={styles.typesFlavoursAddBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Items List */}
                  {category.items.length === 0 ? (
                    <Text style={styles.noItemsText}>No items yet</Text>
                  ) : (
                    category.items.map((item, index) => {
                      console.log(`Rendering item ${index}:`, item.name, 'isVeg:', item.isVegetarian);
                      return (
                        <View key={`${category.id}-${item.id}-${index}`} style={[styles.itemCard, !item.isEnabled && styles.itemCardDisabled]}>
                          <View style={styles.itemInfo}>
                            <Text style={styles.itemName} numberOfLines={2}>
                              {item.name || 'No name'}
                            </Text>
                            <View style={[styles.itemDetails]}>
                              <Text style={styles.itemPrice}>
                                ₹{(typeof item.price === 'number' ? item.price : parseFloat(item.price || 0)).toFixed(2)}
                              </Text>
                              {item.isVegetarian ? (
                                <View style={styles.vegBadge}>
                                  <Text style={styles.vegText}>🌱</Text>
                                </View>
                              ) : (
                                <View style={styles.nonVegBadge}>
                                  <Text style={styles.nonVegText}>🍖</Text>
                                </View>
                              )}
                            </View>
                          </View>
                          <View style={styles.itemActionButtons}>
                            <View style={styles.itemToggleContainer}>
                              <Switch
                                value={item.isEnabled}
                                onValueChange={() => handleToggleItemStatus(category.id, item.id)}
                                trackColor={{ false: '#7c3aed', true: '#7c3aed' }}
                                thumbColor={item.isEnabled ? '#4caf50' : '#fff'}
                              />
                            </View>
                            <TouchableOpacity
                              onPress={() => handleEditItem(category.id, item)}
                              style={styles.iconButton}
                            >
                              <Text style={styles.iconText}>✎</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleDeleteItem(category.id, item.id)}
                              style={styles.iconButton}
                            >
                              <Text style={styles.iconText}>🗑</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        onPress={() => setShowCategoryModal(true)}
        style={[styles.addCategoryBtn, { bottom: insets.bottom + 12 }]}
      >
        <Text style={styles.addCategoryBtnText}>+</Text>
      </TouchableOpacity>

      {/* Add Category Modal */}
      <Modal
        visible={showCategoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowCategoryModal(false);
          setEditingCategoryId(null);
          setEditCategoryName('');
          setError('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingCategoryId ? 'Edit Category' : 'Add New Category'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Category name (e.g., Appetizers)"
              value={editingCategoryId ? editCategoryName : newCategoryName}
              onChangeText={editingCategoryId ? setEditCategoryName : setNewCategoryName}
              placeholderTextColor="#999"
            />
            {error && showCategoryModal ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => {
                  setShowCategoryModal(false);
                  setEditingCategoryId(null);
                  setEditCategoryName('');
                  setError('');
                }}
                style={[styles.modalBtn, styles.cancelBtn]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={editingCategoryId ? handleSaveEditCategory : handleAddCategory}
                style={[styles.modalBtn, styles.confirmBtn]}
              >
                <Text style={styles.confirmBtnText}>{editingCategoryId ? 'Update' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Item Modal */}
      <Modal
        visible={showItemModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowItemModal(false);
          setEditingItemId(null);
          setEditItemName('');
          setEditItemPrice('');
          setEditItemVegetarian(false);
          setEditItemEnabled(true);
          setError('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingItemId ? 'Edit Menu Item' : 'Add Menu Item'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Item name"
              value={editingItemId ? editItemName : newItemName}
              onChangeText={editingItemId ? setEditItemName : setNewItemName}
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Price"
              value={editingItemId ? editItemPrice : newItemPrice}
              onChangeText={editingItemId ? setEditItemPrice : setNewItemPrice}
              keyboardType="decimal-pad"
              placeholderTextColor="#999"
            />
            <View style={styles.vegetarianToggle}>
              <Text style={styles.toggleLabel}>Vegetarian</Text>
              <Switch
                value={editingItemId ? editItemVegetarian : newItemVegetarian}
                onValueChange={(value) => {
                  if (editingItemId) {
                    setEditItemVegetarian(value);
                  } else {
                    setNewItemVegetarian(value);
                  }
                }}
                trackColor={{ false: '#767577', true: '#7c3aed' }}
              />
            </View>
            {editingItemId && (
              <View style={styles.vegetarianToggle}>
                <Text style={styles.toggleLabel}>Available</Text>
                <Switch
                  value={editItemEnabled}
                  onValueChange={setEditItemEnabled}
                  trackColor={{ false: '#767577', true: '#7c3aed' }}
                />
              </View>
            )}
            {error && showItemModal ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => {
                  setShowItemModal(false);
                  setEditingItemId(null);
                  setEditItemName('');
                  setEditItemPrice('');
                  setEditItemVegetarian(false);
                  setEditItemEnabled(true);
                  setError('');
                }}
                style={[styles.modalBtn, styles.cancelBtn]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={editingItemId ? handleSaveEditItem : handleAddItem}
                style={[styles.modalBtn, styles.confirmBtn]}
              >
                <Text style={styles.confirmBtnText}>{editingItemId ? 'Update' : 'Add Item'}</Text>
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
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 14,
    color: '#999',
  },
  categorySection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  categoryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  expandIcon: {
    fontSize: 12,
    color: '#7c3aed',
    marginRight: 10,
    fontWeight: 'bold',
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  categoryActionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    padding: 4,
  },
  iconButtonDisabled: {
    opacity: 0.5,
  },
  iconText: {
    fontSize: 18,
    color: '#757575',
    fontWeight: 'bold',
  },
  iconTextDisabled: {
    color: '#bdbdbd',
  },
  noItemsText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  itemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#7c3aed',
  },
  itemCardDisabled: {
    backgroundColor: '#f5f5f5',
    borderLeftColor: '#bdbdbd',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  itemNameDisabled: {
    color: '#999',
    textDecorationLine: 'line-through',
  },
  itemDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemDetailsDisabled: {
    opacity: 0.5,
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  itemPriceDisabled: {
    color: '#bdbdbd',
  },
  vegBadge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  vegText: {
    fontSize: 14,
    fontWeight: '500',
  },
  vegBadgeDisabled: {
    opacity: 0.5,
  },
  nonVegBadge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  nonVegText: {
    fontSize: 14,
    fontWeight: '500',
  },
  nonVegBadgeDisabled: {
    opacity: 0.5,
  },
  itemToggleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActionButtons: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  toggleStatusBtn: {
    padding: 4,
  },
  toggleStatusText: {
    fontSize: 16,
    color: '#757575',
    fontWeight: 'bold',
  },
  itemDeleteBtn: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffebee',
    borderRadius: 14,
  },
  typesFlavoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  typesFlavoursText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  typesFlavoursAddBtn: {
    padding: 4,
  },
  typesFlavoursAddBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  addItemBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    alignItems: 'center',
  },
  addItemBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  addCategoryBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.27,
    shadowRadius: 4.65,
    elevation: 6,
  },
  addCategoryBtnText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 30,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
    color: '#333',
  },
  vegetarianToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  errorText: {
    fontSize: 12,
    color: '#d32f2f',
    marginBottom: 12,
    fontWeight: '500',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: '#e0e0e0',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  confirmBtn: {
    backgroundColor: '#7c3aed',
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});