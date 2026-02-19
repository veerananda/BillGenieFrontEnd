import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { HeaderBackButton } from '@react-navigation/elements';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Alert,
  Dimensions,
  BackHandler,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import { apiClient, RestaurantTable, RestaurantProfile } from '../services/api';
import { wsService } from '../services/websocket';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { store } from '../store';
import { setOrders, setLoading as setOrdersLoading, removeOrder, updateOrder } from '../store/ordersSlice';
import { setTables, setLoading as setTablesLoading } from '../store/tablesSlice';
import { setProfile } from '../store/profileSlice';
import { selectOrders, selectOrdersLoading } from '../store/ordersSlice';
import { selectTables, selectTablesLoading } from '../store/tablesSlice';
import { selectProfile } from '../store/profileSlice';
import type { Order as ReduxOrder } from '../store/ordersSlice';

type RootStackParamList = {
  Orders: undefined;
  TakeOrder: { orderId?: string; tableId?: string; tableName?: string };
  SelfServiceOrder: undefined;
  BillSummary: { orderId: string };
  OrderDetails: { orderId: string; tableName: string };
};

type OrdersScreenProps = NativeStackScreenProps<RootStackParamList, 'Orders'>;

type ItemStatus = 'pending' | 'cooking' | 'ready' | 'served';

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  isVegetarian: boolean;
  status?: ItemStatus;
  statusUpdatedAt?: number;
  subId?: string; // Unique identifier for each quantity batch
}

// Use the Redux Order type instead of local interface
type Order = ReduxOrder;

