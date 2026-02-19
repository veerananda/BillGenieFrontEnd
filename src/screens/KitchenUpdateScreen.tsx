import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import { apiClient } from '../services/api';
import { wsService } from '../services/websocket';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setOrders, setLoading as setOrdersLoading, updateOrderItemStatus, addOrder, updateOrder, removeOrder } from '../store/ordersSlice';
import { selectOrders, selectOrdersLoading } from '../store/ordersSlice';

type RootStackParamList = {
  Home: undefined;
  KitchenUpdate: undefined;
};

type KitchenUpdateScreenProps = NativeStackScreenProps<RootStackParamList, 'KitchenUpdate'>;

type ItemStatus = 'pending' | 'cooking' | 'ready' | 'served';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
  status: ItemStatus;
  statusUpdatedAt?: number;
  subId?: string; // Unique identifier for each quantity batch
  menuId?: string; // Menu item ID for bulk updates
}

interface KitchenOrder {
  id: string;
  tableNumber: number;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  createdAt: number;
  isSelfService?: boolean;
}

export const KitchenUpdateScreen: React.FC<KitchenUpdateScreenProps> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  
  // Redux state
  const orders = useAppSelector(selectOrders) as any[];
  const loading = useAppSelector(selectOrdersLoading);
  // Local kitchen-only view of pending orders (keep separate from global orders)
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrder[]>([]);

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    const handleOrderCreated = (data: any) => {
      console.log('📱 New order received via WebSocket:', data);
      
      // Check if order already exists in Redux to avoid duplicates
      const existingOrder = orders.find((order: any) => order.id === data.id);
      if (!existingOrder) {
        // Transform API order data to match Redux format
        const newOrder = {
          id: data.id,
          tableNumber: data.table_number || 0,
          customerName: data.customer_name || 'Guest',
          items: (data.items || []).map((item: any) => ({
            id: item.id,
            name: item.name || item.menu_item?.name || 'Unknown Item',
            quantity: item.quantity,
            notes: item.notes,
            status: item.status || 'pending',
            statusUpdatedAt: item.status_updated_at,
            price: item.unit_rate || item.price || 0,
            isVegetarian: item.is_vegetarian || item.menu_item?.is_vegetarian || false,
            menuId: item.menu_id,
          })),
          totalAmount: data.total || 0,
          createdAt: new Date(data.created_at).getTime(),
          status: 'pending' as const,
          isSelfService: data.is_self_service || (data.table_id && data.table_id.startsWith('self-service')) || data.customer_name === 'Self Service',
        };
        
        // Add to Redux store
        dispatch(addOrder(newOrder as any));
        console.log('✅ Added new order to Redux via WebSocket');
        // Add to local kitchen view if it contains pending or cooking items
        const hasPending = (newOrder.items || []).some((it: any) => it.status === 'pending' || it.status === 'cooking');
        if (hasPending) {
          setKitchenOrders(prev => {
            if (prev.find(o => o.id === newOrder.id)) return prev;
            return [newOrder as KitchenOrder, ...prev];
          });
        }
      } else {
        console.log('⚠️ Order already exists in Redux, skipping duplicate add');
      }
    };

    const handleOrderStatusChanged = (data: any) => {
      console.log('📱 Order status changed via WebSocket:', data);
      // Dispatch Redux action to update item status
      dispatch(updateOrderItemStatus({
        orderId: data.orderId,
        itemId: data.itemId,
        newStatus: data.status,
      }));
      // Update local kitchen view (single update only)
      setKitchenOrders(prev => prev.map(order => {
        if (order.id !== data.orderId) return order;
        const items = order.items.map(item => item.id === data.itemId ? { ...item, status: data.status } : item);
        // keep pending or cooking items visible
        const activeItems = items.filter(it => it.status === 'pending' || it.status === 'cooking');
        if (activeItems.length === 0) return null as any;
        return { ...order, items: activeItems } as KitchenOrder;
      }).filter(Boolean) as KitchenOrder[]);
    };

    const handleOrderUpdated = (data: any) => {
      console.log('📱 Order updated via WebSocket:', data);
      
      // Check if this is just a status update that we already handled
      // If so, avoid reloading all orders
      const existingOrder = orders.find((order: any) => order.id === data.id);
      if (existingOrder) {
        // Update only changed item statuses instead of reloading
        const incomingItems = (data.items || []) as any[];
        incomingItems.forEach((incoming) => {
          const localItem = existingOrder.items.find((i: any) => i.id === incoming.id);
          const incomingStatus = incoming.status || 'pending';
          if (localItem && localItem.status !== incomingStatus) {
            dispatch(updateOrderItemStatus({ orderId: data.id, itemId: incoming.id, newStatus: incomingStatus }));
          }
        });

        // After applying updates, update local kitchen view: remove order if it has no pending items
        setTimeout(() => {
          setKitchenOrders(prev => prev.flatMap(o => {
            if (o.id !== data.id) return o;
            const incomingItems = (data.items || []) as any[];
            const updatedItems = o.items.map(localItem => {
              const incoming = incomingItems.find(i => i.id === localItem.id);
              return incoming ? { ...localItem, status: incoming.status || localItem.status, statusUpdatedAt: incoming.status_updated_at || localItem.statusUpdatedAt } : localItem;
            });
            const activeItems = updatedItems.filter(i => i.status === 'pending' || i.status === 'cooking');
            if (activeItems.length === 0) return [];
            return [{ ...o, items: activeItems }];
          }));
        }, 50);
        console.log('✅ Partially updated existing order via WebSocket (no reload)');
      } else {
        // If order doesn't exist, reload all orders
        loadOrders();
      }
    };

    // Register event listeners
    wsService.on('order_created', handleOrderCreated);
    wsService.on('order_status_changed', handleOrderStatusChanged);
    wsService.on('order_updated', handleOrderUpdated);

    // Cleanup on unmount
    return () => {
      wsService.off('order_created', handleOrderCreated);
      wsService.off('order_status_changed', handleOrderStatusChanged);
      wsService.off('order_updated', handleOrderUpdated);
    };
  }, [dispatch]);

  useFocusEffect(
    React.useCallback(() => {
      // Load orders without blocking - use cached data if available
      loadOrders(false); // false = don't block on loading
    }, [])
  );

  const loadOrders = useCallback(async (forceRefresh: boolean = false) => {
    try {
      // Only show loading spinner if forcing refresh or no cached data
      if (forceRefresh || (orders && orders.length === 0)) {
        dispatch(setOrdersLoading(true));
      }
      
      // Try loading from API first
      let allOrders: any[] = [];
      try {
        console.log('🍳 Loading kitchen orders from API...');
        const response = await apiClient.listOrders();
        allOrders = response.orders.map((order: any) => {
          const isSelfService = order.is_self_service || (order.table_id && order.table_id.startsWith('self-service')) || order.customer_name === 'Self Service';
          console.log(`📦 API Order ${order.id}: customer_name="${order.customer_name}", table_id="${order.table_id}", is_self_service=${order.is_self_service}, detected_isSelfService=${isSelfService}`);
          return {
            id: order.id,
            tableNumber: order.table_number,
            customerName: order.customer_name || 'Guest',
            items: order.items?.map((item: any) => ({
              id: item.id,
              name: item.name || item.menu_item?.name || 'Unknown Item',
              quantity: item.quantity,
              notes: item.notes,
              status: item.status || 'pending',
              statusUpdatedAt: item.status_updated_at,
              menu_id: item.menu_id,
            })) || [],
            totalAmount: order.total || 0,
            createdAt: new Date(order.created_at).getTime(),
            isSelfService: isSelfService,
            table_id: order.table_id, // Store original table_id for later checks
          };
        });
        console.log(`✅ Loaded ${allOrders.length} orders from API`);
      } catch (apiErr) {
        console.error('API error, falling back to AsyncStorage:', apiErr);
        // Use the storage helper to safely read cached orders as a fallback.
        const ordersStored = await getJSONOrDefault<any[]>('orders', []);
        allOrders = Array.isArray(ordersStored) ? ordersStored : [];
        console.log(`📱 Loaded ${allOrders.length} orders from AsyncStorage`);
      }

      const processedOrders = allOrders
        .map((order: any) => {
          const processedItems = (order.items || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            notes: item.notes,
            status: item.status || 'pending',
            statusUpdatedAt: item.statusUpdatedAt,
            menuId: item.menuId || item.menu_id,
          }));

          // Show orders which have pending or cooking items. Ready/served are not shown in the kitchen list.
          const hasActiveItems = processedItems.some((item: OrderItem) => item.status === 'pending' || item.status === 'cooking');

          if (!hasActiveItems) return null;

          const isSelfService = order.isSelfService || (order.customerName === 'Self Service') || (order.table_id && order.table_id.startsWith('self-service')) || false;
          console.log(`🔬 Processing order ${order.id}: isSelfService=${isSelfService}, customerName=${order.customerName}, table_id=${order.table_id}`);

          return {
            id: order.id,
            tableNumber: order.tableNumber || 0,
            customerName: order.customerName || 'Guest',
            // Keep pending and cooking items in the kitchen view
            items: processedItems.filter((item: OrderItem) => item.status === 'pending' || item.status === 'cooking'),
            totalAmount: order.totalAmount || 0,
            createdAt: order.createdAt || order.savedAt || Date.now(),
            status: 'pending' as const,
            isSelfService: isSelfService,
          };
        })
        .filter((order: any | null): order is any => order !== null);

      // Keep the processed pending orders local to the kitchen UI
      setKitchenOrders(processedOrders as KitchenOrder[]);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      dispatch(setOrdersLoading(false));
    }
  }, [dispatch]);

  const getNextStatus = useCallback((currentStatus: ItemStatus): ItemStatus | null => {
    const statusFlow: { [key: string]: ItemStatus | null } = {
      pending: 'cooking',
      cooking: 'ready',
      ready: 'served',
      served: null,
    };
    return statusFlow[currentStatus] || null;
  }, []);

  const updateItemStatus = useCallback(async (orderId: string, itemId: string, menuId: string | undefined, currentStatus: ItemStatus) => {
    try {
      const nextStatus = getNextStatus(currentStatus);
      if (!nextStatus) return;

      // Update Redux state (optimistic update) - update all items in the order with this menu ID
      if (menuId) {
        // Bulk update all items with this menu ID
        setKitchenOrders(prev => prev.flatMap(order => {
          if (order.id !== orderId) return order;
          const updatedItems = order.items.map(i => 
            i.menuId === menuId ? { ...i, status: nextStatus, statusUpdatedAt: Date.now() } : i
          );
          const activeItems = updatedItems.filter(i => i.status === 'pending' || i.status === 'cooking');
          if (activeItems.length === 0) return [];
          return [{ ...order, items: activeItems }];
        }));
        
        // Also update Redux for all items with this menu ID
        const order = kitchenOrders.find(o => o.id === orderId);
        if (order) {
          order.items.forEach(item => {
            if (item.menuId === menuId && item.status === currentStatus) {
              dispatch(updateOrderItemStatus({ orderId, itemId: item.id, newStatus: nextStatus }));
            }
          });
        }
      } else {
        // Fallback to single item update if no menuId
        dispatch(updateOrderItemStatus({ orderId, itemId, newStatus: nextStatus }));
        setKitchenOrders(prev => prev.flatMap(order => {
          if (order.id !== orderId) return order;
          const updatedItems = order.items.map(i => i.id === itemId ? { ...i, status: nextStatus, statusUpdatedAt: Date.now() } : i);
          const activeItems = updatedItems.filter(i => i.status === 'pending' || i.status === 'cooking');
          if (activeItems.length === 0) return [];
          return [{ ...order, items: activeItems }];
        }));
      }

      // Try updating via API first
      try {
        if (menuId) {
          console.log(`🔄 Updating all items with menu_id ${menuId} status: ${currentStatus} → ${nextStatus}`);
          await apiClient.updateOrderItemsByMenuID(orderId, menuId, nextStatus);
          console.log('✅ All items with this menu ID updated via API');
        } else {
          console.log(`🔄 Updating item ${itemId} status: ${currentStatus} → ${nextStatus}`);
          await apiClient.updateOrderItemStatus(orderId, itemId, nextStatus);
          console.log('✅ Item status updated via API');
        }
      } catch (apiErr) {
        console.error('API error, falling back to AsyncStorage:', apiErr);
        // Fallback to AsyncStorage: safely read and persist using helpers
        try {
          const allOrders = await getJSONOrDefault<any[]>('orders', []);
          const updatedOrders = (allOrders || []).map((order: any) => {
            if (order.id === orderId) {
              const updatedItems = order.items.map((item: any) => {
                const itemMatchesUpdate = menuId 
                  ? (item.menuId === menuId || item.menu_id === menuId) && item.status === currentStatus
                  : item.id === itemId && item.status === currentStatus;
                
                if (itemMatchesUpdate) {
                  return {
                    ...item,
                    status: nextStatus,
                    statusUpdatedAt: Date.now(),
                  };
                }
                return item;
              });

              return {
                ...order,
                items: updatedItems,
              };
            }
            return order;
          });
          await safeSetJSON('orders', updatedOrders);
        } catch (e) {
          console.warn('⚠️ Failed to persist update to AsyncStorage fallback', e);
        }
      }
    } catch (error) {
      console.error('Error updating item status:', error);
    }
  }, [dispatch, getNextStatus]);

  const getStatusIcon = useCallback((status: ItemStatus) => {
    const icons: { [key: string]: string } = {
      pending: '⏳',
      cooking: '🔥',
      ready: '🍴', // Fork emoji for ready items
      served: '', // Empty string - these items should be hidden/removed
    };
    return icons[status] || '⏳';
  }, []);

  const getOrderLabel = useCallback((tableNumber: number, isSelfService: boolean = false): string => {
    // Check if this is a self-service order
    const label = isSelfService ? `Order ${tableNumber}` : `Table ${tableNumber}`;
    console.log(`🏷️ getOrderLabel(${tableNumber}, ${isSelfService}) => "${label}"`);
    return label;
  }, []);

  const handleItemStatusUpdate = useCallback((orderId: string, itemId: string, menuId: string | undefined, currentStatus: ItemStatus) => {
    updateItemStatus(orderId, itemId, menuId, currentStatus);
  }, [updateItemStatus]);

  const formatTime = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const getTimeElapsed = useCallback((startTime: number) => {
    const elapsed = Date.now() - startTime;
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes === 1) return '1 min ago';
    return `${minutes} mins ago`;
  }, []);

  // Group items by name, then by status, summing quantities
  const groupItemsByNameAndStatus = useCallback((items: OrderItem[]) => {
    const statusOrder = { pending: 0, cooking: 1, ready: 2, served: 3 };
    const grouped: { [key: string]: { name: string; variants: Array<{ id: string; status: ItemStatus; quantity: number }>; firstIndex: number } } = {};
    const seenNames: string[] = [];
    
    items.forEach((item, index) => {
      const nameKey = item.name;
      if (!grouped[nameKey]) {
        grouped[nameKey] = {
          name: item.name,
          variants: [],
          firstIndex: index,
        };
        seenNames.push(nameKey);
      }
      
      // Find or create status variant
      const existingVariant = grouped[nameKey].variants.find(v => v.status === item.status);
      if (existingVariant) {
        existingVariant.quantity += item.quantity;
      } else {
        grouped[nameKey].variants.push({
          id: item.id,
          status: item.status,
          quantity: item.quantity,
          menuId: item.menuId,
        });
      }
    });
    
    // Sort variants within each group by status
    Object.values(grouped).forEach(group => {
      group.variants.sort((a, b) => 
        (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99)
      );
    });
    
    // Return in original order
    return seenNames.map(name => grouped[name]);
  }, []);

  const getTotalItemCount = useCallback(() => {
    return kitchenOrders.reduce((total, order) => total + order.items.length, 0);
  }, [kitchenOrders]);

  const getCookingItemCount = useCallback(() => {
    return kitchenOrders.reduce((total, order) => {
      return total + order.items.filter((item: any) => item.status === 'cooking').length;
    }, 0);
  }, [kitchenOrders]);

  const getPendingItemCount = useCallback(() => {
    return kitchenOrders.reduce((total, order) => {
      return total + order.items.filter((item: any) => item.status === 'pending').length;
    }, 0);
  }, [kitchenOrders]);

  const renderOrderCard = useCallback((order: KitchenOrder) => {
    // Group items by name with variants for each status
    const groupedItems = groupItemsByNameAndStatus(order.items);
    
    // Check if all items are ready
    const allItemsReady = order.items.every(item => item.status === 'ready' || item.status === 'served');
    
    // Count items by status
    const readyItemsCount = order.items.filter(item => item.status === 'ready').length;
    const totalItemsCount = order.items.length;
    
    // Filter out items where all variants are served
    const activeGroupedItems = groupedItems.filter(itemGroup => 
      itemGroup.variants.some(variant => variant.status !== 'served')
    );

    // If no active items remain and all are ready, show "Order Ready" message
    if (allItemsReady && activeGroupedItems.length === 0) {
      return (
        <View key={order.id} style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <View style={styles.orderHeaderLeft}>
              <Text style={styles.tableNumber}>{getOrderLabel(order.tableNumber, order.isSelfService)}</Text>
              <Text style={styles.customerName}>{order.customerName}</Text>
            </View>
            <View style={styles.orderHeaderRight}>
              <Text style={styles.orderTime}>{formatTime(order.createdAt)}</Text>
              <Text style={styles.orderElapsed}>{getTimeElapsed(order.createdAt)}</Text>
            </View>
          </View>
          <View style={styles.orderReadyContainer}>
            <Text style={styles.orderReadyIcon}>✓</Text>
          </View>
        </View>
      );
    }

    // If some items are ready, show count
    if (readyItemsCount > 0) {
      return (
        <View key={order.id} style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <View style={styles.orderHeaderLeft}>
              <Text style={styles.tableNumber}>{getOrderLabel(order.tableNumber, order.isSelfService)}</Text>
              <Text style={styles.customerName}>{order.customerName}</Text>
            </View>
            <View style={styles.orderHeaderRight}>
              <Text style={styles.orderTime}>{formatTime(order.createdAt)}</Text>
              <Text style={styles.orderElapsed}>{getTimeElapsed(order.createdAt)}</Text>
            </View>
          </View>
          <View style={styles.itemsContainer}>
            {activeGroupedItems.map((itemGroup, groupIndex) => (
              <View 
                key={`${itemGroup.name}-${groupIndex}`}
                style={[styles.itemTile, groupIndex === activeGroupedItems.length - 1 && { marginBottom: 0 }]}
              >
                {/* Item Name - Left, Variants - Right */}
                <View style={styles.itemRow}>
                  <Text style={styles.itemName}>{itemGroup.name}</Text>
                  
                  {/* Status Variants - Stacked on Right */}
                  <View style={styles.variantsStackRight}>
                    {itemGroup.variants
                      .filter(variant => variant.status !== 'served') // Hide served items
                      .map((variant, variantIndex) => (
                      <View 
                        key={`${itemGroup.name}-${variant.status}-${variantIndex}`}
                        style={styles.variantRow}
                      >
                        <Text style={styles.itemQuantity}>{variant.quantity}x</Text>
                        <TouchableOpacity
                          style={styles.statusButton}
                          onPress={() => handleItemStatusUpdate(order.id, variant.id, variant.menuId, variant.status)}
                          disabled={variant.status === 'ready' || variant.status === 'served'}
                          >
                          <Text style={[styles.statusIcon, (variant.status === 'ready' || variant.status === 'served') && styles.statusIconDisabled]}>
                            {getStatusIcon(variant.status)}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      );
    }

    // Default case: show all items
    return (
      <View key={order.id} style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <View style={styles.orderHeaderLeft}>
            <Text style={styles.tableNumber}>{getOrderLabel(order.tableNumber, order.isSelfService)}</Text>
            <Text style={styles.customerName}>{order.customerName}</Text>
          </View>
          <View style={styles.orderHeaderRight}>
            <Text style={styles.orderTime}>{formatTime(order.createdAt)}</Text>
            <Text style={styles.orderElapsed}>{getTimeElapsed(order.createdAt)}</Text>
          </View>
        </View>
        <View style={styles.itemsContainer}>
          {activeGroupedItems.map((itemGroup, groupIndex) => (
            <View 
              key={`${itemGroup.name}-${groupIndex}`}
              style={[styles.itemTile, groupIndex === activeGroupedItems.length - 1 && { marginBottom: 0 }]}
            >
              {/* Item Name - Left, Variants - Right */}
              <View style={styles.itemRow}>
                <Text style={styles.itemName}>{itemGroup.name}</Text>
                
                {/* Status Variants - Stacked on Right */}
                <View style={styles.variantsStackRight}>
                  {itemGroup.variants
                    .filter(variant => variant.status !== 'served') // Hide served items
                    .map((variant, variantIndex) => (
                    <View 
                      key={`${itemGroup.name}-${variant.status}-${variantIndex}`}
                      style={styles.variantRow}
                    >
                      <Text style={styles.itemQuantity}>{variant.quantity}x</Text>
                      <TouchableOpacity
                        style={styles.statusButton}
                        onPress={() => handleItemStatusUpdate(order.id, variant.id, variant.menuId, variant.status)}
                        disabled={variant.status === 'ready' || variant.status === 'served'}
                        >
                        <Text style={[styles.statusIcon, (variant.status === 'ready' || variant.status === 'served') && styles.statusIconDisabled]}>
                          {getStatusIcon(variant.status)}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }, [groupItemsByNameAndStatus, formatTime, getTimeElapsed, handleItemStatusUpdate, getStatusIcon, getOrderLabel]);

  return (
    <View style={styles.container}>
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{getTotalItemCount()}</Text>
          <Text style={styles.statLabel}>Active Items</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{getCookingItemCount()}</Text>
          <Text style={styles.statLabel}>Cooking</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>{getPendingItemCount()}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#7c3aed" />
            <Text style={styles.loadingText}>Loading orders...</Text>
          </View>
        ) : kitchenOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>🍳</Text>
            <Text style={styles.emptyStateText}>No active orders</Text>
            <Text style={styles.emptyStateSubtext}>New items will appear here</Text>
          </View>
        ) : (
          <View style={styles.ordersContainer}>
            {kitchenOrders
              .map((order, index) => {
                const card = renderOrderCard(order);
                return card ? (
                  <View key={order.id} style={index > 0 ? { marginTop: 16 } : {}}>
                    {card}
                  </View>
                ) : null;
              })
              .filter(Boolean)}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#7c3aed',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    marginRight: 15,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  refreshButton: {
    padding: 8,
  },
  refreshButtonText: {
    fontSize: 24,
  },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#7c3aed',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
  },
  ordersContainer: {
    padding: 16,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  orderHeaderLeft: {
    flex: 1,
  },
  orderHeaderRight: {
    alignItems: 'flex-end',
  },
  tableNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#7c3aed',
    marginBottom: 4,
  },
  customerName: {
    fontSize: 16,
    color: '#666',
  },
  orderTime: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  orderElapsed: {
    fontSize: 12,
    color: '#999',
  },
  itemsContainer: {
    paddingHorizontal: 0,
  },
  itemTile: {
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#7c3aed',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  variantsStackRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  statusColumn: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  itemQuantity: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#7c3aed',
    marginRight: 8,
    minWidth: 40,
    textAlign: 'right',
  },
  statusButton: {
    padding: 4,
  },
  statusIcon: {
    fontSize: 24,
  },
  statusIconDisabled: {
    opacity: 0.5,
  },
  orderReadyContainer: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderReadyIcon: {
    fontSize: 48,
    color: '#4caf50',
    marginBottom: 8,
  },
  orderReadyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  readyCountDisplay: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  readyCountText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#92400e',
  },
});
