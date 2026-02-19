/**
 * API Client Service for React Native
 * Handles all HTTP requests to Go backend
 * Supports real-time WebSocket sync for multi-device coordination
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { logger } from '../utils/logger';

// Get API URLs from environment or use defaults
const getApiBaseUrl = (): string => {
  // Try to get from environment variables first (process.env for Expo)
  const envVarUrl = (process.env as any)?.EXPO_PUBLIC_API_BASE_URL;
  if (envVarUrl && !envVarUrl.includes('${')) {
    logger.api('Using environment variable API URL:', envVarUrl);
    return envVarUrl;
  }

  // Try to get from Expo Constants (app.json extra)
  const expoUrl = Constants.expoConfig?.extra?.apiBaseUrl;
  if (expoUrl && !expoUrl.includes('${')) {
    logger.api('Using Expo config API URL:', expoUrl);
    // For localhost URLs from app.json, convert to proper platform URL
    if (expoUrl.includes('localhost')) {
      if (Platform.OS === 'android') {
        const androidUrl = expoUrl.replace('localhost', '10.0.2.2');
        logger.api('Converting localhost to Android emulator URL:', androidUrl);
        return androidUrl;
      }
    }
    return expoUrl;
  }

  // Fallback to machine IP (192.168.29.196) - works for both physical device and emulator on same network
  if (Platform.OS === 'android') {
    logger.api('Using fallback Android API URL (machine IP)');
    return 'http://192.168.29.196:3000';
  }
  logger.api('Using fallback localhost API URL');
  return 'http://localhost:3000';
};

const getWsBaseUrl = (): string => {
  // Try to get from environment variables first (process.env for Expo)
  const envVarUrl = (process.env as any)?.EXPO_PUBLIC_WS_BASE_URL;
  if (envVarUrl && !envVarUrl.includes('${')) {
    logger.api('Using environment variable WS URL:', envVarUrl);
    return envVarUrl;
  }

  // Try to get from Expo Constants (app.json extra)
  const expoUrl = Constants.expoConfig?.extra?.wsBaseUrl;
  if (expoUrl && !expoUrl.includes('${')) {
    logger.api('Using Expo config WS URL:', expoUrl);
    // For localhost URLs from app.json, convert to proper platform URL
    if (expoUrl.includes('localhost')) {
      if (Platform.OS === 'android') {
        const androidUrl = expoUrl.replace('localhost', '10.0.2.2');
        logger.api('Converting localhost to Android emulator URL:', androidUrl);
        return androidUrl;
      }
    }
    return expoUrl;
  }

  // Fallback to machine IP (192.168.29.196) - works for both physical device and emulator on same network
  if (Platform.OS === 'android') {
    logger.api('Using fallback Android WS URL (machine IP)');
    return 'ws://192.168.29.196:3000';
  }
  logger.api('Using fallback localhost WS URL');
  return 'ws://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();
const WS_BASE_URL = getWsBaseUrl();
const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const RESTAURANT_ID_KEY = 'restaurant_id';
const USER_ID_KEY = 'user_id';

// Log final URLs on module load
logger.api('API Client initialized');
logger.api('API Base URL:', API_BASE_URL);
logger.api('WS Base URL:', WS_BASE_URL);

// Types
export interface AuthCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  restaurant_name: string;
  owner_name: string;
  email: string;
  phone: string;
  password: string;
  address?: string;
  city?: string;
  cuisine?: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  restaurant_id: string;
  user_id: string;
  role: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  table_number: number;
  table_id?: string;
  order_number: number;
  customer_name?: string;
  status: string;
  sub_total: number;
  tax_amount: number;
  total: number;
  items: OrderItem[];
  created_at: string;
  completed_at?: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_id: string;
  quantity: number;
  unit_rate: number;
  total: number;
  status: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  name: string;
  category: string;
  price: number;
  cost_price?: number;
  is_veg: boolean;
  is_available: boolean;
}

export interface InventoryItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit: string;
  min_level: number;
  max_level: number;
}

export interface Ingredient {
  id: string;
  restaurant_id: string;
  name: string;
  unit: string;
  current_stock: number;
  full_stock: number;
  created_at: string;
  updated_at: string;
}

export interface RestaurantProfile {
  id: string;
  name: string;
  address: string;
  phone: string;
  contact_number: string;
  email: string;
  upi_qr_code: string;
  city: string;
  cuisine: string;
  is_self_service: boolean;
  subscription_end?: string; // ISO 8601 date string
}

export interface UpdateProfileRequest {
  name?: string;
  address?: string;
  contact_number?: string;
  upi_qr_code?: string;
  is_self_service?: boolean;
}

export interface CompletePaymentRequest {
  payment_method: 'cash' | 'upi';
  amount_received?: number;
  change_returned?: number;
  upi_transaction_id?: string;
}

export interface CreateOrderRequest {
  table_number: string;
  order_number?: number; // For self-service orders
  customer_name?: string;
  table_id?: string;
  items: {
    menu_item_id: string;
    quantity: number;
    notes?: string;
  }[];
  notes?: string;
}

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  name: string;
  is_occupied: boolean;
  current_order_id?: string;
  capacity?: number;
  created_at: string;
  updated_at: string;
}

class APIClient {
  private wsConnection: WebSocket | null = null;
  private wsListeners: Map<string, Function[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  /**
   * Helper: Make HTTP requests with auth token
   */
  private async makeRequest(
    endpoint: string,
    method: string = 'GET',
    body?: any,
    skipRetry: boolean = false  // ✅ NEW: Flag to skip retry logic
  ): Promise<any> {
    // Restore AsyncStorage token checks
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    logger.auth(`Token check for ${endpoint}: ${token ? 'Found' : 'NOT FOUND'}`);
    
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
      logger.auth(`Authorization header set for ${endpoint}`);
    } else {
      logger.warn(`NO TOKEN - Request to ${endpoint} will be unauthorized!`);
    }

    const config: RequestInit = {
      method,
      headers,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    const fullUrl = `${API_BASE_URL}${endpoint}`;
    logger.api(`${method} Request to: ${fullUrl}`);

    try {
      const response = await fetch(fullUrl, config);

      if (response.status === 401) {
        // Don't retry on auth endpoints (login, register, refresh) or if skipRetry is true
        const isAuthEndpoint = endpoint.startsWith('/auth/');
        
        if (!isAuthEndpoint && !skipRetry) {
          // Token might be expired - try to refresh
          logger.warn('401 Unauthorized - Attempting to refresh token...');
          const refreshed = await this.refreshAccessToken();
          
          if (refreshed) {
            // Retry request with new token
            logger.auth('Retrying request with new token...');
            const newToken = await AsyncStorage.getItem(TOKEN_KEY);
            const retryConfig = { ...config };
            if (newToken) {
              retryConfig.headers = {
                ...retryConfig.headers,
                Authorization: `Bearer ${newToken}`,
              };
            }
            
            try {
              const retryResponse = await fetch(fullUrl, retryConfig);
              if (retryResponse.ok) {
                return await retryResponse.json();
              }
            } catch (retryErr) {
              console.error('❌ Retry failed:', retryErr);
            }
          }
        }
        
        // If refresh failed or retry failed (or auth endpoint), logout
        logger.error('Authentication failed - logging out');
        await this.logout();
        throw new Error('Authentication failed. Please login again.');
      }

      if (response.status === 402) {
        // Subscription expired
        const errorData = await response.json().catch(() => ({}));
        logger.warn('402 Payment Required - Subscription expired');
        throw new Error(errorData.error || 'Your subscription has expired. Please renew to continue.');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      // Normalize: if API wraps result under { data: ... } return the inner data
      const parsed = await response.json().catch(() => null);
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data')) {
        return parsed.data;
      }
      return parsed;
    } catch (error) {
      console.error(`❌ Request failed for ${fullUrl}:`, error);
      throw error;
    }
  }

  /**
   * Auth Endpoints
   */

  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      const response = await this.makeRequest('/auth/register', 'POST', data);
      const authPayload = response?.data ?? response;
      await this.storeAuthData(authPayload);
      return authPayload;
    } catch (error) {
      throw error;
    }
  }

  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    try {
      const response = await this.makeRequest('/auth/login', 'POST', credentials);
      const authPayload = response?.data ?? response;
      await this.storeAuthData(authPayload);
      return authPayload;
    } catch (error) {
      throw error;
    }
  }

  async logout(): Promise<void> {
    // Remove saved auth data on logout
    await AsyncStorage.multiRemove([TOKEN_KEY, RESTAURANT_ID_KEY, USER_ID_KEY]);
    this.disconnectWebSocket();
  }

  /**
   * Order Endpoints
   */

  async createOrder(order: CreateOrderRequest): Promise<Order> {
    try {
      const response = await this.makeRequest(
        `/orders`,
        'POST',
        order
      );
      // Extract the order from the wrapped response
      logger.orders('createOrder raw response:', response);
      const createdOrder = response.order || response;
      logger.orders('createOrder extracted order:', createdOrder);
      return createdOrder;
    } catch (error) {
      throw error;
    }
  }

  async getOrder(orderId: string): Promise<Order> {
    try {
      const response = await this.makeRequest(
        `/orders/${orderId}`,
        'GET'
      );
      // Handle wrapped response { order: {...} } or direct response
      logger.orders('getOrder raw response:', response);
      const order = response.order || response;
      logger.orders('getOrder extracted order:', order);
      return order;
    } catch (error) {
      throw error;
    }
  }

  async listOrders(
    status?: string,
    limit = 50,
    offset = 0
  ): Promise<{ orders: Order[]; total: number }> {
    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());

      const response = await this.makeRequest(
        `/orders?${params.toString()}`,
        'GET'
      );
      console.log('📋 listOrders raw response:', JSON.stringify(response, null, 2));
      console.log('📋 listOrders response.orders:', response.orders);
      console.log('📋 listOrders orders count:', response.orders?.length || 0);
      return response;
    } catch (error) {
      console.error('❌ listOrders error:', error);
      throw error;
    }
  }

  async completeOrder(orderId: string): Promise<Order> {
    try {
      return await this.makeRequest(
        `/orders/${orderId}/complete`,
        'PUT'
      );
    } catch (error) {
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.makeRequest(
        `/orders/${orderId}/cancel`,
        'PUT'
      );
    } catch (error) {
      throw error;
    }
  }

  async updateOrder(orderId: string, order: CreateOrderRequest): Promise<Order> {
    try {
      const response = await this.makeRequest(
        `/orders/${orderId}`,
        'PUT',
        order
      );
      // Extract the order from the wrapped response
      console.log('📦 updateOrder raw response:', response);
      const updatedOrder = response.order || response;
      console.log('📦 updateOrder extracted order:', updatedOrder);
      return updatedOrder;
    } catch (error) {
      throw error;
    }
  }

  async updateOrderItemStatus(
    orderId: string,
    itemId: string,
    status: 'pending' | 'cooking' | 'ready' | 'served'
  ): Promise<void> {
    try {
      await this.makeRequest(
        `/orders/${orderId}/items/${itemId}/status`,
        'PUT',
        { status }
      );
    } catch (error) {
      throw error;
    }
  }

  async updateOrderItemsByMenuID(
    orderId: string,
    menuItemId: string,
    status: 'pending' | 'cooking' | 'ready' | 'served'
  ): Promise<void> {
    try {
      await this.makeRequest(
        `/orders/${orderId}/menu-items/${menuItemId}/status`,
        'PUT',
        { status }
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Inventory Endpoints
   */

  async getInventory(menuItemId: string): Promise<InventoryItem> {
    try {
      return await this.makeRequest(
        `/inventory/${menuItemId}`,
        'GET'
      );
    } catch (error) {
      throw error;
    }
  }

  async listInventory(): Promise<InventoryItem[]> {
    try {
      return await this.makeRequest(
        `/inventory`,
        'GET'
      );
    } catch (error) {
      throw error;
    }
  }

  async updateInventory(menuItemId: string, quantity: number): Promise<InventoryItem> {
    try {
      return await this.makeRequest(
        `/inventory/${menuItemId}`,
        'PUT',
        { quantity }
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Ingredient Endpoints
   */

  async listIngredients(): Promise<Ingredient[]> {
    try {
      const response = await this.makeRequest('/ingredients', 'GET');
      return response.ingredients || [];
    } catch (error) {
      throw error;
    }
  }

  async createIngredient(data: {
    name: string;
    unit: string;
    current_stock: number;
    full_stock: number;
  }): Promise<Ingredient> {
    try {
      const response = await this.makeRequest('/ingredients', 'POST', data);
      return response.ingredient;
    } catch (error) {
      throw error;
    }
  }

  async updateIngredient(
    ingredientId: string,
    data: {
      name?: string;
      unit?: string;
      current_stock: number;
      full_stock: number;
    }
  ): Promise<Ingredient> {
    try {
      const response = await this.makeRequest(
        `/ingredients/${ingredientId}`,
        'PUT',
        data
      );
      return response.ingredient;
    } catch (error) {
      throw error;
    }
  }

  async deleteIngredient(ingredientId: string): Promise<void> {
    try {
      await this.makeRequest(`/ingredients/${ingredientId}`, 'DELETE');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Menu Endpoints
   */

  async listMenuItems(): Promise<MenuItem[]> {
    try {
      const response = await this.makeRequest('/menu', 'GET');
      console.log('Menu API Response:', JSON.stringify(response, null, 2));
      // API returns { menu_items: [...], total: ..., limit: ..., offset: ... }
      const items = response.menu_items || response || [];
      console.log('Extracted items:', JSON.stringify(items, null, 2));
      if (items.length > 0) {
        console.log('First item structure:', JSON.stringify(items[0], null, 2));
      }
      return items;
    } catch (error) {
      console.error('Menu API Error:', error);
      throw error;
    }
  }

  async getMenuItem(menuItemId: string): Promise<MenuItem> {
    try {
      return await this.makeRequest(`/menu/${menuItemId}`, 'GET');
    } catch (error) {
      throw error;
    }
  }

  async createMenuItem(data: Partial<MenuItem>): Promise<MenuItem> {
    try {
      const response = await this.makeRequest('/menu', 'POST', data);
      // Backend returns { message: "...", menu_item: {...} }
      return response.menu_item || response || {};
    } catch (error) {
      throw error;
    }
  }

  async updateMenuItem(menuItemId: string, data: Partial<MenuItem>): Promise<MenuItem> {
    try {
      const response = await this.makeRequest(`/menu/${menuItemId}`, 'PUT', data);
      return response.menu_item || response || {};
    } catch (error) {
      throw error;
    }
  }

  async deleteMenuItem(menuItemId: string): Promise<void> {
    try {
      await this.makeRequest(`/menu/${menuItemId}`, 'DELETE');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Restaurant Profile Endpoints
   */

  async getRestaurantProfile(): Promise<RestaurantProfile> {
    try {
      const response = await this.makeRequest('/restaurants/profile', 'GET');
      return response;
    } catch (error) {
      throw error;
    }
  }

  async updateRestaurantProfile(data: UpdateProfileRequest): Promise<{ message: string; restaurant: RestaurantProfile }> {
    try {
      const response = await this.makeRequest('/restaurants/profile', 'PUT', data);
      return response;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Table Management Endpoints
   */

  async getTables(): Promise<RestaurantTable[]> {
    try {
      const response = await this.makeRequest('/tables', 'GET');
      console.log('🎯 getTables raw response:', response);
      console.log('🎯 getTables response type:', typeof response);
      console.log('🎯 getTables is array?', Array.isArray(response));
      
      // Handle both array and wrapped response
      const tables = Array.isArray(response) ? response : response.tables || [];
      console.log('🎯 getTables final tables:', tables);
      return tables;
    } catch (error) {
      console.error('❌ getTables error:', error);
      throw error;
    }
  }

  async createTable(name: string): Promise<RestaurantTable> {
    try {
      const response = await this.makeRequest('/tables', 'POST', { name });
      return response;
    } catch (error) {
      throw error;
    }
  }

  async createBulkTables(names: string): Promise<{ message: string; count: number; tables: RestaurantTable[] }> {
    try {
      const response = await this.makeRequest('/tables/bulk', 'POST', { names });
      return response;
    } catch (error) {
      throw error;
    }
  }

  async updateTable(tableId: string, updates: { name?: string; is_occupied?: boolean; capacity?: number }): Promise<RestaurantTable> {
    try {
      const response = await this.makeRequest(`/tables/${tableId}`, 'PUT', updates);
      return response;
    } catch (error) {
      throw error;
    }
  }

  async deleteTable(tableId: string): Promise<{ message: string }> {
    try {
      const response = await this.makeRequest(`/tables/${tableId}`, 'DELETE');
      return response;
    } catch (error) {
      throw error;
    }
  }

  async setTableOccupied(tableId: string, orderId: string): Promise<RestaurantTable> {
    try {
      console.log('🔴 Calling setTableOccupied:', { tableId, orderId });
      const response = await this.makeRequest(`/tables/${tableId}/occupy`, 'PUT', { order_id: orderId });
      console.log('✅ setTableOccupied response:', response);
      return response;
    } catch (error) {
      console.error('❌ setTableOccupied error:', error);
      throw error;
    }
  }

  async setTableVacant(tableId: string): Promise<RestaurantTable> {
    try {
      const response = await this.makeRequest(`/tables/${tableId}/vacant`, 'PUT', {});
      return response;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Order Payment Completion Endpoint
   */

  async completeOrderWithPayment(
    orderId: string,
    paymentData: CompletePaymentRequest
  ): Promise<{ message: string; order: Order }> {
    try {
      console.log('🔄 [API CLIENT] completeOrderWithPayment called');
      console.log('   Endpoint: /orders/' + orderId + '/complete-payment');
      console.log('   Payload:', paymentData);
      
      const response = await this.makeRequest(
        `/orders/${orderId}/complete-payment`,
        'POST',
        paymentData
      );
      
      console.log('✅ [API CLIENT] Payment response received:', response);
      return response;
    } catch (error) {
      console.error('❌ [API CLIENT] Payment request failed:', error);
      throw error;
    }
  }

  /**
   * WebSocket Real-time Sync
   */

  connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${WS_BASE_URL}/ws`;

        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onopen = () => {
          console.log('✅ WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.wsConnection.onmessage = (event) => {
          this.handleWebSocketMessage(event.data);
        };

        this.wsConnection.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          reject(error);
        };

        this.wsConnection.onclose = () => {
          console.log('❌ WebSocket disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`🔄 Attempting to reconnect in ${delay}ms...`);
      setTimeout(() => this.connectWebSocket().catch(console.error), delay);
    }
  }

  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      const { type, data: eventData } = message;

      // Emit event to all listeners
      const listeners = this.wsListeners.get(type) || [];
      listeners.forEach((listener) => listener(eventData));
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  on(eventType: string, callback: Function): void {
    if (!this.wsListeners.has(eventType)) {
      this.wsListeners.set(eventType, []);
    }
    this.wsListeners.get(eventType)!.push(callback);
  }

  off(eventType: string, callback: Function): void {
    const listeners = this.wsListeners.get(eventType) || [];
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  sendMessage(type: string, data: any): void {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify({ type, data }));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  disconnectWebSocket(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }

  /**
   * Helper Methods
   */

  private async storeAuthData(authData: AuthResponse): Promise<void> {
    console.log('💾 Storing auth data (raw):', JSON.stringify(authData, null, 2));

    if (!authData || !authData.access_token) {
      console.error('❌ storeAuthData: missing access_token in authData. Skipping store.');
      return;
    }

    await AsyncStorage.setItem(TOKEN_KEY, authData.access_token);
    if (authData.refresh_token) {
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, authData.refresh_token);
    }
    if (authData.restaurant_id) {
      await AsyncStorage.setItem(RESTAURANT_ID_KEY, authData.restaurant_id);
    }
    if (authData.user_id) {
      await AsyncStorage.setItem(USER_ID_KEY, authData.user_id);
    }

    // Verify it was stored
    const storedToken = await AsyncStorage.getItem(TOKEN_KEY);
    console.log('✅ Auth token stored:', storedToken ? `${storedToken.substring(0, 20)}...` : 'FAILED');
  }

  // Refresh access token using refresh token
  async refreshAccessToken(): Promise<boolean> {
    try {
      const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        console.log('❌ No refresh token found');
        return false;
      }

      console.log('🔄 Attempting to refresh access token...');
      // ✅ Pass skipRetry: true to prevent infinite loop
      const response = await this.makeRequest('/auth/refresh', 'POST', { refresh_token: refreshToken }, true);
      const payload = response?.data ?? response;
      await this.storeAuthData(payload);
      console.log('✅ Access token refreshed successfully');
      return true;
    } catch (err) {
      console.error('❌ Token refresh failed:', err);
      return false;
    }
  }

  isAuthenticated = async (): Promise<boolean> => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    return !!token;
  };

  async updateTableStatus(
    tableId: string,
    status: 'vacant' | 'occupied'
  ): Promise<void> {
    try {
      await this.makeRequest(
        `/tables/${tableId}/status`,
        'PUT',
        { status }
      );
    } catch (error) {
      throw error;
    }
  }

  getAuthToken = async (): Promise<string | null> => {
    return await AsyncStorage.getItem(TOKEN_KEY);
  };
}

// Export singleton instance
export const apiClient = new APIClient();
export default apiClient;

