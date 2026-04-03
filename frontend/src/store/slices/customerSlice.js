import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getCustomers, checkPoints, syncPOSCustomers, getCustomerById } from '../../services/api';

export const fetchCustomers = createAsyncThunk(
  'customers/fetchCustomers',
  async (params, { rejectWithValue }) => {
    try {
      const response = await getCustomers(params);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Failed to fetch customers');
    }
  }
);

export const phoneLookup = createAsyncThunk(
  'customers/phoneLookup',
  async (phone, { rejectWithValue }) => {
    try {
      const response = await checkPoints(phone);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Customer not found');
    }
  }
);

export const syncCustomers = createAsyncThunk(
  'customers/syncCustomers',
  async (_, { rejectWithValue }) => {
    try {
      const response = await syncPOSCustomers();
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || 'Failed to sync customers');
    }
  }
);

const initialState = {
  items: [],
  total: 0,
  page: 1,
  totalPages: 1,
  status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
  error: null,
  selectedCustomer: null,
  syncStatus: 'idle',
  syncStats: null,
};

const customerSlice = createSlice({
  name: 'customers',
  initialState,
  reducers: {
    setSelectedCustomer: (state, action) => {
      state.selectedCustomer = action.payload;
    },
    clearSyncStats: (state) => {
      state.syncStats = null;
    },
    setPage: (state, action) => {
      state.page = action.payload;
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch Customers
      .addCase(fetchCustomers.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(fetchCustomers.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.customers || [];
        state.total = action.payload.total || 0;
        state.totalPages = action.payload.totalPages || 1;
        state.page = action.payload.page || 1;
      })
      .addCase(fetchCustomers.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
      })
      // Phone Lookup
      .addCase(phoneLookup.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(phoneLookup.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.selectedCustomer = action.payload;
      })
      .addCase(phoneLookup.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
      })
      // Sync Customers
      .addCase(syncCustomers.pending, (state) => {
        state.syncStatus = 'loading';
      })
      .addCase(syncCustomers.fulfilled, (state, action) => {
        state.syncStatus = 'succeeded';
        state.syncStats = action.payload;
      })
      .addCase(syncCustomers.rejected, (state, action) => {
        state.syncStatus = 'failed';
        state.error = action.payload;
      });
  },
});

export const { setSelectedCustomer, clearSyncStats, setPage } = customerSlice.actions;
export default customerSlice.reducer;
