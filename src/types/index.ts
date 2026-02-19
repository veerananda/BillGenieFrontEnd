export interface MenuItem {
    id: string;
    name: string;
    price: number;
    category: string;
    description?: string;
    isVegetarian: boolean;
    isEnabled: boolean;
    dateAdded: number;
    imageUrl?: string;
}

export interface User {
    id: string;
    email: string;
    restaurantId: string;
    role: 'admin' | 'staff' | 'kitchen';
    name: string;
}

export interface Restaurant {
    id: string;
    name: string;
    address: string;
    phone: string;
    ownerId: string;
    settings: RestaurantSettings;
}

export interface RestaurantSettings {
    currency: string;
    tax: number;
    serviceCharge: number;
    isTableManagementEnabled: boolean;
    isInventoryEnabled: boolean;
}

export interface Order {
    id: string;
    restaurantId: string;
    tableNumber?: string;
    items: OrderItem[];
    status: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
    total: number;
    tax: number;
    serviceCharge: number;
    createdAt: number;
    updatedAt: number;
}

export interface OrderItem {
    menuItemId: string;
    name: string;
    quantity: number;
    price: number;
    notes?: string;
}