/**
 * CSS styles for the content script shadow DOM.
 * Uses a dark theme consistent with the extension UI.
 */
export const INSPECTOR_STYLES = `
  /* ── Overlay highlight ── */
  .uib-overlay {
    position: fixed;
    pointer-events: none;
    z-index: 999999;
    border: 2px solid #3b82f6;
    background: rgba(59, 130, 246, 0.08);
    transition: all 0.1s ease-out;
    border-radius: 2px;
    box-sizing: border-box;
  }

  .uib-overlay-label {
    position: absolute;
    top: -24px;
    left: 0;
    background: #3b82f6;
    color: #ffffff;
    font-size: 12px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 3px 3px 0 0;
    white-space: nowrap;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* ── Annotation status indicators ── */
  .uib-unannotated {
    outline: 2px dotted #f97316;
    outline-offset: 1px;
  }

  .uib-annotated {
    position: relative;
  }

  .uib-annotated::after {
    content: '';
    position: absolute;
    top: -3px;
    right: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    border: 1px solid #1f2937;
  }

  .uib-status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .uib-status-dot--annotated {
    background: #10b981;
  }

  .uib-status-dot--unannotated {
    background: #f97316;
  }

  /* ── Popover ── */
  .uib-popover {
    position: fixed;
    z-index: 999998;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 8px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    min-width: 320px;
    max-width: 400px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #f3f4f6;
    font-size: 13px;
    line-height: 1.4;
    overflow: hidden;
  }

  .uib-popover-header {
    background: #111827;
    padding: 10px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #374151;
  }

  .uib-popover-header-title {
    font-size: 13px;
    font-weight: 600;
    color: #f3f4f6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
  }

  .uib-popover-header-close {
    background: none;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
  }

  .uib-popover-header-close:hover {
    color: #f3f4f6;
  }

  .uib-popover-body {
    padding: 16px;
  }

  /* ── Form fields ── */
  .uib-field {
    margin-bottom: 12px;
  }

  .uib-field:last-child {
    margin-bottom: 0;
  }

  .uib-label {
    display: block;
    color: #9ca3af;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .uib-input,
  .uib-textarea {
    width: 100%;
    background: #374151;
    border: 1px solid #4b5563;
    color: #f3f4f6;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: inherit;
    line-height: 1.4;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.15s;
  }

  .uib-input:focus,
  .uib-textarea:focus {
    border-color: #3b82f6;
  }

  .uib-textarea {
    min-height: 60px;
    resize: vertical;
  }

  .uib-select {
    width: 100%;
    background: #374151;
    border: 1px solid #4b5563;
    color: #f3f4f6;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
    outline: none;
    cursor: pointer;
    appearance: auto;
    transition: border-color 0.15s;
  }

  .uib-select:focus {
    border-color: #3b82f6;
  }

  /* ── Tags ── */
  .uib-tag-input {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    background: #374151;
    border: 1px solid #4b5563;
    border-radius: 4px;
    padding: 4px 6px;
    min-height: 32px;
    align-items: center;
    cursor: text;
    transition: border-color 0.15s;
  }

  .uib-tag-input:focus-within {
    border-color: #3b82f6;
  }

  .uib-tag-input input {
    background: none;
    border: none;
    color: #f3f4f6;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    flex: 1;
    min-width: 60px;
    padding: 2px 0;
  }

  .uib-tag {
    display: inline-flex;
    align-items: center;
    background: #1e3a5f;
    color: #93c5fd;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    gap: 4px;
    white-space: nowrap;
    user-select: none;
  }

  .uib-tag:hover {
    background: #1e40af;
  }

  .uib-tag-remove {
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
  }

  .uib-tag:hover .uib-tag-remove {
    opacity: 1;
  }

  /* ── Buttons ── */
  .uib-btn {
    padding: 6px 16px;
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    border: none;
    outline: none;
    transition: background-color 0.15s, opacity 0.15s;
    line-height: 1.4;
  }

  .uib-btn:hover {
    opacity: 0.9;
  }

  .uib-btn:active {
    opacity: 0.8;
  }

  .uib-btn-primary {
    background: #3b82f6;
    color: #ffffff;
  }

  .uib-btn-primary:hover {
    background: #2563eb;
  }

  .uib-btn-secondary {
    background: #374151;
    color: #f3f4f6;
  }

  .uib-btn-secondary:hover {
    background: #4b5563;
  }

  .uib-btn-danger {
    background: #ef4444;
    color: #ffffff;
  }

  .uib-btn-danger:hover {
    background: #dc2626;
  }

  .uib-btn-group {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
  }

  /* ── Flash animation for highlight ── */
  @keyframes uib-flash {
    0%, 100% { border-color: #3b82f6; background: rgba(59, 130, 246, 0.08); }
    50% { border-color: #60a5fa; background: rgba(59, 130, 246, 0.2); }
  }

  .uib-overlay--flash {
    animation: uib-flash 0.4s ease-in-out 3;
  }
`;
