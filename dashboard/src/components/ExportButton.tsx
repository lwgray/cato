import React, { useState } from 'react';
import { useVisualizationStore } from '../store/visualizationStore';
import './ExportButton.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4301';

const ExportButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const selectedProjectId = useVisualizationStore((state) => state.selectedProjectId);
  const snapshot = useVisualizationStore((state) => state.snapshot);

  const handleExport = async (format: 'json' | 'csv') => {
    setIsExporting(true);
    setIsOpen(false);

    try {
      // Build URL with project_id parameter
      const params = new URLSearchParams();
      if (selectedProjectId) {
        params.append('project_id', selectedProjectId);
      }
      params.append('format', format);

      const url = `${API_BASE_URL}/api/export?${params.toString()}`;

      // Fetch the export file
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `cato_export_${format === 'json' ? 'json' : 'csv'}.${format === 'json' ? 'json' : 'zip'}`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Download the file
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      console.log(`Export complete: ${filename}`);
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const projectName = snapshot?.project_name || 'All Projects';

  return (
    <div className="export-button-container">
      <button
        className="export-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        title="Export data"
      >
        {isExporting ? '⏳ Exporting...' : '📥 Export'}
      </button>

      {isOpen && !isExporting && (
        <div className="export-dropdown">
          <div className="export-dropdown-header">
            Export: {projectName}
          </div>
          <button
            className="export-option"
            onClick={() => handleExport('json')}
          >
            <span className="export-icon">📄</span>
            <div className="export-option-content">
              <div className="export-option-title">JSON Format</div>
              <div className="export-option-description">
                Complete snapshot (pretty-printed)
              </div>
            </div>
          </button>
          <button
            className="export-option"
            onClick={() => handleExport('csv')}
          >
            <span className="export-icon">📊</span>
            <div className="export-option-content">
              <div className="export-option-title">CSV Bundle (ZIP)</div>
              <div className="export-option-description">
                6 CSV files for analysis
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export default ExportButton;
