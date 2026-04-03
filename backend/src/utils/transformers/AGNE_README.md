# AGNE Vendor

## Vendor Information

- **Vendor ID**: `AGNE`
- **Vendor Name**: AGNE
- **Description**: Standard AGNE CSV transformation with special pricing logic
- **Supported Formats**: CSV, XLSX, XLS

## Transformation Rules

### Columns Removed

- Status
- CaseUPC
- MANUFACTURER
- REG_MULTIPLE
- CASE_RETAIL
- TAX2
- TAX3
- CASE_DEPOSIT
- PRC_GRP
- FUTURE_RETAIL
- FUTURE_COST
- FUTURE_ACTIVE_DATE
- FUTURE_MULTIPLE
- BRAND
- PBHN
- CLASS
- SALE_MULTIPLE (used in logic, then removed)
- TPR_MULTIPLE (used in logic, then removed)

### Columns Kept (No Change)

- Item
- Description
- Department
- REG_RETAIL
- PACK
- REGULARCOST
- FOOD_STAMP
- WIC
- SALE_COST
- TPR_COST
- ITEM_SIZE
- ITEM_UOM

### Columns Transformed

#### UPC
- **Rule**: Remove exactly one leading zero if present
- **Examples**:
  - `012345` → `12345`
  - `12345` → `12345` (no change)
  - `001234` → `01234`

#### Department (D)
- **Rule**: Preserve original Department ID if incoming value differs
- **Logic**:
  - If original data available and values differ: use original with warning
  - If no original data or values match: use incoming value

#### TAX1
- **Rule**: Transform Y/N values to 1/empty
- **Logic**:
  - `Y` or `y` → `1`
  - `N` or `n` → `` (empty)
  - Other values: preserved with warning
- **Examples**:
  - `Y` → `1`
  - `N` → `` (empty)
  - `X` → `X` (with warning)

#### BOTTLE_DEPOSIT
- **Rule**: Mapped from deposit mapping file (UPC/Item → DepositID)
- **Priority**:
  1. If row has BOTTLE_DEPOSIT value (amount), map to ID from deposit mapping
  2. If no amount mapping found, try mapping by UPC or Item number
  3. If no mapping found, keep original value
- **Examples**:
  - `0.3` → `26` (if mapping exists)
  - UPC `12345` → `26` (if mapping exists)
- **Warning**: Generated if UPC/Item has no mapping and no existing deposit value

#### Dates (SALE_START_DATE, SALE_END_DATE, TPR_START_DATE, TPR_END_DATE)
- **Rule**: Normalized to `YYYYMMDD` format
- **Supported Input Formats**:
  - `YYYYMMDD` (e.g., `20231225`)
  - `YYYY-MM-DD` (e.g., `2023-12-25`)
  - `MM/DD/YYYY` (e.g., `12/25/2023`)
  - `DD-MM-YYYY` (e.g., `25-12-2023`)
- **Output Format**: `YYYYMMDD`
- **Examples**:
  - `20231225` → `20231225` (unchanged)
  - `2023-12-25` → `20231225`
  - `12/25/2023` → `20231225`
- **Invalid dates**: empty with warning

### Special Pricing Logic

#### SALE_MULTIPLE
- **If no Sale data** (no SALE_RETAIL, SALE_COST, or dates):
  - `SPECIAL PRICING #1` = `` (null/empty)
  - `SPECIAL QUANTITY 1` = `` (empty)
  - `SALE_RETAIL` = `` (empty)
  - `group_price` = `` (empty)

- **If Sale data exists and `SALE_MULTIPLE <= 1`**:
  - Keep `SALE_RETAIL` unchanged
  - Add `SPECIAL PRICING #1 = "0"`
  - `SPECIAL QUANTITY 1` = `` (empty)
  - `group_price` = `` (empty)

- **If Sale data exists and `SALE_MULTIPLE > 1`**:
  - Set `group_price = original SALE_RETAIL`
  - Set `SALE_RETAIL = REG_RETAIL`
  - Add `SPECIAL PRICING #1 = "2"`
  - Add `SPECIAL QUANTITY 1 = SALE_MULTIPLE value`

#### TPR_MULTIPLE
- **If no TPR data** (no TPR_RETAIL, TPR_COST, or dates):
  - `SPECIAL PRICING #2` = `` (null/empty)
  - `SPECIAL QUANTITY 2` = `` (empty)
  - `TPR_RETAIL` = `` (empty)
  - `group_price_2` = `` (empty)

- **If TPR data exists and `TPR_MULTIPLE <= 1`**:
  - Keep `TPR_RETAIL` unchanged
  - Add `SPECIAL PRICING #2 = "0"`
  - `SPECIAL QUANTITY 2` = `` (empty)
  - `group_price_2` = `` (empty)

- **If TPR data exists and `TPR_MULTIPLE > 1`**:
  - Set `group_price_2 = original TPR_RETAIL`
  - Set `TPR_RETAIL = REG_RETAIL`
  - Add `SPECIAL PRICING #2 = "2"`
  - Add `SPECIAL QUANTITY 2 = TPR_MULTIPLE value`

## Output Column Order

The transformed CSV will have columns in this exact order:

1. Item
2. UPC
3. Description
4. Department
5. REG_RETAIL
6. PACK
7. REGULARCOST
8. TAX1
9. FOOD_STAMP
10. WIC
11. BOTTLE_DEPOSIT
12. SPECIAL PRICING #1
13. SALE_RETAIL
14. SPECIAL QUANTITY 1
15. group_price
16. SALE_START_DATE
17. SALE_END_DATE
18. SALE_COST
19. SPECIAL PRICING #2
20. TPR_RETAIL
21. SPECIAL QUANTITY 2
22. group_price_2
23. TPR_START_DATE
24. TPR_END_DATE
25. TPR_COST
26. ITEM_SIZE
27. ITEM_UOM

## Example Transformation

### Input CSV (simplified)
```csv
Item,UPC,Description,REG_RETAIL,SALE_RETAIL,SALE_MULTIPLE,SALE_START_DATE,SALE_END_DATE,TAX1
12345,012345,Product A,10.00,8.00,1,20231201,20231231,Y
67890,067890,Product B,15.00,10.00,2,20231201,20231231,N
```

### Output CSV (simplified)
```csv
Item,UPC,Description,REG_RETAIL,TAX1,SPECIAL PRICING #1,SALE_RETAIL,SPECIAL QUANTITY 1,group_price,SALE_START_DATE,SALE_END_DATE
12345,12345,Product A,10.00,1,0,8.00,,,20231201,20231231
67890,67890,Product B,15.00,,2,15.00,2,10.00,20231201,20231231
```

## Warnings

The transformation process may generate warnings for:

- **Department ID Changes**: When incoming department differs from original
- **Invalid TAX1 Values**: When TAX1 is not Y or N
- **Missing Deposit Mapping**: When UPC/Item has no deposit mapping
- **Invalid Dates**: When dates cannot be parsed

## Usage

1. Select "AGNE" from the vendor dropdown in the UI (default vendor)
2. Upload your CSV/Excel file
3. Preview the transformation
4. Download the transformed file

## Technical Details

- **File Location**: `backend/src/utils/transformers/agne.js`
- **Config Export**: `agneConfig`
- **Transform Function**: `transformRow(row, depositMapping, options)`
- **Output Columns Function**: `getOutputColumns()`

## Notes

- This is the default vendor for the system
- Special pricing logic handles both single-item and multi-item deals
- Dates are normalized to YYYYMMDD format for database compatibility
- UPC transformation removes exactly one leading zero to match internal systems
