const API_BASE = '/api';
let SESSION_ID = null;
let CURRENT_PATH = '~';

const elements = {
    setupScreen: document.getElementById('setup-screen'),
    dashboard: document.getElementById('dashboard'),
    setupForm: document.getElementById('setup-form'),
    setupStep1: document.getElementById('setup-step-1'),
    setupStep2: document.getElementById('setup-step-2'),
    installCommand: document.getElementById('install-command'),
    copyBtn: document.getElementById('copy-btn'),
    setupStatus: document.getElementById('setup-status'),

    // Dashboard
    terminalOutput: document.getElementById('terminal-output'),
    chatHistory: document.getElementById('chat-history'),
    chatInput: document.getElementById('chat-input'),
    sendChatBtn: document.getElementById('send-chat'),
    fileTree: document.getElementById('file-tree'),
    currentFileLabel: document.getElementById('current-file'),
    codeEditor: document.getElementById('code-editor'),

    toggleFilesBtn: document.getElementById('toggle-files'),
    toggleChatBtn: document.getElementById('toggle-chat'),
    fileSidebar: document.getElementById('file-sidebar'),
    chatSidebar: document.getElementById('chat-sidebar'),
    overlay: document.getElementById('sidebar-overlay'),

    agentStatus: document.getElementById('agent-status'),
    quotaDisplay: document.getElementById('ai-quota-display'),
    modelSelect: document.getElementById('dashboard-model-select'),

    saveBtn: document.getElementById('save-file'),
    refreshFilesBtn: document.getElementById('refresh-files'),
    disconnectBtn: document.getElementById('disconnect-btn'),

    // R2 Elements
    tabVps: document.getElementById('tab-vps'),
    tabCloud: document.getElementById('tab-cloud'),
    vpsPanel: document.getElementById('vps-file-panel'),
    r2Panel: document.getElementById('r2-file-panel'),
    r2Tree: document.getElementById('r2-file-tree'),
    refreshR2Btn: document.getElementById('refresh-r2'),
    r2UploadBtn: document.getElementById('r2-upload-btn'),
    r2UploadInput: document.getElementById('r2-upload-input')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initTabs();
    initR2();
    initSettings();
});

function checkSession() {
    const storedId = localStorage.getItem('vpsai_session');
    if (storedId) {
        SESSION_ID = storedId;
        // Check validity
        fetch(`${API_BASE}/session/status`, {
            headers: { 'Authorization': SESSION_ID }
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'connected' || data.status === 'offline') {
                restoreDashboard();
            } else if (data.status === 'waiting') {
                // Show waiting screen
                elements.setupStep1.classList.add('hidden');
                elements.setupStep2.classList.remove('hidden');
                generateCommand(SESSION_ID);
                pollConnection();
            } else {
                localStorage.removeItem('vpsai_session');
            }
        })
        .catch(() => localStorage.removeItem('vpsai_session'));
    }
}

function restoreDashboard() {
    elements.setupScreen.classList.remove('active');
    elements.setupScreen.classList.add('hidden');
    elements.dashboard.classList.remove('hidden');
    elements.dashboard.classList.add('active');
    loadFiles();
}

// --- SETUP FLOW ---

elements.setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiKey = document.getElementById('gemini-key').value;
    const model = document.getElementById('gemini-model').value;
    const btn = elements.setupForm.querySelector('button');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = 'Creating Session...';

    try {
        const res = await fetch(`${API_BASE}/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model })
        });

        // Robust Error Handling
        let data;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await res.json();
        } else {
            // If server returns text (e.g. 500 Internal Server Error)
            const text = await res.text();
            throw new Error(`Server Error: ${text}`);
        }

        if (data.success) {
            SESSION_ID = data.sessionId;
            localStorage.setItem('vpsai_session', SESSION_ID);

            elements.setupStep1.classList.add('hidden');
            elements.setupStep2.classList.remove('hidden');

            generateCommand(SESSION_ID);
            pollConnection();
        } else {
            throw new Error(data.error || 'Failed to create session');
        }
    } catch (e) {
        console.error(e);
        alert(e.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

function generateCommand(sessionId) {
    const baseUrl = window.location.origin;
    // The command downloads setup.sh and runs it with URL and Token
    const cmd = `curl -sL ${baseUrl}/setup.sh | bash -s -- "${baseUrl}" "${sessionId}"`;
    elements.installCommand.textContent = cmd;

    elements.copyBtn.onclick = () => {
        navigator.clipboard.writeText(cmd);
        elements.copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(() => elements.copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy', 2000);
    };
}

let pollInterval;
function pollConnection() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/session/status`, {
                headers: { 'Authorization': SESSION_ID }
            });
            const data = await res.json();

            if (data.status === 'connected') {
                clearInterval(pollInterval);
                elements.setupStatus.textContent = 'Connected! Redirecting...';
                elements.setupStatus.style.color = '#4ade80';
                setTimeout(restoreDashboard, 1000);
            }
        } catch (e) {
            console.error('Poll error', e);
        }
    }, 2000);
}

