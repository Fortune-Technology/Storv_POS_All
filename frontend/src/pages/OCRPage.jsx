import React, { useState } from 'react';
import DocumentUploader from '../components/DocumentUploader';
import DocumentHistory from '../components/DocumentHistory';
import '../OCR.css';

const OCRPage = () => {
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const handleUploadComplete = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    return (
        <div className="animate-fade-in container">
            <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Document Intelligence Hub</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Transform physical documents into digital pipelines. Extract critical information from invoices, receipts, and identity documents with sub-second latency.</p>
                </div>
            </header>

            <div className="grid grid-2">
                <div className="flex flex-col gap-lg">
                    <div className="card ocr-card-container p-xl">
                        <DocumentUploader onUploadSuccess={handleUploadComplete} />
                    </div>
                </div>

                <div className="flex flex-col gap-lg">
                    <div className="card ocr-card-container p-xl">
                        <DocumentHistory refresh={refreshTrigger} />
                    </div>
                </div>
            </div>

            {/* Background Glows for visual impact */}
            <div className="ocr-glow ocr-glow-1"></div>
            <div className="ocr-glow ocr-glow-2"></div>
        </div>
    );
};

export default OCRPage;
