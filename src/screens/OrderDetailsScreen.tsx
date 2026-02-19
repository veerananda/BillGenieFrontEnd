import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  FlatList,
  Alert,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient } from '../services/api';
import { wsService } from '../services/websocket';
import { CheckoutModal } from './CheckoutModal';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { updateOrderItemStatus, selectOrderById } from '../store/ordersSlice';

type RootStackParamList = {
  Orders: undefined;
  OrderDetails: { orderId: string; tableName: string };
  TakeOrder: { orderId?: string };
  BillSummary: { orderId: string };
};

type OrderDetailsScreenProps = NativeStackScreenProps<RootStackParamList, 'OrderDetails'>;

type ItemStatus = 'pending' | 'cooking' | 'ready' | 'served';

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  isVegetarian: boolean;
  status?: ItemStatus;
  statusUpdatedAt?: number;
  subId?: string;
}

interface Order {
  id: string;
  tableNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  createdAt: number;
  status: 'pending' | 'completed';
  isSelfService?: boolean; // For self-service orders (view-only)
}

export const OrderDetailsScreen: React.FC<OrderDetailsScreenProps> = ({ 
  navigation, 
  route 
}) => {
  const dispatch = useAppDispatch();
  const { orderId, tableName } = route.params;
  
  // Redux state
  const reduxOrder = useAppSelector(state => selectOrderById(state, orderId));
  
  // Local state for loading and UI
  const [order, setOrder] = useState<Order | null>(reduxOrder || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Auto-refresh when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      console.log('👁️ OrderDetailsScreen focused - refreshing data');
      loadOrderDetails();
    }, [orderId])
  );

  useEffect(() => {
    loadOrderDetails();
    
    // WebSocket listeners for real-time updates
    const handleOrderUpdated = (data: any) => {
      if (data.id === orderId) {
        console.log('📱 Order updated via WebSocket');
        loadOrderDetails();
      }
    };

    const handleOrderStatusChanged = (data: any) => {
      if (data.id === orderId) {
        console.log('📱 Order status changed via WebSocket');
        loadOrderDetails();
      }
    };

    wsService.on('order_updated', handleOrderUpdated);
    wsService.on('order_status_changed', handleOrderStatusChanged);

    return () => {
      wsService.off('order_updated', handleOrderUpdated);
      wsService.off('order_status_changed', handleOrderStatusChanged);
    };
  }, [orderId]);

  const loadOrderDetails = useCallback(async () => {
    try {
      setLoading(true);
      console.log('📋 Loading order details for:', orderId);
      const response: any = await apiClient.getOrder(orderId);
      
      // Transform the response to match our Order interface
      const transformedOrder: Order = {
        id: response.id,
        tableNumber: String(response.table_number || tableName),
        customerName: response.customer_name || '',
        items: (response.items || []).map((item: any) => ({
          id: item.id,
          name: item.name || item.menu_item?.name || 'Unknown Item',
          price: item.price || item.unit_rate || 0,
          quantity: item.quantity,
          isVegetarian: item.is_vegetarian || false,
          status: item.status || 'pending',
          statusUpdatedAt: item.status_updated_at,
        })),
        totalAmount: response.total || response.sub_total || 0,
        createdAt: new Date(response.created_at).getTime(),
        status: response.status === 'completed' ? 'completed' : 'pending',
        isSelfService: (response as any).is_self_service || (response.table_id && String(response.table_id).startsWith('self-service')) || false,
      };
      
      setOrder(transformedOrder);
      setError('');
    } catch (err) {
      console.error('❌ Error loading order details:', err);
      setError('Failed to load order details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orderId, tableName]);

  const onRefresh = useCallback(() => {
    console.log('🔄 Manual refresh triggered');
    setRefreshing(true);
    loadOrderDetails();
  }, [loadOrderDetails]);

  const getStatusSymbol = useCallback((status?: string) => {
    switch (status) {
      case 'cooking':
        return '🔥';
      case 'ready':
        return '🍴'; // Fork emoji for ready items (clickable)
      case 'served':
        return '✅'; // Green tick - show served items in OrderDetails
      case 'pending':
      default:
        return '⏳';
    }
  }, []);

  const handleReadyToServed = useCallback(async (itemName: string) => {
    try {
      if (!order) return;
      // Find all items with this name that are in "ready" status
      const itemsToUpdate = order.items.filter(
        item => item.name === itemName && item.status === 'ready'
      );

      if (itemsToUpdate.length === 0) return;

      // Update UI immediately (optimistic update)
      setOrder(prevOrder => {
        if (!prevOrder) return prevOrder;
        return {
          ...prevOrder,
          items: prevOrder.items.map(item => {
            if (item.name === itemName && item.status === 'ready') {
              return {
                ...item,
                status: 'served',
              };
            }
            return item;
          }),
        };
      });

      // Update each item via API
      for (const item of itemsToUpdate) {
        try {
          await apiClient.updateOrderItemStatus(order.id, item.id, 'served');
        } catch (error) {
          console.error('Error updating item status:', error);
        }
      }
    } catch (error) {
      console.error('Error marking ready items as served:', error);
    }
  }, [order]);

  // Group items by name, then by status to show all variants of same item together
  const getGroupedItemsByName = useCallback(() => {
    if (!order || order.items.length === 0) return [];
    
    const statusOrder = { served: 0, ready: 1, cooking: 2, pending: 3 };
    
    // Group by name, preserving first appearance order
    const groups: { [key: string]: { name: string; isVegetarian: boolean; variants: Array<{ status: ItemStatus; quantity: number; price: number }>; firstIndex: number } } = {};
    const seenNames: string[] = [];
    
    order.items.forEach((item, index) => {
      const groupKey = item.name;
      
      if (!groups[groupKey]) {
        groups[groupKey] = {
          name: item.name,
          isVegetarian: item.isVegetarian,
          variants: [],
          firstIndex: index,
        };
        seenNames.push(groupKey);
      }
      
      // Normalize status and find or create status variant
      const normalizedStatus: ItemStatus = (item.status || 'pending') as ItemStatus;
      const existingVariant = groups[groupKey].variants.find(v => v.status === normalizedStatus);
      if (existingVariant) {
        existingVariant.quantity += item.quantity;
      } else {
        groups[groupKey].variants.push({
          status: normalizedStatus,
          quantity: item.quantity,
          price: item.price,
        });
      }
    });
    
    // Sort variants within each group by status (served=0 first, pending=3 last)
    Object.values(groups).forEach(group => {
      group.variants.sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 99;
        const bOrder = statusOrder[b.status] ?? 99;
        return aOrder - bOrder;
      });
    });
    
    // Return in original order, don't re-sort groups
    return seenNames.map(name => groups[name]);
  }, [order]);

  // Memoize total calculation BEFORE any conditional returns
  const totalAmount = useMemo(() => {
    if (!order) return 0;
    return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [order?.items]);

  const [showCheckout, setShowCheckout] = useState(false);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error || 'Order not found'}</Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backBtnText}>Back to Orders</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Content */}
      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            colors={['#7c3aed']}
            tintColor="#7c3aed"
          />
        }
      >
        {/* Customer Info */}
        {order.customerName && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Customer</Text>
            <Text style={styles.customerName}>{order.customerName}</Text>
          </View>
        )}

        {/* Items Section */}
        <View style={styles.section}>
          {(() => {
            const groupedByName = getGroupedItemsByName();
            return <Text style={styles.sectionTitle}>Items ({groupedByName.length})</Text>;
          })()}
          {order.items.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No items added yet</Text>
              <Text style={styles.emptyStateSubtext}>Click "Add Items" to get started</Text>
            </View>
          ) : (
            <View style={styles.itemsList}>
              {getGroupedItemsByName().map((itemGroup, groupIndex) => (
                <View 
                  key={`${itemGroup.name}-${groupIndex}`}
                  style={[
                    styles.itemCard,
                    groupIndex === getGroupedItemsByName().length - 1 && styles.itemCardLast
                  ]}
                >
                  {/* Item Name - Left, Status Variants - Right */}
                  <View style={styles.itemCardRow}>
                    <View style={styles.itemNameWrapper}>
                      <Text style={styles.itemName}>{itemGroup.name}</Text>
                      {itemGroup.isVegetarian && (
                        <Text style={styles.vegetarianBadge}>🌱 Veg</Text>
                      )}
                    </View>

                    {/* Status Variants - Stacked on Right */}
                    <View style={styles.variantsStackRight}>
                      {itemGroup.variants.map((variant, variantIndex) => (
                        <View 
                          key={`${itemGroup.name}-${variant.status}-${variantIndex}`}
                          style={styles.variantRow}
                        >
                          {variant.status === 'ready' ? (
                            // For self-service orders we don't allow state changes here (view-only)
                            order.isSelfService ? (
                              <Text style={styles.variantIcon}>{getStatusSymbol(variant.status)}</Text>
                            ) : (
                              <TouchableOpacity
                                onPress={() => handleReadyToServed(itemGroup.name)}
                                style={styles.variantIcon}
                              >
                                <Text style={styles.variantIconText}>{getStatusSymbol(variant.status)}</Text>
                              </TouchableOpacity>
                            )
                          ) : (
                            <Text style={styles.variantIcon}>{getStatusSymbol(variant.status)}</Text>
                          )}
                          <Text style={styles.variantQty}>{variant.quantity}x</Text>
                          <Text style={styles.variantPrice}>₹{variant.price.toFixed(2)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer with Total Only */}
      <View style={styles.footer}>
        <View style={styles.totalSection}>
          <Text style={styles.totalLabel}>Total Amount</Text>
          <Text style={styles.totalAmount}>₹{totalAmount.toFixed(2)}</Text>
        </View>

        <View style={styles.footerActions}>
          {!order.isSelfService && (
            <>
              <TouchableOpacity
                style={styles.addItemsBtn}
                onPress={() => navigation.navigate('TakeOrder', { orderId: order.id })}
              >
                <Text style={styles.addItemsBtnText}>Add Items</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.checkoutBtn}
                onPress={() => setShowCheckout(true)}
              >
                <Text style={styles.checkoutBtnText}>Checkout</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Checkout Modal */}
      {showCheckout && (
        <CheckoutModal
          orderId={order.id}
          tableName={order.tableNumber || tableName}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => {
            setShowCheckout(false);
            (navigation as any).reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] });
          }}
        />
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
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  itemsList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 12,
    padding: 14,
  },
  itemCardLast: {
    marginBottom: 0,
  },
  itemCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemNameWrapper: {
    flex: 1,
  },
  variantsStackRight: {
    marginLeft: 16,
  },
  variantDisplayRight: {
    fontSize: 24,
    fontWeight: '600',
    color: '#7c3aed',
    textAlign: 'left',
    marginBottom: 6,
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  variantQty: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7c3aed',
    marginRight: 6,
  },
  variantIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  variantIconText: {
    fontSize: 24,
  },
  variantPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7c3aed',
  },
  /* footer/button variants - only a single consistent set is kept further below */
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemNameHeader: {
    backgroundColor: '#fafafa',
    paddingVertical: 10,
  },
  orderItemVariant: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  variantContent: {
    alignItems: 'flex-end',
  },
  orderItemLast: {
    borderBottomWidth: 0,
  },
  itemLeftContent: {
    flex: 1,
  },
  itemRightContent: {
    marginLeft: 12,
    alignItems: 'flex-end',
  },
  itemNameWithStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  footerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  itemQuantity: {
    fontSize: 12,
    color: '#666',
  },
  vegetarianBadge: {
    fontSize: 11,
    color: '#27ae60',
    fontWeight: '600',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7c3aed',
  },
  emptyState: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
  },
  emptyStateSubtext: {
    fontSize: 12,
    color: '#bbb',
    marginTop: 4,
  },
  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 24,
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  totalLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#7c3aed',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  addItemsBtn: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  addItemsBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  checkoutBtn: {
    flex: 1,
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  backBtn: {
    marginTop: 16,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  errorText: {
    fontSize: 14,
    color: '#e74c3c',
    textAlign: 'center',
  },
});
