/**
 * File processing utilities for CSV and Excel files
 * Supports streaming for large files
 */

import fs from 'fs';
import csvParser from 'csv-parser';
import { parse } from 'fast-csv';
import XLSX from 'xlsx';
import { Readable } from 'stream';

/**
 * Escape a value for proper CSV formatting
 * Handles special characters, quotes, commas, line breaks, and date formats
 * @param {*} value - Value to escape
 * @returns {string} - Properly escaped CSV value
 */
function escapeCSVValue(value) {
    // Handle null/undefined
    if (value === null || value === undefined) {
        return '';
    }

    // Convert to string
    let str = String(value);

    // Trim whitespace
    str = str.trim();

    // Check if value needs quoting (contains comma, quote, newline, or carriage return)
    const needsQuoting = str.includes(',') ||
        str.includes('"') ||
        str.includes('\n') ||
        str.includes('\r') ||
        str.includes('\t');

    if (needsQuoting) {
        // Escape existing quotes by doubling them
        str = str.replace(/"/g, '""');
        // Wrap in quotes
        return `"${str}"`;
    }

    return str;
}

/**
 * Parse Excel file and return rows
 * @param {string} filePath - Path to Excel file
 * @param {number} limit - Max rows to read (0 = all)
 * @returns {Promise<Object[]>} - Array of row objects
 */
export async function parseExcelFile(filePath, limit = 0) {
    return new Promise((resolve, reject) => {
        try {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Convert to JSON
            let rows = XLSX.utils.sheet_to_json(worksheet, {
                defval: '',
                raw: false // Keep as strings to preserve formatting
            });

            if (limit > 0) {
                rows = rows.slice(0, limit);
            }

            resolve(rows);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Parse CSV file and return rows
 * @param {string} filePath - Path to CSV file
 * @param {number} limit - Max rows to read (0 = all)
 * @returns {Promise<Object[]>} - Array of row objects
 */
export async function parseCSVFile(filePath, limit = 0) {
    return new Promise((resolve, reject) => {
        const rows = [];
        let count = 0;

        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => {
                if (limit === 0 || count < limit) {
                    rows.push(row);
                    count++;
                }
            })
            .on('end', () => {
                resolve(rows);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

/**
 * Stream process CSV file with transformation
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path
 * @param {Function} transformFn - Transform function (row) => {transformedRow, warnings}
 * @param {Function} progressCallback - Progress callback (processed, total)
 * @returns {Promise<{processed: number, warnings: string[]}>}
 */
export async function streamProcessCSV(inputPath, outputPath, transformFn, progressCallback = null) {
    return new Promise((resolve, reject) => {
        const warnings = [];
        let processed = 0;
        let isFirstRow = true;
        let headers = [];

        // Use UTF-8 encoding with BOM for Excel compatibility
        const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
        writeStream.write('\ufeff'); // Write BOM

        const csvStream = parse({ headers: true });

        csvStream
            .on('data', (row) => {
                // Skip empty rows
                const hasContent = Object.values(row).some(v => {
                    const str = String(v || '').trim();
                    return str !== '';
                });

                if (!hasContent) {
                    return;
                }

                const result = transformFn(row);

                // Skip if transformation resulted in empty data
                if (!result.transformedRow || Object.keys(result.transformedRow).length === 0) {
                    return;
                }

                // Write header on first valid row - preserve column ordering
                if (isFirstRow) {
                    headers = Object.keys(result.transformedRow);
                    writeStream.write(headers.map(h => escapeCSVValue(h)).join(',') + '\n');
                    isFirstRow = false;
                }

                // Write data row with consistent column order
                const values = headers.map(header => {
                    const value = result.transformedRow[header];
                    return escapeCSVValue(value);
                });
                writeStream.write(values.join(',') + '\n');

                // Collect warnings
                if (result.warnings && result.warnings.length > 0) {
                    warnings.push(...result.warnings.map(w => `Row ${processed + 1}: ${w}`));
                }

                processed++;

                if (progressCallback) {
                    progressCallback(processed);
                }
            })
            .on('end', () => {
                writeStream.end();
                resolve({ processed, warnings });
            })
            .on('error', (error) => {
                writeStream.end();
                reject(error);
            });

        fs.createReadStream(inputPath).pipe(csvStream);
    });
}

/**
 * Stream process Excel file with transformation
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path
 * @param {Function} transformFn - Transform function
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<{processed: number, warnings: string[]}>}
 */
export async function streamProcessExcel(inputPath, outputPath, transformFn, progressCallback = null) {
    return new Promise((resolve, reject) => {
        try {
            const workbook = XLSX.readFile(inputPath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const rows = XLSX.utils.sheet_to_json(worksheet, {
                defval: '',
                raw: false // Keep as strings to preserve formatting
            });

            // Filter out empty rows (rows where all values are empty)
            const nonEmptyRows = rows.filter(row => {
                return Object.values(row).some(value => {
                    const strValue = String(value || '').trim();
                    return strValue !== '';
                });
            });

            const transformedRows = [];
            const warnings = [];

            nonEmptyRows.forEach((row, index) => {
                const result = transformFn(row);

                // Skip rows where transformation resulted in empty data
                if (result.transformedRow && Object.keys(result.transformedRow).length > 0) {
                    transformedRows.push(result.transformedRow);
                }

                if (result.warnings && result.warnings.length > 0) {
                    warnings.push(...result.warnings.map(w => `Row ${index + 1}: ${w}`));
                }

                if (progressCallback) {
                    progressCallback(index + 1);
                }
            });

            // Always write to CSV format with proper encoding and formatting
            const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

            // Write BOM for proper UTF-8 encoding in Excel
            writeStream.write('\ufeff');

            if (transformedRows.length > 0) {
                // Write header - preserve column ordering from first row
                const headers = Object.keys(transformedRows[0]);
                writeStream.write(headers.map(h => escapeCSVValue(h)).join(',') + '\n');

                // Write rows with proper CSV escaping
                transformedRows.forEach(row => {
                    const values = headers.map(header => {
                        const value = row[header];
                        return escapeCSVValue(value);
                    });
                    writeStream.write(values.join(',') + '\n');
                });
            }

            writeStream.end();

            resolve({ processed: nonEmptyRows.length, warnings });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Get file type from extension
 * @param {string} filename - Filename
 * @returns {string} - 'csv', 'excel', or 'unknown'
 */
export function getFileType(filename) {
    const ext = filename.toLowerCase().split('.').pop();

    if (ext === 'csv') return 'csv';
    if (ext === 'xlsx' || ext === 'xls') return 'excel';

    return 'unknown';
}

/**
 * Parse file (auto-detect type)
 * @param {string} filePath - File path
 * @param {number} limit - Max rows
 * @returns {Promise<Object[]>}
 */
export async function parseFile(filePath, limit = 0) {
    const fileType = getFileType(filePath);

    if (fileType === 'csv') {
        return parseCSVFile(filePath, limit);
    } else if (fileType === 'excel') {
        return parseExcelFile(filePath, limit);
    } else {
        const ext = filePath.toLowerCase().split('.').pop();
        throw new Error(`Unsupported file type: .${ext}. Supported formats are: CSV, XLS, XLSX`);
    }
}

/**
 * Stream process file (auto-detect type)
 * @param {string} inputPath - Input path
 * @param {string} outputPath - Output path
 * @param {Function} transformFn - Transform function
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<{processed: number, warnings: string[]}>}
 */
export async function streamProcessFile(inputPath, outputPath, transformFn, progressCallback = null) {
    const fileType = getFileType(inputPath);

    if (fileType === 'csv') {
        return streamProcessCSV(inputPath, outputPath, transformFn, progressCallback);
    } else if (fileType === 'excel') {
        return streamProcessExcel(inputPath, outputPath, transformFn, progressCallback);
    } else {
        const ext = inputPath.toLowerCase().split('.').pop();
        throw new Error(`Unsupported file type: .${ext}. Supported formats are: CSV, XLS, XLSX`);
    }
}
