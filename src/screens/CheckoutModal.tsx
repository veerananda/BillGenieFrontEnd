import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
  Image,
  Pressable,
} from 'react-native';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectOrderById, removeOrder, updateOrder } from '../store/ordersSlice';
import { setTableOccupied } from '../store/tablesSlice';
import { apiClient } from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

interface CheckoutModalProps {
  orderId: string;
  tableName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

type PaymentMethod = 'cash' | 'upi';

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ orderId, tableName, onClose, onSuccess }) => {
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const order = useAppSelector(state => selectOrderById(state, orderId)) as Order | undefined;
  
  const [showMainModal, setShowMainModal] = useState(true);
  const [discountAmount, setDiscountAmount] = useState('0');
  const [discountType, setDiscountType] = useState<'amount' | 'percentage'>('amount');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [showCashModal, setShowCashModal] = useState(false);
  const [showUPIModal, setShowUPIModal] = useState(false);
  const [cashGiven, setCashGiven] = useState('');
  const [upiTransactionId, setUpiTransactionId] = useState('');
  const [upiQrCode, setUpiQrCode] = useState<string | null>(null);
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
  
  // Calculate tax (5% GST on subtotal) and final amount including tax
  const taxAmount = useMemo(() => subtotal * 0.05, [subtotal]);
  const finalAmount = useMemo(() => (subtotal + taxAmount) - discountValue, [subtotal, taxAmount, discountValue]);
  
  const cashGivenAmount = useMemo(() => parseFloat(cashGiven) || 0, [cashGiven]);
  const balance = useMemo(() => cashGivenAmount - finalAmount, [cashGivenAmount, finalAmount]);
  const isValidCash = useMemo(() => cashGivenAmount >= finalAmount, [cashGivenAmount, finalAmount]);
  // UPI transaction ID is optional - user can pay without entering it
  const isValidUPI = useMemo(() => true, []);

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
    console.log('💵 handlePayByCash called');
    setPaymentMethod('cash');
    console.log('💵 Hiding main modal to avoid nested modal issue');
    setShowMainModal(false);
    console.log('💵 Setting showCashModal to true after 200ms delay');
    setTimeout(() => {
      setShowCashModal(true);
      console.log('💵 showCashModal state updated');
    }, 200);
  };

  const handlePayByUPI = () => {
    console.log('📱 handlePayByUPI called');
    setPaymentMethod('upi');
    console.log('📱 Hiding main modal to avoid nested modal issue');
    setShowMainModal(false);
    console.log('📱 Setting showUPIModal to true after 200ms delay');
    setTimeout(() => {
      setShowUPIModal(true);
      console.log('📱 showUPIModal state updated');
      // Fetch UPI QR code from restaurant profile
      fetchUPIQrCode();
    }, 200);
  };

  const fetchUPIQrCode = async () => {
    try {
      const profile = await (apiClient as any).getRestaurantProfile?.() || 
                      await (apiClient as any).makeRequest('/restaurants/profile', 'GET');
      if (profile && profile.upi_qr_code) {
        setUpiQrCode(profile.upi_qr_code);
        console.log('✅ UPI QR Code loaded');
      } else {
        console.warn('⚠️ No UPI QR code found in restaurant profile');
        setUpiQrCode('MISSING'); // Set a flag indicating no QR code
      }
    } catch (error) {
      console.error('❌ Error fetching UPI QR code:', error);
      setUpiQrCode('ERROR'); // Set a flag indicating error
    }
  };

  const handleCompletePayment = useCallback(async () => {
    if (!order) return;

    if (paymentMethod === 'cash' && !isValidCash) {
      Alert.alert('Insufficient Cash', 'Please enter cash amount greater than or equal to the total');
      return;
    }

    // UPI transaction ID is optional, so no validation needed

    setLoading(true);
    try {
      // Mark order as completed and store the final amount (after discount)
      const completedOrder: Order = {
        ...order,
        status: 'completed',
        finalAmount: finalAmount, // Store the amount after discount for sales tracking
      };
      dispatch(updateOrder(completedOrder));
      console.log('✅ Redux: Order marked as completed:', completedOrder);

      // Try to update via API
      try {
        console.log('🔄 [PAYMENT FLOW START] Calling API to complete payment');
        console.log('   Order ID:', orderId);
        console.log('   Payment Method:', paymentMethod);
        console.log('   Amount Received:', paymentMethod === 'cash' ? cashGivenAmount : finalAmount);
        console.log('   Change Returned:', paymentMethod === 'cash' ? balance : 0);
        
        const paymentData = {
          payment_method: paymentMethod,
          amount_received: paymentMethod === 'cash' ? cashGivenAmount : finalAmount,
          change_returned: paymentMethod === 'cash' ? balance : 0,
          upi_transaction_id: paymentMethod === 'upi' ? upiTransactionId : undefined,
        };
        console.log('   Full Payment Data:', paymentData);
        
        const paymentResponse = await apiClient.completeOrderWithPayment(orderId, paymentData);
        console.log('✅ [PAYMENT SUCCESS] Payment API response:', paymentResponse);
      } catch (apiErr) {
        console.error('❌ [PAYMENT ERROR] API error updating order:', apiErr);
        const errorMessage = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.error('   Error details - Message:', errorMessage);
      }

      // Update table status to vacant via API and Redux if tableId exists
      if (order.tableId) {
        console.log('🔄 [TABLE UPDATE START] Updating table to vacant:', order.tableId);
        try {
          console.log('🔄 Setting table to vacant:', order.tableId);
          
          // Update table status via API first (optional, don't block on failure)
          const tableId = order.tableId;
          await Promise.resolve().then(async () => {
            try {
              console.log('   → Calling setTableVacant API...');
              if (tableId) await apiClient.setTableVacant(tableId);
              console.log('   ✅ Table status updated via API');
            } catch (apiErr) {
              console.warn('   ⚠️ API table status update failed (continuing anyway):', apiErr);
            }
          });
          
          // Update Redux state to mark table as not occupied (this is what matters)
          if (tableId) dispatch(setTableOccupied({ tableId, isOccupied: false }));
          console.log('   ✅ Redux table state updated to not occupied');
        } catch (tableErr) {
          // Log but don't fail payment on table update error
          console.warn('⚠️ Table status update error (payment still successful):', tableErr);
        }
      } else {
        console.log('ℹ️ No tableId - Skipping table status update');
      }

      // Remove order from Redux
      dispatch(removeOrder(orderId));

      // Show success and close modal
      const successMessage = paymentMethod === 'cash' 
        ? `Amount Received: ₹${cashGivenAmount.toFixed(2)}\nChange: ₹${balance.toFixed(2)}`
        : `UPI Transaction ID: ${upiTransactionId}\nAmount: ₹${finalAmount.toFixed(2)}`;

      Alert.alert(
        'Payment Successful',
        successMessage,
        [
          {
            text: 'OK',
            onPress: async () => {
              // Add small delay to ensure Redux updates are processed
              await new Promise(resolve => setTimeout(resolve, 500));
              console.log('🚀 Closing checkout modal');
              setShowCashModal(false);
              setShowUPIModal(false);
              onClose();
              if (typeof onSuccess === 'function') {
                try { onSuccess(); } catch (err) { console.warn('onSuccess handler threw:', err); }
              }
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
  }, [isValidCash, isValidUPI, order, orderId, dispatch, cashGivenAmount, balance, finalAmount, paymentMethod, upiTransactionId, onClose]);

  if (!order) {
    return null;
  }

  return (
    <>
      <Modal
        visible={showMainModal}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
            <TouchableOpacity onPress={onClose} disabled={loading}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Checkout</Text>
            <View style={{ width: 30 }} />
          </View>

          <FlatList
            data={[
              { type: 'summary', key: 'summary' },
              { type: 'discount', key: 'discount' },
              { type: 'payment', key: 'payment' },
            ]}
            renderItem={({ item }) => {
              if (item.type === 'summary') {
                return (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Bill Summary</Text>
                    
                    {/* Items List */}
                    <View>
                      {groupedItems.map((groupItem) => (
                        <View key={groupItem.name} style={styles.itemRow}>
                          <View style={styles.itemInfo}>
                            <Text style={styles.itemName}>{groupItem.name}</Text>
                            <Text style={styles.itemQuantity}>{groupItem.totalQty}x ₹{groupItem.price.toFixed(2)}</Text>
                          </View>
                          <Text style={styles.itemPrice}>₹{(groupItem.price * groupItem.totalQty).toFixed(2)}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Divider */}
                    <View style={styles.divider} />

                    {/* Subtotal */}
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Subtotal</Text>
                      <Text style={styles.summaryValue}>₹{subtotal.toFixed(2)}</Text>
                    </View>

                    {/* Tax (5% GST) */}
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Tax (5% GST)</Text>
                      <Text style={styles.summaryValue}>₹{taxAmount.toFixed(2)}</Text>
                    </View>
                  </View>
                );
              }

              if (item.type === 'discount') {
                return (
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
                );
              }

              if (item.type === 'payment') {
                return (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Payment Method</Text>
                    
                    {/* Cash Button */}
                    <View style={{ backgroundColor: '#fff', padding: 4, marginBottom: 10 }} pointerEvents="auto">
                      <Pressable
                        style={({ pressed }) => [
                          styles.paymentMethodBtn,
                          paymentMethod === 'cash' && styles.paymentMethodBtnActive,
                          pressed && { opacity: 0.5, backgroundColor: '#ddd' },
                        ]}
                        onPressIn={() => console.log('💵💵💵 CASH BUTTON PRESS IN - CheckoutModal')}
                        onPressOut={() => console.log('💵💵💵 CASH BUTTON PRESS OUT - CheckoutModal')}
                        onPress={() => {
                          console.log('💵💵💵 Cash payment button ONPRESS - CheckoutModal');
                          handlePayByCash();
                        }}
                        disabled={loading}
                      >
                        <Text style={[styles.paymentMethodBtnText, paymentMethod === 'cash' && styles.paymentMethodBtnTextActive]}>
                          💵 Pay by Cash
                        </Text>
                      </Pressable>
                    </View>

                    {/* UPI Button */}
                    <View style={{ backgroundColor: '#fff', padding: 4 }} pointerEvents="auto">
                      <Pressable
                        style={({ pressed }) => [
                          styles.paymentMethodBtn,
                          paymentMethod === 'upi' && styles.paymentMethodBtnActive,
                          pressed && { opacity: 0.5, backgroundColor: '#ddd' },
                        ]}
                        onPressIn={() => console.log('📱📱📱 UPI BUTTON PRESS IN - CheckoutModal')}
                        onPressOut={() => console.log('📱📱📱 UPI BUTTON PRESS OUT - CheckoutModal')}
                        onPress={() => {
                          console.log('📱📱📱 UPI payment button ONPRESS - CheckoutModal');
                          handlePayByUPI();
                        }}
                        disabled={loading}
                      >
                        <Text style={[styles.paymentMethodBtnText, paymentMethod === 'upi' && styles.paymentMethodBtnTextActive]}>
                          📱 Pay by UPI
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }

              return null;
            }}
            keyExtractor={(item) => item.key}
            scrollEnabled={true}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 24 }]}
          />
        </View>
      </Modal>

      {/* Cash Payment Modal */}
      <Modal
        visible={showCashModal}
        transparent
        animationType="slide"
        onRequestClose={() => !loading && setShowCashModal(false)}
        onShow={() => console.log('💰💰💰 CASH MODAL IS NOW SHOWING')}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingTop: insets.top + 24 }]}>
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
              autoFocus
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
                  console.log('💵 Closing cash modal and showing main modal again');
                  setShowCashModal(false);
                  setCashGiven('');
                  setTimeout(() => {
                    setShowMainModal(true);
                    console.log('💵 Main modal shown again');
                  }, 200);
                }}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>Back</Text>
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
        </View>
      </Modal>

      {/* UPI Payment Modal */}
      <Modal
        visible={showUPIModal}
        transparent
        animationType="slide"
        onRequestClose={() => !loading && setShowUPIModal(false)}
        onShow={() => console.log('📱💰📱 UPI MODAL IS NOW SHOWING')}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingTop: insets.top + 24 }]}>
            <Text style={styles.modalTitle}>UPI Payment</Text>

            <ScrollView 
              style={styles.scrollContent}
              showsVerticalScrollIndicator={true}
              scrollEnabled={true}
            >
            {/* QR Code Display */}
            <View style={styles.qrCodeContainer}>
              {upiQrCode && upiQrCode !== 'MISSING' && upiQrCode !== 'ERROR' ? (
                <>
                  <Text style={styles.qrCodeLabel}>Scan this QR code to pay</Text>
                  <Image
                    source={{ uri: upiQrCode }}
                    style={styles.qrCode}
                    resizeMode="contain"
                  />
                  <Text style={styles.qrCodeSubtext}>Ask customer to scan with their UPI app</Text>
                </>
              ) : upiQrCode === 'MISSING' ? (
                <>
                  <Text style={styles.infoLabel}>Payment Method: UPI</Text>
                  <Text style={styles.infoValue}>Customer can complete payment via UPI</Text>
                </>
              ) : upiQrCode === 'ERROR' ? (
                <>
                  <Text style={styles.infoLabel}>Payment Method: UPI</Text>
                  <Text style={styles.infoValue}>Customer can complete payment via UPI</Text>
                </>
              ) : (
                <>
                  <ActivityIndicator size="large" color="#7c3aed" />
                  <Text style={styles.loadingText}>Loading UPI QR code...</Text>
                </>
              )}
            </View>

            {/* Bill Amount Display */}
            <View style={styles.billDisplay}>
              <Text style={styles.billLabel}>Bill Amount</Text>
              <Text style={styles.billAmount}>₹{finalAmount.toFixed(2)}</Text>
            </View>

            {/* UPI Transaction ID Input */}
            <TextInput
              style={styles.upiInput}
              placeholder="Enter transaction ID after payment (optional)"
              placeholderTextColor="#999"
              value={upiTransactionId}
              onChangeText={setUpiTransactionId}
              editable={!loading}
              autoFocus
            />

            {/* Info Box */}
            <View style={styles.infoBox}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Amount to Receive:</Text>
                <Text style={styles.infoValue}>₹{finalAmount.toFixed(2)}</Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Transaction ID:</Text>
                <Text style={styles.infoValue}>{upiTransactionId || '—'}</Text>
              </View>
            </View>
            </ScrollView>

            {/* Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  console.log('📱 Closing UPI modal and showing main modal again');
                  setShowUPIModal(false);
                  setUpiTransactionId('');
                  setUpiQrCode(null);
                  setTimeout(() => {
                    setShowMainModal(true);
                    console.log('📱 Main modal shown again');
                  }, 200);
                }}
                disabled={loading}
              >
                <Text style={styles.cancelButtonText}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.completeButton]}
                onPress={handleCompletePayment}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.completeButtonText}>Confirm Payment</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8',
  },
  header: {
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeButton: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '300',
    padding: 4,
  },
  headerTitle: {
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
    gap: 8,
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
    width: 44,
    height: 40,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  discountTypeBtnActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  discountTypeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  discountTypeTextActive: {
    color: '#fff',
  },
  discountInfo: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '600',
    marginTop: 8,
  },
  paymentMethodBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  paymentMethodBtnActive: {
    borderColor: '#7c3aed',
    backgroundColor: '#f3f0ff',
  },
  paymentMethodBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  paymentMethodBtnTextActive: {
    color: '#7c3aed',
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
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
    flex: 1,
    flexDirection: 'column',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
    textAlign: 'center',
  },
  scrollContent: {
    flex: 1,
  },
  qrCodeContainer: {
    alignItems: 'center',
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  qrCode: {
    width: 150,
    height: 150,
    marginVertical: 12,
  },
  qrCodeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  qrCodeSubtext: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
  },
  billDisplay: {
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  billLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  billAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: '#7c3aed',
  },
  cashInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    marginBottom: 16,
  },
  upiInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1a1a1a',
    marginBottom: 16,
  },
  upiInstructions: {
    backgroundColor: '#f0f7ff',
    borderLeftWidth: 4,
    borderLeftColor: '#7c3aed',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  upiInstructionsText: {
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 18,
    marginBottom: 6,
  },
  infoBox: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 20,
  },
  infoBoxError: {
    backgroundColor: '#fff0f0',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  changeLabel: {
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  changePositive: {
    color: '#22c55e',
  },
  changeNegative: {
    color: '#ef4444',
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 6,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  completeButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    alignItems: 'center',
  },
  completeButtonDisabled: {
    backgroundColor: '#ccc',
  },
  completeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