// Start polling for usage/quota updates when dashboard is active
let dashboardPoll;
function startDashboardPoll() {
    if (dashboardPoll) clearInterval(dashboardPoll);

    // Initial fetch to set model
    fetchStatus();

    dashboardPoll = setInterval(fetchStatus, 5000);
}

async function fetchStatus() {
    if (!SESSION_ID) return;
    try {
        const res = await fetch(`${API_BASE}/session/status`, {
            headers: { 'Authorization': SESSION_ID }
        });
        const data = await res.json();

        if (data.usage !== undefined) {
            elements.quotaDisplay.querySelector('span').textContent = `Quota: ${data.usage}`;
        }

        // Sync model selector if changed externally (or initial load)
        if (data.model && document.activeElement !== elements.modelSelect) {
            elements.modelSelect.value = data.model;
        }

    } catch (e) {
        // silent error
    }
}

function initSettings() {
    elements.modelSelect.addEventListener('change', async (e) => {
        const newModel = e.target.value;
        try {
            const res = await fetch(`${API_BASE}/session/update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': SESSION_ID
                },
                body: JSON.stringify({ model: newModel })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Model switched to ${newModel}`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            showToast('Failed to switch model: ' + err.message, 'error');
            // Revert selection
            fetchStatus();
        }
    });
}

// --- DASHBOARD LOGIC ---

// Toast Notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'fa-info-circle';
    if (type === 'error') icon = 'fa-exclamation-triangle';
    if (type === 'success') icon = 'fa-check-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function logSystem(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `term-line ${type}`;
    div.innerHTML = `<span style="opacity:0.5">[${time}]</span> ${message}`;
    elements.terminalOutput.appendChild(div);
    elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
}

// Disconnect
elements.disconnectBtn.addEventListener('click', () => {
    if(confirm('Disconnect?')) {
        localStorage.removeItem('vpsai_session');
        location.reload();
    }
});

// Chat & SSE
function sendChat() {
    const text = elements.chatInput.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    elements.chatInput.value = '';
    connectSSE(text);
}

function connectSSE(text) {
    const params = new URLSearchParams({
        message: text,
        currentPath: CURRENT_PATH,
        token: SESSION_ID
    });

    const evtSource = new EventSource(`${API_BASE}/chat-stream?${params.toString()}`);

    evtSource.addEventListener('ai-response', (e) => appendMessage(e.data, 'ai'));
    evtSource.addEventListener('command', (e) => logSystem(`$ ${e.data}`, 'system'));
    evtSource.addEventListener('output', (e) => logSystem(e.data, 'output'));

    evtSource.addEventListener('error', (e) => {
        logSystem(e.data || 'Error', 'error');
        evtSource.close();
    });

    evtSource.addEventListener('done', () => {
        evtSource.close();
        // Refresh file list if command might have changed files
        if (text.match(/(create|delete|touch|mkdir|rm|write)/i)) {
            loadFiles(CURRENT_PATH);
        }
    });
}

elements.sendChatBtn.addEventListener('click', sendChat);
elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
    }
});

function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `chat-msg ${sender} animate-fade`;
    let icon = sender === 'user' ? 'fa-user' : 'fa-robot';
    div.innerHTML = `<div class="avatar"><i class="fas ${icon}"></i></div><div class="bubble">${text.replace(/\n/g, '<br>')}</div>`;
    elements.chatHistory.appendChild(div);
    elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

// File Manager
async function loadFiles(path = '~') {
    elements.fileTree.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';
    document.getElementById('file-path-crumb').textContent = path;

    try {
        const res = await fetch(`${API_BASE}/files?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': SESSION_ID }
        });

        let data;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await res.json();
        } else {
             const text = await res.text();
             throw new Error(text || res.statusText);
        }

        if (data.files) {
            elements.fileTree.innerHTML = '';

            const upDiv = document.createElement('div');
            upDiv.className = 'file-item folder';
            upDiv.innerHTML = '<i class="fas fa-level-up-alt"></i> ..';
            upDiv.onclick = () => {
                const parts = CURRENT_PATH.split('/').filter(p => p !== '');
                parts.pop();
                CURRENT_PATH = parts.length === 0 ? '~' : parts.join('/');
                if(path === '~') CURRENT_PATH = '~';
                loadFiles(CURRENT_PATH);
            };
            elements.fileTree.appendChild(upDiv);

            data.files.forEach(file => {
                const div = document.createElement('div');
                div.className = `file-item ${file.isDirectory ? 'folder' : 'file'}`;
                const icon = file.isDirectory ? 'fa-folder' : 'fa-file-code';
                div.innerHTML = `<i class="fas ${icon}"></i> ${file.name}`;
                div.onclick = () => {
                    if (file.isDirectory) {
                        CURRENT_PATH = file.path;
                        loadFiles(file.path);
                    } else {
                        loadFileContent(file.path);
                    }
                };
                elements.fileTree.appendChild(div);
            });
        }
    } catch (err) {
        elements.fileTree.innerHTML = '<div class="term-line error">Failed to load files</div>';
        logSystem('Load Files Error: ' + err.message, 'error');
    }
}

async function loadFileContent(path) {
    elements.currentFileLabel.textContent = path;
    elements.codeEditor.value = 'Loading...';
    try {
        const res = await fetch(`${API_BASE}/read?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': SESSION_ID }
        });
        const data = await res.json();
        elements.codeEditor.value = data.content || '';
    } catch (e) {
        elements.codeEditor.value = '// Error: ' + e.message;
    }
}

