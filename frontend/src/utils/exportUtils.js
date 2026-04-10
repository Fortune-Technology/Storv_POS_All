/**
 * Export Utilities — CSV and PDF downloads for analytics pages.
 * Uses jspdf + jspdf-autotable for PDF, native Blob for CSV.
 */

import { saveAs } from 'file-saver';

// ─── CSV Export ──────────────────────────────────────────────────────────────

/**
 * Download data as a CSV file.
 * @param {Array<object>} data - array of row objects
 * @param {Array<{key:string, label:string}>} columns - column definitions
 * @param {string} filename - output filename (without extension)
 */
export function downloadCSV(data, columns, filename = 'export') {
  if (!data?.length) return;

  const headers = columns.map(c => `"${c.label}"`).join(',');
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key];
      if (val == null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  );

  const csv = [headers, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ─── PDF Export ──────────────────────────────────────────────────────────────

/**
 * Download data as a styled PDF with title, summary, and table.
 * @param {object} options
 * @param {string} options.title - report title
 * @param {string} [options.subtitle] - date range or description
 * @param {Array<{label:string, value:string}>} [options.summary] - KPI cards
 * @param {Array<object>} options.data - table rows
 * @param {Array<{key:string, label:string}>} options.columns - table column defs
 * @param {string} [options.filename] - output filename
 */
export async function downloadPDF({ title, subtitle, summary, data, columns, filename = 'report' }) {
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 18);

  // Subtitle
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(subtitle, 14, 25);
    doc.setTextColor(0);
  }

  let yPos = subtitle ? 32 : 26;

  // Summary KPI row
  if (summary?.length) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const cardWidth = (pageWidth - 28) / Math.min(summary.length, 6);
    summary.forEach((kpi, i) => {
      const x = 14 + i * cardWidth;
      doc.setDrawColor(200);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, yPos, cardWidth - 4, 14, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text(kpi.label, x + 3, yPos + 5);
      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold');
      doc.text(String(kpi.value), x + 3, yPos + 11);
    });
    yPos += 20;
  }

  // Table
  if (data?.length && columns?.length) {
    doc.autoTable({
      startY: yPos,
      head: [columns.map(c => c.label)],
      body: data.map(row => columns.map(c => {
        const v = row[c.key];
        return v != null ? String(v) : '';
      })),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [61, 86, 181], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Generated ${new Date().toLocaleString()} | Page ${i}/${pageCount}`, 14, doc.internal.pageSize.getHeight() - 8);
    doc.text('StoreVue POS', pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }

  doc.save(`${filename}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Quick Export from Chart Data ────────────────────────────────────────────

/**
 * Export chart screenshot as PDF image.
 * @param {HTMLElement} chartElement - the chart container DOM element
 * @param {string} title
 * @param {string} filename
 */
export async function exportChartAsPDF(chartElement, title, filename = 'chart') {
  if (!chartElement) return;

  const { default: html2canvas } = await import('html2canvas');
  const { default: jsPDF } = await import('jspdf');

  const canvas = await html2canvas(chartElement, { scale: 2, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/png');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 14);

  const imgWidth = doc.internal.pageSize.getWidth() - 28;
  const imgHeight = (canvas.height / canvas.width) * imgWidth;
  doc.addImage(imgData, 'PNG', 14, 22, imgWidth, Math.min(imgHeight, 160));

  doc.save(`${filename}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Export Button Component Helper ──────────────────────────────────────────

/**
 * Formats a number as currency string for export.
 */
export const fmtExport$ = (n) => {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
};

/**
 * Formats a number with commas for export.
 */
export const fmtExportNum = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
};
