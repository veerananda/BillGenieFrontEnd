import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Text,
  Modal,
  ActivityIndicator,
  Dimensions,
  FlatList,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import { processOrderForInventoryDeduction, isLowStock, getStockWarningLevel } from '../utils/InventoryUtils';
import { getNextOrderNumber } from '../utils/OrderNumberUtils';
import { apiClient, RestaurantProfile, RestaurantTable } from '../services/api';
import { useAppDispatch } from '../store/hooks';
import { addOrder } from '../store/ordersSlice';
import { setTableOccupied } from '../store/tablesSlice';

type RootStackParamList = {
  Orders: undefined;
  TakeOrder: { orderId?: string; tableId?: string; tableName?: string };
};

type TakeOrderScreenProps = NativeStackScreenProps<RootStackParamList, 'TakeOrder'>;

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  quantityUsed?: number;
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

type ItemStatus = 'pending' | 'cooking' | 'ready' | 'served';

interface OrderItem {
  id: string; // Unique order item ID
  menuItemId?: string; // Reference to menu item
  name: string;
  price: number;
  quantity: number;
  isVegetarian: boolean;
  status?: ItemStatus;
  statusUpdatedAt?: number;
  subId?: string; // Unique identifier for each quantity batch
}

interface Order {
  id: string;
  tableNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  createdAt: number;
  savedAt?: number;
  status: 'pending' | 'completed';
  orderNumber?: number; // Optional order number for self-service
  isSelfService?: boolean;
  ingredientsDeducted?: boolean;
  deductedItems?: string[]; // Track which item IDs have been deducted
  previousDeductedQuantities?: { [key: string]: number }; // Track quantities already deducted per item
  tableId?: string; // Optional table id for dine-in orders
}

