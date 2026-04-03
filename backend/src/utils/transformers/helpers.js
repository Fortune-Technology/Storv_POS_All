/**
 * Shared helper functions for all vendor transformers
 * These utilities are vendor-agnostic and can be reused
 */

/**
 * Remove exactly one leading zero from UPC if present
 * @param {string} upc - UPC code
 * @returns {string} - Transformed UPC
 */
export function transformUPC(upc) {
    if (!upc) return upc;
    const upcStr = String(upc).trim();
    if (upcStr.startsWith('0')) {
        return upcStr.substring(1);
    }
    return upcStr;
}

/**
 * Transform TAX1 values: Y→1, N→empty, others preserved with warning
 * @param {string} tax1 - TAX1 value
 * @returns {{value: string, warning: string|null}}
 */
export function transformTAX1(tax1) {
    if (!tax1) return { value: '', warning: null };

    const tax1Str = String(tax1).trim().toUpperCase();

    if (tax1Str === 'Y') {
        return { value: '1', warning: null };
    } else if (tax1Str === 'N') {
        return { value: '', warning: null };
    } else {
        return {
            value: tax1,
            warning: `TAX1 has unexpected value: "${tax1}" (expected Y or N)`
        };
    }
}

/**
 * Preserve original Department ID if incoming value differs
 * @param {string} incomingDept - Department from current file
 * @param {string} originalDept - Department from original source
 * @returns {{value: string, warning: string|null}}
 */
export function preserveDepartmentID(incomingDept, originalDept) {
    // If no original data available, use incoming value
    if (!originalDept) {
        return { value: incomingDept || '', warning: null };
    }

    // If values differ, preserve original
    if (incomingDept !== originalDept) {
        return {
            value: originalDept,
            warning: `Department ID changed from "${originalDept}" to "${incomingDept}" - using original value`
        };
    }

    return { value: incomingDept || '', warning: null };
}

/**
 * Parse numeric value from string (handles currency symbols)
 * @param {string|number} value - Value to parse
 * @returns {number|null}
 */
export function parseNumeric(value) {
    if (value === null || value === undefined || value === '') return null;

    // Remove currency symbols and non-numeric except . and -
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);

    return isNaN(parsed) ? null : parsed;
}

/**
 * Normalize date to YYYYMMDD format
 * @param {string} dateStr - Date string
 * @returns {{value: string, warning: string|null}}
 */
export function normalizeDate(dateStr) {
    if (!dateStr) return { value: '', warning: null };

    const str = String(dateStr).trim();

    // Try various formats
    const formats = [
        // YYYYMMDD (compact format)
        { regex: /^(\d{4})(\d{2})(\d{2})$/, type: 'YYYYMMDD' },
        // YYYY-MM-DD
        { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, type: 'YYYY-MM-DD' },
        // MM/DD/YYYY
        { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, type: 'MM/DD/YYYY' },
        // DD-MM-YYYY
        { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, type: 'DD-MM-YYYY' },
        // DD/MM/YY or DD/M/YY (2-digit year)
        { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, type: 'DD/MM/YY' },
        // DD-MM-YY (2-digit year)
        { regex: /^(\d{1,2})-(\d{1,2})-(\d{2})$/, type: 'DD-MM-YY' },
    ];

    for (const format of formats) {
        const match = str.match(format.regex);
        if (match) {
            let year, month, day;

            switch (format.type) {
                case 'YYYYMMDD':
                    [, year, month, day] = match;
                    break;
                case 'YYYY-MM-DD':
                    [, year, month, day] = match;
                    break;
                case 'MM/DD/YYYY':
                    [, month, day, year] = match;
                    break;
                case 'DD-MM-YYYY':
                    [, day, month, year] = match;
                    break;
                case 'DD/MM/YY':
                case 'DD-MM-YY':
                    // DD/MM/YY or DD-MM-YY format
                    [, day, month, year] = match;
                    // Convert 2-digit year to 4-digit
                    // Assume 00-49 = 2000-2049, 50-99 = 1950-1999
                    const yearNum = parseInt(year);
                    year = yearNum < 50 ? `20${year.padStart(2, '0')}` : `19${year.padStart(2, '0')}`;
                    break;
            }

            // Pad month and day
            month = month.padStart(2, '0');
            day = day.padStart(2, '0');

            // Basic validation
            const monthNum = parseInt(month);
            const dayNum = parseInt(day);

            if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
                return {
                    value: '',
                    warning: `Invalid date: "${dateStr}"`
                };
            }

            // Return YYYYMMDD format
            return { value: `${year}${month}${day}`, warning: null };
        }
    }

    return {
        value: '',
        warning: `Could not parse date: "${dateStr}"`
    };
}

/**
 * Get case-insensitive column value from row
 * @param {Object} row - Data row
 * @param {string} columnName - Column name to find
 * @returns {any} - Column value or undefined
 */
export function getColumnValue(row, columnName) {
    // Try exact match first
    if (row.hasOwnProperty(columnName)) {
        return row[columnName];
    }

    // Try case-insensitive match
    const lowerName = columnName.toLowerCase();
    for (const key in row) {
        if (key.toLowerCase() === lowerName) {
            return row[key];
        }
    }

    return undefined;
}
