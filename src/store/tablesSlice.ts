import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface RestaurantTable {
  id: string;
  name: string;
  capacity: number;
  is_occupied: boolean;
}

interface TablesState {
  tables: RestaurantTable[];
  loading: boolean;
  error: string | null;
}

const initialState: TablesState = {
  tables: [],
  loading: false,
  error: null,
};

const tablesSlice = createSlice({
  name: 'tables',
  initialState,
  reducers: {
    // Set all tables
    setTables: (state, action: PayloadAction<RestaurantTable[]>) => {
      state.tables = action.payload;
      state.error = null;
    },
    
    // Update single table
    updateTable: (state, action: PayloadAction<RestaurantTable>) => {
      const index = state.tables.findIndex(t => t.id === action.payload.id);
      if (index !== -1) {
        state.tables[index] = action.payload;
      }
    },
    
    // Set table occupied status
    setTableOccupied: (state, action: PayloadAction<{ tableId: string; isOccupied: boolean }>) => {
      const table = state.tables.find(t => t.id === action.payload.tableId);
      if (table) {
        table.is_occupied = action.payload.isOccupied;
      }
    },
    
    // Set loading state
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    
    // Set error
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    // Clear all tables
    clearTables: (state) => {
      state.tables = [];
      state.error = null;
    },
  },
});

export const {
  setTables,
  updateTable,
  setTableOccupied,
  setLoading,
  setError,
  clearTables,
} = tablesSlice.actions;

// Selectors
export const selectTables = (state: { tables: TablesState }) => state.tables.tables;
export const selectTablesLoading = (state: { tables: TablesState }) => state.tables.loading;
export const selectTablesError = (state: { tables: TablesState }) => state.tables.error;
export const selectTableById = (state: { tables: TablesState }, tableId: string) =>
  state.tables.tables.find(t => t.id === tableId);

export default tablesSlice.reducer;
