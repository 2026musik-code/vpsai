const API_BASE = '/api';
let SESSION_TOKEN = null;
let CURRENT_PATH = '~';

// DOM Elements
const elements = {
    loginScreen: document.getElementById('login-screen'),
    dashboard: document.getElementById('dashboard'),
    loginForm: document.getElementById('login-form'),
    terminalOutput: document.getElementById('terminal-output'),
    chatHistory: document.getElementById('chat-history'),
    chatInput: document.getElementById('chat-input'),
    sendChatBtn: document.getElementById('send-chat'),
    fileTree: document.getElementById('file-tree'),
    currentFileLabel: document.getElementById('current-file'),
    codeEditor: document.getElementById('code-editor'),

    // UI Toggles
    toggleFilesBtn: document.getElementById('toggle-files'),
    toggleChatBtn: document.getElementById('toggle-chat'),
    fileSidebar: document.getElementById('file-sidebar'),
    chatSidebar: document.getElementById('chat-sidebar'),
    overlay: document.getElementById('sidebar-overlay'),

    // Status
    connectionStatus: document.getElementById('connection-status'),

    // Actions
    saveBtn: document.getElementById('save-file'),
    refreshFilesBtn: document.getElementById('refresh-files'),
    autoInstallBtn: document.getElementById('auto-install-btn'),
    disconnectBtn: document.getElementById('disconnect-btn')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

function checkSession() {
    const storedToken = localStorage.getItem('vpsai_token');
    if (storedToken) {
        logSystem('Found existing session, attempting to reconnect...', 'system');
        SESSION_TOKEN = storedToken;
        // Verify token by trying to load files
        // If it fails (401), we clear storage and show login
        fetch(`${API_BASE}/files?path=~`, {
            headers: { 'Authorization': SESSION_TOKEN }
        })
        .then(res => {
            if (res.ok) {
                restoreDashboard();
            } else {
                throw new Error('Session invalid');
            }
        })
        .catch(() => {
            localStorage.removeItem('vpsai_token');
            // Stay on login screen
        });
    }
}

function restoreDashboard() {
    elements.loginScreen.classList.remove('active');
    elements.loginScreen.classList.add('hidden');
    elements.dashboard.classList.remove('hidden');
    elements.dashboard.classList.add('active');
    logSystem('Session restored successfully.', 'success');
    showToast('Session Restored', 'success');
    loadFiles();
}

// --- UI INTERACTIONS ---
function toggleSidebar(sidebar) {
    const isActive = sidebar.classList.contains('active');
    // Close all
    elements.fileSidebar.classList.remove('active');
    elements.chatSidebar.classList.remove('active');
    elements.overlay.classList.add('hidden');

    if (!isActive) {
        sidebar.classList.add('active');
        elements.overlay.classList.remove('hidden');
    }
}

elements.toggleFilesBtn.addEventListener('click', () => toggleSidebar(elements.fileSidebar));
elements.toggleChatBtn.addEventListener('click', () => toggleSidebar(elements.chatSidebar));

elements.overlay.addEventListener('click', () => {
    elements.fileSidebar.classList.remove('active');
    elements.chatSidebar.classList.remove('active');
    elements.overlay.classList.add('hidden');
});

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

// Logger
function logSystem(message, type = 'system') {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `term-line ${type}`;
    div.innerHTML = `<span style="opacity:0.5">[${time}]</span> ${message}`;
    elements.terminalOutput.appendChild(div);
    elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;

    if (type === 'error') {
        showToast(message, 'error');
    }
}

// --- CORE LOGIC ---

// Login
elements.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = elements.loginForm.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Connecting...';
    btn.disabled = true;

    const ip = document.getElementById('vps-ip').value;
    const user = document.getElementById('vps-user').value;
    const pass = document.getElementById('vps-pass').value;
    const apiKey = document.getElementById('gemini-key').value;
    const model = document.getElementById('gemini-model').value;

    logSystem(`Initiating connection to ${user}@${ip}...`, 'system');

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, user, pass, apiKey, model })
        });

        const data = await res.json();
        if (data.success) {
            SESSION_TOKEN = data.token;
            localStorage.setItem('vpsai_token', SESSION_TOKEN);

            // Animation transition
            elements.loginScreen.style.opacity = '0';
            setTimeout(() => {
                elements.loginScreen.classList.remove('active');
                elements.loginScreen.classList.add('hidden');
                elements.dashboard.classList.remove('hidden');
                elements.dashboard.classList.add('active');
            }, 300);

            logSystem('Connection established successfully.', 'success');
            showToast('Connected to VPS', 'success');
            loadFiles();
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        console.error(err);
        logSystem(`Connection Failed: ${err.message}`, 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// Disconnect
elements.disconnectBtn.addEventListener('click', () => {
    if(confirm('Disconnect from server?')) {
        localStorage.removeItem('vpsai_token');
        location.reload();
    }
});

// Chat & SSE
function sendChat() {
    const text = elements.chatInput.value.trim();
    if (!text) return;

    appendMessage(text, 'user');
    elements.chatInput.value = '';
    logSystem(`> AI Request: ${text}`, 'system');

    connectSSE(text);
}

function connectSSE(text, retryCount = 0) {
    const params = new URLSearchParams({
        message: text,
        currentPath: CURRENT_PATH,
        token: SESSION_TOKEN
    });

    const evtSource = new EventSource(`${API_BASE}/chat-stream?${params.toString()}`);

    evtSource.addEventListener('ai-response', (e) => {
        appendMessage(e.data, 'ai');
    });

    evtSource.addEventListener('command', (e) => {
        logSystem(`$ ${e.data}`, 'system');
    });

    evtSource.addEventListener('output', (e) => {
        logSystem(e.data, 'output');
    });

    evtSource.addEventListener('error', (e) => {
        const msg = e.data || 'Stream ended.';
        logSystem(msg, 'error');
        evtSource.close();
    });

    evtSource.addEventListener('done', (e) => {
        evtSource.close();
        if (text.toLowerCase().includes('create') || text.toLowerCase().includes('delete') || text.toLowerCase().includes('touch') || text.toLowerCase().includes('mkdir')) {
            loadFiles(CURRENT_PATH);
        }
    });

    evtSource.onerror = (e) => {
        evtSource.close();
        // Simple auto-reconnect logic for network blips
        if (retryCount < 3) {
            logSystem(`Connection lost. Retrying (${retryCount + 1}/3)...`, 'system');
            setTimeout(() => connectSSE(text, retryCount + 1), 2000);
        } else {
             logSystem('Connection failed after multiple attempts. Please try again.', 'error');
        }
    };
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

    let avatarIcon = sender === 'user' ? 'fa-user' : 'fa-robot';

    div.innerHTML = `
        <div class="avatar"><i class="fas ${avatarIcon}"></i></div>
        <div class="bubble">${text.replace(/\n/g, '<br>')}</div>
    `;
    elements.chatHistory.appendChild(div);
    elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

// File Manager
async function loadFiles(path = '~') {
    elements.fileTree.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';
    document.getElementById('file-path-crumb').textContent = path;

    try {
        const res = await fetch(`${API_BASE}/files?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': SESSION_TOKEN }
        });

        if (res.status === 401) {
            // Token expired during usage
            localStorage.removeItem('vpsai_token');
            location.reload();
            return;
        }

        const data = await res.json();

        if (data.files) {
            elements.fileTree.innerHTML = '';

            // Parent Dir
            const upDiv = document.createElement('div');
            upDiv.className = 'file-item folder';
            upDiv.innerHTML = '<i class="fas fa-level-up-alt"></i> ..';
            upDiv.onclick = () => {
                const parts = CURRENT_PATH.split('/').filter(p => p !== '');
                parts.pop();
                CURRENT_PATH = parts.length === 0 ? '~' : parts.join('/');
                if(path === '~') CURRENT_PATH = '~'; // Keep at root
                loadFiles(CURRENT_PATH);
            };
            elements.fileTree.appendChild(upDiv);

            if (data.files.length === 0) {
                 elements.fileTree.innerHTML += '<div style="padding:10px; opacity:0.7">Empty Directory</div>';
            }

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
        } else if (data.error) {
            throw new Error(data.error);
        }
    } catch (err) {
        elements.fileTree.innerHTML = '<div class="term-line error">Failed to load files</div>';
        logSystem('Failed to fetch file list: ' + err.message, 'error');
    }
}

async function loadFileContent(path) {
    elements.currentFileLabel.textContent = path;
    elements.codeEditor.value = 'Loading...';
    try {
        const res = await fetch(`${API_BASE}/read?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': SESSION_TOKEN }
        });
        const data = await res.json();
        elements.codeEditor.value = data.content || '';
    } catch (e) {
        logSystem('Error reading file: ' + path, 'error');
        elements.codeEditor.value = '// Error reading file';
    }
}

elements.saveBtn.addEventListener('click', async () => {
    const path = elements.currentFileLabel.textContent;
    if (path.includes('No File')) return;

    const content = elements.codeEditor.value;
    const btn = elements.saveBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/write`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': SESSION_TOKEN
            },
            body: JSON.stringify({ path, content })
        });
        const data = await res.json();

        if (data.success) {
            logSystem(`Saved ${path} successfully.`, 'success');
            showToast('File Saved', 'success');
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        logSystem(`Failed to save file: ${err.message}`, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

elements.refreshFilesBtn.addEventListener('click', () => loadFiles(CURRENT_PATH));

elements.autoInstallBtn.addEventListener('click', () => {
    if(!confirm('This will install Python venv and tools. Continue?')) return;
    elements.chatInput.value = "Setup the VPS environment for AI (Install Python, pip, venv)";
    sendChat();
});
