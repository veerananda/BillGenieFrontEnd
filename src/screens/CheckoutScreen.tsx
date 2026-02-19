import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  Alert,
  FlatList,
  TextInput,
  Modal,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Platform,
  Pressable,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectOrderById, removeOrder, updateOrder } from '../store/ordersSlice';
import { setTableOccupied } from '../store/tablesSlice';
import { apiClient } from '../services/api';

type RootStackParamList = {
  Checkout: { orderId: string; tableName: string };
  Orders: undefined;
};

type CheckoutScreenProps = NativeStackScreenProps<RootStackParamList, 'Checkout'>;

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  isVegetarian: boolean;
  status?: 'pending' | 'cooking' | 'ready' | 'served';
}

interface Order {
  id: string;
  tableNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  finalAmount?: number; // Amount after discount
  createdAt: number;
  status: 'pending' | 'completed';
  tableId?: string;
}

export const CheckoutScreen: React.FC<CheckoutScreenProps> = ({ route, navigation }) => {
  const insets = useSafeAreaInsets();
  const { orderId, tableName } = route.params;
  const dispatch = useAppDispatch();
  const order = useAppSelector(state => selectOrderById(state, orderId)) as Order | undefined;
  
  const [discountAmount, setDiscountAmount] = useState('0');
  const [discountType, setDiscountType] = useState<'amount' | 'percentage'>('amount');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCashModal, setShowCashModal] = useState(false);
  const [showUPIModal, setShowUPIModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | ''>('');
  const [cashGiven, setCashGiven] = useState('');
  const [loading, setLoading] = useState(false);

  // Calculate subtotal from items (handle undefined order)
  const subtotal = useMemo(() => {
    if (!order) return 0;
    return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [order?.items]);

  const calculateDiscount = useCallback(() => {
    const discount = parseFloat(discountAmount) || 0;
    if (discountType === 'percentage') {
      return (subtotal * discount) / 100;
    }
    return discount;
  }, [discountAmount, discountType, subtotal]);

  const discountValue = useMemo(() => calculateDiscount(), [calculateDiscount]);
  const finalAmount = useMemo(() => subtotal - discountValue, [subtotal, discountValue]);
  
  const cashGivenAmount = useMemo(() => parseFloat(cashGiven) || 0, [cashGiven]);
  const balance = useMemo(() => cashGivenAmount - finalAmount, [cashGivenAmount, finalAmount]);
  const isValidCash = useMemo(() => cashGivenAmount >= finalAmount, [cashGivenAmount, finalAmount]);

  // Group items by name to consolidate duplicates
  const groupedItems = useMemo(() => {
    if (!order) return [];
    const grouped: { [key: string]: OrderItem & { totalQty: number } } = {};
    order.items.forEach(item => {
      if (!grouped[item.name]) {
        grouped[item.name] = { ...item, totalQty: 0 };
      }
      grouped[item.name].totalQty += item.quantity;
    });
    return Object.values(grouped);
  }, [order?.items]);

  const handlePayByCash = () => {
    setShowPaymentModal(true);
  };

  const handleCompleteUPIPayment = useCallback(async () => {
    if (!order) return;

    setLoading(true);
    try {
      const completedOrder: Order = {
        ...order,
        status: 'completed',
        finalAmount: finalAmount,
      };
      dispatch(updateOrder(completedOrder));

      try {
        await apiClient.completeOrderWithPayment(orderId, {
          payment_method: 'upi',
          amount_received: finalAmount,
          change_returned: 0,
        });
      } catch (apiErr) {
        console.error('API error updating order:', apiErr);
      }

      if (order.tableId) {
        try {
          await apiClient.updateTableStatus(order.tableId, 'vacant');
          dispatch(setTableOccupied({ tableId: order.tableId, isOccupied: false }));
        } catch (tableErr) {
          console.error('❌ Error updating table status:', tableErr);
        }
      }

      dispatch(removeOrder(orderId));

      Alert.alert(
        'Payment Successful',
        `Amount Paid: ₹${finalAmount.toFixed(2)}`,
        [
          {
            text: 'OK',
            onPress: async () => {
              await new Promise(resolve => setTimeout(resolve, 500));
              (navigation as any).reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] });
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to complete payment');
      console.error('Payment error:', error);
    } finally {
      setLoading(false);
    }
  }, [order, orderId, dispatch, finalAmount, navigation]);

  const handleCompletePayment = useCallback(async () => {
    if (!isValidCash || !order) {
      Alert.alert('Insufficient Cash', 'Please enter cash amount greater than or equal to the total');
      return;
    }

    setLoading(true);
    try {
      // Mark order as completed and store the final amount (after discount)
      const completedOrder: Order = {
        ...order,
        status: 'completed',
        finalAmount: finalAmount, // Store the amount after discount for sales tracking
      };
      dispatch(updateOrder(completedOrder));

      // Try to update via API
      try {
        await apiClient.completeOrderWithPayment(orderId, {
          payment_method: 'cash',
          amount_received: cashGivenAmount,
          change_returned: balance,
        });
      } catch (apiErr) {
        console.error('API error updating order:', apiErr);
      }

      // Update table status to vacant via API and Redux if tableId exists
      if (order.tableId) {
        try {
          console.log('🔄 Setting table to vacant:', order.tableId);
          
          // Update table status via API first
          try {
            await apiClient.updateTableStatus(order.tableId, 'vacant');
            console.log('✅ Table status updated via API');
          } catch (apiErr) {
            console.warn('⚠️ API update failed, continuing with Redux update:', apiErr);
          }
          
          // Update Redux state to mark table as not occupied
          dispatch(setTableOccupied({ tableId: order.tableId, isOccupied: false }));
          console.log('✅ Redux table state updated to not occupied');
        } catch (tableErr) {
          console.error('❌ Error updating table status:', tableErr);
        }
      }

      // Remove order from Redux
      dispatch(removeOrder(orderId));

      // Show success and navigate back
      Alert.alert(
        'Payment Successful',
        `Amount Received: ₹${cashGivenAmount.toFixed(2)}\nChange: ₹${balance.toFixed(2)}`,
        [
          {
            text: 'OK',
              onPress: async () => {
              // Add small delay to ensure Redux updates are processed before navigating
              await new Promise(resolve => setTimeout(resolve, 500));
              console.log('🚀 Navigating back to Orders and resetting stack so Back -> Home');
              (navigation as any).reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] });
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to complete payment');
      console.error('Payment error:', error);
    } finally {
      setLoading(false);
    }
  }, [isValidCash, order, orderId, dispatch, cashGivenAmount, balance, finalAmount, navigation]);

  // Early return after all hooks
  if (!order) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Order not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Centered Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.titleText}>Checkout</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 24 }]}>
        {/* Bill Summary Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bill Summary</Text>
          
          {/* Items List */}
          <FlatList
            scrollEnabled={false}
            data={groupedItems}
            keyExtractor={(item) => item.name}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemQuantity}>{item.totalQty}x ₹{item.price.toFixed(2)}</Text>
                </View>
                <Text style={styles.itemPrice}>₹{(item.price * item.totalQty).toFixed(2)}</Text>
              </View>
            )}
          />

          {/* Divider */}
          <View style={styles.divider} />

          {/* Subtotal */}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>₹{subtotal.toFixed(2)}</Text>
          </View>
        </View>

        {/* Discount Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Apply Discount (Optional)</Text>
          
          <View style={styles.discountContainer}>
            <View style={styles.discountInputWrapper}>
              <TextInput
                style={styles.discountInput}
                placeholder="0"
                placeholderTextColor="#999"
                keyboardType="decimal-pad"
                value={discountAmount}
                onChangeText={setDiscountAmount}
              />
              <TouchableOpacity
                style={[
                  styles.discountTypeBtn,
                  discountType === 'amount' && styles.discountTypeBtnActive,
                ]}
                onPress={() => setDiscountType('amount')}
              >
                <Text
                  style={[
                    styles.discountTypeText,
                    discountType === 'amount' && styles.discountTypeTextActive,
                  ]}
                >
                  ₹
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.discountTypeBtn,
                  discountType === 'percentage' && styles.discountTypeBtnActive,
                ]}
                onPress={() => setDiscountType('percentage')}
              >
                <Text
                  style={[
                    styles.discountTypeText,
                    discountType === 'percentage' && styles.discountTypeTextActive,
                  ]}
                >
                  %
                </Text>
              </TouchableOpacity>
            </View>
            {discountValue > 0 && (
              <Text style={styles.discountInfo}>
                Discount: -₹{discountValue.toFixed(2)}
              </Text>
            )}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Final Total */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.totalValue}>₹{finalAmount.toFixed(2)}</Text>
          </View>
        </View>

        {/* Pay Button */}
        <TouchableOpacity
          style={styles.payButton}
          onPress={() => {
            console.log('🔘🔘🔘 SELECT PAYMENT METHOD BUTTON CLICKED');
            console.log('🔘 showPaymentModal before:', showPaymentModal);
            setShowPaymentModal(true);
            console.log('🔘 setShowPaymentModal(true) called');
          }}
          disabled={loading}
        >
          <Text style={styles.payButtonText}>Select Payment Method</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Payment Method Selection Modal */}
      <Modal
        visible={showPaymentModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPaymentModal(false)}
        onShow={() => console.log('🔔🔔🔔 PAYMENT MODAL IS NOW SHOWING')}
      >
        <View style={styles.paymentSelectionOverlay}>
          <View style={[styles.paymentSelectionContent, { paddingTop: insets.top + 20 }]}>
            <View style={styles.paymentModalHeader}>
              <TouchableOpacity 
                onPress={() => setShowPaymentModal(false)}
                style={{ marginRight: 12 }}
                activeOpacity={0.7}
              >
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.paymentSelectionTitle}>Select Payment</Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 24 }}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={true}
            >
              <View style={styles.paymentCard}>
                <Text style={styles.cardTitle}>Payment Method</Text>
                
                <View style={{ backgroundColor: '#fff', padding: 10, marginBottom: 10 }} pointerEvents="auto">
                  <Pressable
                    style={({ pressed }) => [
                      styles.paymentMethodButton,
                      paymentMethod === 'cash' && styles.paymentMethodActive,
                      pressed && { opacity: 0.5, backgroundColor: '#ddd' },
                    ]}
                    onPressIn={() => console.log('💵💵💵 CASH BUTTON PRESS IN - Checkout')}
                    onPressOut={() => console.log('💵💵💵 CASH BUTTON PRESS OUT - Checkout')}
                    onPress={() => {
                      console.log('💵💵💵 Cash payment button ONPRESS - Checkout');
                      console.log('💵💵💵 Setting payment method to cash');
                      setPaymentMethod('cash');
                      console.log('💵💵💵 Closing payment modal');
                      setShowPaymentModal(false);
                      console.log('💵💵💵 Setting showCashModal to true after 200ms delay');
                      setTimeout(() => {
                        setShowCashModal(true);
                        console.log('💵💵💵 ShowCashModal state updated');
                      }, 200);
                    }}
                  >
                    <Text style={styles.paymentMethodButtonText}>💵 Pay by Cash</Text>
                  </Pressable>
                </View>

                <View style={{ backgroundColor: '#fff', padding: 10 }} pointerEvents="auto">
                  <Pressable
                    style={({ pressed }) => [
                      styles.paymentMethodButton,
                      paymentMethod === 'upi' && styles.paymentMethodActive,
                      pressed && { opacity: 0.5, backgroundColor: '#ddd' },
                    ]}
                    onPressIn={() => console.log('📱📱📱 UPI BUTTON PRESS IN - Checkout')}
                    onPressOut={() => console.log('📱📱📱 UPI BUTTON PRESS OUT - Checkout')}
                    onPress={() => {
                      console.log('📱📱📱 UPI payment button ONPRESS - Checkout');
                      console.log('📱📱📱 Setting payment method to upi');
                      setPaymentMethod('upi');
                      console.log('📱📱📱 Closing payment modal');
                      setShowPaymentModal(false);
                      console.log('📱📱📱 Setting showUPIModal to true after 200ms delay');
                      setTimeout(() => {
                        setShowUPIModal(true);
                        console.log('📱📱📱 ShowUPIModal state updated');
                      }, 200);
                    }}
                  >
                    <Text style={styles.paymentMethodButtonText}>📱 Pay by UPI</Text>
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
        onRequestClose={() => !loading && setShowCashModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Cash Received</Text>

            {/* Bill Amount Display */}
            <View style={styles.billDisplay}>
              <Text style={styles.billLabel}>Bill Amount</Text>
              <Text style={styles.billAmount}>₹{finalAmount.toFixed(2)}</Text>
            </View>

            {/* Cash Input */}
            <TextInput
              style={styles.cashInput}
              placeholder="0.00"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              value={cashGiven}
              onChangeText={setCashGiven}
              editable={!loading}
              returnKeyType="done"
              blurOnSubmit={true}
              onSubmitEditing={Keyboard.dismiss}
            />

            {/* Validation Info */}
            {cashGivenAmount > 0 && (
              <View style={[styles.infoBox, !isValidCash && styles.infoBoxError]}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Cash Given:</Text>
                  <Text style={styles.infoValue}>₹{cashGivenAmount.toFixed(2)}</Text>
                </View>
                <View style={styles.infoDivider} />
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Bill Amount:</Text>
                  <Text style={styles.infoValue}>₹{finalAmount.toFixed(2)}</Text>
                </View>
                <View style={styles.infoDivider} />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, styles.changeLabel]}>Change:</Text>
                  <Text
                    style={[
                      styles.infoValue,
                      isValidCash ? styles.changePositive : styles.changeNegative,
                    ]}
                  >
                    {isValidCash ? '+' : '-'}₹{Math.abs(balance).toFixed(2)}
                  </Text>
                </View>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowCashModal(false);
                  setCashGiven('');
                  setTimeout(() => setShowPaymentModal(true), 200);
                }}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.completeButton, !isValidCash && styles.completeButtonDisabled]}
                onPress={handleCompletePayment}
                disabled={!isValidCash || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.completeButtonText}>Complete Payment</Text>
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
      <Modal
        visible={showUPIModal}
        transparent
        animationType="fade"
        onRequestClose={() => !loading && setShowUPIModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>UPI Payment</Text>
            <Text style={styles.billAmount}>₹{finalAmount.toFixed(2)}</Text>

            <View style={styles.upiInfoContainer}>
              <Text style={styles.upiInfoText}>Scan QR Code or Confirm Payment</Text>
              <Text style={styles.upiSubText}>Once payment is confirmed, click Complete Payment</Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowUPIModal(false);
                  setTimeout(() => setShowPaymentModal(true), 200);
                }}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.completeButton}
                onPress={handleCompleteUPIPayment}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.completeButtonText}>Complete Payment</Text>
                )}
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
    backgroundColor: '#f8f8f8',
  },
  titleContainer: {
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#ff6b6b',
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  itemQuantity: {
    fontSize: 12,
    color: '#666',
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7c3aed',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#f8f8f8',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#7c3aed',
  },
  discountContainer: {
    marginBottom: 12,
  },
  discountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  discountInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1a1a1a',
  },
  discountTypeBtn: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  discountTypeBtnActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  discountTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  discountTypeTextActive: {
    color: '#fff',
  },
  discountInfo: {
    fontSize: 12,
    color: '#ff6b6b',
    fontWeight: '600',
    marginTop: 8,
  },
  payButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  payButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
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
    padding: 24,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
  },
  billDisplay: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  billLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
    marginBottom: 4,
  },
  billAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  cashInput: {
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
    backgroundColor: '#f8f8f8',
  },
  infoBox: {
    backgroundColor: '#f8f8f8',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  infoBoxError: {
    backgroundColor: '#fff8f8',
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  changeLabel: {
    fontWeight: '700',
    color: '#1a1a1a',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  changePositive: {
    color: '#10b981',
    fontSize: 16,
  },
  changeNegative: {
    color: '#ff6b6b',
    fontSize: 16,
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
  },
  completeButton: {
    flex: 1,
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  completeButtonDisabled: {
    backgroundColor: '#ccc',
  },
  completeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  paymentSelectionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  paymentSelectionContent: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: 50,
  },
  paymentModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
  backButtonText: {
    fontSize: 16,
    color: '#7c3aed',
    fontWeight: '600',
  },
  paymentSelectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
    flex: 1,
    textAlign: 'center',
  },
  paymentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  paymentMethodButton: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  paymentMethodActive: {
    backgroundColor: '#e9d5ff',
    borderColor: '#7c3aed',
  },
  paymentMethodButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  upiInfoContainer: {
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    padding: 16,
    marginVertical: 20,
    alignItems: 'center',
  },
  upiInfoText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  upiSubText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});
