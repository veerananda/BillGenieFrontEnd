import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { apiClient, RestaurantProfile } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getJSONOrDefault, safeSetJSON } from '../utils/storageHelpers';

type RootStackParamList = {
  Orders: undefined;
  BillSummary: { orderId: string };
};

type BillSummaryScreenProps = NativeStackScreenProps<RootStackParamList, 'BillSummary'>;

type ItemStatus = 'pending' | 'cooking' | 'ready' | 'served';

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  status?: ItemStatus;
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
  tableId?: string; // Link to RestaurantTable for dine-in mode
}

// Use RestaurantProfile from api import
// No need to redefine it locally

export const BillSummaryScreen: React.FC<BillSummaryScreenProps> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { orderId } = route.params;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showCashModal, setShowCashModal] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [changeAmount, setChangeAmount] = useState(0);
  const [showCompleteBill, setShowCompleteBill] = useState(false);
  const [paymentMethodUsed, setPaymentMethodUsed] = useState<'cash' | 'upi'>('cash');
  const [cashReceivedAmount, setCashReceivedAmount] = useState(0);
  const [restaurantProfile, setRestaurantProfile] = useState<RestaurantProfile | null>(null);
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);

  useEffect(() => {
    loadOrder();
    loadRestaurantProfile();
    loadProfile();
  }, []);

  const loadOrder = async () => {
    try {
      // Try cached orders as a fallback
      const orders: Order[] = await getJSONOrDefault<Order[]>('orders', []);
      const foundOrder = orders.find((o: Order) => o.id === orderId);
      
      if (foundOrder) {
        setOrder(foundOrder);
      } else {
        Alert.alert('Error', 'Order not found');
        navigation.goBack();
      }
    } catch (error) {
      console.error('Error loading order:', error);
      Alert.alert('Error', 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };
  const loadRestaurantProfile = async () => {
    try {
      const data = await apiClient.getRestaurantProfile();
      setRestaurantProfile(data);
    } catch (error) {
      console.error('Error loading restaurant profile:', error);
    }
  };

  const loadProfile = async () => {
    try {
      const restaurantProfile = await apiClient.getRestaurantProfile();
      setProfile(restaurantProfile);
    } catch (err) {
      console.error('❌ Error loading profile:', err);
    }
  };

  const calculateSubtotal = () => {
    if (!order) return 0;
    
    // Group items by name and sum quantities
    const itemTotals: { [key: string]: { quantity: number; price: number } } = {};
    
    order.items.forEach(item => {
      if (itemTotals[item.name]) {
        itemTotals[item.name].quantity += item.quantity;
      } else {
        itemTotals[item.name] = {
          quantity: item.quantity,
          price: item.price,
        };
      }
    });
    
    return Object.values(itemTotals).reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );
  };

  const calculateTax = (subtotal: number) => {
    return subtotal * 0.05; // 5% tax
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const tax = calculateTax(subtotal);
    return subtotal + tax;
  };

  const getGroupedItems = () => {
    if (!order) return [];
    
    const itemMap: { [key: string]: { name: string; quantity: number; price: number } } = {};
    
    order.items.forEach(item => {
      if (itemMap[item.name]) {
        itemMap[item.name].quantity += item.quantity;
      } else {
        itemMap[item.name] = {
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        };
      }
    });
    
    return Object.values(itemMap);
  };

  const handleCashPayment = () => {
    setShowCashModal(true);
    setCashReceived('');
    setChangeAmount(0);
  };

  const handleUpiPayment = () => {
    if (restaurantProfile?.upi_qr_code) {
      setShowUpiModal(true);
    } else {
      // If no QR code, process payment directly
      Alert.alert(
        'No UPI QR Code',
        'Please add UPI QR code in Restaurant Profile to enable UPI payments.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Complete Anyway',
            onPress: () => handlePayment('upi'),
          },
        ]
      );
    }
  };

  const handleCashInputChange = (text: string) => {
    setCashReceived(text);
    const received = parseFloat(text) || 0;
    const total = calculateTotal();
    const change = received - total;
    setChangeAmount(change);
  };

  const handlePayment = async (paymentMethod: 'cash' | 'upi', cashAmount?: number) => {
    setProcessing(true);
    
    try {
      const total = calculateTotal();
      const changeReturned = cashAmount ? cashAmount - total : 0;

      // Call API to complete order with payment
      await apiClient.completeOrderWithPayment(orderId, {
        payment_method: paymentMethod,
        amount_received: cashAmount || 0,
        change_returned: changeReturned > 0 ? changeReturned : 0,
      });
      
      // If dine-in mode and table is linked, mark table as vacant
      if (profile && !profile.is_self_service && order?.tableId) {
        try {
          await apiClient.setTableVacant(order.tableId);
          console.log('✅ Table marked as vacant after payment');
        } catch (tableErr) {
          console.error('❌ Error marking table as vacant:', tableErr);
        }
      }
      
      // Remove order from local storage (cache fallback)
      try {
        const orders: Order[] = await getJSONOrDefault<Order[]>('orders', []);
        const updatedOrders = (orders || []).filter((o: Order) => o.id !== orderId);
        await safeSetJSON('orders', updatedOrders);
      } catch (e) {
        console.warn('⚠️ Failed to update cached orders on payment:', e);
      }
      
      // Show complete bill
      setPaymentMethodUsed(paymentMethod);
      if (cashAmount) {
        setCashReceivedAmount(cashAmount);
      }
      setShowCashModal(false);
      setShowCompleteBill(true);
    } catch (error) {
      console.error('Error processing payment:', error);
      Alert.alert('Error', 'Failed to process payment. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleCompleteCashPayment = () => {
    const received = parseFloat(cashReceived) || 0;
    const total = calculateTotal();
    
    if (received < total) {
      Alert.alert('Insufficient Amount', 'Cash received is less than the total amount.');
      return;
    }
    
    handlePayment('cash', received);
  };

  const handleCloseBill = () => {
    (navigation as any).reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] });
  };

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
        <Text style={styles.errorText}>Order not found</Text>
      </View>
    );
  }

  const subtotal = calculateSubtotal();
  const tax = calculateTax(subtotal);
  const total = calculateTotal();
  const groupedItems = getGroupedItems();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (styles.content?.paddingBottom || 0) + insets.bottom + 12 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Bill Summary</Text>
          <View style={styles.headerInfo}>
            <Text style={styles.tableNumber}>Table {order.tableNumber}</Text>
            {order.customerName && (
              <Text style={styles.customerName}>{order.customerName}</Text>
            )}
          </View>
          <Text style={styles.dateTime}>
            {new Date(order.createdAt).toLocaleString('en-IN')}
          </Text>
        </View>

        {/* Items */}
        <View style={styles.itemsSection}>
          <Text style={styles.sectionTitle}>Items</Text>
          
          {groupedItems.map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemQuantity}>x{item.quantity}</Text>
              </View>
              <Text style={styles.itemPrice}>
                ₹{(item.quantity * item.price).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

        {/* Calculation */}
        <View style={styles.calculationSection}>
          <View style={styles.calculationRow}>
            <Text style={styles.calculationLabel}>Subtotal</Text>
            <Text style={styles.calculationValue}>₹{subtotal.toFixed(2)}</Text>
          </View>
          
          <View style={styles.calculationRow}>
            <Text style={styles.calculationLabel}>Tax (5%)</Text>
            <Text style={styles.calculationValue}>₹{tax.toFixed(2)}</Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{total.toFixed(2)}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Payment Buttons */}
      <View style={[styles.paymentSection, { bottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.paymentBtn, styles.cashBtn]}
          onPress={handleCashPayment}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.paymentIcon}>💵</Text>
              <Text style={styles.paymentBtnText}>Pay by Cash</Text>
            </>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.paymentBtn, styles.upiBtn]}
          onPress={handleUpiPayment}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.paymentIcon}>📱</Text>
              <Text style={styles.paymentBtnText}>Pay by UPI</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Cash Payment Modal */}
      <Modal
        visible={showCashModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCashModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cash Payment</Text>
            
            <View style={styles.totalSection}>
              <Text style={styles.totalAmountLabel}>Total Amount</Text>
              <Text style={styles.totalAmountValue}>₹{total.toFixed(2)}</Text>
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>Cash Received</Text>
              <TextInput
                style={styles.cashInput}
                placeholder="Enter amount"
                keyboardType="numeric"
                value={cashReceived}
                onChangeText={handleCashInputChange}
                autoFocus={true}
              />
            </View>

            {cashReceived && parseFloat(cashReceived) > 0 && (
              <View style={styles.changeSection}>
                <Text style={styles.changeLabel}>Change to Return</Text>
                <Text style={[
                  styles.changeValue,
                  changeAmount < 0 && styles.changeNegative
                ]}>
                  ₹{changeAmount.toFixed(2)}
                </Text>
                {changeAmount < 0 && (
                  <Text style={styles.warningText}>Insufficient amount!</Text>
                )}
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setShowCashModal(false)}
                disabled={processing}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalBtn, styles.completeBtn]}
                onPress={handleCompleteCashPayment}
                disabled={processing || !cashReceived || parseFloat(cashReceived) < total}
              >
                {processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.completeBtnText}>Payment Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* UPI Payment Modal */}
      <Modal
        visible={showUpiModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowUpiModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>UPI Payment</Text>
            
            <View style={styles.totalSection}>
              <Text style={styles.totalAmountLabel}>Total Amount</Text>
              <Text style={styles.totalAmountValue}>₹{total.toFixed(2)}</Text>
            </View>

            {restaurantProfile?.upi_qr_code ? (
              <View style={styles.qrCodeSection}>
                <Text style={styles.qrInstructions}>
                  Scan QR code with any UPI app to pay
                </Text>
                <Image
                  source={{ uri: restaurantProfile.upi_qr_code }}
                  style={styles.qrCodeImage}
                  resizeMode="contain"
                />
                {restaurantProfile.name && (
                  <Text style={styles.restaurantName}>{restaurantProfile.name}</Text>
                )}
              </View>
            ) : (
              <View style={styles.noQrSection}>
                <Text style={styles.noQrText}>No UPI QR Code configured</Text>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setShowUpiModal(false)}
                disabled={processing}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalBtn, styles.completeBtn]}
                onPress={() => handlePayment('upi')}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.completeBtnText}>Payment Complete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Complete Bill Modal */}
      <Modal
        visible={showCompleteBill}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseBill}
      >
        <View style={styles.completeBillOverlay}>
          <View style={styles.completeBillContent}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            
            <Text style={styles.successTitle}>Payment Successful!</Text>
            
            <View style={styles.billDetails}>
              <Text style={styles.billDetailsTitle}>Bill Summary</Text>
              
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Table</Text>
                <Text style={styles.billValue}>{order?.tableNumber}</Text>
              </View>
              
              {order?.customerName && (
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Customer</Text>
                  <Text style={styles.billValue}>{order.customerName}</Text>
                </View>
              )}
              
              <View style={styles.divider} />
              
              {groupedItems.map((item, index) => (
                <View key={`${item.name}-${index}`} style={styles.billRow}>
                  <Text style={styles.billItemName}>
                    {item.name} x{item.quantity}
                  </Text>
                  <Text style={styles.billItemPrice}>
                    ₹{(item.quantity * item.price).toFixed(2)}
                  </Text>
                </View>
              ))}
              
              <View style={styles.divider} />
              
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Subtotal</Text>
                <Text style={styles.billValue}>₹{subtotal.toFixed(2)}</Text>
              </View>
              
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Tax (5%)</Text>
                <Text style={styles.billValue}>₹{tax.toFixed(2)}</Text>
              </View>
              
              <View style={styles.divider} />
              
              <View style={styles.billRow}>
                <Text style={styles.billTotalLabel}>Total</Text>
                <Text style={styles.billTotalValue}>₹{total.toFixed(2)}</Text>
              </View>
              
              <View style={styles.divider} />
              
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Payment Method</Text>
                <Text style={styles.billValue}>
                  {paymentMethodUsed === 'cash' ? '💵 Cash' : '📱 UPI'}
                </Text>
              </View>
              
              {paymentMethodUsed === 'cash' && cashReceivedAmount > 0 && (
                <>
                  <View style={styles.billRow}>
                    <Text style={styles.billLabel}>Cash Received</Text>
                    <Text style={styles.billValue}>₹{cashReceivedAmount.toFixed(2)}</Text>
                  </View>
                  
                  <View style={styles.billRow}>
                    <Text style={styles.billLabel}>Change</Text>
                    <Text style={styles.billChangeValue}>
                      ₹{(cashReceivedAmount - total).toFixed(2)}
                    </Text>
                  </View>
                </>
              )}
              
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Date & Time</Text>
                <Text style={styles.billValue}>
                  {new Date(order?.createdAt || Date.now()).toLocaleString('en-IN')}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.okButton}
              onPress={handleCloseBill}
            >
              <Text style={styles.okButtonText}>OK</Text>
            </TouchableOpacity>
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
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  headerInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tableNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#7c3aed',
  },
  customerName: {
    fontSize: 16,
    color: '#666',
  },
  dateTime: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  itemsSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  itemQuantity: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
    minWidth: 40,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#7c3aed',
    marginLeft: 12,
  },
  calculationSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  calculationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  calculationLabel: {
    fontSize: 16,
    color: '#666',
  },
  calculationValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  totalLabel: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  paymentSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 20,
    flexDirection: 'row',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  paymentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  cashBtn: {
    backgroundColor: '#10b981',
  },
  upiBtn: {
    backgroundColor: '#7c3aed',
  },
  paymentIcon: {
    fontSize: 24,
  },
  paymentBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  errorText: {
    fontSize: 16,
    color: '#999',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 24,
  },
  totalSection: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  totalAmountLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  totalAmountValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  cashInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 16,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  changeSection: {
    backgroundColor: '#f0fdf4',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  changeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  changeValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#10b981',
  },
  changeNegative: {
    color: '#ef4444',
  },
  warningText: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
    fontWeight: '600',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: '#f0f0f0',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  completeBtn: {
    backgroundColor: '#10b981',
  },
  completeBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  qrCodeSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  qrInstructions: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  qrCodeImage: {
    width: 280,
    height: 280,
    marginBottom: 12,
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#7c3aed',
    textAlign: 'center',
  },
  noQrSection: {
    padding: 32,
    alignItems: 'center',
    marginBottom: 20,
  },
  noQrText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  completeBillOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  completeBillContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  successIconText: {
    fontSize: 48,
    color: '#fff',
    fontWeight: 'bold',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#10b981',
    textAlign: 'center',
    marginBottom: 24,
  },
  billDetails: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    maxHeight: 400,
  },
  billDetailsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  billLabel: {
    fontSize: 14,
    color: '#666',
  },
  billValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  billItemName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  billItemPrice: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  billTotalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  billTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  billChangeValue: {
    fontSize: 14,
    color: '#10b981',
    fontWeight: '600',
  },
  okButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  okButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});
