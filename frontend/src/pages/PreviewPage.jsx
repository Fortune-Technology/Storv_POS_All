/**
 * Preview Page Component
 * Shows preview of uploaded file and transformation details
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPreview, startTransform, getDepositMaps } from '../services/api';
import './PreviewPage.css';

const PreviewPage = () => {
    const { uploadId } = useParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [preview, setPreview] = useState(null);
    const [depositMaps, setDepositMaps] = useState([]);
    const [selectedDepositMap, setSelectedDepositMap] = useState('');
    const [transforming, setTransforming] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => { loadPreview(); }, [uploadId]);

    const loadPreview = async () => {
        try {
            setLoading(true);
            const data = await getPreview(uploadId);
            setPreview(data);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load preview');
        } finally {
            setLoading(false);
        }
        try {
            const maps = await getDepositMaps();
            setDepositMaps(maps);
        } catch (err) {}
    };

    const handleTransform = async () => {
        try {
            setTransforming(true);
            setError(null);
            const response = await startTransform(uploadId, selectedDepositMap || null, 'csv');
            navigate(`/transform/${response.transformId}`);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to start transformation');
            setTransforming(false);
        }
    };

    if (loading) {
        return (
            <div className="container section flex-center">
                <div className="text-center">
                    <div className="spinner spinner-lg"></div>
                    <p className="mt-lg text-secondary">Loading preview...</p>
                </div>
            </div>
        );
    }

    if (error && !preview) {
        return (
            <div className="container section">
                <div className="alert alert-error"><strong>Error:</strong> {error}</div>
                <button className="btn btn-secondary mt-lg" onClick={() => navigate('/')}>← Back to Upload</button>
            </div>
        );
    }

    const removedColumns = preview.columns.filter(col => !preview.outputColumns.includes(col));

    return (
        <div className="container section">
            <div className="p-header">
                <div>
                    <h2 className="p-title">Preview: {preview.filename}</h2>
                    <p className="text-secondary">
                        {preview.fileType.toUpperCase()} • {(preview.fileSize / 1024).toFixed(1)} KB • {preview.preview.length} rows (preview)
                    </p>
                </div>
                <button className="btn btn-secondary" onClick={() => navigate('/')}>← Upload New File</button>
            </div>

            {error && <div className="alert alert-error mb-lg"><strong>Error:</strong> {error}</div>}

            {/* Column Summary */}
            <div className="grid grid-2 mb-xl">
                <div className="card">
                    <h4>Input Columns ({preview.columns.length})</h4>
                    <div className="mt-md pp-badge-wrap">
                        {preview.columns.map(col => (
                            <span key={col} className={`badge ${removedColumns.includes(col) ? 'badge-error' : 'badge-success'}`}>
                                {col} {removedColumns.includes(col) && '✕'}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="card">
                    <h4>Output Columns ({preview.outputColumns.length})</h4>
                    <div className="mt-md pp-badge-wrap">
                        {preview.outputColumns.map(col => (
                            <span key={col} className="badge badge-primary">{col}</span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Deposit Map Selection */}
            <div className="card mb-xl">
                <h4>Bottle Deposit Mapping (Optional)</h4>
                <p className="text-secondary mb-md">Select a deposit mapping file to populate BOTTLE_DEPOSIT values</p>
                <div className="flex pp-deposit-flex">
                    <select
                        className="form-select pp-deposit-select"
                        value={selectedDepositMap}
                        onChange={(e) => setSelectedDepositMap(e.target.value)}
                    >
                        <option value="">No deposit mapping</option>
                        {depositMaps.map(map => (
                            <option key={map.depositMapId} value={map.depositMapId}>
                                {map.filename} ({map.totalMappings} mappings)
                            </option>
                        ))}
                    </select>
                    <button className="btn btn-secondary" onClick={() => navigate('/deposit-map')}>Upload New Mapping</button>
                </div>
            </div>

            {/* Preview Table */}
            <div className="card mb-xl">
                <div className="card-header">
                    <h4 className="card-title">Data Preview (First {preview.preview.length} Rows)</h4>
                    <p className="card-subtitle">Showing original data before transformation</p>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                {preview.columns.slice(0, 10).map(col => (
                                    <th key={col}>
                                        {col}
                                        {removedColumns.includes(col) && (
                                            <span className="badge badge-error ml-sm pp-badge-ml">Removed</span>
                                        )}
                                    </th>
                                ))}
                                {preview.columns.length > 10 && <th>... +{preview.columns.length - 10} more</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {preview.preview.slice(0, 10).map((row, idx) => (
                                <tr key={idx}>
                                    {preview.columns.slice(0, 10).map(col => (
                                        <td key={col} className={removedColumns.includes(col) ? 'pp-td-removed' : ''}>
                                            {row[col] || '-'}
                                        </td>
                                    ))}
                                    {preview.columns.length > 10 && <td>...</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {preview.preview.length > 10 && (
                    <p className="text-secondary text-center mt-md">... and {preview.preview.length - 10} more rows in preview</p>
                )}
            </div>

            {/* Transform Button */}
            <div className="card card-elevated text-center">
                <h3>Ready to Transform?</h3>
                <p className="text-secondary mb-lg">This will apply all transformation rules to your data</p>
                <button className="btn btn-primary btn-lg" onClick={handleTransform} disabled={transforming}>
                    {transforming ? (<><span className="spinner spinner-sm"></span> Starting Transformation...</>) : (<>⚙️ Start Transformation</>)}
                </button>
            </div>
        </div>
    );
};

export default PreviewPage;
