import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { MenuItem } from '../types';

interface MenuState {
    items: MenuItem[];
    loading: boolean;
    error: string | null;
}

const initialState: MenuState = {
    items: [],
    loading: false,
    error: null,
};

const menuSlice = createSlice({
    name: 'menu',
    initialState,
    reducers: {
        setMenuItems(state, action: PayloadAction<MenuItem[]>) {
            state.items = action.payload;
        },
        addMenuItem(state, action: PayloadAction<MenuItem>) {
            state.items.push(action.payload);
        },
        updateMenuItem(state, action: PayloadAction<MenuItem>) {
            const index = state.items.findIndex(item => item.id === action.payload.id);
            if (index !== -1) {
                state.items[index] = action.payload;
            }
        },
        deleteMenuItem(state, action: PayloadAction<string>) {
            state.items = state.items.filter(item => item.id !== action.payload);
        },
        setLoading(state, action: PayloadAction<boolean>) {
            state.loading = action.payload;
        },
        setError(state, action: PayloadAction<string | null>) {
            state.error = action.payload;
        },
    },
});

export const {
    setMenuItems,
    addMenuItem,
    updateMenuItem,
    deleteMenuItem,
    setLoading,
    setError,
} = menuSlice.actions;

export default menuSlice.reducer;