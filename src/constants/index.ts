// src/constants/index.ts
export const TAX_RATE = 0.05; // 5% GST
export const ORDER_EXPIRATION_MINUTES = 30;
export const ORDER_EXPIRATION_MS = ORDER_EXPIRATION_MINUTES * 60 * 1000;

export const COLORS = {
  primary: '#7c3aed',
  success: '#4caf50',
  warning: '#f59e0b',
  error: '#ff6b6b',
  background: '#f8f9fa',
  card: '#fff',
  border: '#e0e0e0',
  text: '#1a1a1a',
  textSecondary: '#666',
  textMuted: '#999',
};

export const STRINGS = {
  subtotal: 'Subtotal:',
  tax: 'Tax (5%):',
  discount: 'Discount:',
  totalAmount: 'Total Amount:',
  cashGiven: 'Cash Given',
  enterAmount: 'Enter amount',
  paymentComplete: 'Payment Complete',
  cancel: 'Cancel',
  selfService: 'Self Service',
  orderNumberPrefix: 'Order ',
  tablePrefix: '#',
};