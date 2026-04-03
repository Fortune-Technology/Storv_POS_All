# Pine State Spirits – Monthly Specials

## Vendor Information

- **Vendor ID**: `PINE_STATE_SPIRITS`
- **Vendor Name**: Pine State Spirits – Monthly Specials
- **Description**: Transformation rules for Pine State Spirits monthly specials data
- **Supported Formats**: CSV, XLSX, XLS

## Transformation Rules

### Columns Kept (No Change)

- **Item #** - Product item number
- **Description** - Product description
- **Size** - Product size
- **Unit** - Unit of measurement

### Columns Transformed

#### UPC
- **Rule**: Ensure it is 13 digits
- **Logic**:
  - If less than 13 digits, pad with leading zeros
  - If already 13 digits, leave unchanged
  - If more than 13 digits, leave unchanged
- **Examples**:
  - `12345` → `0000000012345`
  - `1234567890123` → `1234567890123` (unchanged)
  - `123456789012` → `0123456789012`

#### Effective Start / Effective End
- **Rule**: Convert to proper date format (MM/DD/YYYY)
- **Supported Input Formats**:
  - `YYYYMMDD` (e.g., `20231225`)
  - `YYYY-MM-DD` (e.g., `2023-12-25`)
  - `MM/DD/YYYY` (e.g., `12/25/2023`)
  - `DD-MM-YYYY` (e.g., `25-12-2023`)
- **Output Format**: `MM/DD/YYYY`
- **Examples**:
  - `20231225` → `12/25/2023`
  - `2023-12-25` → `12/25/2023`
  - `12/25/2023` → `12/25/2023` (unchanged)

#### Retail
- **Rule**: Convert to numeric format with 2 decimal places
- **Logic**:
  - Remove currency symbols ($, etc.)
  - Parse as numeric value
  - Format with exactly 2 decimal places
- **Examples**:
  - `$19.99` → `19.99`
  - `25` → `25.00`
  - `12.5` → `12.50`

#### Special Pricing Method
- **Rule**: Add new column with value always set to "0"
- **Value**: `0` (for all rows)

#### Sale Price
- **Rule**: Convert to numeric format with 2 decimal places
- **Logic**: Same as Retail field
- **Examples**:
  - `$15.99` → `15.99`
  - `20` → `20.00`

#### Agency Cost
- **Rule**: Convert to numeric format with 2 decimal places
- **Logic**: Same as Retail field
- **Examples**:
  - `$12.50` → `12.50`
  - `10` → `10.00`

#### Agency Sale Cost
- **Rule**: Convert to numeric format with 2 decimal places
- **Logic**: Same as Retail field
- **Examples**:
  - `$10.99` → `10.99`
  - `8.5` → `8.50`

### Columns Removed

- **Proof** - Alcohol proof value (not needed in output)
- **Retail Savings** - Calculated savings field (not needed in output)
- **Agency Savings** - Calculated savings field (not needed in output)

## Output Column Order

The transformed CSV will have columns in this exact order:

1. Item #
2. Description
3. Size
4. Unit
5. UPC
6. Effective Start
7. Effective End
8. Retail
9. Special Pricing Method
10. Sale Price
11. Agency Cost
12. Agency Sale Cost

## Example Transformation

### Input CSV
```csv
Item #,Description,Size,Unit,UPC,Proof,Effective Start,Effective End,Retail,Sale Price,Retail Savings,Agency Cost,Agency Sale Cost,Agency Savings
12345,Premium Vodka,750,ML,12345,80,20231201,20231231,$29.99,$24.99,$5.00,$18.50,$15.00,$3.50
67890,Craft Whiskey,1,L,1234567890123,90,2023-12-01,2023-12-31,45,39.99,5.01,28.00,24.50,3.50
```

### Output CSV
```csv
Item #,Description,Size,Unit,UPC,Effective Start,Effective End,Retail,Special Pricing Method,Sale Price,Agency Cost,Agency Sale Cost
12345,Premium Vodka,750,ML,0000000012345,12/01/2023,12/31/2023,29.99,0,24.99,18.50,15.00
67890,Craft Whiskey,1,L,1234567890123,12/01/2023,12/31/2023,45.00,0,39.99,28.00,24.50
```

## Warnings

The transformation process may generate warnings for:

- **Missing UPC**: If a row has no UPC value
- **Invalid Dates**: If a date cannot be parsed in any supported format
- **Invalid Prices**: If a price field cannot be parsed as a numeric value

Warnings are logged but do not stop the transformation process. Rows with warnings will still be included in the output with empty values for invalid fields.

## Usage

1. Select "Pine State Spirits – Monthly Specials" from the vendor dropdown in the UI
2. Upload your CSV/Excel file
3. Preview the transformation
4. Download the transformed file

## Technical Details

- **File Location**: `backend/src/utils/transformers/pine-state-spirits.js`
- **Config Export**: `pineStateSpiritConfig`
- **Transform Function**: `transformRow(row, depositMapping, options)`
- **Output Columns Function**: `getOutputColumns()`

## Notes

- All price fields are formatted to exactly 2 decimal places
- UPC padding ensures consistent 13-digit format for barcode systems
- Date format MM/DD/YYYY is used for compatibility with most systems
- Special Pricing Method is always "0" as per vendor requirements
