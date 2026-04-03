# Vendor Transformers

This directory contains vendor-specific transformation logic for the CSV/Excel transformation system. Each vendor has its own transformation rules, column mappings, and output formats.

## Available Vendors

### 1. AGNE (Default)
- **File**: `agne.js`
- **Config**: `agneConfig`
- **Documentation**: [AGNE_README.md](AGNE_README.md)
- **Description**: Standard AGNE CSV transformation with special pricing logic
- **Use Case**: Default vendor for most transformations

### 2. Pine State Spirits – Monthly Specials
- **File**: `pine-state-spirits.js`
- **Config**: `pineStateSpiritConfig`
- **Documentation**: [PINE_STATE_SPIRITS_README.md](PINE_STATE_SPIRITS_README.md)
- **Description**: Pine State Spirits monthly specials transformation
- **Use Case**: Monthly specials data from Pine State Spirits

## Vendor Registry

All vendors are registered in `vendorRegistry.js`. This file:

- Imports all vendor transformer modules
- Maintains a registry of available vendors
- Provides utility functions to get vendor information
- Supports dynamic vendor selection

### Registry Functions

- `getAvailableVendors()` - Returns list of all available vendors with metadata
- `getVendorTransformer(vendorId)` - Gets transformer module for specific vendor
- `isVendorSupported(vendorId)` - Checks if vendor is supported
- `getDefaultVendor()` - Returns default vendor ID

## Creating a New Vendor

### Step 1: Create Transformer File

Create a new file `your-vendor.js` in this directory:

```javascript
import { getColumnValue, parseNumeric, normalizeDate } from './helpers.js';

/**
 * Your Vendor Configuration
 */
export const yourVendorConfig = {
    vendorId: 'YOUR_VENDOR',
    vendorName: 'Your Vendor Name',
    description: 'Description of transformation',
    supportedFormats: ['csv', 'xlsx', 'xls'],
    
    transformationRules: {
        columnsRemoved: ['Column1', 'Column2'],
        columnsKept: ['Column3', 'Column4'],
        transformations: [
            'Rule 1: Description',
            'Rule 2: Description'
        ]
    }
};

/**
 * Transform row according to your vendor rules
 */
export function transformRow(row, depositMapping = {}, options = {}) {
    const warnings = [];
    const transformedRow = {};
    
    const getValue = (name) => getColumnValue(row, name);
    
    // Your transformation logic here
    transformedRow.Column1 = getValue('Column1') || '';
    
    return { transformedRow, warnings };
}

/**
 * Get output column order
 */
export function getOutputColumns() {
    return ['Column1', 'Column2', 'Column3'];
}
```

### Step 2: Register Vendor

Add your vendor to `vendorRegistry.js`:

```javascript
import * as yourVendorTransformer from './your-vendor.js';

const vendorRegistry = {
    AGNE: agneTransformer,
    PINE_STATE_SPIRITS: pineStateSpiritTransformer,
    YOUR_VENDOR: yourVendorTransformer,  // Add this line
};
```

### Step 3: Create Documentation

Create `YOUR_VENDOR_README.md` with:

- Vendor information
- Transformation rules
- Column mappings
- Examples
- Usage instructions

### Step 4: Create Sample Data

Create sample input and expected output files in `../../sample-data/`:

- `your-vendor-sample.csv` - Sample input data
- `your-vendor-expected-output.csv` - Expected transformation output

### Step 5: Test

1. Restart the backend server
2. The new vendor will appear in the frontend dropdown
3. Upload a sample file and test the transformation
4. Verify output matches expected results

## Helper Functions

The `helpers.js` file provides common utility functions:

### Column Access
- `getColumnValue(row, columnName)` - Get column value case-insensitively

### UPC Transformation
- `transformUPC(upc)` - Remove one leading zero from UPC

### Tax Transformation
- `transformTAX1(tax1)` - Transform Y/N to 1/empty

### Department Preservation
- `preserveDepartmentID(incoming, original)` - Preserve original department ID

### Numeric Parsing
- `parseNumeric(value)` - Parse numeric value (handles currency symbols)

### Date Normalization
- `normalizeDate(dateStr)` - Normalize date to YYYYMMDD format

## Best Practices

### 1. Configuration
- Always export a config object with vendor metadata
- Include clear transformation rules in the config
- Specify supported file formats

### 2. Transform Function
- Use `getColumnValue()` for case-insensitive column access
- Collect warnings for data quality issues
- Return both `transformedRow` and `warnings`
- Handle missing/invalid data gracefully

### 3. Output Columns
- Define explicit column order in `getOutputColumns()`
- Match the order to business requirements
- Keep column names consistent

### 4. Error Handling
- Generate warnings for data quality issues
- Don't throw errors for individual row problems
- Log warnings with context (item number, UPC, etc.)

### 5. Documentation
- Document all transformation rules
- Provide examples for each transformation
- Include sample input/output files
- Explain business logic and edge cases

### 6. Testing
- Create comprehensive sample data
- Test various input formats
- Verify edge cases (empty values, invalid data)
- Check warning generation

## File Structure

```
transformers/
├── agne.js                              # AGNE vendor transformer
├── pine-state-spirits.js                # Pine State Spirits transformer
├── example-vendor.js                    # Template/example
├── helpers.js                           # Shared utility functions
├── vendorRegistry.js                    # Vendor registry
├── AGNE_README.md                       # AGNE documentation
├── PINE_STATE_SPIRITS_README.md         # Pine State Spirits docs
└── README.md                            # This file
```

## Sample Data Location

Sample files are stored in `../../sample-data/`:

```
sample-data/
├── sample-input.csv                     # AGNE sample input
├── expected-output.csv                  # AGNE expected output
├── deposit-mapping.csv                  # Deposit mapping file
├── pine-state-spirits-sample.csv        # Pine State sample input
└── pine-state-spirits-expected-output.csv  # Pine State expected output
```

## API Integration

The vendor system integrates with the API through:

1. **Upload**: User selects vendor when uploading file
2. **Preview**: System shows vendor-specific column mappings
3. **Transform**: Correct vendor transformer is applied
4. **Download**: Output follows vendor-specific format

## Frontend Integration

The frontend:

1. Fetches available vendors from `/api/vendors`
2. Displays vendor dropdown on upload page
3. Shows vendor name and description
4. Passes vendor ID to transformation endpoint

## Troubleshooting

### Vendor Not Appearing in Frontend
- Check vendor is registered in `vendorRegistry.js`
- Verify config object is exported correctly
- Restart backend server
- Check browser console for errors

### Transformation Errors
- Verify `transformRow()` function signature
- Check column name case sensitivity
- Ensure `getOutputColumns()` returns array
- Review warnings for data quality issues

### Column Mapping Issues
- Use `getColumnValue()` for case-insensitive access
- Check for typos in column names
- Verify input file has expected columns
- Review transformation logic

## Support

For questions or issues:

1. Check vendor-specific README
2. Review example-vendor.js template
3. Check helpers.js for available utilities
4. Review existing vendor implementations
5. Check API documentation in backend README

## Version History

- **v1.0** - Initial vendor system with AGNE
- **v1.1** - Added Pine State Spirits vendor
- **v1.2** - Improved vendor registry with dynamic config detection