export const TakeOrderScreen: React.FC<TakeOrderScreenProps> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const orderId = route.params?.orderId;
  console.log('🎯 TakeOrderScreen mounted with params:', { 
    orderId, 
    tableId: route.params?.tableId,
    tableName: route.params?.tableName,
    allParams: JSON.stringify(route.params)
  });
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCategoryItemsModal, setShowCategoryItemsModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<MenuCategory | null>(null);
  const [categoryItemQuantities, setCategoryItemQuantities] = useState<{ [key: string]: number }>({});
  const [error, setError] = useState('');
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [initialState, setInitialState] = useState<{ table: string; customer: string; items: OrderItem[] } | null>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation]);

  // Check if there are changes
  useEffect(() => {
    if (!initialState) {
      console.log('⏳ Initial state not set yet, hasChanges = false');
      setHasChanges(false);
      return;
    }

    const tableChanged = tableNumber !== initialState.table;
    const customerChanged = customerName !== initialState.customer;
    
    // Deep compare items - normalize by comparing key properties only
    const normalizeItem = (item: OrderItem) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      isVegetarian: item.isVegetarian,
    });
    
    const currentItemsNormalized = orderItems.map(normalizeItem);
    const initialItemsNormalized = initialState.items.map(normalizeItem);
    const itemsChanged = JSON.stringify(currentItemsNormalized) !== JSON.stringify(initialItemsNormalized);

    const changed = tableChanged || customerChanged || itemsChanged;

    console.log('🔍 hasChanges check:', {
      tableChanged,
      customerChanged,
      itemsChanged,
      changed,
      currentTable: tableNumber,
      initialTable: initialState.table,
      currentCustomer: customerName,
      initialCustomer: initialState.customer,
      currentItemsCount: orderItems.length,
      initialItemsCount: initialState.items.length,
      currentItemsNormalized: JSON.stringify(currentItemsNormalized),
      initialItemsNormalized: JSON.stringify(initialItemsNormalized),
    });
    
    setHasChanges(changed);
  }, [tableNumber, customerName, orderItems, initialState]);

  // Check for orders that need inventory deduction (2-minute delay after saving)
  useEffect(() => {
    const checkAndDeductInventory = async () => {
      try {
        // Read cached orders safely as a fallback when API calls fail
        const orders = await getJSONOrDefault<any[]>('orders', []);

        const currentTime = Date.now();
        const TWO_MINUTES = 2 * 60 * 1000;

        console.log(`🔍 Checking ${orders.length} orders for inventory deduction...`);

        let ordersUpdated = false;

        for (let i = 0; i < orders.length; i++) {
          const order = orders[i];
          
          // Check if order needs deduction
          if (order.savedAt) {
            const timeSinceCreation = currentTime - order.savedAt;
            const timeRemainingSeconds = Math.ceil((TWO_MINUTES - timeSinceCreation) / 1000);

            if (!order.ingredientsDeducted && timeSinceCreation >= TWO_MINUTES) {
              console.log(`⏰ Order ${order.id} is ready for deduction (${(timeSinceCreation / 1000 / 60).toFixed(2)} mins old)`);

              // Process inventory deduction
              const success = await processOrderForInventoryDeduction(order);

              if (success) {
                // Update the order object with deduction info
                orders[i] = {
                  ...order,
                  ingredientsDeducted: true,
                  deductedItems: order.deductedItems || [],
                  previousDeductedQuantities: order.previousDeductedQuantities || {},
                };
                ordersUpdated = true;
                console.log(`✅ Inventory deducted for order ${order.id}`);
              } else {
                console.warn(`⚠️ Failed to deduct inventory for order ${order.id}`);
              }
            } else if (!order.ingredientsDeducted && timeRemainingSeconds > 0) {
              console.log(`⏳ Order ${order.id} will be deducted in ${timeRemainingSeconds}s`);
            }
          }
        }

        // Save updated orders if any were modified
        if (ordersUpdated) {
          // Persist updated orders back to storage in a safe way
          await safeSetJSON('orders', orders);
          console.log(`💾 Orders saved to AsyncStorage`);
        }
      } catch (error) {
        console.error('Error checking inventory deduction:', error);
      }
    };

    // Run check every 10 seconds
    const interval = setInterval(checkAndDeductInventory, 10000);

    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Load restaurant profile to check if dine-in mode
      try {
        const restaurantProfile = await apiClient.getRestaurantProfile();
        setProfile(restaurantProfile);
        
        // If in dine-in mode, load tables
        if (!restaurantProfile.is_self_service) {
          const restaurantTables = await apiClient.getTables();
          setTables(restaurantTables);
        }
      } catch (profileErr) {
        console.error('Error loading profile:', profileErr);
      }

      // Load categories from API
      try {
        const menuItems = await apiClient.listMenuItems();
        // Group menu items by category
        const categoryMap = new Map<string, any[]>();
        
        menuItems.forEach((item: any) => {
          const categoryName = item.category || 'Uncategorized';
          if (!categoryMap.has(categoryName)) {
            categoryMap.set(categoryName, []);
          }
          categoryMap.get(categoryName)!.push({
            id: item.id,
            name: item.name,
            price: item.price,
            isVegetarian: item.is_veg || false,
            isEnabled: item.is_available !== false,
          });
        });
        
        const loadedCategories: MenuCategory[] = Array.from(categoryMap.entries()).map(
          ([name, items]) => ({
            id: name.toLowerCase().replace(/\s+/g, '-'),
            name,
            items,
          })
        );
        
        setCategories(loadedCategories);
      } catch (apiErr) {
        console.error('Error loading menu from API, falling back to AsyncStorage:', apiErr);
        // Fallback to cached categories
        const cachedCategories = await getJSONOrDefault<MenuCategory[]>('menuCategories', []);
        if (Array.isArray(cachedCategories) && cachedCategories.length > 0) {
          setCategories(cachedCategories);
        }
      }

      // Load inventory from cache (or API if needed)
      try {
        const inventoryStored = await getJSONOrDefault<any[]>('inventory_cache', []);
        if (Array.isArray(inventoryStored) && inventoryStored.length > 0) setInventory(inventoryStored);
      } catch (err) {
        console.error('Error loading inventory cache:', err);
      }

      // Load all orders from API (not AsyncStorage)
      try {
        console.log('📋 Fetching all orders from API...');
        const response = await apiClient.listOrders();
        const orders = response.orders || [];
        console.log('✅ Loaded', orders.length, 'orders from API');
        setAllOrders(orders);
        
        // Cache for offline access
        await safeSetJSON('orders_cache', orders);
      } catch (apiErr) {
        console.error('❌ Failed to fetch orders from API:', apiErr);
        // Fallback to cached orders if offline
        try {
          // Fallback to cached orders
          const cached = await getJSONOrDefault<any[]>('orders_cache', []);
          if (Array.isArray(cached) && cached.length > 0) {
            console.log('📦 Using cached orders:', cached.length);
            setAllOrders(cached);
          }
        } catch (cacheErr) {
          console.error('Error loading orders cache:', cacheErr);
          setAllOrders([]);
        }
      }

      // If pre-filled table is passed (from table click), use it
      if (route.params?.tableName && !orderId) {
        console.log('🪑 Pre-filling table:', route.params.tableName);
        setTableNumber(route.params.tableName);
        setSelectedTableId(route.params.tableId || null);
        setOrderItems([]);
        setInitialState({
          table: route.params.tableName,
          customer: '',
          items: [],
        });
      } else if (orderId) {
        // If editing existing order, fetch from API
        console.log('📋 Loading existing order with ID:', orderId);
        try {
          const apiOrder = await apiClient.getOrder(orderId);
          console.log('✅ Order fetched from API:', JSON.stringify(apiOrder, null, 2));
          
          // Transform API order to local format
          const transformedItems = (apiOrder.items || []).map((item: any) => {
            console.log('🔍 Transforming item:', JSON.stringify(item, null, 2));
            const itemName = item.menu_item?.name || item.name || 'Unknown Item';
            console.log('✅ Item name resolved to:', itemName);
            return {
              id: item.menu_id || item.id,
              menuItemId: item.menu_id,
              name: itemName,
              price: item.unit_rate || 0,
              quantity: item.quantity,
              isVegetarian: item.menu_item?.is_vegetarian || false,
              status: item.status || 'pending',
            };
          });
          console.log('📦 Transformed items:', JSON.stringify(transformedItems, null, 2));
          
          const order = {
            id: apiOrder.id,
            tableNumber: String(apiOrder.table_number || ''),
            customerName: apiOrder.customer_name || '',
            items: transformedItems,
            totalAmount: apiOrder.total || 0,
            createdAt: new Date(apiOrder.created_at).getTime(),
            status: apiOrder.status === 'completed' ? 'completed' : 'pending',
            savedAt: Date.now(),
          };
          console.log('📦 Transformed order:', JSON.stringify(order, null, 2));
          
          // Set selectedTableId from the order's table_id so table selector won't appear
          if (apiOrder.table_id) {
            console.log('🪑 Setting selectedTableId from order:', apiOrder.table_id);
            setSelectedTableId(apiOrder.table_id);
          }
          
          console.log('📋 Loading existing order - Table:', order.tableNumber, 'Items:', order.items.length);
          setTableNumber(order.tableNumber);
          setCustomerName(order.customerName);
          
          // Merge items by ID for display in TakeOrderScreen (single line per item)
          const mergedItems: { [key: string]: OrderItem } = {};
          order.items.forEach((item: OrderItem) => {
            console.log('🔄 Processing item:', item.id, 'name:', item.name, 'qty:', item.quantity);
            // Use menuItemId as key to group same menu items
            const itemKey = item.menuItemId || item.id;
            if (mergedItems[itemKey]) {
              // Same menu item - add quantities
              mergedItems[itemKey].quantity += item.quantity;
            } else {
              // First occurrence - create entry
              mergedItems[itemKey] = { 
                ...item,
                id: itemKey, // Use menuItemId as id for consistency
              };
            }
          });
          
          const mergedItemsArray = Object.values(mergedItems);
          console.log('✅ Merged items for display:', JSON.stringify(mergedItemsArray, null, 2));
          setOrderItems(mergedItemsArray);
          setInitialState({
            table: order.tableNumber,
            customer: order.customerName,
            items: mergedItemsArray, // Store merged items to match orderItems format for comparison
          });
        } catch (apiErr) {
          console.error('❌ Failed to fetch order from API:', apiErr);
          // Order not found
          setError('Order not found');
          setLoading(false);
          return;
        }
      } else {
        // For new order, set initial state to empty
        setTableNumber('');
        setCustomerName('');
        setOrderItems([]);
        setInitialState({
          table: '',
          customer: '',
          items: [],
        });
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setLoading(false);
    }
  };

  const validateTableNumber = (tableNum: string): boolean => {
    if (!tableNum.trim()) {
      return false;
    }

    // Check if table exists (excluding current order being edited)
    const tableExists = allOrders.some((o: any) => 
      o.tableNumber === tableNum.trim() && o.id !== orderId
    );

    if (tableExists) {
      setError('Table already exists');
      return false;
    }
    setError('');
    return true;
  };

  const handleTableNumberChange = (text: string) => {
    setTableNumber(text);
    if (text.trim()) {
      validateTableNumber(text);
    } else {
      setError('');
    }
  };

  // Check if menu item has low stock
  const checkMenuItemLowStock = (menuItem: MenuItem): boolean => {
    if (!menuItem.ingredients || menuItem.ingredients.length === 0) {
      return false;
    }

    // Check if any ingredient has low stock
    for (const ingredient of menuItem.ingredients) {
      const inventoryItem = inventory.find(
        (inv: any) => inv.name.toLowerCase() === ingredient.name.toLowerCase()
      );

      if (inventoryItem) {
        if (isLowStock(inventoryItem.currentStock, inventoryItem.fullStock)) {
          return true;
        }
      }
    }

    return false;
  };

  // Get warning level for menu item
  const getMenuItemWarningLevel = (menuItem: MenuItem): 'GREEN' | 'YELLOW' | 'RED' => {
    if (!menuItem.ingredients || menuItem.ingredients.length === 0) {
      return 'GREEN';
    }

    let worstLevel: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

    for (const ingredient of menuItem.ingredients) {
      const inventoryItem = inventory.find(
        (inv: any) => inv.name.toLowerCase() === ingredient.name.toLowerCase()
      );

      if (inventoryItem) {
        const level = getStockWarningLevel(inventoryItem.currentStock, inventoryItem.fullStock);
        if (level === 'RED') {
          worstLevel = 'RED';
        } else if (level === 'YELLOW' && worstLevel !== 'RED') {
          worstLevel = 'YELLOW';
        }
      }
    }

    return worstLevel;
  };

  const openCategoryModal = (category: MenuCategory) => {
    setSelectedCategory(category);
    setCategoryItemQuantities({});
    setShowCategoryItemsModal(true);
  };

  const closeCategoryModal = () => {
    setShowCategoryItemsModal(false);
    setSelectedCategory(null);
    setCategoryItemQuantities({});
  };

  const handleCategoryItemQuantityChange = (itemId: string, delta: number) => {
    setCategoryItemQuantities(prev => {
      const currentQty = prev[itemId] || 0;
      const newQty = Math.max(0, currentQty + delta);
      if (newQty === 0) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: newQty };
    });
  };

  const handleCloseCategoryModal = () => {
    if (!selectedCategory) {
      closeCategoryModal();
      return;
    }

    // Get items that have quantity > 0
    const itemsToAdd = selectedCategory.items.filter(item => {
      const qty = categoryItemQuantities[item.id];
      return qty && qty > 0 && item.isEnabled;
    });

    console.log('Items to add from category:', itemsToAdd.length, itemsToAdd);

    // Add or update items in order
    if (itemsToAdd.length > 0) {
      const updatedOrderItems = [...orderItems];
      
      itemsToAdd.forEach(item => {
        const qtyToAdd = categoryItemQuantities[item.id];
        
        // Check if this menu item already exists in the order (by menuItemId or id)
        const existingIndex = updatedOrderItems.findIndex(
          oi => oi.menuItemId === item.id || oi.id === item.id
        );
        
        if (existingIndex !== -1) {
          // Item exists - increment quantity
          updatedOrderItems[existingIndex] = {
            ...updatedOrderItems[existingIndex],
            quantity: updatedOrderItems[existingIndex].quantity + qtyToAdd
          };
        } else {
          // New item - add to order
          updatedOrderItems.push({
            id: item.id, // Use menu item ID as order item ID
            name: item.name,
            price: item.price,
            quantity: qtyToAdd,
            isVegetarian: item.isVegetarian,
            menuItemId: item.id, // Keep reference to menu item
          });
        }
      });

      console.log('Updated items:', updatedOrderItems);
      setOrderItems(updatedOrderItems);
    } else {
      console.log('No items to add');
    }

    closeCategoryModal();
  };

  const handleRemoveItem = (itemId: string) => {
    setOrderItems(orderItems.filter(oi => oi.id !== itemId));
  };

  const handleQuantityChange = (itemId: string, delta: number) => {
    const updatedItems = orderItems
      .map(oi => {
        if (oi.id === itemId) {
          const newQty = oi.quantity + delta;
          return newQty > 0 ? { ...oi, quantity: newQty } : null;
        }
        return oi;
      })
      .filter((item): item is OrderItem => item !== null);
    
    setOrderItems(updatedItems);
  };

  const calculateTotal = () => {
    return orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const handleSaveOrder = async () => {
    if (!tableNumber.trim()) {
      setError('Please enter table number');
      return;
    }

    if (!validateTableNumber(tableNumber)) {
      return;
    }

    if (orderItems.length === 0) {
      setError('Please add at least one item');
      return;
    }

    // If in dine-in mode (not self-service) and no table selected yet, show table selector
    if (profile && !profile.is_self_service && !selectedTableId) {
      setShowTableSelector(true);
      return;
    }

    try {
      // If it's a new order (no orderId), use the API
      if (!orderId) {
        try {
          // Create order via API
          const orderRequest: any = {
            table_number: tableNumber.trim(),
            customer_name: customerName.trim() || undefined,
            items: orderItems.map(item => ({
              menu_item_id: item.menuItemId || item.id,
              quantity: item.quantity,
              notes: '',
            })),
            notes: '',
          };

          // Add table_id if in dine-in mode and table selected
          console.log('🔍 DINE-IN CHECK:', {
            profile_exists: !!profile,
            is_self_service: profile?.is_self_service,
            selectedTableId: selectedTableId,
            should_add_table_id: profile && !profile.is_self_service && selectedTableId,
          });
          
          if (profile && !profile.is_self_service && selectedTableId) {
            orderRequest.table_id = selectedTableId;
            console.log('✅ Added table_id to request:', selectedTableId);
          } else if (profile?.is_self_service) {
            // For self-service mode, add order_number instead of table_id
            const orderNumber = await getNextOrderNumber();
            orderRequest.order_number = orderNumber;
            console.log('✅ Added order_number to request for self-service:', orderNumber);
          } else {
            console.log('⚠️ Not adding table_id or order_number');
          }

          console.log('🔵 Creating order via API:', JSON.stringify(orderRequest, null, 2));
          const createdOrder = await apiClient.createOrder(orderRequest);
          console.log('✅ Order created response:', JSON.stringify(createdOrder, null, 2));
          console.log('✅ Order ID:', createdOrder?.id);
          
          // Add order to Redux immediately so it appears in OrdersScreen
          if (createdOrder?.id) {
            // Prefer API-provided order_number, then request order_number, then parse table_number as numeric
            const resolvedOrderNumber =
              createdOrder.order_number ?? orderRequest.order_number ??
              (createdOrder.table_number && /^\d+$/.test(String(createdOrder.table_number)) ? parseInt(String(createdOrder.table_number), 10) : undefined);

            const tableIdForOccupancy = (createdOrder as any)?.table_id || (createdOrder as any)?.tableId || selectedTableId;

            const reduxOrder: any = {
              id: createdOrder.id,
              orderNumber: resolvedOrderNumber,
              tableNumber: String(createdOrder.table_number || tableNumber.trim()),
              isSelfService: (createdOrder as any).is_self_service || (String(createdOrder.table_id || '').startsWith('self-service')) || profile?.is_self_service || false,
              customerName: customerName.trim() || '',
              items: (createdOrder.items || orderItems).map((item: any) => ({
                id: item.id || item.menuItemId,
                name: item.name || item.menu_item?.name || 'Unknown Item',
                price: item.unit_rate || item.price || 0,
                quantity: item.quantity,
                isVegetarian: item.is_vegetarian || item.isVegetarian || false,
                status: item.status || 'pending',
                statusUpdatedAt: Date.now(),
              })),
              totalAmount: createdOrder.total || 0,
              createdAt: Date.now(),
              status: 'pending',
              tableId: tableIdForOccupancy ?? undefined,
            };
            console.log('📝 Dispatching new order to Redux:', reduxOrder);
            dispatch(addOrder(reduxOrder));
            
            // If dine-in mode, mark table as occupied locally (Redux) immediately
            if (profile && !profile.is_self_service && tableIdForOccupancy) {
              try {
                dispatch(setTableOccupied({ tableId: tableIdForOccupancy, isOccupied: true }));
                console.log('🔴 Marked table occupied in Redux (immediate):', tableIdForOccupancy);
              } catch (e) {
                console.warn('⚠️ Failed to mark table occupied in Redux:', e);
              }
            }
          }
          
          // If dine-in mode, mark table as occupied
          console.log('🔍 TABLE OCCUPANCY CHECK:', {
            profile_exists: !!profile,
            is_self_service: profile?.is_self_service,
            selectedTableId_exists: !!selectedTableId,
            selectedTableId_value: selectedTableId,
            createdOrder_id: createdOrder?.id,
            condition_result: !!(profile && !profile.is_self_service && selectedTableId && createdOrder?.id),
          });
          
          const tableIdForOccupancy2 = (createdOrder as any)?.table_id || selectedTableId;
          if (profile && !profile.is_self_service && tableIdForOccupancy2 && createdOrder?.id) {
            try {
              console.log('🔴 [CALLING] setTableOccupied with:', { tableId: tableIdForOccupancy2, orderId: createdOrder.id });
              await apiClient.setTableOccupied(tableIdForOccupancy2, createdOrder.id);
              console.log('✅ Table marked as occupied');
              // Wait a moment for backend to persist
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (tableErr) {
              console.error('❌ Error marking table as occupied:', tableErr);
            }
          } else {
            console.log('⚠️ SKIPPED: setTableOccupied call - condition failed');
          }
          
          navigation.goBack();
          return;
        } catch (apiErr) {
          console.error('❌ Error creating order via API:', apiErr);
          setError('Backend unavailable, saving locally...');
          // Fall through to AsyncStorage save below
        }
      }

      // For editing existing orders
      if (orderId) {
        try {
          console.log('✏️ Updating existing order via API:', orderId);
          
          // Calculate only the NEW items being added (not existing ones)
          const newItems: any[] = [];
          
          if (initialState && initialState.items.length > 0) {
            // Create a map of initial items by menuItemId with their quantities
            const initialItemsMap = new Map<string, number>();
            initialState.items.forEach(item => {
              const key = item.menuItemId || item.id;
              initialItemsMap.set(key, (initialItemsMap.get(key) || 0) + item.quantity);
            });
            
            // For each current item, if quantity increased, add only the delta
            orderItems.forEach(item => {
              const key = item.menuItemId || item.id;
              const initialQty = initialItemsMap.get(key) || 0;
              const currentQty = item.quantity;
              
              if (currentQty > initialQty) {
                // New quantity is higher - add only the difference
                const qtyToAdd = currentQty - initialQty;
                console.log(`📦 Adding ${qtyToAdd} new units of ${item.name} (was ${initialQty}, now ${currentQty})`);
                newItems.push({
                  menu_item_id: key,
                  quantity: qtyToAdd,
                  notes: '',
                });
              }
            });
          } else {
            // No initial items, so all current items are new
            console.log('📦 All items are new (no previous items)');
            newItems.push(...orderItems.map(item => ({
              menu_item_id: item.menuItemId || item.id,
              quantity: item.quantity,
              notes: '',
            })));
          }
          
          console.log('📋 Sending new items to API:', JSON.stringify(newItems, null, 2));
          
          // Update order via API
          const updateRequest: any = {
            table_number: tableNumber.trim(),
            customer_name: customerName.trim() || undefined,
            items: newItems,
            notes: '',
          };
          
          await apiClient.updateOrder(orderId, updateRequest);
          console.log('✅ Order updated via API');
          navigation.goBack();
          return;
        } catch (apiErr) {
          console.error('❌ Error updating order via API:', apiErr);
          setError('Failed to update order via API');
          return;
        }
      }

      // For new orders, fallback to AsyncStorage if API failed earlier
      // Note: This is only reached if API creation failed above
      // Read cached orders for offline save
      let orders = await getJSONOrDefault<any[]>('orders_cache', []);

      // Find existing order if editing
      const existingOrder = orders.find((o: any) => o.id === orderId);

      let finalItems: OrderItem[] = [];

      if (existingOrder && orderId) {
        // Editing existing order - need to handle incremental quantities
        const existingItemsMap = new Map<string, any[]>();
        
        // Group existing items by menu item id
        existingOrder.items.forEach((item: any) => {
          if (!existingItemsMap.has(item.id)) {
            existingItemsMap.set(item.id, []);
          }
          existingItemsMap.get(item.id)!.push(item);
        });

        // Process current order items
        orderItems.forEach((currentItem) => {
          const existingEntries = existingItemsMap.get(currentItem.id) || [];
          const totalExistingQty = existingEntries.reduce((sum, ei) => sum + (ei.quantity || 0), 0);
          const currentQty = currentItem.quantity;

          // Keep all existing entries as-is
          finalItems.push(...existingEntries);

          // If current quantity is greater than existing total, add to pending items
          if (currentQty > totalExistingQty) {
            const newQty = currentQty - totalExistingQty;
            
            // Check if there's already a pending entry for this item
            const pendingEntry = existingEntries.find((e: any) => e.status === 'pending');
            
            if (pendingEntry) {
              // Merge with existing pending entry
              pendingEntry.quantity += newQty;
              console.log(`➕ Added ${newQty} to existing pending ${currentItem.name} (now ${pendingEntry.quantity}x)`);
            } else {
              // Create new pending entry
              finalItems.push({
                ...currentItem,
                quantity: newQty,
                status: 'pending' as ItemStatus,
                statusUpdatedAt: Date.now(),
                subId: `${currentItem.id}-${Date.now()}`,
              });
              console.log(`➕ Adding ${newQty} new pending ${currentItem.name}`);
            }
          }
        });
      } else {
        // New order - all items are pending
        finalItems = orderItems.map((item) => ({
          ...item,
          status: 'pending' as ItemStatus,
          statusUpdatedAt: Date.now(),
          subId: `${item.id}-${Date.now()}`,
        }));
      }

      // When saving offline, ensure self-service orders carry a sequential order number
      let fallbackOrderNumber: number | undefined;
      if (!orderId && profile?.is_self_service) {
        if (tableNumber && /^\d+$/.test(tableNumber.trim())) {
          fallbackOrderNumber = parseInt(tableNumber.trim(), 10);
        } else {
          try {
            fallbackOrderNumber = await getNextOrderNumber();
          } catch (e) {
            console.warn('⚠️ Could not generate fallback order number:', e);
          }
        }
      }

      const newOrder: Order = {
        id: orderId || Date.now().toString(),
        tableNumber: tableNumber.trim(),
        customerName: customerName.trim(),
        items: finalItems,
        totalAmount: calculateTotal(),
        createdAt: existingOrder?.createdAt || Date.now(),
        savedAt: Date.now(),
        status: 'pending',
        tableId: selectedTableId ?? undefined,
        ingredientsDeducted: false,
        deductedItems: existingOrder?.deductedItems || [],
        previousDeductedQuantities: existingOrder?.previousDeductedQuantities || {},
        orderNumber: fallbackOrderNumber,
        isSelfService: profile?.is_self_service || false,
      };

      if (orderId) {
        orders = orders.map((o: any) => (o.id === orderId ? newOrder : o));
        console.log(`📝 Updated order ${orderId} with items (CACHE ONLY)`);
      } else {
        orders.push(newOrder);
        // Also show the offline-created order immediately in the UI by dispatching to Redux
        try {
          dispatch(addOrder(newOrder as any));
          // Mark table occupied locally for offline orders when dine-in
          if (profile && !profile.is_self_service && selectedTableId) {
            try {
              dispatch(setTableOccupied({ tableId: selectedTableId, isOccupied: true }));
              console.log('🔴 Marked table occupied locally for offline-created order:', selectedTableId);
            } catch (e) {
              console.warn('⚠️ Failed to mark table occupied locally for offline-created order:', e);
            }
          }
        } catch (err) {
          console.warn('⚠️ Failed to dispatch offline order to Redux store:', err);
        }
        console.log(`✨ Created new order ${newOrder.id} (CACHE ONLY)`);
      }

      // Only save to cache, not as primary storage
      await safeSetJSON('orders_cache', orders);
      navigation.goBack();
    } catch (err) {
      console.error('Error saving order:', err);
      setError('Failed to save order');
    }
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
        {/* Table & Customer Info - Side by Side */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <View style={styles.tableInputContainer}>
              <Text style={styles.inputLabel}>Table</Text>
              <TextInput
                style={[styles.tableInput, error && error.includes('Table') && styles.inputError]}
                placeholder="Table #"
                value={tableNumber}
                onChangeText={handleTableNumberChange}
                keyboardType="numeric"
                placeholderTextColor="#999"
                maxLength={3}
              />
            </View>
            <View style={styles.customerInputContainer}>
              <Text style={styles.inputLabel}>Customer (Optional)</Text>
              <TextInput
                style={styles.customerInput}
                placeholder="Name"
                value={customerName}
                onChangeText={setCustomerName}
                placeholderTextColor="#999"
              />
            </View>
          </View>
        </View>

        {/* Categories - Direct Display */}
        {categories.length > 0 && (
          <View style={styles.categoriesSection}>
            <Text style={styles.sectionTitle}>Categories</Text>
            {categories.map(category => (
              <TouchableOpacity
                key={category.id}
                onPress={() => openCategoryModal(category)}
                style={styles.categoryButton}
              >
                <Text style={styles.categoryButtonText}>{category.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Order Items */}
        {orderItems.length > 0 && (
          <View style={styles.itemsSection}>
            <Text style={styles.sectionTitle}>Items in Order</Text>
            {orderItems.map(item => {
              return (
                <View key={item.id} style={styles.orderItemCard}>
                  <View style={styles.orderItemInfo}>
                    <Text style={styles.orderItemName}>{item.name}</Text>
                    <Text style={styles.orderItemPrice}>₹{item.price.toFixed(2)}</Text>
                  </View>
                  <View style={styles.quantityControl}>
                    <TouchableOpacity
                      onPress={() => handleQuantityChange(item.id, -1)}
                      style={styles.qtyBtn}
                    >
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.quantity}>{item.quantity}</Text>
                    <TouchableOpacity
                      onPress={() => handleQuantityChange(item.id, 1)}
                      style={styles.qtyBtn}
                    >
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveItem(item.id)}
                    style={styles.removeBtn}
                  >
                    <Text style={styles.removeBtnText}>🗑</Text>
                  </TouchableOpacity>
                </View>
              );
            })}

            {/* Total */}
            <View style={styles.totalSection}>
              <Text style={styles.totalLabel}>Total Amount:</Text>
              <Text style={styles.totalAmount}>₹{calculateTotal().toFixed(2)}</Text>
            </View>
          </View>
        )}

        {error && !error.includes('No changes') ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
      </ScrollView>

      {/* Save Order Button - Disabled if no changes */}
      <TouchableOpacity
        onPress={handleSaveOrder}
        style={[styles.saveBtn, { bottom: insets.bottom + 12 }, !hasChanges && styles.saveBtnDisabled]}
        disabled={!hasChanges}
      >
        <Text style={[styles.saveBtnText, !hasChanges && styles.saveBtnTextDisabled]}>
          Save Order
        </Text>
      </TouchableOpacity>

      {/* Category Items Modal - Center */}
      <Modal
        visible={showCategoryItemsModal}
        transparent
        animationType="fade"
        onRequestClose={closeCategoryModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.centeredModal}>
            <View style={styles.centeredModalHeader}>
              <Text style={styles.centeredModalTitle}>{selectedCategory?.name}</Text>
            </View>

            <View style={styles.centeredModalContentWrapper}>
              <ScrollView 
                style={styles.centeredModalContent}
                showsVerticalScrollIndicator={true}
                contentContainerStyle={styles.centeredModalContentScroll}
                scrollEnabled={true}
              >
                {selectedCategory?.items
                  .filter(item => item.isEnabled)
                  .map(item => {
                    const hasLowStock = checkMenuItemLowStock(item);
                    const warningLevel = getMenuItemWarningLevel(item);
                    const warningEmoji = warningLevel === 'RED' ? '🔴' : warningLevel === 'YELLOW' ? '🟡' : '🟢';

                    return (
                      <View 
                        key={item.id} 
                        style={[
                          styles.categoryItemRow,
                          hasLowStock && warningLevel === 'RED' ? styles.lowStockHighAlert : undefined
                        ]}
                      >
                        <View style={styles.categoryItemInfo}>
                          <View style={styles.itemNameContainer}>
                            <Text style={styles.categoryItemName}>{item.name}</Text>
                            {hasLowStock && <Text style={styles.stockWarningEmoji}>{warningEmoji}</Text>}
                          </View>
                          <Text style={styles.categoryItemPrice}>₹{item.price.toFixed(2)}</Text>
                          {item.isVegetarian ? (
                            <Text style={styles.vegBadge}>🌱</Text>
                          ) : (
                            <Text style={styles.nonVegBadge}>🍖</Text>
                          )}
                        </View>
                        <View style={styles.categoryItemQty}>
                          <TouchableOpacity
                            onPress={() => handleCategoryItemQuantityChange(item.id, -1)}
                            style={styles.qtyBtnSmall}
                          >
                            <Text style={styles.qtyBtnTextSmall}>−</Text>
                          </TouchableOpacity>
                          <Text style={styles.categoryItemQtyDisplay}>
                            {categoryItemQuantities[item.id] || 0}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleCategoryItemQuantityChange(item.id, 1)}
                            style={styles.qtyBtnSmall}
                          >
                            <Text style={styles.qtyBtnTextSmall}>+</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
              </ScrollView>
            </View>

            {/* Close/Add Button at Bottom - Fixed */}
            <View style={styles.centeredModalFooter}>
              <TouchableOpacity
                onPress={handleCloseCategoryModal}
                style={styles.centeredModalCloseBtn}
              >
                <Text style={styles.centeredModalCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Table Selector Modal - For Dine-in Mode */}
      <Modal
        visible={showTableSelector}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTableSelector(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.tableSelectorModal}>
            <View style={styles.tableSelectorHeader}>
              <Text style={styles.tableSelectorTitle}>Select Table</Text>
            </View>

            <FlatList
              data={tables}
              keyExtractor={(item) => item.id}
              numColumns={3}
              columnWrapperStyle={styles.tableSelectorGrid}
              contentContainerStyle={styles.tableSelectorContent}
              renderItem={({ item: table }) => (
                <TouchableOpacity
                  style={[
                    styles.tableSelectorCard,
                    table.is_occupied && styles.tableSelectorCardOccupied,
                    selectedTableId === table.id && styles.tableSelectorCardSelected,
                  ]}
                  onPress={() => {
                    if (!table.is_occupied) {
                      setSelectedTableId(table.id);
                    }
                  }}
                  disabled={table.is_occupied}
                >
                  <Text style={styles.tableSelectorCardName}>{table.name}</Text>
                  <Text style={styles.tableSelectorCardStatus}>
                    {table.is_occupied ? '🔴' : '🟢'}
                  </Text>
                </TouchableOpacity>
              )}
            />

            <View style={styles.tableSelectorFooter}>
              <TouchableOpacity
                onPress={() => {
                  setShowTableSelector(false);
                  setSelectedTableId(null);
                }}
                style={styles.tableSelectorCancelBtn}
              >
                <Text style={styles.tableSelectorCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  setShowTableSelector(false);
                  // Re-trigger save now that table is selected
                  await handleSaveOrder();
                }}
                style={[styles.tableSelectorConfirmBtn, !selectedTableId && styles.tableSelectorConfirmBtnDisabled]}
                disabled={!selectedTableId}
              >
                <Text style={[styles.tableSelectorConfirmBtnText, !selectedTableId && styles.tableSelectorConfirmBtnTextDisabled]}>
                  Confirm Table
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
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  infoSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  existingTablesSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  tableButtonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tableQuickSelectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
    minWidth: 80,
    alignItems: 'center',
  },
  tableQuickSelectBtnActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  tableQuickSelectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  tableQuickSelectBtnTextActive: {
    color: '#fff',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  tableInputContainer: {
    flex: 0.2,
  },
  customerInputContainer: {
    flex: 0.8,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  tableInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    color: '#333',
    textAlign: 'center',
  },
  customerInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#333',
  },
  inputError: {
    borderColor: '#d32f2f',
    borderWidth: 2,
  },
  categoriesSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  categoryButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  categoryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#7c3aed',
  },
  categoryCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7c3aed',
    marginBottom: 8,
  },
  itemsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemBadge: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    minWidth: 100,
  },
  itemBadgeText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  itemBadgePrice: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7c3aed',
  },
  categoryItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  categoryItemInfo: {
    flex: 1,
  },
  categoryItemName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  categoryItemPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
  },
  vegBadge: {
    fontSize: 12,
    marginTop: 2,
  },
  nonVegBadge: {
    fontSize: 12,
    marginTop: 2,
  },
  lowStockHighAlert: {
    backgroundColor: '#fff3f3',
    borderLeftWidth: 4,
    borderLeftColor: '#d32f2f',
  },
  itemNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stockWarningEmoji: {
    fontSize: 14,
    marginLeft: 4,
  },
  categoryItemQty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtnSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  qtyBtnTextSmall: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  categoryItemQtyDisplay: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    minWidth: 20,
    textAlign: 'center',
  },
  itemsSection: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  orderItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fafafa',
    borderRadius: 6,
    marginBottom: 8,
  },
  orderItemInfo: {
    flex: 1,
  },
  orderItemName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  itemNameWithStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusSymbol: {
    fontSize: 18,
    marginLeft: 8,
  },
  orderItemPrice: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '600',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    backgroundColor: '#fff',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  qtyBtn: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  quantity: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    width: 24,
    textAlign: 'center',
  },
  removeBtn: {
    padding: 6,
  },
  removeBtnText: {
    fontSize: 14,
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 2,
    borderTopColor: '#7c3aed',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7c3aed',
  },
  errorText: {
    fontSize: 12,
    color: '#d32f2f',
    marginTop: 12,
    fontWeight: '500',
    paddingHorizontal: 16,
  },
  saveBtn: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#ccc',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtnTextDisabled: {
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centeredModal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '90%',
    maxHeight: '90%',
    paddingBottom: 0,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  centeredModalHeader: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  centeredModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  centeredModalContent: {
    flexGrow: 0,
  },
  centeredModalContentWrapper: {
    flexGrow: 1,
    flexShrink: 1,
    maxHeight: '85%',
  },
  centeredModalContentScroll: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  itemPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: '#7c3aed',
    marginBottom: 8,
  },
  vegetarianBadge: {
    fontSize: 12,
    fontWeight: '500',
    color: '#4caf50',
    marginBottom: 12,
  },
  quantitySection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  quantityBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#7c3aed',
  },
  quantityBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  quantityDisplay: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    minWidth: 40,
    textAlign: 'center',
  },
  centeredModalCloseBtn: {
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderRadius: 6,
  },
  centeredModalCloseBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  centeredModalFooter: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  // Table Selector Modal Styles
  tableSelectorModal: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 20,
    marginVertical: 100,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  tableSelectorHeader: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  tableSelectorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  tableSelectorGrid: {
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
  },
  tableSelectorContent: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  tableSelectorCard: {
    flex: 0.33,
    aspectRatio: 1,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#4ade80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableSelectorCardOccupied: {
    backgroundColor: '#ffebee',
    borderColor: '#ef4444',
    opacity: 0.5,
  },
  tableSelectorCardSelected: {
    borderColor: '#7c3aed',
    borderWidth: 3,
    backgroundColor: '#ede9fe',
  },
  tableSelectorCardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  tableSelectorCardStatus: {
    fontSize: 18,
  },
  tableSelectorFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  tableSelectorCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    alignItems: 'center',
  },
  tableSelectorCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  tableSelectorConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    alignItems: 'center',
  },
  tableSelectorConfirmBtnDisabled: {
    backgroundColor: '#ddd',
  },
  tableSelectorConfirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  tableSelectorConfirmBtnTextDisabled: {
    color: '#999',
  },
});
