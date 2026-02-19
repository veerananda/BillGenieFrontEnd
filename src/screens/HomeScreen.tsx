import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { safeRemove } from '../utils/storageHelpers';
import { wsService } from '../services/websocket';
import { SubscriptionBanner } from '../components/SubscriptionBanner';

type RootStackParamList = {
  Home: undefined;
  AddMenuPricing: undefined;
  Orders: undefined;
  TakeOrder: { orderId?: string };
  IngredientManagement: undefined;
  InventoryManagement: undefined;
  SalesInformation: undefined;
  KitchenUpdate: undefined;
  RestaurantProfile: undefined;
  StaffManagement: undefined;
};

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [showDropdown, setShowDropdown] = useState(false);
  const { width } = useWindowDimensions();
  const [userRole, setUserRole] = useState<string>('staff');

  // ✅ REPLACED: Old polling logic with WebSocket listeners
  // Previously: Checked every 10 seconds with setInterval
  // Now: Listening to real-time WebSocket events from backend

  // Load user role
  useEffect(() => {
    const loadUserRole = async () => {
      const role = await AsyncStorage.getItem('user_role');
      setUserRole(role || 'staff');
      console.log('👤 User role:', role);
    };
    loadUserRole();
  }, []);

  // WebSocket event listeners for real-time order notifications
  useEffect(() => {
    const handleOrderCreated = (data: any) => {
      console.log('🔔 [HomeScreen] New order created via WebSocket:', data);
      // Server handles inventory deduction - no polling needed
      // Just notify user
    };

    const handleInventoryUpdated = (data: any) => {
      console.log('🔔 [HomeScreen] Inventory updated via WebSocket:', data);
      // Server handles deduction - UI updates via WebSocket
    };

    const handleOrderStatusChanged = (data: any) => {
      console.log('🔔 [HomeScreen] Order status changed via WebSocket:', data);
      // Real-time status updates for orders
    };

    // Register event listeners
    wsService.on('order_created', handleOrderCreated);
    wsService.on('inventory_updated', handleInventoryUpdated);
    wsService.on('order_status_changed', handleOrderStatusChanged);

    // Cleanup on unmount
    return () => {
      wsService.off('order_created', handleOrderCreated);
      wsService.off('inventory_updated', handleInventoryUpdated);
      wsService.off('order_status_changed', handleOrderStatusChanged);
    };
  }, []);

  const handleMenuPricingPress = () => {
    navigation.navigate('AddMenuPricing');
  };

  const handleOrdersPress = () => {
    navigation.navigate('Orders');
  };

  const handleIngredientManagementPress = () => {
    navigation.navigate('IngredientManagement');
  };

  const handleInventoryManagementPress = () => {
    navigation.navigate('InventoryManagement');
  };

  const handleSalesInformationPress = () => {
    navigation.navigate('SalesInformation');
  };

  const handleKitchenUpdatePress = () => {
    navigation.navigate('KitchenUpdate');
  };

  const handleStaffManagementPress = () => {
    navigation.navigate('StaffManagement');
  };

  const handleRestaurantProfilePress = () => {
    navigation.navigate('RestaurantProfile');
  };

  const handleLogout = async () => {
    try {
      // Disconnect WebSocket
      console.log('🔌 Disconnecting WebSocket...');
      wsService.disconnect();
      
      // Clear auth data
      await safeRemove('auth_token');
      await safeRemove('restaurant_id');
      await safeRemove('user_id');
      await safeRemove('user_role');
      console.log('✅ Logged out successfully');
      
      // Reset navigation stack to Login screen (prevents back button from going back)
      (navigation as any).reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const toggleDropdown = () => {
    setShowDropdown(!showDropdown);
  };

  const handleProfileSelect = () => {
    setShowDropdown(false);
    handleRestaurantProfilePress();
  };

  const handleLogoutSelect = () => {
    setShowDropdown(false);
    handleLogout();
  };

  return (
    <View style={styles.container}>
      {showDropdown && (
        <Pressable 
          style={styles.overlay} 
          onPress={() => setShowDropdown(false)} 
        />
      )}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.appTitle}>BillGenie</Text>
            <Text style={styles.appSubtitle}>Restaurant Management</Text>
          </View>
          <TouchableOpacity 
            style={styles.dropdownButton}
            onPress={toggleDropdown}
          >
            <Text style={styles.dropdownIcon}>☰</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.optionsContainer, { paddingBottom: (styles.optionsContainer?.paddingBottom || 0) + insets.bottom + 12 }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!showDropdown}
      >
        {/* Subscription Status Banner */}
        <SubscriptionBanner />
        
        <View style={styles.gridContainer}>
          {/* Menu & Pricing - admin and manager only */}
          {(userRole === 'admin' || userRole === 'manager') && (
            <TouchableOpacity
              style={[
                styles.optionCard,
                { width: getCardWidth(width) },
              ]}
              onPress={handleMenuPricingPress}
            >
              <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
                <Text style={[styles.optionIcon, { fontSize: getIconSize(width) }]}>🍽️</Text>
              </View>
              <Text style={styles.optionTitle}>Menu & Pricing</Text>
            </TouchableOpacity>
          )}

          {/* Orders & Billing - all roles */}
          <TouchableOpacity
            style={[styles.optionCard, { width: getCardWidth(width) }]}
            onPress={handleOrdersPress}
          >
            <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
              <Text style={[styles.optionIcon, { fontSize: getIconSize(width) }]}>📋</Text>
            </View>
            <Text style={styles.optionTitle}>Orders & Billing</Text>
          </TouchableOpacity>

          {/* Ingredient Management - DISABLED (Coming Soon) */}
          {(userRole === 'admin' || userRole === 'manager') && (
            <View
              style={[
                styles.optionCard,
                styles.disabledCard,
                { width: getCardWidth(width) },
              ]}
            >
              <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
                <Text style={[styles.optionIcon, { fontSize: getIconSize(width), opacity: 0.4 }]}>🥘</Text>
              </View>
              <Text style={[styles.optionTitle, styles.disabledText]}>Ingredient Mgmt</Text>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>Coming Soon</Text>
              </View>
            </View>
          )}

          {/* Inventory Management - DISABLED (Coming Soon) */}
          {(userRole === 'admin' || userRole === 'manager') && (
            <View
              style={[
                styles.optionCard,
                styles.disabledCard,
                { width: getCardWidth(width) },
              ]}
            >
              <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
                <Text style={[styles.optionIcon, { fontSize: getIconSize(width), opacity: 0.4 }]}>📦</Text>
              </View>
              <Text style={[styles.optionTitle, styles.disabledText]}>Inventory</Text>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>Coming Soon</Text>
              </View>
            </View>
          )}

          {/* Sales Information - admin only */}
          {userRole === 'admin' && (
            <TouchableOpacity
              style={[styles.optionCard, { width: getCardWidth(width) }]}
              onPress={handleSalesInformationPress}
            >
              <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
                <Text style={[styles.optionIcon, { fontSize: getIconSize(width) }]}>💰</Text>
              </View>
              <Text style={styles.optionTitle}>Sales Info</Text>
            </TouchableOpacity>
          )}

          {/* Kitchen Update - chef has access, admin and manager too */}
          {(userRole === 'admin' || userRole === 'manager' || userRole === 'chef') && (
            <TouchableOpacity
              style={[styles.optionCard, { width: getCardWidth(width) }]}
              onPress={handleKitchenUpdatePress}
            >
              <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
                <Text style={[styles.optionIcon, { fontSize: getIconSize(width) }]}>🍳</Text>
              </View>
              <Text style={styles.optionTitle}>Kitchen</Text>
            </TouchableOpacity>
          )}

          {/* Staff Management - admin only */}
          {userRole === 'admin' && (
            <TouchableOpacity
              style={[styles.optionCard, { width: getCardWidth(width) }]}
              onPress={handleStaffManagementPress}
            >
              <View style={[styles.iconWrapper, { width: getIconSize(width) * 1.8, height: getIconSize(width) * 1.8, borderRadius: (getIconSize(width) * 1.8) / 2 }]}>
                <Text style={[styles.optionIcon, { fontSize: getIconSize(width) }]}>👥</Text>
              </View>
              <Text style={styles.optionTitle}>Staff Mgmt</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}> 
        <Text style={styles.footerText}>Streamline your restaurant operations</Text>
      </View>

      {/* Dropdown Menu - Absolutely Positioned */}
      {showDropdown && (
        <View style={styles.dropdownMenuContainer}>
          <View style={styles.dropdownMenu}>
            <TouchableOpacity 
              style={styles.dropdownItem}
              onPress={handleProfileSelect}
            >
              <Text style={styles.dropdownItemIcon}>🏪</Text>
              <Text style={styles.dropdownItemText}>Restaurant Profile</Text>
            </TouchableOpacity>
            <View style={styles.dropdownDivider} />
            <TouchableOpacity 
              style={styles.dropdownItem}
              onPress={handleLogoutSelect}
            >
              <Text style={styles.dropdownItemIcon}>🚪</Text>
              <Text style={styles.dropdownItemText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

// Responsive helpers used by the component above
function getCardWidth(screenWidth: number) {
  // Account for horizontal padding (optionsContainer paddingHorizontal = 12 => left+right 24)
  const containerPadding = 24;
  const available = Math.max(0, screenWidth - containerPadding);

  if (screenWidth >= 1100) {
    // 4-column layout
    const gaps = 3 * 12; // between items
    return Math.floor((available - gaps) / 4);
  }

  // Make 3 columns for typical phones/tablet narrow widths (>=360dp)
  if (screenWidth >= 360) {
    const gaps = 2 * 12;
    return Math.floor((available - gaps) / 3);
  }

  if (screenWidth >= 260) {
    // 2-column layout for very narrow devices
    const gaps = 1 * 12;
    return Math.floor((available - gaps) / 2);
  }

  // Small phones: single column
  return Math.floor(available);
}

function getIconSize(screenWidth: number) {
  // Scale the icon size modestly based on width (slightly smaller than before)
  if (screenWidth >= 1100) return 48;
  if (screenWidth >= 760) return 44;
  if (screenWidth >= 360) return 40;
  return 34; // phones
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  header: {
    backgroundColor: '#7c3aed',
    paddingTop: 60,
    paddingBottom: 30,
    paddingHorizontal: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  appSubtitle: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
  },
  dropdownContainer: {
    position: 'relative',
  },
  dropdownMenuContainer: {
    position: 'absolute',
    top: 130,
    right: 20,
    zIndex: 1001,
  },
  dropdownButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownIcon: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
  },
  dropdownMenu: {
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 12,
    minWidth: 220,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  dropdownItemHover: {
    backgroundColor: '#f9f9f9',
  },
  dropdownItemIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#e8e8e8',
    marginVertical: 2,
  },
  optionsContainer: {
    paddingHorizontal: 12,
    paddingVertical: 20,
    paddingBottom: 120,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  optionCard: {
    // Width is calculated dynamically by getCardWidth based on device width
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    aspectRatio: 1,
    // spacing between rows
    marginBottom: 18,
  },
  optionIcon: {
    fontSize: 36,
    marginBottom: 0,
  },
  iconWrapper: {
    backgroundColor: '#fafafa',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  optionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    lineHeight: 16,
  },
  disabledCard: {
    backgroundColor: '#f5f5f5',
    opacity: 0.6,
  },
  disabledText: {
    color: '#999',
  },
  comingSoonBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FFB800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  comingSoonText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  footer: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#999',
  },
});
