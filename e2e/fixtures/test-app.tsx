/**
 * Test Application Fixture
 *
 * A test React application used for E2E testing the AI-native UI Bridge.
 * This app simulates a data extraction tool with various UI elements.
 */

import React, { useState, useCallback } from 'react';

/**
 * Types for the test application
 */
interface ExtractionResult {
  data: string[];
  timestamp: number;
}

/**
 * Header Component
 */
export function Header(): React.ReactElement {
  return (
    <header data-ui-id="app-header" data-ui-type="header">
      <h1>Data Extraction Tool</h1>
      <nav>
        <a href="#home" data-ui-id="nav-home">
          Home
        </a>
        <a href="#settings" data-ui-id="nav-settings">
          Settings
        </a>
        <a href="#help" data-ui-id="nav-help">
          Help
        </a>
      </nav>
    </header>
  );
}

/**
 * URL Input Component
 */
export function URLInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="field-group">
      <label htmlFor="url-input">Target URL</label>
      <input
        id="url-input"
        type="url"
        data-ui-id="url-input"
        data-ui-type="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter the URL to extract data from"
        disabled={disabled}
        aria-label="Target URL for data extraction"
      />
    </div>
  );
}

/**
 * Selector Input Component
 */
export function SelectorInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="field-group">
      <label htmlFor="selector-input">CSS Selector</label>
      <input
        id="selector-input"
        type="text"
        data-ui-id="selector-input"
        data-ui-type="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter CSS selector (e.g., .product-title)"
        disabled={disabled}
        aria-label="CSS selector for data extraction"
      />
    </div>
  );
}

/**
 * Format Selector Component
 */
export function FormatSelector({
  value,
  onChange,
  disabled,
}: {
  value: 'json' | 'csv' | 'xml';
  onChange: (value: 'json' | 'csv' | 'xml') => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="field-group">
      <label htmlFor="format-select">Output Format</label>
      <select
        id="format-select"
        data-ui-id="format-select"
        data-ui-type="dropdown"
        value={value}
        onChange={(e) => onChange(e.target.value as 'json' | 'csv' | 'xml')}
        disabled={disabled}
        aria-label="Output format selection"
      >
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
        <option value="xml">XML</option>
      </select>
    </div>
  );
}

/**
 * Options Panel Component
 */
export function OptionsPanel({
  includeHeaders,
  onIncludeHeadersChange,
  validateData,
  onValidateDataChange,
  disabled,
}: {
  includeHeaders: boolean;
  onIncludeHeadersChange: (value: boolean) => void;
  validateData: boolean;
  onValidateDataChange: (value: boolean) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="options-panel" data-ui-id="options-panel">
      <h3>Advanced Options</h3>
      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            data-ui-id="include-headers-checkbox"
            data-ui-type="checkbox"
            checked={includeHeaders}
            onChange={(e) => onIncludeHeadersChange(e.target.checked)}
            disabled={disabled}
            aria-label="Include column headers in output"
          />
          Include Headers
        </label>
      </div>
      <div className="checkbox-group">
        <label>
          <input
            type="checkbox"
            data-ui-id="validate-data-checkbox"
            data-ui-type="checkbox"
            checked={validateData}
            onChange={(e) => onValidateDataChange(e.target.checked)}
            disabled={disabled}
            aria-label="Validate extracted data"
          />
          Validate Data
        </label>
      </div>
    </div>
  );
}

/**
 * Action Buttons Component
 */
export function ActionButtons({
  onStartExtraction,
  onCancel,
  onClear,
  isExtracting,
}: {
  onStartExtraction: () => void;
  onCancel: () => void;
  onClear: () => void;
  isExtracting: boolean;
}): React.ReactElement {
  return (
    <div className="action-buttons">
      <button
        type="button"
        data-ui-id="start-extraction-button"
        data-ui-type="submit-button"
        onClick={onStartExtraction}
        disabled={isExtracting}
        aria-label="Start data extraction process"
      >
        {isExtracting ? 'Extracting...' : 'Start Extraction'}
      </button>
      <button
        type="button"
        data-ui-id="cancel-button"
        data-ui-type="cancel-button"
        onClick={onCancel}
        disabled={!isExtracting}
        aria-label="Cancel extraction"
      >
        Cancel
      </button>
      <button
        type="button"
        data-ui-id="clear-button"
        data-ui-type="button"
        onClick={onClear}
        disabled={isExtracting}
        aria-label="Clear all fields"
      >
        Clear
      </button>
    </div>
  );
}

/**
 * Status Message Component
 */
