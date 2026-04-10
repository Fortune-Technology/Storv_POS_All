/**
 * Upload Page Component
 * Drag & drop file upload with preview and vendor selection
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { FileSpreadsheet } from 'lucide-react';
import { uploadFile, getVendors } from '../services/api';
import './UploadPage.css';

const UploadPage = () => {
    const navigate = useNavigate();
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [vendors, setVendors] = useState([]);
    const [selectedVendor, setSelectedVendor] = useState('');
    const [loadingVendors, setLoadingVendors] = useState(true);

    useEffect(() => {
        const loadVendors = async () => {
            try {
                const data = await getVendors();
                setVendors(data.vendors || []);
                setSelectedVendor(data.defaultVendor || 'AGNE');
            } catch (err) {
                setError('Failed to load vendor list');
            } finally {
                setLoadingVendors(false);
            }
        };
        loadVendors();
    }, []);

    const onDrop = useCallback(async (acceptedFiles) => {
        if (acceptedFiles.length === 0) return;
        const file = acceptedFiles[0];
        setUploading(true);
        setError(null);
        try {
            const response = await uploadFile(file, selectedVendor);
            navigate(`/preview/${response.uploadId}`);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to upload file');
        } finally {
            setUploading(false);
        }
    }, [navigate, selectedVendor]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
        multiple: false,
        disabled: uploading,
    });

    const currentVendor = vendors.find(v => v.vendorId === selectedVendor);

    return (
        <div className="container section">
        <div className="p-header">
          <div className="p-header-left">
            <div className="p-header-icon"><FileSpreadsheet size={22} /></div>
            <div>
              <h1 className="p-title">CSV/Excel Transformer</h1>
              <p className="p-subtitle">Upload your CSV or Excel file to transform it according to vendor-specific business rules</p>
            </div>
          </div>
        </div>

            {/* Vendor Selection */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Select Vendor</h3>
                </div>
                <div className="card-body">
                    {loadingVendors ? (
                        <div className="text-center">
                            <div className="spinner up-spinner-center"></div>
                            <p className="text-secondary">Loading vendors...</p>
                        </div>
                    ) : (
                        <>
                            <div className="form-group">
                                <label htmlFor="vendor-select" className="up-vendor-label">
                                    Choose transformation vendor:
                                </label>
                                <select
                                    id="vendor-select"
                                    className="form-select"
                                    value={selectedVendor}
                                    onChange={(e) => setSelectedVendor(e.target.value)}
                                    disabled={uploading}
                                >
                                    {vendors.map(vendor => (
                                        <option key={vendor.vendorId} value={vendor.vendorId}>
                                            {vendor.vendorName} - {vendor.description}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {currentVendor && (
                                <div className="mt-md up-vendor-info">
                                    <p>
                                        <strong>Supported formats:</strong> {currentVendor.supportedFormats.join(', ').toUpperCase()}
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* File Upload */}
            <div className="card">
                <div className="card-body p-0">
                    <div
                        {...getRootProps()}
                        className={`dropzone ${isDragActive ? 'dropzone-active' : ''}`}
                    >
                        <input {...getInputProps()} />
                        <div className="dropzone-icon">{uploading ? '⏳' : '📁'}</div>
                        {uploading ? (
                            <>
                                <div className="dropzone-text">Uploading...</div>
                                <div className="spinner up-spinner-center"></div>
                            </>
                        ) : (
                            <>
                                <div className="dropzone-text">
                                    {isDragActive ? 'Drop the file here' : 'Drag & drop a file here, or click to select'}
                                </div>
                                <div className="dropzone-hint">Supports CSV, XLS, and XLSX files (max 100MB)</div>
                            </>
                        )}
                    </div>
                </div>
                {error && (
                    <div className="card-body pt-0">
                        <div className="alert alert-error"><strong>Error:</strong> {error}</div>
                    </div>
                )}
            </div>

            {/* Process Steps */}
            <div className="card mt-xl">
                <div className="card-header">
                    <h3 className="card-title">What happens next?</h3>
                </div>
                <div className="card-body">
                    <div className="grid grid-3">
                        <div className="text-center">
                            <div className="up-step-icon">👁️</div>
                            <h4 className="mb-md">1. Preview</h4>
                            <p className="text-secondary up-step-desc">
                                Review the first 50 rows and see which columns will be transformed
                            </p>
                        </div>
                        <div className="text-center">
                            <div className="up-step-icon">⚙️</div>
                            <h4 className="mb-md">2. Transform</h4>
                            <p className="text-secondary up-step-desc">
                                Apply vendor-specific business rules and transformations to your data
                            </p>
                        </div>
                        <div className="text-center">
                            <div className="up-step-icon">⬇️</div>
                            <h4 className="mb-md">3. Download</h4>
                            <p className="text-secondary up-step-desc">
                                Download the transformed CSV file ready for import
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Transformation Rules */}
            {currentVendor && currentVendor.transformationRules && (
                <div className="card mt-xl">
                    <div className="card-header">
                        <h3 className="card-title">Transformation Rules - {currentVendor.vendorName}</h3>
                    </div>
                    <div className="card-body">
                        <div className="grid grid-2">
                            <div>
                                <h5 className="mb-md">Columns Removed</h5>
                                <ul className="up-rules-list">
                                    {currentVendor.transformationRules.columnsRemoved?.map((col, idx) => (
                                        <li key={idx} className="mb-sm">{col}</li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <h5 className="mb-md">Transformations Applied</h5>
                                <ul className="up-rules-list">
                                    {currentVendor.transformationRules.transformations?.map((rule, idx) => (
                                        <li key={idx} className="mb-sm">{rule}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UploadPage;
