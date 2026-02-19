import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';

// Re-enable native screens now that we sanitize boolean-like props
// (previously disabled while investigating a ClassCastException).
// Passing correctly typed boolean | undefined to native components prevents
// the Android ClassCastException (string -> boolean) in RNSScreenManagerDelegate.
enableScreens(true);
import { Provider as StoreProvider } from 'react-redux';
import { store } from './src/store';
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { QuickAddMenuScreen } from './src/screens/QuickAddMenuScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { TakeOrderScreen } from './src/screens/TakeOrderScreen';
import { SelfServiceOrderScreen } from './src/screens/SelfServiceOrderScreen';
import { IngredientManagementScreen } from './src/screens/IngredientManagementScreen';
import { InventoryManagementScreen } from './src/screens/InventoryManagementScreen';
import { SalesInformationScreen } from './src/screens/SalesInformationScreen';
import { KitchenUpdateScreen } from './src/screens/KitchenUpdateScreen';
import { BillSummaryScreen } from './src/screens/BillSummaryScreen';
import { OrderDetailsScreen } from './src/screens/OrderDetailsScreen';
import { RestaurantProfileScreen } from './src/screens/RestaurantProfileScreen';
import { StaffManagementScreen } from './src/screens/StaffManagementScreen';
import { AddStaffScreen } from './src/screens/AddStaffScreen';
import { EditStaffScreen } from './src/screens/EditStaffScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { EmailVerificationScreen } from './src/screens/EmailVerificationScreen';

type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  EmailVerification: { restaurantId: string; email: string; restaurantCode: string };
  ForgotPassword: undefined;
  ResetPassword: { token: string };
  Home: undefined;
  AddMenuPricing: undefined;
  Orders: undefined;
  TakeOrder: { orderId?: string };
  SelfServiceOrder: undefined;
  OrderDetails: { orderId: string; tableName: string };
  IngredientManagement: undefined;
  InventoryManagement: undefined;
  SalesInformation: undefined;
  KitchenUpdate: undefined;
  BillSummary: { orderId: string };
  RestaurantProfile: undefined;
  StaffManagement: undefined;
  AddStaff: undefined;
  EditStaff: { userId: string; userName: string; userEmail: string; userPhone: string; userRole: string };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider store={store}>
        <NavigationContainer
          linking={{
            prefixes: ['exp://', 'billgenie://'],
            config: {
              screens: {
                Login: 'login',
                Register: 'register',
                EmailVerification: 'verify-email',
                ForgotPassword: 'forgot-password',
                ResetPassword: 'reset-password',
                Home: 'home',
                Orders: 'orders',
                TakeOrder: 'takeorder/:orderId',
              },
            },
          }}
          fallback={null}
        >
          <Stack.Navigator id="root"
            initialRouteName="Login"
            screenOptions={{
              headerShown: true,
              headerStyle: {
                backgroundColor: '#7c3aed',
              },
              headerTintColor: '#fff',
              headerTitleAlign: 'center',
              headerBackTitleVisible: false,
            }}
          >
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{
                title: 'BillGenie Login',
                headerShown: false,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="Register"
              component={RegisterScreen}
              options={{
                title: 'Register Restaurant',
                headerShown: false,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{
                title: 'Reset Password',
                headerShown: true,
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="ResetPassword"
              component={ResetPasswordScreen}
              options={{
                title: 'Create New Password',
                headerShown: true,
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="EmailVerification"
              component={EmailVerificationScreen}
              options={{
                title: 'Verify Email',
                headerShown: true,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{
                title: 'BillGenie',
                headerShown: false,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="AddMenuPricing"
              component={QuickAddMenuScreen}
              options={{
                title: 'Add Menu & Pricing',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="Orders"
              component={OrdersScreen}
              options={{
                title: 'Orders & Billing',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="TakeOrder"
              component={TakeOrderScreen}
              options={{
                title: 'Take Order',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="SelfServiceOrder"
              component={SelfServiceOrderScreen}
              options={{
                title: 'New Order',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="IngredientManagement"
              component={IngredientManagementScreen}
              options={{
                title: 'Ingredient Management',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="InventoryManagement"
              component={InventoryManagementScreen}
              options={{
                title: 'Inventory Management',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="SalesInformation"
              component={SalesInformationScreen}
              options={{
                title: 'Sales Information',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="KitchenUpdate"
              component={KitchenUpdateScreen}
              options={{
                title: 'Kitchen Updates',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="BillSummary"
              component={BillSummaryScreen}
              options={{
                title: 'Bill Summary',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="OrderDetails"
              component={OrderDetailsScreen}
              options={({ route }) => {
                const { tableName } = route.params as { tableName: string };
                // Extract order number from tableName (e.g., "Order 123" or "Table 1"). We normalize to 'Order <num>' (no '#').
                const isOrderNumber = typeof tableName === 'string' && /^order\b/i.test(tableName);
                let displayTitle = '';
                if (isOrderNumber) {
                  const m = String(tableName).match(/^order\s*#?\s*(.*)$/i);
                  displayTitle = m ? `Order ${m[1].trim()}` : tableName;
                } else if (/^\s*table\b/i.test(tableName)) {
                  displayTitle = tableName;
                } else {
                  displayTitle = `Table ${tableName}`;
                }
                return {
                  title: displayTitle,
                  gestureEnabled: true,
                };
              }}
            />
            <Stack.Screen
              name="RestaurantProfile"
              component={RestaurantProfileScreen}
              options={{
                title: 'Restaurant Profile',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="StaffManagement"
              component={StaffManagementScreen}
              options={{
                title: 'Staff Management',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="AddStaff"
              component={AddStaffScreen}
              options={{
                title: 'Add Staff Member',
                gestureEnabled: true,
              }}
            />
            <Stack.Screen
              name="EditStaff"
              component={EditStaffScreen}
              options={{
                title: 'Edit Staff Member',
                gestureEnabled: true,
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