export function StatusMessage({
  message,
  type,
}: {
  message: string | null;
  type: 'info' | 'success' | 'error' | 'warning';
}): React.ReactElement | null {
  if (!message) return null;

  return (
    <div
      className={`status-message status-${type}`}
      data-ui-id="status-message"
      data-ui-type="text"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

/**
 * Results Panel Component
 */
export function ResultsPanel({
  results,
  onDownload,
  onCopyToClipboard,
}: {
  results: ExtractionResult | null;
  onDownload: () => void;
  onCopyToClipboard: () => void;
}): React.ReactElement | null {
  if (!results) return null;

  return (
    <div className="results-panel" data-ui-id="results-panel">
      <h3>Extraction Results</h3>
      <div className="results-info">
        <span data-ui-id="results-count">{results.data.length} items extracted</span>
        <span data-ui-id="results-timestamp">
          at {new Date(results.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="results-actions">
        <button
          type="button"
          data-ui-id="download-results-button"
          data-ui-type="button"
          onClick={onDownload}
          aria-label="Download extraction results"
        >
          Download Results
        </button>
        <button
          type="button"
          data-ui-id="copy-results-button"
          data-ui-type="button"
          onClick={onCopyToClipboard}
          aria-label="Copy results to clipboard"
        >
          Copy to Clipboard
        </button>
      </div>
      <div className="results-preview" data-ui-id="results-preview">
        <pre>{JSON.stringify(results.data, null, 2)}</pre>
      </div>
    </div>
  );
}

/**
 * Modal Dialog Component
 */
export function ConfirmationModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" data-ui-id="modal-overlay">
      <div
        className="modal"
        data-ui-id="confirmation-modal"
        data-ui-type="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <h2 id="modal-title" data-ui-id="modal-title">
          {title}
        </h2>
        <p data-ui-id="modal-message">{message}</p>
        <div className="modal-actions">
          <button
            type="button"
            data-ui-id="modal-confirm-button"
            data-ui-type="submit-button"
            onClick={onConfirm}
            aria-label="Confirm action"
          >
            Confirm
          </button>
          <button
            type="button"
            data-ui-id="modal-cancel-button"
            data-ui-type="cancel-button"
            onClick={onCancel}
            aria-label="Cancel and close modal"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Main Test Application
 */
export function TestApp(): React.ReactElement {
  // Form state
  const [url, setUrl] = useState('');
  const [selector, setSelector] = useState('');
  const [format, setFormat] = useState<'json' | 'csv' | 'xml'>('json');
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [validateData, setValidateData] = useState(false);

  // UI state
  const [isExtracting, setIsExtracting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error' | 'warning'>('info');
  const [results, setResults] = useState<ExtractionResult | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Handlers
  const handleStartExtraction = useCallback(() => {
    if (!url) {
      setStatusMessage('Please enter a URL');
      setStatusType('error');
      return;
    }

    setIsExtracting(true);
    setStatusMessage('Extraction in progress...');
    setStatusType('info');

    // Simulate extraction
    setTimeout(() => {
      setIsExtracting(false);
      setResults({
        data: ['Item 1', 'Item 2', 'Item 3'],
        timestamp: Date.now(),
      });
      setStatusMessage('Extraction completed successfully!');
      setStatusType('success');
    }, 1500);
  }, [url]);

  const handleCancel = useCallback(() => {
    setIsExtracting(false);
    setStatusMessage('Extraction cancelled');
    setStatusType('warning');
  }, []);

  const handleClear = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleConfirmClear = useCallback(() => {
    setUrl('');
    setSelector('');
    setFormat('json');
    setIncludeHeaders(true);
    setValidateData(false);
    setResults(null);
    setStatusMessage('All fields cleared');
    setStatusType('info');
    setIsModalOpen(false);
  }, []);

  const handleDownload = useCallback(() => {
    setStatusMessage('Download started');
    setStatusType('info');
  }, []);

  const handleCopyToClipboard = useCallback(() => {
    if (results) {
      navigator.clipboard?.writeText(JSON.stringify(results.data, null, 2));
      setStatusMessage('Results copied to clipboard');
      setStatusType('success');
    }
  }, [results]);

  return (
    <div className="test-app" data-ui-id="test-app">
      <Header />

      <main data-ui-id="main-content">
        <form
          data-ui-id="extraction-form"
          data-ui-type="form"
          onSubmit={(e) => {
            e.preventDefault();
            handleStartExtraction();
          }}
        >
          <URLInput value={url} onChange={setUrl} disabled={isExtracting} />
          <SelectorInput value={selector} onChange={setSelector} disabled={isExtracting} />
          <FormatSelector value={format} onChange={setFormat} disabled={isExtracting} />
          <OptionsPanel
            includeHeaders={includeHeaders}
            onIncludeHeadersChange={setIncludeHeaders}
            validateData={validateData}
            onValidateDataChange={setValidateData}
            disabled={isExtracting}
          />
          <ActionButtons
            onStartExtraction={handleStartExtraction}
            onCancel={handleCancel}
            onClear={handleClear}
            isExtracting={isExtracting}
          />
        </form>

        <StatusMessage message={statusMessage} type={statusType} />
        <ResultsPanel
          results={results}
          onDownload={handleDownload}
          onCopyToClipboard={handleCopyToClipboard}
        />
      </main>

      <ConfirmationModal
        isOpen={isModalOpen}
        title="Clear All Fields?"
        message="This will reset all form fields and clear any results. Are you sure?"
        onConfirm={handleConfirmClear}
        onCancel={() => setIsModalOpen(false)}
      />
    </div>
  );
}

export default TestApp;
