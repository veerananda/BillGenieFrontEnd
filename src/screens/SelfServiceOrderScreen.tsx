import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  Modal,
  ActivityIndicator,
  FlatList,
  TextInput,
  Alert,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';
import { getNextOrderNumber } from '../utils/OrderNumberUtils';
import { calculateOrderTotals } from '../utils/orderCalculations';
import { apiClient, RestaurantProfile } from '../services/api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { addOrder } from '../store/ordersSlice';
import { selectProfile } from '../store/profileSlice';
import { TAX_RATE, ORDER_EXPIRATION_MS, COLORS, STRINGS } from '../constants';

type RootStackParamList = {
  SelfServiceOrder: undefined;
  Orders: undefined;
};

type SelfServiceOrderScreenProps = NativeStackScreenProps<RootStackParamList, 'SelfServiceOrder'>;

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isVegetarian: boolean;
}

interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  isVegetarian: boolean;
}

type PaymentMethod = 'cash' | 'upi';

const SelfServiceOrderScreenComponent = ({ navigation }: SelfServiceOrderScreenProps) => {
  const dispatch = useAppDispatch();
  const profile = useAppSelector(selectProfile);
  const insets = useSafeAreaInsets();

  // Order creation state
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<MenuCategory | null>(null);
  const [categoryQuantities, setCategoryQuantities] = useState<{ [key: string]: number }>({});

  // Checkout state
  const [showCheckout, setShowCheckout] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0');
  const [discountType, setDiscountType] = useState<'amount' | 'percentage'>('amount');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [showCashModal, setShowCashModal] = useState(false);
  const [showUPIModal, setShowUPIModal] = useState(false);
  const [cashGiven, setCashGiven] = useState('');
  const [upiTransactionId, setUpiTransactionId] = useState('');
  const [upiQrCode, setUpiQrCode] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);

  // Initialize
  useEffect(() => {
    loadOrderNumberAndMenu();
  }, []);

  // Load UPI QR code when showing UPI modal
  useEffect(() => {
    if (showUPIModal && profile?.upi_qr_code) {
      try {
        // Validate that it's a valid string
        if (typeof profile.upi_qr_code === 'string' && profile.upi_qr_code.length > 0) {
          setUpiQrCode(profile.upi_qr_code);
        } else {
          console.warn('Invalid UPI QR code format');
          setUpiQrCode(null);
        }
      } catch (error) {
        console.error('Error setting UPI QR code:', error);
        setUpiQrCode(null);
      }
    }
  }, [showUPIModal, profile?.upi_qr_code]);

  const loadOrderNumberAndMenu = async () => {
    try {
      // Get next order number
      const nextOrderNum = await getNextOrderNumber();
      setOrderNumber(nextOrderNum);
      console.log('📦 Generated order number:', nextOrderNum);

      // Load menu items from API
      const menuItems = await apiClient.listMenuItems();
      
      // Group menu items by category
      const categoryMap = new Map<string, MenuItem[]>();
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
      console.log('🍽️ Loaded', loadedCategories.length, 'categories');
    } catch (error) {
      console.error('Error loading menu:', error);
      Alert.alert('Error', 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = (item: MenuItem) => {
    const existingItem = orderItems.find(oi => oi.menuItemId === item.id);
    if (existingItem) {
      setOrderItems(
        orderItems.map(oi =>
          oi.menuItemId === item.id ? { ...oi, quantity: oi.quantity + 1 } : oi
        )
      );
    } else {
      setOrderItems([
        ...orderItems,
        {
          id: `${item.id}-${Date.now()}`,
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          isVegetarian: item.isVegetarian,
        },
      ]);
    }
    setCategoryQuantities({});
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const handleQuantityChange = (index: number, newQuantity: number) => {
    if (newQuantity <= 0) {
      handleRemoveItem(index);
    } else {
      setOrderItems(
        orderItems.map((item, i) =>
          i === index ? { ...item, quantity: newQuantity } : item
        )
      );
    }
  };

  const orderCalculations = useMemo(() => 
    calculateOrderTotals(orderItems, discountAmount, discountType), 
    [orderItems, discountAmount, discountType]
  );
  const { subtotal, taxAmount, discountValue, finalAmount } = orderCalculations;
  const cashGivenAmount = parseFloat(cashGiven) || 0;
  const balance = cashGivenAmount - finalAmount;

  const handleCashPayment = async () => {
    if (orderItems.length === 0) {
      Alert.alert('Error', 'Please add items to your order before payment.');
      return;
    }
    if (!isValidCash()) {
      Alert.alert('Error', `Please enter amount ≥ ₹${finalAmount.toFixed(2)}`);
      return;
    }

    setProcessingPayment(true);
    try {
      // Save order with payment info
      await saveOrder('cash');
      setShowCashModal(false);
      
      Alert.alert(
        'Payment Successful',
        `Order ${orderNumber} completed!\n\nChange: ₹${balance.toFixed(2)}`,
        [
          {
            text: 'OK',
            onPress: () => (navigation as any).reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] }),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to process payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleUPIPayment = async () => {
    if (orderItems.length === 0) {
      Alert.alert('Error', 'Please add items to your order before payment.');
      return;
    }
    if (!upiTransactionId.trim()) {
      Alert.alert('Error', 'Please enter UPI transaction ID.');
      return;
    }

    setProcessingPayment(true);
    try {
      // Save order with UPI payment info
      await saveOrder('upi');
      setShowUPIModal(false);

      Alert.alert(
        'Payment Successful',
        `Order ${orderNumber} completed!\n\nAmount paid: ₹${finalAmount.toFixed(2)}`,
        [
          {
            text: 'OK',
            onPress: () => (navigation as any).reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] }),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to process payment');
    } finally {
      setProcessingPayment(false);
    }
  };

  const saveOrder = async (paymentMethod: string) => {
    try {
      // Create order object
      const order = {
        id: `self-service-${orderNumber}-${Date.now()}`,
        orderNumber: orderNumber,
        customerName: STRINGS.selfService,
        tableNumber: `#${orderNumber}`,
        table_id: `self-service-${orderNumber}`, // Add table_id for backend
        items: orderItems,
        totalAmount: subtotal,
        discountAmount: discountValue,
        taxAmount: taxAmount,
        finalAmount: finalAmount,
        paymentMethod: paymentMethod,
        upiTransactionId: paymentMethod === 'upi' ? upiTransactionId : undefined,
        cashGiven: paymentMethod === 'cash' ? cashGivenAmount : undefined,
        balance: paymentMethod === 'cash' ? balance : undefined,
        status: 'completed',
        isSelfService: true, // Mark as self-service order
        createdAt: Date.now(),
        expiresAt: Date.now() + ORDER_EXPIRATION_MS,
      };

      // Save to backend
      // Ensure orderNumber is available (guard against null)
      const resolvedOrderNumber = orderNumber ?? await getNextOrderNumber();

      const createdOrder = await apiClient.createOrder({
        table_number: resolvedOrderNumber.toString(), // Convert to string for backend
        table_id: `self-service-${resolvedOrderNumber}`, // Add table_id
        customer_name: STRINGS.selfService, // Add customer name to help identify self-service orders
        items: order.items.map(item => ({
          menu_item_id: item.menuItemId,
          quantity: item.quantity,
        })),
        order_number: resolvedOrderNumber,
      });

      // Complete payment to mark order as completed
      await apiClient.completeOrderWithPayment(createdOrder.id, {
        payment_method: paymentMethod as 'cash' | 'upi',
        amount_received: paymentMethod === 'cash' ? cashGivenAmount : finalAmount,
        change_returned: paymentMethod === 'cash' ? Math.max(0, cashGivenAmount - finalAmount) : undefined,
        upi_transaction_id: paymentMethod === 'upi' ? upiTransactionId : undefined,
      });

      // Add to Redux
      dispatch(addOrder(order as any));

      // Save to AsyncStorage for persistence
      try {
        const ordersList = await getJSONOrDefault<any[]>('orders', []);
        ordersList.push(order);
        await safeSetJSON('orders', ordersList);
      } catch (e) {
        console.warn('⚠️ Failed to persist self-service order to cache', e);
      }

      console.log('✅ Self-service order saved:', order.orderNumber);
    } catch (error) {
      console.error('Error saving order:', error);
      throw error;
    }
  };

  const isValidCash = useCallback(() => cashGivenAmount >= finalAmount, [cashGivenAmount, finalAmount]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!showCheckout ? (
        <>
          {/* Order Number Subheader */}
          <View style={styles.subheader}>
            <Text style={styles.orderNumberSubheader}>Order {orderNumber}</Text>
          </View>

          {/* Categories */}
          <ScrollView style={styles.categoriesContainer} showsVerticalScrollIndicator={true}>
            <View style={styles.categoriesGrid}>
              {categories.map((category, index) => (
                <TouchableOpacity
                  key={category.id}
                  style={styles.categoryButton}
                  onPress={() => {
                    setSelectedCategory(category);
                    setShowCategoryModal(true);
                  }}
                >
                  <Text style={styles.categoryButtonText}>{category.name}</Text>
                  <Text style={styles.categoryCount}>({category.items.length})</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Order Items */}
          <View style={styles.orderItemsContainer}>
            {orderItems.length === 0 ? (
              <Text style={styles.emptyText}>No items added. Select from categories above.</Text>
            ) : (
              <ScrollView style={styles.itemsList}>
                {orderItems.map((item, index) => (
                  <View key={index} style={styles.orderItemRow}>
                    <View style={styles.orderItemInfo}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemPrice}>₹{item.price}</Text>
                    </View>
                    <View style={styles.quantityControl}>
                      <TouchableOpacity
                        onPress={() => handleQuantityChange(index, item.quantity - 1)}
                        style={styles.quantityButton}
                      >
                        <Text style={styles.quantityButtonText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.quantity}>{item.quantity}</Text>
                      <TouchableOpacity
                        onPress={() => handleQuantityChange(index, item.quantity + 1)}
                        style={styles.quantityButton}
                      >
                        <Text style={styles.quantityButtonText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Summary and Checkout */}
          {orderItems.length > 0 && (
            <View style={[styles.summaryContainer, { paddingBottom: insets.bottom }]}>
              <View style={styles.summaryRow}>
                <Text>{STRINGS.subtotal}</Text>
                <Text style={styles.amount}>₹{subtotal.toFixed(2)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text>Tax (5%):</Text>
                <Text style={styles.amount}>₹{taxAmount.toFixed(2)}</Text>
              </View>
              {discountValue > 0 && (
                <View style={styles.summaryRow}>
                  <Text>Discount:</Text>
                  <Text style={[styles.amount, { color: '#4caf50' }]}>-₹{discountValue.toFixed(2)}</Text>
                </View>
              )}
              <View style={[styles.summaryRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total:</Text>
                <Text style={styles.totalAmount}>₹{finalAmount.toFixed(2)}</Text>
              </View>

              <TouchableOpacity
                style={styles.checkoutButton}
                onPress={() => setShowCheckout(true)}
              >
                <Text style={styles.checkoutButtonText}>Proceed to Payment</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Category Modal */}
          <Modal visible={showCategoryModal} transparent animationType="slide">
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{selectedCategory?.name}</Text>
                  <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  scrollEnabled={true}
                  data={selectedCategory?.items || []}
                  keyExtractor={item => item.id}
                  renderItem={({ item }) => {
                    const existingItem = orderItems.find(oi => oi.menuItemId === item.id);
                    const currentQty = existingItem?.quantity || 0;
                    
                    return (
                      <View style={styles.menuItemWithQty}>
                        <View style={styles.menuItemInfo}>
                          <View style={styles.menuItemNameRow}>
                            <Text style={styles.menuItemName}>{item.name}</Text>
                            <Text style={styles.vegNonVegTag}>
                              {item.isVegetarian ? '🌱' : '🍖'}
                            </Text>
                          </View>
                          <Text style={styles.menuItemPrice}>₹{item.price}</Text>
                        </View>
                        <View style={styles.qtyControlsContainer}>
                          {currentQty === 0 ? (
                            <TouchableOpacity
                              style={styles.addItemButton}
                              onPress={() => handleAddItem(item)}
                            >
                              <Text style={styles.addItemButtonText}>Add</Text>
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.qtyControls}>
                              <TouchableOpacity
                                onPress={() => {
                                  const index = orderItems.findIndex(oi => oi.menuItemId === item.id);
                                  handleQuantityChange(index, currentQty - 1);
                                }}
                                style={styles.qtyButton}
                              >
                                <Text style={styles.qtyButtonText}>−</Text>
                              </TouchableOpacity>
                              <Text style={styles.qtyDisplay}>{currentQty}</Text>
                              <TouchableOpacity
                                onPress={() => {
                                  const index = orderItems.findIndex(oi => oi.menuItemId === item.id);
                                  handleQuantityChange(index, currentQty + 1);
                                }}
                                style={styles.qtyButton}
                              >
                                <Text style={styles.qtyButtonText}>+</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  }}
                />
              </View>
            </View>
          </Modal>
        </>
      ) : (
        <>
        </>
      )}

      {/* Checkout Modal */}
      <Modal 
        visible={showCheckout} 
        transparent 
        animationType="slide"
        onShow={() => console.log('🔔🔔🔔 CHECKOUT MODAL IS NOW VISIBLE')}
      >
        <View style={styles.checkoutModalOverlay}>
          <View style={[styles.checkoutModalContent, { paddingTop: insets.top }]}>
            <View style={styles.checkoutModalHeader}>
              <TouchableOpacity 
                onPress={() => {
                  console.log('⬅️ Back button pressed');
                  setShowCheckout(false);
                }} 
                style={{ marginRight: 12 }}
                activeOpacity={0.7}
              >
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.paymentHeaderText}>Payment</Text>
              <View style={{ width: 50 }} />
            </View>
            <ScrollView 
              style={styles.checkoutContainer} 
              contentContainerStyle={styles.checkoutContainerContent}
              scrollEnabled={true}
              keyboardShouldPersistTaps="handled"
            >
            {/* Order Summary */}
            <View style={styles.checkoutCard}>
              <Text style={styles.cardTitle}>Order Summary</Text>
              {orderItems.map((item, index) => (
                <View key={index} style={styles.checkoutItem}>
                  <Text style={styles.checkoutItemName}>
                    {item.name} × {item.quantity}
                  </Text>
                  <Text style={styles.checkoutItemPrice}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                </View>
              ))}
              <View style={styles.checkoutDivider} />
              <View style={styles.checkoutSummary}>
                <View style={styles.summaryRow}>
                  <Text>{STRINGS.subtotal}</Text>
                  <Text>₹{subtotal.toFixed(2)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text>Tax (5%):</Text>
                  <Text>₹{taxAmount.toFixed(2)}</Text>
                </View>
                {discountValue > 0 && (
                  <View style={styles.summaryRow}>
                    <Text>Discount:</Text>
                    <Text style={{ color: '#4caf50' }}>-₹{discountValue.toFixed(2)}</Text>
                  </View>
                )}
                <View style={[styles.summaryRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Final Amount:</Text>
                  <Text style={styles.totalAmount}>₹{finalAmount.toFixed(2)}</Text>
                </View>
              </View>
            </View>

            {/* Discount Section */}
            <View style={styles.checkoutCard}>
              <Text style={styles.cardTitle}>Discount (Optional)</Text>
              <View style={styles.discountRow}>
                <TextInput
                  style={styles.discountInput}
                  placeholder="Amount"
                  keyboardType="decimal-pad"
                  value={discountAmount}
                  onChangeText={setDiscountAmount}
                />
                <TouchableOpacity
                  style={[
                    styles.discountTypeButton,
                    discountType === 'amount' && styles.discountTypeActive,
                  ]}
                  onPress={() => setDiscountType('amount')}
                >
                  <Text style={[styles.discountTypeText, discountType === 'amount' && styles.discountTypeTextActive]}>₹</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.discountTypeButton,
                    discountType === 'percentage' && styles.discountTypeActive,
                  ]}
                  onPress={() => setDiscountType('percentage')}
                >
                  <Text style={styles.discountTypeText}>%</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Payment Methods */}
            <View style={styles.checkoutCard} pointerEvents="box-none">
              <Text style={styles.cardTitle}>Payment Method</Text>
              <View style={{ backgroundColor: '#fff', padding: 10, marginBottom: 10 }} pointerEvents="auto">
                <Pressable
                  style={({ pressed }) => [
                    styles.paymentMethodButton,
                    paymentMethod === 'cash' && styles.paymentMethodActive,
                    pressed && { opacity: 0.5, backgroundColor: '#ddd' },
                  ]}
                  onPressIn={() => console.log('💵💵💵 CASH BUTTON PRESS IN')}
                  onPressOut={() => console.log('💵💵💵 CASH BUTTON PRESS OUT')}
                  onPress={() => {
                    console.log('💵💵💵 Cash payment button ONPRESS - iOS');
                    console.log('💵💵💵 Setting payment method to cash');
                    setPaymentMethod('cash');
                    console.log('💵💵💵 Closing checkout modal to avoid iOS nested modal issue');
                    setShowCheckout(false);
                    console.log('💵💵💵 Setting showCashModal to true after 200ms delay');
                    setTimeout(() => {
                      setShowCashModal(true);
                      console.log('💵💵💵 ShowCashModal state updated');
                    }, 200);
                  }}
                >
                  <Text
                    style={[
                      styles.paymentMethodText,
                      paymentMethod === 'cash' && styles.paymentMethodTextActive,
                    ]}
                  >
                    💵 Pay by Cash
                  </Text>
                </Pressable>
              </View>
              <View style={{ backgroundColor: '#fff', padding: 10 }} pointerEvents="auto">
                <Pressable
                  style={({ pressed }) => [
                    styles.paymentMethodButton,
                    paymentMethod === 'upi' && styles.paymentMethodActive,
                    pressed && { opacity: 0.5, backgroundColor: '#ddd' },
                  ]}
                  onPressIn={() => console.log('📱📱📱 UPI BUTTON PRESS IN')}
                  onPressOut={() => console.log('📱📱📱 UPI BUTTON PRESS OUT')}
                  onPress={() => {
                    console.log('📱📱📱 UPI payment button ONPRESS - iOS');
                    console.log('📱📱📱 Setting payment method to upi');
                    setPaymentMethod('upi');
                    console.log('📱📱📱 Closing checkout modal to avoid iOS nested modal issue');
                    setShowCheckout(false);
                    console.log('📱📱📱 Setting showUPIModal to true after 200ms delay');
                    setTimeout(() => {
                      setShowUPIModal(true);
                      console.log('📱📱📱 ShowUPIModal state updated');
                    }, 200);
                  }}
                >
                  <Text
                    style={[
                      styles.paymentMethodText,
                      paymentMethod === 'upi' && styles.paymentMethodTextActive,
                    ]}
                  >
                    📱 Pay by UPI
                  </Text>
                </Pressable>
              </View>
            </View>

          </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Cash Payment Modal */}
      <Modal 
        visible={showCashModal} 
        transparent 
        animationType="fade"
        onShow={() => console.log('💰💰💰 CASH MODAL IS NOW SHOWING')}
        onDismiss={() => console.log('💰 Cash modal dismissed')}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.paymentModalOverlay}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={styles.paymentModalContent}>
            <Text style={styles.paymentModalTitle}>Cash Payment</Text>
            
            {/* Bill Summary */}
            <View style={styles.billSummarySection}>
              <Text style={styles.billSectionTitle}>Bill Details</Text>
              {orderItems.map((item, index) => (
                <View key={index} style={styles.billItemRow}>
                  <Text style={styles.billItemName}>{item.name} × {item.quantity}</Text>
                  <Text style={styles.billItemPrice}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                </View>
              ))}
              <View style={styles.billDivider} />
              <View style={styles.billRow}>
                <Text>{STRINGS.subtotal}</Text>
                <Text>₹{subtotal.toFixed(2)}</Text>
              </View>
              <View style={styles.billRow}>
                <Text>Tax (5%):</Text>
                <Text>₹{taxAmount.toFixed(2)}</Text>
              </View>
              {discountValue > 0 && (
                <View style={styles.billRow}>
                  <Text>Discount:</Text>
                  <Text style={{ color: '#4caf50' }}>-₹{discountValue.toFixed(2)}</Text>
                </View>
              )}
              <View style={[styles.billRow, styles.billTotalRow]}>
                <Text style={styles.billTotalLabel}>{STRINGS.totalAmount}</Text>
                <Text style={styles.billTotalAmount}>₹{finalAmount.toFixed(2)}</Text>
              </View>
            </View>

            {/* Cash Given Input Section */}
            <View style={styles.cashInputSection}>
              <Text style={styles.paymentLabel}>{STRINGS.cashGiven}</Text>
              <TextInput
                style={styles.cashInput}
                placeholder={STRINGS.enterAmount}
                keyboardType="decimal-pad"
                value={cashGiven}
                onChangeText={setCashGiven}
                returnKeyType="done"
                blurOnSubmit={true}
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>

            {/* Change Calculation */}
            {cashGiven && (
              <View style={styles.changeSection}>
                <View style={styles.changeRow}>
                  <Text style={styles.changeLabel}>
                    {isValidCash() ? 'Change:' : 'Short by:'}
                  </Text>
                  <Text style={[styles.changeAmount, !isValidCash() && styles.errorAmount]}>
                    ₹{Math.abs(balance).toFixed(2)}
                  </Text>
                </View>
              </View>
            )}

            {/* Payment Buttons */}
            <View style={styles.paymentModalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowCashModal(false);
                  setCashGiven('');
                  setTimeout(() => {
                    setShowCheckout(true);
                  }, 200);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, !isValidCash() && styles.disabledButton]}
                onPress={handleCashPayment}
                disabled={!isValidCash() || processingPayment}
              >
                {processingPayment ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Payment Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* UPI Payment Modal */}
      <Modal visible={showUPIModal} transparent animationType="fade">
        <View style={styles.paymentModalOverlay}>
          <View style={styles.paymentModalContent}>
            <Text style={styles.paymentModalTitle}>UPI Payment</Text>
            <Text style={styles.paymentAmount}>₹{finalAmount.toFixed(2)}</Text>

            {/* QR Code Display */}
            {upiQrCode ? (
              <View style={styles.qrCodeContainer}>
                <Text style={styles.qrCodeText}>Show this QR to customer</Text>
                <View style={styles.qrPlaceholder}>
                  <Text style={styles.qrPlaceholderText}>QR Code</Text>
                  {/* In production, render actual QR image from upiQrCode */}
                </View>
              </View>
            ) : (
              <View style={styles.noQrContainer}>
                <Text style={styles.noQrText}>No QR Code Available</Text>
              </View>
            )}

            {/* Payment Buttons */}
            <View style={styles.paymentModalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowUPIModal(false);
                  setUpiTransactionId('');
                  setTimeout(() => {
                    setShowCheckout(true);
                  }, 200);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleUPIPayment}
                disabled={processingPayment}
              >
                {processingPayment ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmButtonText}>Payment Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export const SelfServiceOrderScreen = memo(SelfServiceOrderScreenComponent);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoriesContainer: {
    flex: 1,
    padding: 12,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryButton: {
    width: '48%',
    padding: 16,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  categoryCount: {
    fontSize: 12,
    color: '#e0e0e0',
    marginTop: 4,
  },
  orderItemsContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  subheader: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderNumberSubheader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#7c3aed',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  itemsList: {
    flex: 1,
  },
  orderItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  orderItemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  itemPrice: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  quantityButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  quantity: {
    marginHorizontal: 8,
    fontWeight: '600',
    minWidth: 24,
    textAlign: 'center',
  },
  itemTotal: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#7c3aed',
    minWidth: 50,
    textAlign: 'right',
  },
  summaryContainer: {
    backgroundColor: '#fff',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    fontSize: 13,
  },
  amount: {
    fontWeight: '600',
    color: '#1a1a1a',
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  checkoutButton: {
    backgroundColor: '#7c3aed',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  checkoutButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  paymentHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
    color: '#222',
  },
  paymentActionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 12,
  },
  paymentActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
  },
  paymentActionButtonActive: {
    backgroundColor: '#f0e6ff',
    borderColor: '#7c3aed',
  },
  paymentActionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  paymentActionButtonTextActive: {
    color: '#7c3aed',
  },
  checkoutModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  checkoutModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  checkoutModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  backButtonText: {
    fontSize: 16,
    color: '#7c3aed',
    fontWeight: '600',
  },
  checkoutContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  checkoutContainerContent: {
    paddingBottom: 20,
  },
  paymentActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingHorizontal: 16,
  },
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
    fontWeight: 'bold',
    color: '#1a1a1a',
    flex: 1,
  },
  modalClose: {
    fontSize: 24,
    color: '#999',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemInfo: {
    flex: 1,
  },
  menuItemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  menuItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  vegNonVegTag: {
    fontSize: 16,
    marginLeft: 6,
  },
  vegTag: {
    fontSize: 12,
    color: '#4caf50',
  },
  menuItemPrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  menuItemWithQty: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  qtyControlsContainer: {
    marginLeft: 12,
  },
  addItemButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addItemButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  qtyButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  qtyButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  qtyDisplay: {
    minWidth: 30,
    textAlign: 'center',
    fontWeight: '600',
    color: '#1a1a1a',
  },
  checkoutModalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  orderNumberHeaderModal: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#7c3aed',
    marginBottom: 12,
  },
  checkoutCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  checkoutItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  checkoutItemName: {
    fontSize: 13,
    color: '#1a1a1a',
  },
  checkoutItemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  checkoutDivider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 12,
  },
  checkoutSummary: {
    marginTop: 8,
  },
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  discountInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  discountTypeButton: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  discountTypeActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  discountTypeText: {
    fontWeight: 'bold',
    color: '#666',
  },
  discountTypeTextActive: {
    color: '#fff',
  },
  paymentMethodButton: {
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#f8f9fa',
    zIndex: 10,
    elevation: 2,
  },
  paymentMethodActive: {
    backgroundColor: '#f0e6ff',
    borderColor: '#7c3aed',
  },
  paymentMethodText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  paymentMethodTextActive: {
    color: '#7c3aed',
  },
  proceedButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  proceedButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  paymentModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  paymentModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 12,
  },
  paymentAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#7c3aed',
    textAlign: 'center',
    marginBottom: 20,
  },
  cashInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  transactionInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  balanceInfo: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 12,
    color: '#666',
  },
  balanceAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4caf50',
    marginTop: 4,
  },
  errorText: {
    color: '#f44336',
  },
  qrCodeContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  qrCodeText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  qrPlaceholder: {
    width: 200,
    height: 200,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  qrPlaceholderText: {
    color: '#999',
    fontSize: 14,
  },
  transactionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  paymentModalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#666',
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  disabledButton: {
    backgroundColor: '#ccc',
    opacity: 0.5,
  },
  billSummarySection: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
    maxHeight: 150,
  },
  billSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
    marginBottom: 8,
  },
  billItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  billItemName: {
    fontSize: 12,
    color: '#555',
    flex: 1,
  },
  billItemPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#222',
    marginLeft: 8,
  },
  billDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    fontSize: 12,
  },
  billTotalRow: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  billTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
  },
  billTotalAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7c3aed',
  },
  paymentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
    marginBottom: 8,
  },
  cashInputSection: {
    flexDirection: 'column',
    marginTop: 24,
    marginBottom: 12,
  },
  changeSection: {
    backgroundColor: '#f3e5f5',
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
  },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  changeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  changeAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7c3aed',
  },
  errorAmount: {
    color: '#f44336',
  },
  noQrContainer: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 16,
    marginVertical: 16,
    alignItems: 'center',
  },
  noQrText: {
    fontSize: 13,
    color: '#856404',
    fontWeight: '600',
  },
});
