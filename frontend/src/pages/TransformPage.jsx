/**
 * Transform Status Page
 * Shows transformation progress and allows download
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTransformStatus, getDownloadUrl } from '../services/api';

const TransformPage = () => {
    const { transformId } = useParams();
    const navigate = useNavigate();

    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [polling, setPolling] = useState(true);

    useEffect(() => {
        loadStatus();
    }, [transformId]);

    useEffect(() => {
        if (!polling) return;

        const interval = setInterval(() => {
            loadStatus();
        }, 2000); // Poll every 2 seconds

        return () => clearInterval(interval);
    }, [polling, transformId]);

    const loadStatus = async () => {
        try {
            const data = await getTransformStatus(transformId);
            setStatus(data);
            setLoading(false);

            // Stop polling if completed or failed
            if (data.status === 'completed' || data.status === 'failed') {
                setPolling(false);
            }
        } catch (err) {
            console.error('Status error:', err);
            setError(err.response?.data?.error || 'Failed to load status');
            setLoading(false);
            setPolling(false);
        }
    };

    const handleDownload = () => {
        window.location.href = getDownloadUrl(transformId);
    };

    if (loading) {
        return (
            <div className="container section flex-center">
                <div className="text-center">
                    <div className="spinner spinner-lg"></div>
                    <p className="mt-lg text-secondary">Loading transformation status...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container section">
                <div className="alert alert-error">
                    <strong>Error:</strong> {error}
                </div>
                <button className="btn btn-secondary mt-lg" onClick={() => navigate('/')}>
                    ← Back to Upload
                </button>
            </div>
        );
    }

    const getStatusBadge = () => {
        switch (status.status) {
            case 'processing':
                return <span className="badge badge-info">Processing</span>;
            case 'completed':
                return <span className="badge badge-success">Completed</span>;
            case 'failed':
                return <span className="badge badge-error">Failed</span>;
            default:
                return <span className="badge badge-primary">{status.status}</span>;
        }
    };

    const getStatusIcon = () => {
        switch (status.status) {
            case 'processing':
                return '⏳';
            case 'completed':
                return '✅';
            case 'failed':
                return '❌';
            default:
                return '📊';
        }
    };

    return (
        <div className="container section">
            <div className="text-center mb-xl">
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
                    {getStatusIcon()}
                </div>
                <h1>Transformation {status.status === 'completed' ? 'Complete' : 'In Progress'}</h1>
                {getStatusBadge()}
            </div>

            {/* Status Card */}
            <div className="card card-elevated mb-xl">
                <div className="card-header">
                    <h3 className="card-title">Status Details</h3>
                </div>

                <div className="grid grid-2">
                    <div>
                        <p className="text-tertiary">Transform ID</p>
                        <p style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}>
                            {transformId}
                        </p>
                    </div>

                    <div>
                        <p className="text-tertiary">Status</p>
                        <p>{status.status}</p>
                    </div>

                    <div>
                        <p className="text-tertiary">Rows Processed</p>
                        <p className="text-primary" style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
                            {status.rowsProcessed.toLocaleString()}
                        </p>
                    </div>

                    <div>
                        <p className="text-tertiary">Warnings</p>
                        <p className={status.warnings?.length > 0 ? 'text-warning' : 'text-success'} style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
                            {status.warnings?.length || 0}
                        </p>
                    </div>

                    <div>
                        <p className="text-tertiary">Started At</p>
                        <p>{new Date(status.createdAt).toLocaleString()}</p>
                    </div>

                    {status.completedAt && (
                        <div>
                            <p className="text-tertiary">Completed At</p>
                            <p>{new Date(status.completedAt).toLocaleString()}</p>
                        </div>
                    )}
                </div>

                {status.status === 'processing' && (
                    <div className="mt-lg">
                        <div className="progress">
                            <div className="progress-bar" style={{ width: '100%' }}></div>
                        </div>
                        <p className="text-center text-secondary mt-sm">
                            Processing... This may take a few moments for large files
                        </p>
                    </div>
                )}

                {status.error && (
                    <div className="alert alert-error mt-lg">
                        <strong>Error:</strong> {status.error}
                    </div>
                )}
            </div>

            {/* Warnings */}
            {status.warnings && status.warnings.length > 0 && (
                <div className="card mb-xl">
                    <div className="card-header">
                        <h4 className="card-title">
                            Warnings ({status.warnings.length})
                        </h4>
                        <p className="card-subtitle">
                            Review these warnings to ensure data quality
                        </p>
                    </div>

                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {status.warnings.slice(0, 50).map((warning, idx) => (
                            <div
                                key={idx}
                                className="alert alert-warning"
                                style={{ marginBottom: 'var(--space-sm)' }}
                            >
                                {warning}
                            </div>
                        ))}
                        {status.warnings.length > 50 && (
                            <p className="text-secondary text-center mt-md">
                                ... and {status.warnings.length - 50} more warnings
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="card card-elevated text-center">
                {status.status === 'completed' ? (
                    <>
                        <h3>🎉 Your file is ready!</h3>
                        <p className="text-secondary mb-lg">
                            Download the transformed CSV file below
                        </p>

                        <div className="flex-center" style={{ gap: '1rem', flexWrap: 'wrap' }}>
                            <button className="btn btn-primary btn-lg" onClick={handleDownload}>
                                ⬇️ Download Transformed File
                            </button>

                            <button className="btn btn-secondary" onClick={() => navigate('/')}>
                                Upload Another File
                            </button>

                            <button className="btn btn-secondary" onClick={() => navigate('/history')}>
                                View History
                            </button>
                        </div>
                    </>
                ) : status.status === 'failed' ? (
                    <>
                        <h3>Transformation Failed</h3>
                        <p className="text-secondary mb-lg">
                            Please try again or contact support if the issue persists
                        </p>

                        <button className="btn btn-secondary" onClick={() => navigate('/')}>
                            ← Back to Upload
                        </button>
                    </>
                ) : (
                    <>
                        <h3>Processing Your File</h3>
                        <p className="text-secondary">
                            Please wait while we transform your data...
                        </p>
                        <div className="spinner spinner-lg" style={{ margin: '2rem auto' }}></div>
                    </>
                )}
            </div>
        </div>
    );
};

export default TransformPage;
