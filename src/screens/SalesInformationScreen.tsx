import React, { useState, useEffect } from 'react';
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
import { apiClient } from '../services/api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectOrders } from '../store/ordersSlice';

type RootStackParamList = {
  Home: undefined;
  SalesInformation: undefined;
};

type SalesInformationScreenProps = NativeStackScreenProps<RootStackParamList, 'SalesInformation'>;

interface SalesData {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  period: string;
}

export const SalesInformationScreen: React.FC<SalesInformationScreenProps> = ({ navigation }) => {
  const dispatch = useAppDispatch();
  const reduxOrders = useAppSelector(selectOrders);
  
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'month'>('today');
  const [salesData, setSalesData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);

  // Reload data when period changes
  useEffect(() => {
    calculateSalesData();
  }, [selectedPeriod, reduxOrders]);

  // Reload data when screen comes into focus (after payment completes)
  useFocusEffect(
    React.useCallback(() => {
      console.log('🎯 Sales screen focused - recalculating sales data');
      calculateSalesData();
    }, [reduxOrders, selectedPeriod])
  );

  const calculateSalesData = () => {
    try {
      setLoading(true);
      
      // Use Redux orders (already loaded and transformed)
      const orders = reduxOrders || [];
      
      console.log(`📊 Using ${orders.length} orders from Redux`);
      console.log('📋 Orders for sales calculation:', orders.map((o: any) => ({
        id: o.id,
        status: o.status,
        finalAmount: o.finalAmount,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        isSelfService: o.isSelfService,
        orderNumber: o.orderNumber,
      })));

      const now = new Date();
      let filteredOrders = [];

      if (selectedPeriod === 'today') {
        // Get today's COMPLETED orders only
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        filteredOrders = orders.filter((order: any) => {
          // Handle both created_at (from API) and createdAt (from Redux)
          const createdAtValue = order.created_at || order.createdAt;
          const orderDate = createdAtValue ? new Date(createdAtValue).getTime() : order.savedAt || 0;
          const isCompleted = order.status === 'completed';
          const isToday = orderDate >= todayStart;
          
          console.log(`📌 Order ${order.id}: status=${order.status}, isCompleted=${isCompleted}, createdAt=${createdAtValue}, orderDate=${new Date(orderDate).toISOString()}, isToday=${isToday}, todayStart=${new Date(todayStart).toISOString()}`);
          return orderDate >= todayStart && isCompleted;
        });
      } else {
        // Get current month's COMPLETED orders only (from 1st to today)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        filteredOrders = orders.filter((order: any) => {
          // Handle both created_at (from API) and createdAt (from Redux)
          const createdAtValue = order.created_at || order.createdAt;
          const orderDate = createdAtValue ? new Date(createdAtValue).getTime() : order.savedAt || 0;
          const isCompleted = order.status === 'completed';
          const isThisMonth = orderDate >= monthStart;
          
          console.log(`📌 Order ${order.id}: status=${order.status}, isCompleted=${isCompleted}, createdAt=${createdAtValue}, orderDate=${new Date(orderDate).toISOString()}, isThisMonth=${isThisMonth}, monthStart=${new Date(monthStart).toISOString()}`);
          return orderDate >= monthStart && isCompleted;
        });
      }

      // Calculate totals - use the final amount paid (after discount)
      const totalRevenue = filteredOrders.reduce((sum: number, order: any) => {
        // Use finalAmount if available (from checkout), otherwise use totalAmount
        const amount = order.finalAmount || order.totalAmount || order.total_amount || order.total || 0;
        console.log(`💰 Order ${order.id}: amount=${amount}, finalAmount=${order.finalAmount}, totalAmount=${order.totalAmount}`);
        return sum + amount;
      }, 0);

      const totalOrders = filteredOrders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      console.log('📈 Sales Data:', { totalRevenue, totalOrders, averageOrderValue, filteredCount: filteredOrders.length, period: selectedPeriod });

      setSalesData({
        totalRevenue,
        totalOrders,
        averageOrderValue,
        period: selectedPeriod === 'today' ? "Today's Sales" : 'Monthly Revenue',
      });
    } catch (error) {
      console.error('Error loading sales data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₹${amount.toFixed(2)}`;
  };

  return (
    <View style={styles.container}>
      {/* Period Selector */}
      <View style={styles.periodSelector}>
        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedPeriod === 'today' && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedPeriod('today')}
        >
          <Text
            style={[
              styles.periodButtonText,
              selectedPeriod === 'today' && styles.periodButtonTextActive,
            ]}
          >
            Today's Sales
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedPeriod === 'month' && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedPeriod('month')}
        >
          <Text
            style={[
              styles.periodButtonText,
              selectedPeriod === 'month' && styles.periodButtonTextActive,
            ]}
          >
            Monthly Revenue
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sales Data */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#7c3aed" />
            <Text style={styles.loadingText}>Loading sales data...</Text>
          </View>
        ) : salesData ? (
          <View style={styles.salesDataContainer}>
            {/* Period Title */}
            <View style={styles.periodCard}>
              <Text style={styles.periodTitle}>{salesData.period}</Text>
              <Text style={styles.periodSubtitle}>
                {selectedPeriod === 'today'
                  ? new Date().toLocaleDateString('en-IN', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : new Date().toLocaleDateString('en-IN', {
                      year: 'numeric',
                      month: 'long',
                    })}
              </Text>
            </View>

            {/* Total Revenue */}
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <Text style={styles.statIcon}>💰</Text>
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statLabel}>Total Revenue</Text>
                <Text style={styles.statValue}>{formatCurrency(salesData.totalRevenue)}</Text>
              </View>
            </View>

            {/* Total Orders */}
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <Text style={styles.statIcon}>📊</Text>
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statLabel}>Total Orders</Text>
                <Text style={styles.statValue}>{salesData.totalOrders}</Text>
              </View>
            </View>

            {/* Average Order Value */}
            <View style={styles.statCard}>
              <View style={styles.statIconContainer}>
                <Text style={styles.statIcon}>📈</Text>
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statLabel}>Average Order Value</Text>
                <Text style={styles.statValue}>{formatCurrency(salesData.averageOrderValue)}</Text>
              </View>
            </View>

            {/* Empty State */}
            {salesData.totalOrders === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateIcon}>📭</Text>
                <Text style={styles.emptyStateText}>
                  No sales recorded for {selectedPeriod === 'today' ? 'today' : 'this month'}
                </Text>
                <Text style={styles.emptyStateSubtext}>
                  Orders will appear here once customers place them
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Refresh Button */}
      <TouchableOpacity style={styles.refreshButton} onPress={calculateSalesData}>
        <Text style={styles.refreshButtonText}>🔄 Refresh Data</Text>
      </TouchableOpacity>
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
  },
  backButton: {
    marginRight: 15,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  periodSelector: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  periodButtonActive: {
    backgroundColor: '#ede9fe',
    borderColor: '#7c3aed',
  },
  periodButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  periodButtonTextActive: {
    color: '#7c3aed',
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
  salesDataContainer: {
    padding: 16,
    gap: 16,
  },
  periodCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  periodTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  periodSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ede9fe',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  statIcon: {
    fontSize: 32,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  refreshButton: {
    backgroundColor: '#7c3aed',
    margin: 16,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
