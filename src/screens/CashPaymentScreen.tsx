import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectOrderById, removeOrder, updateOrder } from '../store/ordersSlice';
import { apiClient } from '../services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type RootStackParamList = {
  CashPayment: { orderId: string; totalAmount: number; tableName: string };
  Orders: undefined;
};

type CashPaymentScreenProps = NativeStackScreenProps<RootStackParamList, 'CashPayment'>;

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
  tableId?: string;
}

export const CashPaymentScreen: React.FC<CashPaymentScreenProps> = ({ route, navigation }) => {
  const { orderId, totalAmount, tableName } = route.params;
  const dispatch = useAppDispatch();
  const order = useAppSelector(state => selectOrderById(state, orderId)) as Order | undefined;

  const [cashGiven, setCashGiven] = useState('');
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  // Calculate these values BEFORE any conditional returns
  const cashGivenAmount = useMemo(() => parseFloat(cashGiven) || 0, [cashGiven]);
  const balance = useMemo(() => cashGivenAmount - totalAmount, [cashGivenAmount, totalAmount]);
  const isValidCash = useMemo(() => cashGivenAmount >= totalAmount, [cashGivenAmount, totalAmount]);

  const handleCompletePayment = useCallback(async () => {
    if (!isValidCash) {
      Alert.alert('Insufficient Cash', 'Please enter cash amount greater than or equal to the total');
      return;
    }

    setLoading(true);
    try {
      if (!order) return;

      // Mark order as completed
      const completedOrder = {
        ...order,
        status: 'completed' as const,
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
        // Continue even if API fails
      }

      // Update table status to vacant via API if tableId exists
      if (order.tableId) {
        try {
          await apiClient.updateTableStatus(order.tableId, 'vacant');
        } catch (tableErr) {
          console.error('Error updating table status:', tableErr);
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
            onPress: () => {
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
  }, [orderId, dispatch, navigation, order, isValidCash, cashGivenAmount, balance]);

  if (!order) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Order not found</Text>
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={[styles.contentContainer, { paddingBottom: insets.bottom + 24 }]}>
        {/* Bill Amount Section */}
        <View style={styles.billSection}>
          <Text style={styles.billLabel}>Bill Amount</Text>
          <Text style={styles.billAmount}>₹{totalAmount.toFixed(2)}</Text>
        </View>

        {/* Cash Input Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enter Cash Received</Text>
          <TextInput
            style={styles.cashInput}
            placeholder="0.00"
            placeholderTextColor="#999"
            keyboardType="decimal-pad"
            value={cashGiven}
            onChangeText={setCashGiven}
            editable={!loading}
          />
        </View>

        {/* Validation Message */}
        {cashGivenAmount > 0 && (
          <View style={[styles.section, !isValidCash && styles.sectionError]}>
            <View style={styles.validationRow}>
              <Text style={styles.validationLabel}>Cash Entered</Text>
              <Text style={styles.validationValue}>₹{cashGivenAmount.toFixed(2)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.validationRow}>
              <Text style={styles.validationLabel}>Bill Amount</Text>
              <Text style={styles.validationValue}>₹{totalAmount.toFixed(2)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={[styles.validationRow, styles.balanceRow]}>
              <Text style={[styles.validationLabel, styles.balanceLabel]}>Change</Text>
              <Text
                style={[
                  styles.validationValue,
                  isValidCash ? styles.balanceValuePositive : styles.balanceValueNegative,
                ]}
              >
                {isValidCash ? '+' : '-'}₹{Math.abs(balance).toFixed(2)}
              </Text>
            </View>
          </View>
        )}

        {/* Payment Complete Button */}
        <TouchableOpacity
          style={[
            styles.completeButton,
            !isValidCash && styles.completeButtonDisabled,
            loading && styles.completeButtonLoading,
          ]}
          onPress={handleCompletePayment}
          disabled={!isValidCash || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Text style={styles.completeButtonText}>Complete Payment</Text>
              {isValidCash && (
                <Text style={styles.completeButtonSubtext}>
                  Change to return: ₹{balance.toFixed(2)}
                </Text>
              )}
            </>
          )}
        </TouchableOpacity>

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8',
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
  billSection: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  billLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
    marginBottom: 8,
  },
  billAmount: {
    fontSize: 40,
    fontWeight: '700',
    color: '#fff',
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
  sectionError: {
    backgroundColor: '#fff8f8',
    borderWidth: 1.5,
    borderColor: '#ff6b6b',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  cashInput: {
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    backgroundColor: '#f8f8f8',
  },
  validationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  balanceRow: {
    paddingVertical: 12,
    backgroundColor: '#f8f8f8',
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  validationLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  balanceLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  validationValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  balanceValuePositive: {
    fontSize: 18,
    color: '#10b981',
  },
  balanceValueNegative: {
    fontSize: 18,
    color: '#ff6b6b',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  completeButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  completeButtonDisabled: {
    backgroundColor: '#ccc',
    shadowOpacity: 0.1,
  },
  completeButtonLoading: {
    opacity: 0.8,
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  completeButtonSubtext: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  bottomSpacing: {
    height: 32,
  },
});