elements.saveBtn.addEventListener('click', async () => {
    const path = elements.currentFileLabel.textContent;
    const content = elements.codeEditor.value;
    elements.saveBtn.innerHTML = '<i class="fas fa-spin fa-spinner"></i>';

    try {
        const res = await fetch(`${API_BASE}/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': SESSION_ID },
            body: JSON.stringify({ path, content })
        });
        const data = await res.json();
        if (data.success) showToast('Saved!', 'success');
        else throw new Error(data.error || 'Failed');
    } catch (e) {
        showToast(e.message, 'error');
    }
    elements.saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
});

elements.refreshFilesBtn.addEventListener('click', () => loadFiles(CURRENT_PATH));

// --- R2 LOGIC ---

function initTabs() {
    elements.tabVps.onclick = () => switchTab('vps');
    elements.tabCloud.onclick = () => switchTab('cloud');
}

function switchTab(tab) {
    if (tab === 'vps') {
        elements.tabVps.classList.add('active');
        elements.tabCloud.classList.remove('active');
        elements.vpsPanel.classList.remove('hidden');
        elements.r2Panel.classList.add('hidden');
    } else {
        elements.tabCloud.classList.add('active');
        elements.tabVps.classList.remove('active');
        elements.r2Panel.classList.remove('hidden');
        elements.vpsPanel.classList.add('hidden');
        loadR2Files();
    startDashboardPoll();
    }
}

function initR2() {
    elements.refreshR2Btn.onclick = loadR2Files;

    elements.r2UploadBtn.onclick = () => elements.r2UploadInput.click();
    elements.r2UploadInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        elements.r2UploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const res = await fetch(`${API_BASE}/storage/upload`, {
                method: 'POST',
                headers: { 'Authorization': SESSION_ID },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                showToast('Uploaded to Cloud!', 'success');
                loadR2Files();
            } else {
                throw new Error(data.error);
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
        elements.r2UploadBtn.innerHTML = '<i class="fas fa-upload"></i>';
        elements.r2UploadInput.value = ''; // Reset
    };
}

async function loadR2Files() {
    elements.r2Tree.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';

    try {
        const res = await fetch(`${API_BASE}/storage/list`, {
            headers: { 'Authorization': SESSION_ID }
        });
        const data = await res.json();

        if (data.files && data.files.length > 0) {
            elements.r2Tree.innerHTML = '';
            data.files.forEach(file => {
                const div = document.createElement('div');
                div.className = 'file-item cloud-file';
                div.innerHTML = `
                    <i class="fas fa-file-invoice"></i>
                    <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${file.key}</span>
                    <div class="actions">
                        <i class="fas fa-download" onclick="downloadR2('${file.key}')" title="Download"></i>
                        <i class="fas fa-trash" onclick="deleteR2('${file.key}')" title="Delete"></i>
                    </div>
                `;
                elements.r2Tree.appendChild(div);
            });
        } else {
            elements.r2Tree.innerHTML = '<div class="empty-state">No files in Cloud Storage</div>';
        }
    } catch (e) {
        elements.r2Tree.innerHTML = `<div class="term-line error">Error: ${e.message}</div>`;
    }
}

async function downloadR2(key) {
    try {
        const res = await fetch(`${API_BASE}/storage/download?key=${encodeURIComponent(key)}`, {
            headers: { 'Authorization': SESSION_ID }
        });
        if(res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = key;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            const d = await res.json();
            throw new Error(d.error);
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

window.downloadR2 = downloadR2; // Expose to global scope for HTML onclick

async function deleteR2(key) {
    if(!confirm(`Delete ${key}?`)) return;

    try {
        const res = await fetch(`${API_BASE}/storage/delete?key=${encodeURIComponent(key)}`, {
            method: 'DELETE',
            headers: { 'Authorization': SESSION_ID }
        });
        const data = await res.json();
        if(data.success) {
            showToast('Deleted', 'success');
            loadR2Files();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}
window.deleteR2 = deleteR2;


// Sidebar Logic
function toggleSidebar(sidebar) {
    sidebar.classList.toggle('active');
    elements.overlay.classList.toggle('hidden');
}
elements.toggleFilesBtn.onclick = () => toggleSidebar(elements.fileSidebar);
elements.toggleChatBtn.onclick = () => toggleSidebar(elements.chatSidebar);
elements.overlay.onclick = () => {
    elements.fileSidebar.classList.remove('active');
    elements.chatSidebar.classList.remove('active');
    elements.overlay.classList.add('hidden');
};
