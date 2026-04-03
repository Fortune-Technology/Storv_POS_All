/**
 * API routes for file upload, preview, transform, and history
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/postgres.js';
import { parseFile, streamProcessFile, getFileType } from '../utils/fileProcessor.js';
import { transformRow, getOutputColumns, getAvailableVendors, getDefaultVendor } from '../utils/transformer.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/download/:transformId
 * Download transformed file (Public Route)
 */
router.get('/download/:transformId', async (req, res, next) => {
    try {
        const { transformId } = req.params;
        const transformRecord = await prisma.transform.findUnique({ where: { transformId } });

        if (!transformRecord) {
            return res.status(404).json({ error: 'Transform not found' });
        }

        if (transformRecord.status !== 'completed') {
            return res.status(400).json({ error: 'Transform not completed yet', status: transformRecord.status });
        }

        if (!fs.existsSync(transformRecord.outputPath)) {
            return res.status(404).json({ error: 'Output file not found' });
        }

        const outputBasename = path.basename(transformRecord.outputPath);
        const timestampMatch = outputBasename.match(/export_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        const timestamp = timestampMatch
            ? timestampMatch[1]
            : new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        res.download(transformRecord.outputPath, `export_${timestamp}.csv`);
    } catch (error) {
        next(error);
    }
});

// All other routes are protected
router.use(protect);
router.use(authorize('admin', 'store'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${uuidv4()}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600') },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.csv', '.xlsx', '.xls'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files are allowed'));
        }
    }
});

/**
 * GET /api/vendors
 */
