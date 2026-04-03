import React, { useState, useEffect } from 'react';
import api from '../services/api';

const DocumentUploader = ({ onUploadSuccess }) => {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [modelId, setModelId] = useState('auto');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [warning, setWarning] = useState(null);
    const [success, setSuccess] = useState(null);
    const [result, setResult] = useState(null);
    const [editingFields, setEditingFields] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    const MAX_MB = 50;
    const MAX_SIZE = MAX_MB * 1024 * 1024;

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            const sizeMB = selectedFile.size / 1024 / 1024;

            // Client side file size validation (50MB)
            if (selectedFile.size > MAX_SIZE) {
                setError(`File too large (${sizeMB.toFixed(1)}MB). Max allowed is ${MAX_MB}MB.`);
                setFile(null);
                setPreviewUrl(null);
                setWarning(null);
                return;
            }
            
            // Validate file typing manually if browser "accept" is bypassed
            const allowedTypes = [
                'application/pdf', 
                'image/jpeg', 
                'image/png', 
                'image/tiff', 
                'image/bmp',
                'image/heif'
            ];
            
            if (!allowedTypes.includes(selectedFile.type)) {
                setError('Unsupported file type. Please upload a PDF, JPG, PNG, TIFF, or BMP.');
                setFile(null);
                setPreviewUrl(null);
                setWarning(null);
                return;
            }

            if (sizeMB > 6 && selectedFile.type.startsWith("image/")) {
                setWarning(`Large image (${sizeMB.toFixed(1)}MB) will be auto-compressed before analysis.`);
            } else {
                setWarning(null);
            }

            setFile(selectedFile);
            setError(null);
            setSuccess(null);
            
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            const url = URL.createObjectURL(selectedFile);
            setPreviewUrl(url);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setError('Please select a file first.');
            return;
        }

        setLoading(true);
        setError(null);
        setWarning(null);
        setSuccess(null);
        setResult(null);

        const formData = new FormData();
        formData.append('document', file);
        // Also provide modelId in body as backup
        formData.append('modelId', modelId);

        try {
            // Pass model as query param for robustness
            const response = await api.post(`/document/analyze?model=${modelId}`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            const data = response.data.data;
            setResult(data);
            setEditingFields(data.extractedFields || {});
            setSuccess('Analysis completed successfully!');
            if (onUploadSuccess) onUploadSuccess();
        } catch (err) {
            setError(err.response?.data?.message || err.response?.data?.error || 'Error analyzing document. Please check server logs.');
        } finally {
            setLoading(false);
        }
    };

    const handleFieldChange = (key, value) => {
        setEditingFields(prev => ({
            ...prev,
            [key]: {
                ...prev[key],
                value: value
            }
        }));
    };

    const handleSaveEdits = async () => {
        if (!result?._id) return;
        
        setIsSaving(true);
        setError(null);
        setSuccess(null);
        
        try {
            const response = await api.patch(`/document/${result._id}`, {
                extractedFields: editingFields
            });
            setResult(response.data);
            setSuccess('Changes saved successfully!');
            if (onUploadSuccess) onUploadSuccess();
        } catch (err) {
            setError('Failed to save document changes.');
        } finally {
            setIsSaving(false);
        }
    };

    const renderPreview = () => {
        if (!previewUrl) return null;

        if (file?.type === 'application/pdf') {
            return (
                <div className="ocr-preview-container">
                    <iframe src={previewUrl} className="ocr-preview-pdf" title="PDF Preview" />
                </div>
            );
        }

        return (
            <div className="ocr-preview-container">
                <img src={previewUrl} alt="Document Preview" className="ocr-preview-image" />
            </div>
        );
    };

    return (
        <div className="fade-in">
            <div className="card-header">
                <h3 className="card-title">Analyze Document</h3>
                <p className="card-subtitle">Upload images (PNG/JPG) or PDF for AI extraction.</p>
            </div>

            <div className="grid grid-2 mt-lg">
                <div className="form-group mb-0">
                    <label className="form-label">Analysis Model</label>
                    <select 
                        className="form-select" 
                        value={modelId} 
                        onChange={(e) => setModelId(e.target.value)}
                        disabled={loading}
                    >
                        <option value="auto">Auto Detect (Default)</option>
                        <option value="prebuilt-layout">General Image / Screenshot</option>
                        <option value="prebuilt-document">General Document / PDF</option>
                        <option value="prebuilt-invoice">Invoice Parser</option>
                        <option value="prebuilt-receipt">Receipt Parser</option>
                        <option value="prebuilt-idDocument">Passport / ID Card</option>
                    </select>
                </div>

                <div className="form-group mb-0">
                    <label className="form-label">Select File (Max size: 50MB for images (auto-compressed), 500MB for PDFs)</label>
                    <input 
                        type="file" 
                        className="form-input" 
                        onChange={handleFileChange}
                        accept=".pdf,.jpg,.jpeg,.png,.tiff,.bmp"
                        disabled={loading}
                    />
                </div>
            </div>

            {renderPreview()}

            <div className="mt-lg">
                <button 
                    className="btn btn-primary w-100" 
                    onClick={handleUpload}
                    disabled={!file || loading}
                >
                    {loading ? (
                        <>
                            <span className="spinner spinner-sm" style={{ marginRight: '8px' }}></span>
                            Analyzing with AI...
                        </>
                    ) : (
                        'Run Document Analysis'
                    )}
                </button>
            </div>

            {error && <div className="alert alert-error mt-md">{error}</div>}
            {warning && <div className="alert alert-warning mt-md">{warning}</div>}
            {success && <div className="alert alert-success mt-md">{success}</div>}

            {result && (
                <div className="mt-xl slide-in-top">
                    <div className="flex-between mb-md">
                        <h4 className="mb-0">Extracted Fields</h4>
                        <div className="flex gap-sm">
                             <span className="badge badge-primary">{result.docType}</span>
                             <span className="badge badge-info">Confidence: {(result.confidence * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                    
                    <div className="table-container mb-lg">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="ocr-table-field-key">Field</th>
                                    <th>Value</th>
                                    <th className="ocr-table-field-confidence">Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(editingFields).length > 0 ? (
                                    Object.entries(editingFields).map(([key, field]) => (
                                        <tr key={key}>
                                            <td className="ocr-table-field-key">{key}</td>
                                            <td>
                                                {key === "extractedText" ? (
                                                    <textarea 
                                                        className="ocr-inline-input" 
                                                        style={{ minHeight: '150px', whiteSpace: 'pre-wrap', fontSize: '13px', paddingTop: '8px' }}
                                                        value={field.value || ''}
                                                        onChange={(e) => handleFieldChange(key, e.target.value)}
                                                    />
                                                ) : (
                                                    <input 
                                                        type="text" 
                                                        className="ocr-inline-input" 
                                                        value={typeof field.value === 'object' ? JSON.stringify(field.value) : field.value || ''}
                                                        onChange={(e) => handleFieldChange(key, e.target.value)}
                                                    />
                                                )}
                                            </td>
                                            <td>
                                                <span className={`badge ${
                                                    (field.confidence || 1.0) > 0.8 ? 'badge-success' : 
                                                    (field.confidence || 1.0) > 0.5 ? 'badge-warning' : 'badge-error'
                                                }`}>
                                                    {((field.confidence || 1.0) * 100).toFixed(0)}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="3" className="text-center text-tertiary p-lg">
                                            No fields extracted, but content was processed successfully.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <button 
                        className="btn btn-secondary w-100" 
                        onClick={handleSaveEdits}
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <>
                                <span className="spinner spinner-sm" style={{ marginRight: '8px' }}></span>
                                Saving changes...
                            </>
                        ) : (
                            'Save Data Edits'
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};

export default DocumentUploader;
