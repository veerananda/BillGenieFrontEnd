// src/utils/orderCalculations.ts
import { TAX_RATE } from '../constants';

export interface OrderItem {
  price: number;
  quantity: number;
}

export interface OrderCalculation {
  subtotal: number;
  taxAmount: number;
  discountValue: number;
  finalAmount: number;
}

export const calculateOrderTotals = (
  items: OrderItem[],
  discountAmount: string | number = 0,
  discountType: 'amount' | 'percentage' = 'amount'
): OrderCalculation => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const discountNum = typeof discountAmount === 'string' ? parseFloat(discountAmount) || 0 : discountAmount;

  let discountValue = 0;
  if (discountType === 'percentage') {
    discountValue = (subtotal * discountNum) / 100;
  } else {
    discountValue = discountNum;
  }

  const taxAmount = subtotal * TAX_RATE;
  const finalAmount = subtotal + taxAmount - discountValue;

  return {
    subtotal,
    taxAmount,
    discountValue,
    finalAmount,
  };
};