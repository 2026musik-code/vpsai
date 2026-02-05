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

    saveBtn: document.getElementById('save-file'),
    refreshFilesBtn: document.getElementById('refresh-files'),
    disconnectBtn: document.getElementById('disconnect-btn')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
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

    btn.disabled = true;
    btn.innerHTML = 'Creating Session...';

    try {
        const res = await fetch(`${API_BASE}/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model })
        });
        const data = await res.json();

        if (data.success) {
            SESSION_ID = data.sessionId;
            localStorage.setItem('vpsai_session', SESSION_ID);

            elements.setupStep1.classList.add('hidden');
            elements.setupStep2.classList.remove('hidden');

            generateCommand(SESSION_ID);
            pollConnection();
        } else {
            alert(data.error);
            btn.disabled = false;
        }
    } catch (e) {
        alert('Error: ' + e.message);
        btn.disabled = false;
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

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

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
