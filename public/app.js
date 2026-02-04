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
        // Strip ANSI codes if needed, or simple render
        logSystem(e.data, 'output');
    });

    evtSource.addEventListener('error', (e) => {
        // This catches the specific "AI Gemini not connected" or network errors if the stream dies
        const msg = e.data || 'Connection lost or stream ended.';
        logSystem(msg, 'error');
        evtSource.close();
    });

    evtSource.addEventListener('done', (e) => {
        evtSource.close();
        if (text.toLowerCase().includes('create') || text.toLowerCase().includes('delete')) {
            loadFiles(CURRENT_PATH);
        }
    });

    evtSource.onerror = (e) => {
        // Generic network error
        logSystem('Stream connection error. Check your internet or VPS status.', 'error');
        evtSource.close();
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
        const data = await res.json();

        if (data.files) {
            elements.fileTree.innerHTML = '';

            // Parent Dir
            const upDiv = document.createElement('div');
            upDiv.className = 'file-item folder';
            upDiv.innerHTML = '<i class="fas fa-level-up-alt"></i> ..';
            upDiv.onclick = () => {
                CURRENT_PATH = path + '/..';
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

    // For now we don't have a save API endpoint in the provided context (implied),
    // but assuming one exists or we send a chat command to overwrite it.
    // Based on memory/context, the system might not have a direct 'write' endpoint,
    // usually we use the AI agent or a shell command.
    // BUT, usually a file manager implies write access.
    // I will check if I should implement a simple write or use AI.
    // Assuming standard API implementation for now or log a warning.

    // NOTE: The previous code had a "Save" button but no event listener implementation in the provided snippet!
    // I will implement a fetch call to `/api/write` if it exists, or just log.
    // Actually, looking at the previous plan, it wasn't specified. I will use the AI to save.

    logSystem('Saving file via AI Agent...', 'system');
    elements.chatInput.value = `Overwrite content of ${path} with:\n${content}`;
    sendChat();
});

elements.refreshFilesBtn.addEventListener('click', () => loadFiles(CURRENT_PATH));

elements.autoInstallBtn.addEventListener('click', () => {
    if(!confirm('This will install Python venv and tools. Continue?')) return;
    elements.chatInput.value = "Setup the VPS environment for AI (Install Python, pip, venv)";
    sendChat();
});
