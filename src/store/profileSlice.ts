import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface RestaurantProfile {
  id: string;
  name: string;
  is_self_service: boolean;
  [key: string]: any;
}

interface ProfileState {
  profile: RestaurantProfile | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProfileState = {
  profile: null,
  loading: false,
  error: null,
};

const profileSlice = createSlice({
  name: 'profile',
  initialState,
  reducers: {
    // Set profile
    setProfile: (state, action: PayloadAction<RestaurantProfile>) => {
      state.profile = action.payload;
      state.error = null;
    },
    
    // Set loading state
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    
    // Set error
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    // Clear profile
    clearProfile: (state) => {
      state.profile = null;
      state.error = null;
    },
  },
});

export const {
  setProfile,
  setLoading,
  setError,
  clearProfile,
} = profileSlice.actions;

// Selectors
export const selectProfile = (state: { profile: ProfileState }) => state.profile.profile;
export const selectProfileLoading = (state: { profile: ProfileState }) => state.profile.loading;
export const selectProfileError = (state: { profile: ProfileState }) => state.profile.error;
export const selectIsSelfService = (state: { profile: ProfileState }) => state.profile.profile?.is_self_service ?? false;
export const selectIsDineIn = (state: { profile: ProfileState }) => !(state.profile.profile?.is_self_service ?? true);

export default profileSlice.reducer;
