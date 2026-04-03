/**
 * History Page
 * Shows transformation history with re-run and download options
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, deleteTransform, getDownloadUrl } from '../services/api';

const HistoryPage = () => {
    const navigate = useNavigate();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [deleting, setDeleting] = useState(null);

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        try {
            setLoading(true);
            const data = await getHistory();
            setHistory(data);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load history');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (transformId) => {
        if (!confirm('Are you sure you want to delete this transformation?')) {
            return;
        }

        try {
            setDeleting(transformId);
            await deleteTransform(transformId);
            setHistory(history.filter(item => item.transformId !== transformId));
        } catch (err) {
            alert('Failed to delete transformation');
        } finally {
            setDeleting(null);
        }
    };

    const handleDownload = (transformId) => {
        window.location.href = getDownloadUrl(transformId);
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'processing':
                return <span className="badge badge-info">Processing</span>;
            case 'completed':
                return <span className="badge badge-success">Completed</span>;
            case 'failed':
                return <span className="badge badge-error">Failed</span>;
            default:
                return <span className="badge badge-primary">{status}</span>;
        }
    };

    if (loading) {
        return (
            <div className="container section flex-center">
                <div className="text-center">
                    <div className="spinner spinner-lg"></div>
                    <p className="mt-lg text-secondary">Loading history...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="animate-fade-in container">
            <header className="flex-between mb-xl">
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Transformation History</h1>
                    <p className="text-secondary">
                        View and manage your previous transformations
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/csv/upload')}>
                    + New Transformation
                </button>
            </header>

            {error && (
                <div className="alert alert-error mb-lg">
                    <strong>Error:</strong> {error}
                </div>
            )}

            {history.length === 0 ? (
                <div className="card p-xl text-center">
                    <div className="card-body">
                        <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>📋</div>
                        <h3 className="mb-md">No Transformations Yet</h3>
                        <p className="text-secondary mb-xl">
                            Upload a file to get started with the CSV transformer.
                        </p>
                        <button className="btn btn-primary" onClick={() => navigate('/csv/upload')}>
                            Upload File
                        </button>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Filename</th>
                                    <th>Status</th>
                                    <th>Rows</th>
                                    <th>Warnings</th>
                                    <th>Created</th>
                                    <th>Completed</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((item) => (
                                    <tr key={item.transformId}>
                                        <td>
                                            <strong>{item.filename}</strong>
                                            <br />
                                            <span style={{
                                                fontSize: 'var(--font-size-xs)',
                                                color: 'var(--color-text-tertiary)',
                                                fontFamily: 'monospace'
                                            }}>
                                                {item.transformId.substring(0, 8)}...
                                            </span>
                                        </td>
                                        <td>{getStatusBadge(item.status)}</td>
                                        <td>{item.rowsProcessed?.toLocaleString() || '-'}</td>
                                        <td>
                                            {item.warningCount > 0 ? (
                                                <span className="badge badge-warning">
                                                    {item.warningCount}
                                                </span>
                                            ) : (
                                                <span className="badge badge-success">0</span>
                                            )}
                                        </td>
                                        <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                                        <td>
                                            {item.completedAt
                                                ? new Date(item.completedAt).toLocaleDateString()
                                                : '-'
                                            }
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                {item.status === 'completed' && (
                                                    <button
                                                        className="btn btn-sm btn-primary"
                                                        onClick={() => handleDownload(item.transformId)}
                                                    >
                                                        ⬇️ Download
                                                    </button>
                                                )}

                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => navigate(`/transform/${item.transformId}`)}
                                                >
                                                    👁️ View
                                                </button>

                                                <button
                                                    className="btn btn-sm btn-error"
                                                    onClick={() => handleDelete(item.transformId)}
                                                    disabled={deleting === item.transformId}
                                                >
                                                    {deleting === item.transformId ? '...' : '🗑️'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HistoryPage;
