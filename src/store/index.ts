import { configureStore } from '@reduxjs/toolkit';
import menuReducer from './menuSlice';
import ordersReducer from './ordersSlice';
import tablesReducer from './tablesSlice';
import profileReducer from './profileSlice';

export const store = configureStore({
    reducer: {
        menu: menuReducer,
        orders: ordersReducer,
        tables: tablesReducer,
        profile: profileReducer,
    },
    devTools: __DEV__, // Disable Redux DevTools in production
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;