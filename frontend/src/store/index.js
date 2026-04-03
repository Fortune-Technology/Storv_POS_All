import { configureStore } from '@reduxjs/toolkit';
import customerReducer from './slices/customerSlice';
import authReducer from './slices/authSlice';

export const store = configureStore({
  reducer: {
    customers: customerReducer,
    auth: authReducer,
  },
});

export default store;
