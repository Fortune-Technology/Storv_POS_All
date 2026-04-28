import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useConfirm } from '../hooks/useConfirmDialog.jsx';
import './DocumentHistory.css';

const DocumentHistory = ({ refresh }) => {
    const confirm = useConfirm();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [expandedItem, setExpandedItem] = useState(null);

    const fetchHistory = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.get('/document/history');
            if (Array.isArray(response.data)) {
                setHistory(response.data);
            } else {
                setHistory([]);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Error fetching document history.');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!await confirm({
            title: 'Delete document?',
            message: 'Are you sure?',
            confirmLabel: 'Delete',
            danger: true,
        })) return;
        try {
            await api.delete(`/document/${id}`);
            setHistory(prev => prev.filter(doc => doc.id !== id));
            if (expandedItem === id) setExpandedItem(null);
        } catch (err) {
            alert('Failed to delete history item');
        }
    };

    const toggleExpand = (id) => {
        setExpandedItem(expandedItem === id ? null : id);
    };

    useEffect(() => { fetchHistory(); }, [refresh]);

    if (loading && history.length === 0) {
        return (
            <div className="card-elevated flex-center p-3xl bg-secondary rounded-xl">
                 <div className="text-center">
                    <div className="spinner mb-md mx-auto"></div>
                    <p className="text-tertiary">Loading history...</p>
                 </div>
            </div>
        );
    }

    if (error) {
        return <div className="alert alert-error">{error}</div>;
    }

    if (history.length === 0) {
        return (
            <div className="card h-100 flex-center p-3xl bg-secondary rounded-xl text-center">
                <div>
                    <div className="dropzone-icon">📁</div>
                    <p className="text-tertiary">No document history found.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="card-header">
                <h4 className="card-title">Recent Discoveries</h4>
                <p className="card-subtitle">Manage previous document extractions.</p>
            </div>

            <div className="mt-lg ocr-history-list">
                {history.map((doc) => (
                    <div
                        key={doc.id}
                        className={`card ocr-history-item ${expandedItem === doc.id ? 'active' : 'inactive'}`}
                        onClick={() => toggleExpand(doc.id)}
                    >
                        <div className="flex-between">
                            <div className="flex items-center gap-md">
                                <div className="dropzone-icon mb-0 dh-doc-icon">
                                    {doc.docType.toLowerCase().includes('invoice') ? '📄' : '🎫'}
                                </div>
                                <div className="text-left">
                                    <h5 className="mb-0 text-primary-light dh-filename">
                                        {doc.fileName.length > 25 ? doc.fileName.slice(0, 25) + '...' : doc.fileName}
                                    </h5>
                                    <small className="text-tertiary">
                                        {new Date(doc.uploadedAt).toLocaleDateString()}
                                    </small>
                                </div>
                            </div>
                            <div className="flex gap-sm">
                                <span className={`badge ${
                                    doc.confidence > 0.8 ? 'badge-success' :
                                    doc.confidence > 0.5 ? 'badge-warning' : 'badge-error'
                                }`}>
                                    {(doc.confidence * 100).toFixed(0)}%
                                </span>
                                <button className="btn btn-sm btn-secondary p-xs rounded-full" onClick={(e) => handleDelete(doc.id, e)}>
                                    🗑️
                                </button>
                            </div>
                        </div>

                        {expandedItem === doc.id && (
                            <div className="mt-lg slide-in-top">
                                <div className="table-container bg-secondary border-light">
                                    <table className="table table-sm">
                                        <thead>
                                            <tr>
                                                <th>Field</th>
                                                <th>Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(doc.extractedFields).map(([key, field]) => (
                                                <tr key={key}>
                                                    <td className="text-tertiary dh-field-key">{key}</td>
                                                    <td>
                                                        {key === "extractedText" ? (
                                                            <pre className="dh-extracted-pre">{field.value}</pre>
                                                        ) : (
                                                            <span>
                                                                {typeof field.value === 'object'
                                                                    ? JSON.stringify(field.value, null, 2)
                                                                    : String(field.value ?? "N/A")}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DocumentHistory;