router.get('/vendors', async (req, res, next) => {
    try {
        res.json({ vendors: getAvailableVendors(), defaultVendor: getDefaultVendor() });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/upload-file
 */
router.post('/upload-file', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const uploadId = uuidv4();
        const fileType  = getFileType(req.file.originalname);
        const vendorId  = req.body.vendorId || getDefaultVendor();
        const preview   = await parseFile(req.file.path, 50);
        const columns   = preview.length > 0 ? Object.keys(preview[0]) : [];

        await prisma.upload.create({
            data: {
                uploadId,
                filename:     req.file.originalname,
                originalPath: req.file.path,
                fileType,
                fileSize:     req.file.size,
                rowCount:     preview.length,
                columns,
                preview,
                vendorId,
                status:       'previewed',
            },
        });

        res.json({ uploadId, filename: req.file.originalname, fileType, fileSize: req.file.size, preview, columns, vendorId, message: 'File uploaded successfully' });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/preview/:uploadId
 */
router.get('/preview/:uploadId', async (req, res, next) => {
    try {
        const uploadRecord = await prisma.upload.findUnique({ where: { uploadId: req.params.uploadId } });
        if (!uploadRecord) return res.status(404).json({ error: 'Upload not found' });

        const vendorId = uploadRecord.vendorId || getDefaultVendor();
        res.json({
            uploadId:      uploadRecord.uploadId,
            filename:      uploadRecord.filename,
            fileType:      uploadRecord.fileType,
            fileSize:      uploadRecord.fileSize,
            columns:       uploadRecord.columns,
            preview:       uploadRecord.preview,
            vendorId,
            outputColumns: getOutputColumns(vendorId),
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/transform
 */
router.post('/transform', async (req, res, next) => {
    try {
        const { uploadId, outputFormat = 'csv' } = req.body;
        if (!uploadId) return res.status(400).json({ error: 'uploadId is required' });

        const uploadRecord = await prisma.upload.findUnique({ where: { uploadId } });
        if (!uploadRecord) return res.status(404).json({ error: 'Upload not found' });

        const vendorId = uploadRecord.vendorId || getDefaultVendor();

        // Load deposit mapping
        let depositMapping = {};
        try {
            const depositMappingPath = path.join(process.cwd(), 'sample-data', 'deposit-mapping.csv');
            if (fs.existsSync(depositMappingPath)) {
                const rows = await parseFile(depositMappingPath);
                rows.forEach(row => {
                    const id = row.Id || row.ID || row.id;
                    const amount = row.Amount || row.amount || row.AMOUNT;
                    if (amount && id) {
                        depositMapping[parseFloat(amount).toString()] = id;
                        depositMapping[amount.toString().trim()] = id;
                    }
                });
            }
        } catch (_) {}

        const transformId = uuidv4();
        const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outputDir   = process.env.UPLOAD_DIR || './uploads';
        const outputPath  = path.join(outputDir, `export_${timestamp}_${transformId}.csv`);

        await prisma.transform.create({
            data: { transformId, uploadId, outputPath, outputFormat: 'csv', vendorId, status: 'processing' },
        });

        setImmediate(async () => {
            try {
                const result = await streamProcessFile(
                    uploadRecord.originalPath,
                    outputPath,
                    (row) => transformRow(row, depositMapping, { vendorId })
                );
                await prisma.transform.update({
                    where: { transformId },
                    data: {
                        status:       'completed',
                        rowsProcessed: result.processed,
                        warnings:      result.warnings,
                        completedAt:   new Date(),
                    },
                });
            } catch (error) {
                await prisma.transform.update({
                    where: { transformId },
                    data: { status: 'failed', error: error.message },
                });
            }
        });

        res.json({ transformId, vendorId, message: 'Transformation started', status: 'processing' });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/transform-status/:transformId
 */
router.get('/transform-status/:transformId', async (req, res, next) => {
    try {
        const transformRecord = await prisma.transform.findUnique({ where: { transformId: req.params.transformId } });
        if (!transformRecord) return res.status(404).json({ error: 'Transform not found' });

        res.json({
            transformId:   transformRecord.transformId,
            status:        transformRecord.status,
            rowsProcessed: transformRecord.rowsProcessed,
            warnings:      transformRecord.warnings,
            error:         transformRecord.error,
            createdAt:     transformRecord.createdAt,
            completedAt:   transformRecord.completedAt,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/upload-deposit-map
 */
router.post('/upload-deposit-map', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const depositMapId = uuidv4();
        const rows = await parseFile(req.file.path);
        const mappings = {};

        rows.forEach(row => {
            const id     = row.Id  || row.ID  || row.id;
            const amount = row.Amount || row.amount || row.AMOUNT;
            const upc    = row.UPC  || row.upc;
            const item   = row.Item || row.item  || row.ITEM;
            const depositId = row.DepositID || row.depositId || row.DEPOSITID || row.DepositPrice;

            if (amount && id) {
                mappings[parseFloat(amount).toString()] = id;
                mappings[amount.toString().trim()]      = id;
            }
            if (upc     && depositId) mappings[upc]  = depositId;
            if (item    && depositId) mappings[item] = depositId;
        });

        await prisma.depositMap.create({
            data: {
                depositMapId,
                filename:      req.file.originalname,
                filePath:      req.file.path,
                mappings,
                totalMappings: Object.keys(mappings).length,
            },
        });

        res.json({ depositMapId, filename: req.file.originalname, totalMappings: Object.keys(mappings).length, message: 'Deposit mapping uploaded successfully' });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/deposit-maps
 */
router.get('/deposit-maps', async (req, res, next) => {
    try {
        const depositMaps = await prisma.depositMap.findMany({
            select: { depositMapId: true, filename: true, totalMappings: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
        res.json(depositMaps);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/history
 */
router.get('/history', async (req, res, next) => {
    try {
        const transforms = await prisma.transform.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        const history = await Promise.all(transforms.map(async (t) => {
            const upload = await prisma.upload.findUnique({ where: { uploadId: t.uploadId } });
            return {
                transformId:   t.transformId,
                uploadId:      t.uploadId,
                filename:      upload?.filename ?? 'Unknown',
                status:        t.status,
                rowsProcessed: t.rowsProcessed,
                warningCount:  Array.isArray(t.warnings) ? t.warnings.length : 0,
                createdAt:     t.createdAt,
                completedAt:   t.completedAt,
            };
        }));

        res.json(history);
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/transform/:transformId
 */
router.delete('/transform/:transformId', async (req, res, next) => {
    try {
        const transformRecord = await prisma.transform.findUnique({ where: { transformId: req.params.transformId } });
        if (!transformRecord) return res.status(404).json({ error: 'Transform not found' });

        if (transformRecord.outputPath && fs.existsSync(transformRecord.outputPath)) {
            try { fs.unlinkSync(transformRecord.outputPath); } catch (_) {}
        }

        await prisma.transform.delete({ where: { transformId: req.params.transformId } });
        res.json({ message: 'Transform deleted successfully' });
    } catch (error) {
        next(error);
    }
});

export default router;