export const OrdersScreen: React.FC<OrdersScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  
  // Redux state
  const orders = useAppSelector(selectOrders);
  const loading = useAppSelector(selectOrdersLoading);
  const tables = useAppSelector(selectTables);
  const loadingTables = useAppSelector(selectTablesLoading);
  const profile = useAppSelector(selectProfile);
  
  // Sort orders with most recent first
  const sortedOrders = [...orders].sort((a, b) => {
    const aTime = a.createdAt || 0;
    const bTime = b.createdAt || 0;
    return bTime - aTime; // Most recent first
  });
  
  // Local state only for UI control
  const [refreshing, setRefreshing] = useState(false);

  // ============ HELPER: Load all data function (NO HOOK) ============
  const performLoad = async (forceTableReload = false) => {
    try {
      // Only show loading spinner if forcing reload or no cached orders
      if (forceTableReload || orders.length === 0) {
        dispatch(setOrdersLoading(true));
      }
      
      // 1. Load profile
      const profileData = await apiClient.getRestaurantProfile();
      dispatch(setProfile(profileData));
      
      // 2. Load tables if dine-in mode - only if forced or tables are empty
      if (profileData.is_self_service === false) {
        try {
          // Only reload tables from API if explicitly forced (manual refresh) or tables are empty
          if (forceTableReload || tables.length === 0) {
            console.log('🔄 Reloading tables from API (forceReload:', forceTableReload, ', empty:', tables.length === 0, ')');
            dispatch(setTablesLoading(true));
            const tableList = await apiClient.getTables();
            console.log('✅ Loaded', tableList.length, 'tables from API');
            dispatch(setTables(tableList as any));
            dispatch(setTablesLoading(false));
          } else {
            console.log('⏭️ Skipping table reload - using Redux state');
          }
        } catch (err) {
          console.error('❌ Error loading tables:', err);
          dispatch(setTables([]));
          dispatch(setTablesLoading(false));
        }
      }
      
      // 3. Load orders
      const response = await apiClient.listOrders();
      const backendOrders = Array.isArray(response) ? response : (response?.orders || []);
      
      console.log('📦 Raw backend orders received:', backendOrders.length, 'orders');
      console.log('📦 First order sample:', backendOrders[0] ? JSON.stringify({
        id: backendOrders[0].id,
        table_number: backendOrders[0].table_number,
        table_id: backendOrders[0].table_id,
        status: backendOrders[0].status,
        total: backendOrders[0].total,
        final_amount: backendOrders[0].final_amount,
        order_number: backendOrders[0].order_number,
        items: backendOrders[0].items?.length
      }) : 'No orders');
      
      // Small delay to allow backend to process newly created orders
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (Array.isArray(backendOrders)) {
        const transformedOrders: Order[] = backendOrders.map((order: any) => {
          // Log every order that doesn't have a tableId to understand the structure
          if (!order.table_id && !order.table_number) {
            console.log(`📋 Order without tableId/table_number:`, JSON.stringify({
              id: order.id,
              customer_name: order.customer_name,
              table_id: order.table_id,
              table_number: order.table_number,
              is_self_service: order.is_self_service,
              order_number: order.order_number,
              status: order.status,
              created_at: order.created_at,
            }));
          }
          const transformed = {
            id: order.id,
            tableNumber: String(order.table_number || ''),
            customerName: order.customer_name || '',
            items: (order.items || []).map((item: any) => ({
              id: item.id,
              name: item.menu_item?.name || 'Unknown Item',
              price: item.unit_rate || 0,
              quantity: item.quantity,
              isVegetarian: item.menu_item?.is_vegetarian || false,
              status: (item.status as ItemStatus) || 'pending',
              statusUpdatedAt: Date.now(),
              subId: '',
            })),
            totalAmount: order.total || 0,
            createdAt: new Date(order.created_at).getTime(),
            status: (order.status === 'completed' ? 'completed' : 'pending') as 'completed' | 'pending',
            tableId: order.table_id,
            finalAmount: order.final_amount || order.total || 0, // For self-service orders with discounts
            taxAmount: order.tax_amount,
            discountAmount: order.discount_amount,
            isSelfService: order.is_self_service || (order.table_id && order.table_id.startsWith('self-service')) || false,
            orderNumber: order.order_number, // Add orderNumber for matching
          };
          
          console.log(`🔄 Transformed order ${transformed.id}: status=${transformed.status}, finalAmount=${transformed.finalAmount}, totalAmount=${transformed.totalAmount}, orderNumber=${transformed.orderNumber}, raw API final_amount=${order.final_amount}, total=${order.total}`);
          if (transformed.tableId) {
            console.log(`✅ Order ${transformed.id} has tableId: ${transformed.tableId}`);
          } else {
            console.log(`ℹ️ Order ${transformed.id} has no tableId (likely self-service)`);
          }
          return transformed;
        });
        // Simple approach: Use API data as primary source, but preserve local completed status for self-service orders
        let finalOrders = transformedOrders;
        
        if (transformedOrders.length === 0) {
          // If API returned no orders, try AsyncStorage as fallback
          const asyncOrders = await getJSONOrDefault<any[]>('orders', []);
          if (Array.isArray(asyncOrders) && asyncOrders.length > 0) {
            console.log('💾 Using AsyncStorage fallback:', asyncOrders.length, 'orders');
            finalOrders = asyncOrders as any[];
          } else {
            console.log('📊 No orders from API or cache, using empty array');
            finalOrders = [];
          }
        } else {
          console.log('📊 Using API orders as primary source');
          
          // For self-service orders, preserve local completed status if API has pending
          const existingOrders = selectOrders(store.getState());
          finalOrders = transformedOrders.map(apiOrder => {
            const localOrder = existingOrders.find(existing => 
              existing.id === apiOrder.id || 
              (existing.orderNumber && apiOrder.orderNumber && existing.orderNumber === apiOrder.orderNumber)
            );
            if (localOrder && localOrder.isSelfService && apiOrder.status === 'pending' && localOrder.status === 'completed') {
              console.log('🎯 Preserving local completed status for self-service order:', apiOrder.id);
              return {
                ...apiOrder,
                status: 'completed',
                finalAmount: localOrder.finalAmount || apiOrder.finalAmount,
              };
            }
            return apiOrder;
          });
        }
        
        // Filter out previous day orders for self-service mode
        if (profileData.is_self_service) {
          const today = new Date().toDateString();
          const todayOrders = finalOrders.filter(order => {
            const orderDate = new Date(order.createdAt).toDateString();
            const isTodayOrder = orderDate === today;
            if (!isTodayOrder) {
              console.log(`🗑️ Filtering out previous day order: ${order.id} from ${orderDate}`);
            }
            return isTodayOrder;
          });
          console.log(`📅 Filtered orders: ${finalOrders.length} → ${todayOrders.length} (today only)`);
          dispatch(setOrders(todayOrders));
        } else {
          dispatch(setOrders(finalOrders));
        }
      } else {
        dispatch(setOrders([]));
      }
    } catch (err) {
      console.error('❌ Error loading data:', err);
      dispatch(setOrders([]));
    } finally {
      dispatch(setOrdersLoading(false));
    }
  };

  // ============ EFFECT: Load on mount ============
  useEffect(() => {
    performLoad(true); // Force load tables and orders on initial mount
  }, []); // Empty array - load once on mount

  // ============ EFFECT: WebSocket listeners ============
  useEffect(() => {
    const handleOrderCreated = () => {
      console.log('📱 WebSocket: order_created');
      performLoad();
    };

    const handleOrderUpdated = () => {
      console.log('📱 WebSocket: order_updated');
      performLoad();
    };

    const handleOrderStatusChanged = () => {
      console.log('📱 WebSocket: order_status_changed');
      performLoad();
    };

    wsService.on('order_created', handleOrderCreated);
    wsService.on('order_updated', handleOrderUpdated);
    wsService.on('order_status_changed', handleOrderStatusChanged);

    return () => {
      wsService.off('order_created', handleOrderCreated);
      wsService.off('order_updated', handleOrderUpdated);
      wsService.off('order_status_changed', handleOrderStatusChanged);
    };
  }, []); // Empty array - set up listeners once

  // ============ EFFECT: Navigation focus listener ============
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      console.log('🎯 OrdersScreen focused - loading orders in background');
      // Don't force reload - just background refresh with cached data
      performLoad(false); // false = use cache, refresh in background
    });
    return unsubscribe;
  }, [navigation]); // Only depends on navigation

  // Ensure hardware Back button always takes the user to Home when Orders is focused
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        (navigation as any).navigate('Home');
        return true; // override default
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [navigation])
  );

  // Always make the header back button go to Home
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: (props) => (
        <HeaderBackButton {...props} tintColor="#fff" onPress={() => (navigation as any).navigate('Home')} />
      ),
    });
  }, [navigation]);

  // ============ EFFECT: Clean up expired completed orders (30 minutes) ============
  useEffect(() => {
    const checkAndRemoveExpiredOrders = () => {
      const now = Date.now();
      const expiredOrders = orders.filter(order => {
          if (order.status === 'completed' && order.expiresAt) {
          const isExpired = now > order.expiresAt;
          if (isExpired) {
            console.log(`🗑️ Order ${order.tableNumber} expired - removing`);
            dispatch(removeOrder(order.id));
          }
          return isExpired;
        }
        return false;
      });
      
      if (expiredOrders.length > 0) {
        console.log(`⏰ Removed ${expiredOrders.length} expired orders`);
      }
    };

    // Check every minute
    const interval = setInterval(checkAndRemoveExpiredOrders, 60000);
    
    // Also check on initial load
    checkAndRemoveExpiredOrders();
    
    return () => clearInterval(interval);
  }, [orders, dispatch]);

  // ============ HELPERS: Memoized functions for rendering ============
  const getTableOrder = useCallback((tableId: string): Order | undefined => {
    return orders.find(order => order.tableId === tableId);
  }, [orders]);

  const hasReadyItems = useCallback((order: Order | undefined): boolean => {
    if (!order) return false;
    return order.items.some(item => item.status === 'ready');
  }, []);

  const getReadyItemCount = useCallback((order: Order | undefined): number => {
    if (!order) return 0;
    return order.items.filter(item => item.status === 'ready').length;
  }, []);

  const areAllItemsReady = useCallback((order: Order | undefined): boolean => {
    if (!order || order.items.length === 0) return false;
    return order.items.every(item => item.status === 'ready' || item.status === 'served');
  }, []);

  // Calculate bill amount from items (more accurate than stored totalAmount)
  const calculateBillAmount = useCallback((order: Order | undefined): number => {
    if (!order) return 0;
    return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, []);

  // ============ HANDLERS ============
  const handleDeleteOrder = (orderId: string) => {
    Alert.alert('Delete Order', 'Are you sure you want to delete this order?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Delete',
        onPress: async () => {
          try {
            // Get the order to find table_id
            const order = orders.find(o => o.id === orderId);
            
            // Cancel order via API (backend doesn't have delete, so we cancel it)
            await apiClient.cancelOrder(orderId);
            
            // If dine-in mode and table is linked, mark table as vacant
            if (profile && !profile.is_self_service && order?.tableId) {
              try {
                await apiClient.setTableVacant(order.tableId);
                console.log('✅ Table marked as vacant');
                performLoad();
              } catch (tableErr) {
                console.error('❌ Error marking table as vacant:', tableErr);
              }
            }
            
            // Remove from Redux state
            dispatch(removeOrder(orderId));
          } catch (err) {
            console.error('Error deleting order:', err);
            Alert.alert('Error', 'Failed to delete order');
          }
        },
        style: 'destructive',
      },
    ]);
  };

  const handleItemStatusClick = async (orderId: string, itemSubId: string, currentStatus: ItemStatus) => {
    // Waiter can only click when chef marks as ready (✅)
    if (currentStatus !== 'ready') {
      return; // Don't allow clicking on other statuses
    }

    // Change check mark (ready) to green tick (served)
    const newStatus: ItemStatus = 'served';
    
    // Update the order item status in Redux
    const order = orders.find(o => o.id === orderId);
    if (order) {
      const updatedItems = order.items.map(item => {
        // Match by subId if available, otherwise fall back to id
        const matchKey = item.subId || `${item.id}-0`;
        if (matchKey === itemSubId) {
          return {
            ...item,
            status: newStatus,
            statusUpdatedAt: Date.now(),
          };
        }
        return item;
      });
      
      const updatedOrder = {
        ...order,
        items: updatedItems,
      };
      
      dispatch(updateOrder(updatedOrder));
    }
  };

  const handleCheckout = (orderId: string) => {
    navigation.navigate('BillSummary', { orderId });
  };

  const handleDeleteTable = (tableId: string, tableName: string) => {
    Alert.alert('Delete Table', `Are you sure you want to delete Table ${tableName}?`, [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Delete',
        onPress: async () => {
          try {
            console.log('🗑️ Deleting table:', tableId);
            await apiClient.deleteTable(tableId);
            console.log('✅ Table deleted successfully');
            performLoad();
            Alert.alert('Success', `Table ${tableName} deleted`);
          } catch (err) {
            console.error('❌ Error deleting table:', err);
            Alert.alert('Error', 'Failed to delete table');
          }
        },
        style: 'destructive',
      },
    ]);
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
        {/* Table Grid - Only show if in dine-in mode (not self-service) */}
        {profile && !profile.is_self_service && (
          <>
            <Text style={styles.sectionTitle}>Restaurant Tables</Text>
            {loadingTables ? (
              <View style={styles.tablesLoadingContainer}>
                <ActivityIndicator size="small" color="#7c3aed" />
              </View>
            ) : tables.length === 0 ? (
              <Text style={styles.noTablesText}>No tables configured</Text>
            ) : (
              <View style={styles.tablesGrid}>
                {tables.map(table => {
                  const tableOrder = getTableOrder(table.id);
                  const isOccupied = table.is_occupied;
                  console.log(`📍 Table ${table.name}:`, { id: table.id, isOccupied, hasOrder: !!tableOrder, ordersCount: orders.length });
                  const itemsReady = hasReadyItems(tableOrder);
                  const readyCount = getReadyItemCount(tableOrder);
                  const billAmount = calculateBillAmount(tableOrder);
                  
                  return (
                    <View key={table.id} style={styles.tableCardWrapper}>
                      <TouchableOpacity
                        style={[
                          styles.tableCard,
                          isOccupied && styles.tableCardOccupied,
                          itemsReady && styles.tableCardReady
                        ]}
                        onPress={() => {
                          console.log('📍 TABLE CLICKED:', { id: table.id, name: table.name, isOccupied, hasOrder: !!tableOrder, itemsReady });
                          if (isOccupied && tableOrder) {
                            // Navigate to dedicated OrderDetailsScreen
                            navigation.navigate('OrderDetails', { 
                              orderId: tableOrder.id,
                              tableName: table.name 
                            });
                          } else {
                            console.log('🚀 Navigating to TakeOrder with:', { tableId: table.id, tableName: table.name });
                            navigation.navigate('TakeOrder', { 
                              tableId: table.id, 
                              tableName: table.name 
                            });
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        {/* Table Card Header */}
                        <View style={styles.tableCardHeader}>
                          <View style={styles.tableNameRow}>
                            <Text style={styles.tableCardNumber}>{table.name}</Text>
                            {table.capacity && (
                              <Text style={styles.capacityText}>({table.capacity})</Text>
                            )}
                          </View>
                          <View style={[
                            styles.statusBadge,
                            itemsReady ? styles.statusBadgeReady : (isOccupied ? styles.statusBadgeOccupied : styles.statusBadgeVacant)
                          ]}>
                            <Text style={styles.statusBadgeText}>
                              {itemsReady ? 'Ready' : (isOccupied ? 'Occupied' : 'Vacant')}
                            </Text>
                          </View>
                        </View>

                        {/* Table Card Content */}
                        <View style={styles.tableCardContent}>
                          {isOccupied && tableOrder ? (
                            <>
                              {itemsReady ? (
                                <>
                                  <Text style={styles.readySymbol}>🍴</Text>
                                  <Text style={styles.readyText}>
                                    {readyCount} {readyCount === 1 ? 'Item' : 'Items'} to Serve
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <Text style={styles.tableCardSubtext}>
                                    {tableOrder.items.length} {tableOrder.items.length === 1 ? 'Item' : 'Items'}
                                  </Text>
                                  <Text style={styles.tableCardTotal}>
                                    ₹{billAmount.toFixed(2)}
                                  </Text>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <Text style={styles.tableCardSubtext}>Empty</Text>
                              <Text style={styles.tableCardTotal}>—</Text>
                            </>
                          )}
                          <Text style={styles.tableCardHint}>
                            {itemsReady ? 'Tap to serve' : (isOccupied ? 'Tap to view' : 'Tap to create')}
                          </Text>
                        </View>
                      </TouchableOpacity>

                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* Self-Service Orders List - Show if in self-service mode */}
        {profile?.is_self_service && (
          <>
            <Text style={styles.sectionTitle}>Active Orders</Text>
            {sortedOrders.length === 0 ? (
              <Text style={styles.noTablesText}>No orders yet</Text>
            ) : (
              <View style={styles.ordersListContainer}>
                {sortedOrders.map(order => {
                  const itemsReady = hasReadyItems(order);
                  const readyCount = getReadyItemCount(order);
                  const billAmount = calculateBillAmount(order);
                  const isCompleted = order.status === 'completed';
                  const allItemsReady = areAllItemsReady(order);
                  
                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={[
                        styles.orderCard,
                        isCompleted && !order.isSelfService && styles.orderCardCompleted,
                        itemsReady && !isCompleted && styles.orderCardReady
                      ]}
                      onPress={() => {
                        // In self-service mode orders are view-only — always open OrderDetails in view-only mode
                        navigation.navigate('OrderDetails', { 
                          orderId: order.id,
                          tableName: `Order ${order.isSelfService && order.orderNumber ? order.orderNumber : order.tableNumber}`
                        });
                      }}
                      activeOpacity={0.8}
                      // Allow tapping self-service orders even if completed so we can view details (view-only)
                      disabled={isCompleted && !order.isSelfService}
                    >
                      <View style={styles.orderCardHeader}>
                        <Text style={[styles.orderCardNumber, isCompleted && styles.orderCardNumberCompleted]}>
                          Order {order.isSelfService && order.orderNumber ? order.orderNumber : order.tableNumber}
                        </Text>
                        {/* Show indicators on the right */}
                        {allItemsReady ? (
                          <Text style={styles.orderReadyCheckmark}>✓</Text>
                        ) : itemsReady ? (
                          <Text style={styles.orderReadyCountBadge}>
                            {readyCount} {readyCount === 1 ? 'item' : 'items'} ready
                          </Text>
                        ) : null}
                      </View>

                      {/* Show content below */}

                      <View style={styles.orderCardContent}>
                        <Text style={styles.orderCardSubtext}>
                          {order.items.length} {order.items.length === 1 ? 'Item' : 'Items'}
                        </Text>
                        <Text style={styles.orderCardTotal}>
                          ₹{billAmount.toFixed(2)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {profile?.is_self_service && (
        <TouchableOpacity
          onPress={() => navigation.navigate('SelfServiceOrder')}
            style={[styles.addOrderBtn, { bottom: insets.bottom + 12 }]}
        >
          <Text style={styles.addOrderBtnText}>+</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  addOrderBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  addOrderBtnText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  tablesLoadingContainer: {
    paddingVertical: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noTablesText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  tablesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 8,
  },
  tableCardWrapper: {
    width: '31%',
    position: 'relative',
  },
  tableCard: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    minHeight: 135, // Increased from 120
  },
  tableCardOccupied: {
    borderColor: '#ff6b6b',
    backgroundColor: '#fff8f8',
  },
  tableCardReady: {
    borderColor: '#ffc107',
    backgroundColor: '#fffbf0',
    borderWidth: 3,
  },
  tableCardHeader: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tableCardNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
  statusBadgeVacant: {
    backgroundColor: '#d4edda',
  },
  statusBadgeOccupied: {
    backgroundColor: '#f8d7da',
  },
  statusBadgeReady: {
    backgroundColor: '#fff3cd',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  tableNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  capacityText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  tableCardContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    height: 65,
    justifyContent: 'center',
  },
  tableCardSubtext: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 6,
  },
  tableCardTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7c3aed',
    marginBottom: 4,
  },
  tableCardHint: {
    fontSize: 11,
    fontWeight: '500',
    color: '#7c3aed',
    marginTop: 4,
  },
  readySymbol: {
    fontSize: 24,
    marginBottom: 2,
  },
  readyText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ff6b6b',
    marginBottom: 2,
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
  // Order Card Styles (for self-service mode)
  ordersListContainer: {
    marginBottom: 12,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    padding: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  orderCardCompleted: {
    borderColor: '#4caf50',
    backgroundColor: '#f0fff0',
  },
  orderCardReady: {
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderCardNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  orderCardNumberCompleted: {
    color: '#999',
  },
  orderCardContent: {
    marginBottom: 8,
  },
  orderCardSubtext: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  orderCardTotal: {
    fontSize: 18,
    fontWeight: '700',
    color: '#7c3aed',
  },
  orderCardHint: {
    fontSize: 12,
    color: '#ff6b6b',
    fontWeight: '600',
  },
  orderReadyCheckmark: {
    fontSize: 24,
    color: '#4caf50',
    fontWeight: 'bold',
  },
  orderReadyCountBadge: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f59e0b',
  },
  statusBadgeCompleted: {
    backgroundColor: '#e0e0e0',
  },
  statusBadgePending: {
    backgroundColor: '#e8e8ff',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
  },
  modalCloseBtn: {
    fontSize: 24,
    color: '#999',
    fontWeight: '600',
  },
  modalItems: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  modalOrderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 8,
  },
  modalItemInfo: {
    flex: 1,
  },
  modalItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  modalItemQuantity: {
    fontSize: 12,
    color: '#666',
  },
  modalItemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
    marginHorizontal: 12,
    minWidth: 50,
    textAlign: 'right',
  },
  modalItemStatus: {
    fontSize: 18,
  },
  modalFooter: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  modalTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 12,
  },
  modalTotalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  modalTotalAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#7c3aed',
  },
  modalActions: {
    flexDirection: 'row',
  },
  modalActionBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  modalActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
  },
  modalCheckoutBtn: {
    flex: 1,
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  modalCheckoutBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
