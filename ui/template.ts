/**
 * UI Template Module
 *
 * Defines the plugin's user interface: a simple button to generate
 * TikTok variants with status feedback.
 */

/**
 * Generate the complete HTML for the plugin UI.
 */
export function getUIHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      color: #333;
      background: #fff;
      padding: 16px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      margin-bottom: 16px;
    }

    .header h1 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .header p {
      color: #666;
      font-size: 11px;
    }

    .selection-info {
      background: #f5f5f5;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }

    .selection-info.valid {
      background: #e8f5e9;
    }

    .selection-info.invalid {
      background: #fff3e0;
    }

    .selection-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #666;
      margin-bottom: 4px;
    }

    .selection-name {
      font-weight: 500;
      color: #333;
    }

    .generate-btn {
      width: 100%;
      padding: 12px 16px;
      background: #18a0fb;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .generate-btn:hover:not(:disabled) {
      background: #0d8de6;
    }

    .generate-btn:disabled {
      background: #ccc;
      cursor: not-allowed;
    }

    .status {
      margin-top: 16px;
      padding: 12px;
      border-radius: 6px;
      font-size: 11px;
      display: none;
    }

    .status.visible {
      display: block;
    }

    .status.progress {
      background: #e3f2fd;
      color: #1565c0;
    }

    .status.success {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .status.error {
      background: #ffebee;
      color: #c62828;
    }

    .status-stage {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .status-detail {
      opacity: 0.8;
    }

    .api-key-section {
      margin-top: auto;
      padding-top: 16px;
      border-top: 1px solid #eee;
    }

    .api-key-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 8px;
    }

    .api-key-input:focus {
      outline: none;
      border-color: #18a0fb;
    }

    .api-key-btn {
      width: 100%;
      padding: 8px 12px;
      background: #f5f5f5;
      color: #333;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }

    .api-key-btn:hover {
      background: #eee;
    }

    .api-key-status {
      font-size: 10px;
      color: #666;
      margin-bottom: 8px;
    }

    .api-key-status.configured {
      color: #2e7d32;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>TikTok Variant Generator</h1>
    <p>Transform your marketing frame for TikTok (1080×1920)</p>
  </div>

  <div id="selectionInfo" class="selection-info invalid">
    <div class="selection-label">Selected Frame</div>
    <div id="selectionName" class="selection-name">No frame selected</div>
  </div>

  <button id="generateBtn" class="generate-btn" disabled>
    Generate TikTok Variant
  </button>

  <div id="status" class="status">
    <div id="statusStage" class="status-stage"></div>
    <div id="statusDetail" class="status-detail"></div>
  </div>

  <div class="api-key-section">
    <div id="apiKeyStatus" class="api-key-status">API key not configured</div>
    <input type="password" id="apiKeyInput" class="api-key-input" placeholder="Enter OpenAI API key">
    <button id="apiKeyBtn" class="api-key-btn">Save API Key</button>
  </div>

  <script>
    const generateBtn = document.getElementById('generateBtn');
    const selectionInfo = document.getElementById('selectionInfo');
    const selectionName = document.getElementById('selectionName');
    const status = document.getElementById('status');
    const statusStage = document.getElementById('statusStage');
    const statusDetail = document.getElementById('statusDetail');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const apiKeyBtn = document.getElementById('apiKeyBtn');
    const apiKeyStatus = document.getElementById('apiKeyStatus');

    let hasValidSelection = false;
    let hasApiKey = false;

    function updateButtonState() {
      generateBtn.disabled = !hasValidSelection || !hasApiKey;
    }

    function showStatus(type, stage, detail) {
      status.className = 'status visible ' + type;
      statusStage.textContent = stage;
      statusDetail.textContent = detail || '';
    }

    function hideStatus() {
      status.className = 'status';
    }

    // Handle messages from plugin
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      switch (msg.type) {
        case 'SELECTION_CHANGED':
          hasValidSelection = msg.hasValidSelection;
          if (hasValidSelection) {
            selectionInfo.className = 'selection-info valid';
            selectionName.textContent = (msg.frameNames && msg.frameNames.length > 0) ? msg.frameNames.join(', ') : 'Selected frame';
          } else {
            selectionInfo.className = 'selection-info invalid';
            selectionName.textContent = 'No frame selected';
          }
          updateButtonState();
          break;

        case 'GENERATION_STARTED':
          generateBtn.disabled = true;
          showStatus('progress', 'Starting generation...', '');
          break;

        case 'GENERATION_PROGRESS':
          showStatus('progress', msg.stage, msg.detail);
          break;

        case 'GENERATION_COMPLETE':
          showStatus('success', 'Generation complete!', 'Created: ' + msg.variantName);
          updateButtonState();
          break;

        case 'GENERATION_ERROR':
          showStatus('error', 'Error', msg.error);
          updateButtonState();
          break;

        case 'API_KEY_STATUS':
          hasApiKey = msg.hasKey;
          apiKeyStatus.textContent = hasApiKey ? 'API key configured ✓' : 'API key not configured';
          apiKeyStatus.className = hasApiKey ? 'api-key-status configured' : 'api-key-status';
          updateButtonState();
          break;
      }
    };

    // Handle generate button click
    generateBtn.addEventListener('click', () => {
      parent.postMessage({ pluginMessage: { type: 'GENERATE_TIKTOK' } }, '*');
    });

    // Handle API key save
    apiKeyBtn.addEventListener('click', () => {
      const key = apiKeyInput.value.trim();
      if (key) {
        parent.postMessage({ pluginMessage: { type: 'SET_API_KEY', apiKey: key } }, '*');
        apiKeyInput.value = '';
      }
    });
  </script>
</body>
</html>`;
}
