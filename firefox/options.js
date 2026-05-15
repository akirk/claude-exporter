// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['organizationId'], (result) => {
    if (result.organizationId) {
      document.getElementById('orgId').value = result.organizationId;
      showStatus('status', 'Organization ID loaded from saved settings', 'success');
      setTimeout(() => hideStatus('status'), 2000);
    }
  });
});

// Save settings
document.getElementById('saveBtn').addEventListener('click', () => {
  const orgId = document.getElementById('orgId').value.trim();
  
  if (!orgId) {
    showStatus('status', 'Please enter an Organization ID', 'error');
    return;
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orgId)) {
    showStatus('status', 'Invalid Organization ID format. It should be a UUID like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'error');
    return;
  }
  
  chrome.storage.sync.set({ organizationId: orgId }, () => {
    showStatus('status', 'Settings saved successfully!', 'success');
  });
});

// Test connection
document.getElementById('testBtn').addEventListener('click', async () => {
  const orgId = document.getElementById('orgId').value.trim();
  
  if (!orgId) {
    showStatus('testStatus', 'Please save an Organization ID first', 'error');
    return;
  }
  
  showStatus('testStatus', 'Testing connection...', 'success');
  
  try {
    const response = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      showStatus('testStatus', `Success! Found ${data.length} conversations.`, 'success');
    } else if (response.status === 401) {
      showStatus('testStatus', 'Not authenticated. Please make sure you are logged into Claude.ai', 'error');
    } else if (response.status === 403) {
      showStatus('testStatus', 'Access denied. The Organization ID might be incorrect.', 'error');
    } else {
      showStatus('testStatus', `Connection failed with status: ${response.status}`, 'error');
    }
  } catch (error) {
    showStatus('testStatus', `Connection error: ${error.message}`, 'error');
  }
});

// Backup all extension data to a file
document.getElementById('backupBtn').addEventListener('click', () => {
  chrome.storage.local.get(null, (local) => {
    chrome.storage.sync.get(null, (sync) => {
      const backup = {
        _meta: {
          app: 'claude-exporter',
          backupVersion: 1,
          extensionVersion: chrome.runtime.getManifest().version,
          createdAt: new Date().toISOString()
        },
        local: local || {},
        sync: sync || {}
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-exporter-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
      const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
      showStatus('backupStatus', `Backup downloaded — ${snapCount} model snapshot(s), ${exportCount} export record(s).`, 'success');
    });
  });
});

// Restore extension data from a backup file
document.getElementById('restoreBtn').addEventListener('click', () => {
  document.getElementById('restoreFile').click();
});

document.getElementById('restoreFile').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = ''; // allow re-selecting the same file later
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch (err) {
      showStatus('backupStatus', 'Restore failed: the file is not valid JSON.', 'error');
      return;
    }

    // Make sure this is actually one of our backup files
    if (!backup || typeof backup !== 'object' || !backup._meta ||
        backup._meta.app !== 'claude-exporter' || typeof backup.local !== 'object') {
      showStatus('backupStatus', 'Restore failed: this does not look like a Claude Exporter backup file.', 'error');
      return;
    }

    const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
    const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
    const proceed = confirm(
      `Restore this backup?\n\n` +
      `It contains ${snapCount} model snapshot(s) and ${exportCount} export record(s), ` +
      `created ${backup._meta.createdAt || 'an unknown date'}.\n\n` +
      `This overwrites the extension's current data with the backup's contents.`
    );
    if (!proceed) {
      showStatus('backupStatus', 'Restore cancelled.', 'error');
      return;
    }

    chrome.storage.local.set(backup.local, () => {
      const syncData = (backup.sync && typeof backup.sync === 'object') ? backup.sync : {};
      chrome.storage.sync.set(syncData, () => {
        showStatus('backupStatus', `Restore complete — ${snapCount} model snapshot(s), ${exportCount} export record(s) restored. Reload any open Claude pages and the browse page to see the changes.`, 'success');
      });
    });
  };
  reader.readAsText(file);
});

// Helper functions
function showStatus(elementId, message, type) {
  const statusEl = document.getElementById(elementId);
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function hideStatus(elementId) {
  const statusEl = document.getElementById(elementId);
  statusEl.className = 'status';
}
