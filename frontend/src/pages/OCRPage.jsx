import React, { useState } from 'react';
import DocumentUploader from '../components/DocumentUploader';
import DocumentHistory from '../components/DocumentHistory';
import '../OCR.css';
import './OCRPage.css';

const OCRPage = () => {
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const handleUploadComplete = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    return (
        <div className="animate-fade-in container">
            <div className="p-header">
                <div>
                    <h1 className="ocr-title">Document Intelligence Hub</h1>
                    <p className="ocr-subtitle">Transform physical documents into digital pipelines. Extract critical information from invoices, receipts, and identity documents with sub-second latency.</p>
                </div>
            </div>

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
