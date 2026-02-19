import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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

export interface Order {
  id: string;
  tableNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  createdAt: number;
  status: 'pending' | 'completed';
  tableId?: string;
  expiresAt?: number; // For self-service orders (30 minutes after completion)
  finalAmount?: number; // Final amount after discounts/taxes (for self-service orders)
  discountAmount?: number;
  taxAmount?: number;
  paymentMethod?: string;
  isSelfService?: boolean;
  orderNumber?: number; // Order number for self-service orders
}

interface OrdersState {
  orders: Order[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null; // Timestamp of last successful fetch
}

const initialState: OrdersState = {
  orders: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
};

const ordersSlice = createSlice({
  name: 'orders',
  initialState,
  reducers: {
    // Set all orders
    setOrders: (state, action: PayloadAction<Order[]>) => {
      state.orders = action.payload;
      state.error = null;
      state.lastFetchedAt = Date.now(); // Update cache timestamp
    },
    
    // Add single order
    addOrder: (state, action: PayloadAction<Order>) => {
      state.orders.push(action.payload);
    },
    
    // Update order (replaces entire order)
    updateOrder: (state, action: PayloadAction<Order>) => {
      const index = state.orders.findIndex(o => o.id === action.payload.id);
      if (index !== -1) {
        state.orders[index] = action.payload;
      }
    },
    
    // Update single item status within an order (CRITICAL: partial update)
    updateOrderItemStatus: (state, action: PayloadAction<{ orderId: string; itemId: string; newStatus: ItemStatus }>) => {
      const order = state.orders.find(o => o.id === action.payload.orderId);
      if (order) {
        const item = order.items.find(i => i.id === action.payload.itemId);
        if (item) {
          item.status = action.payload.newStatus;
          item.statusUpdatedAt = Date.now();
        }
      }
    },
    
    // Remove order
    removeOrder: (state, action: PayloadAction<string>) => {
      state.orders = state.orders.filter(o => o.id !== action.payload);
    },
    
    // Set loading state
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    
    // Set error
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    // Clear all orders
    clearOrders: (state) => {
      state.orders = [];
      state.error = null;
    },
    
    // Complete sale (mark as completed and update for sales)
    completeSale: (state, action: PayloadAction<{ orderId: string; amountPaid: number; paymentMethod: string }>) => {
      const order = state.orders.find(o => o.id === action.payload.orderId);
      if (order) {
        order.status = 'completed';
      }
    },
  },
});

export const {
  setOrders,
  addOrder,
  updateOrder,
  updateOrderItemStatus,
  removeOrder,
  setLoading,
  setError,
  clearOrders,
  completeSale,
} = ordersSlice.actions;

// Selectors
export const selectOrders = (state: { orders: OrdersState }) => state.orders.orders;
export const selectOrdersLoading = (state: { orders: OrdersState }) => state.orders.loading;
export const selectOrdersError = (state: { orders: OrdersState }) => state.orders.error;
export const selectOrdersLastFetchedAt = (state: { orders: OrdersState }) => state.orders.lastFetchedAt;
export const selectOrderById = (state: { orders: OrdersState }, orderId: string) =>
  state.orders.orders.find(o => o.id === orderId);

export default ordersSlice.reducer;
