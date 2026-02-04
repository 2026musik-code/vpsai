const API_BASE = '/api';
let SESSION_TOKEN = null;
let CURRENT_PATH = '~';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const terminalOutput = document.getElementById('terminal-output');
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat');
const fileTree = document.getElementById('file-tree');

// --- LOGIN LOGIC ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ip = document.getElementById('vps-ip').value;
    const user = document.getElementById('vps-user').value;
    const pass = document.getElementById('vps-pass').value;
    const apiKey = document.getElementById('gemini-key').value;
    const model = document.getElementById('gemini-model').value;

    addToTerminal(`Connecting to ${user}@${ip}...`, 'system');

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, user, pass, apiKey, model })
        });

        const data = await res.json();
        if (data.success) {
            SESSION_TOKEN = data.token;
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            addToTerminal('Connected successfully!', 'system');
            loadFiles();
        } else {
            alert('Login failed: ' + data.error);
            addToTerminal('Login failed.', 'error');
        }
    } catch (err) {
        console.error(err);
        alert('Connection error');
    }
});

// --- CHAT & AI LOGIC (SSE STREAMING) ---
function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;

    // UI Updates
    appendMessage(text, 'user');
    chatInput.value = '';
    addToTerminal(`> AI Request: ${text}`, 'system');

    // Create EventSource connection
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
        addToTerminal(`$ ${e.data}`, 'system');
    });

    evtSource.addEventListener('output', (e) => {
        addToTerminal(e.data); // Stream output line by line
    });

    evtSource.addEventListener('error', (e) => {
        // e.data might be undefined for generic connection errors
        const msg = e.data || 'Connection error or stream ended';
        addToTerminal(msg, 'error');
        evtSource.close();
    });

    evtSource.addEventListener('done', (e) => {
        evtSource.close();
        // Refresh files if likely modified
        if (text.toLowerCase().includes('create') || text.toLowerCase().includes('delete')) {
            loadFiles();
        }
    });

    evtSource.onerror = (e) => {
        console.error("Stream error", e);
        evtSource.close();
    };
}

sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
    }
});

// --- FILE MANAGER LOGIC ---
async function loadFiles(path = '~') {
    fileTree.innerHTML = '<div class="item">Loading...</div>';
    try {
        const res = await fetch(`${API_BASE}/files?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': SESSION_TOKEN }
        });
        const data = await res.json();

        if (data.files) {
            fileTree.innerHTML = '';
            // Go up directory
            const upDiv = document.createElement('div');
            upDiv.className = 'file-item folder';
            upDiv.textContent = '..';
            upDiv.onclick = () => {
                CURRENT_PATH = path + '/..'; // Simplified, backend should handle normalization
                loadFiles(CURRENT_PATH);
            };
            fileTree.appendChild(upDiv);

            data.files.forEach(file => {
                const div = document.createElement('div');
                div.className = `file-item ${file.isDirectory ? 'folder' : 'file'}`;
                div.innerHTML = file.isDirectory ? `<i class="fas fa-folder"></i> ${file.name}` : `<i class="fas fa-file"></i> ${file.name}`;
                div.onclick = () => {
                    if (file.isDirectory) {
                        CURRENT_PATH = file.path;
                        loadFiles(file.path);
                    } else {
                        loadFileContent(file.path);
                    }
                };
                fileTree.appendChild(div);
            });
        }
    } catch (err) {
        fileTree.innerHTML = '<div class="item error">Failed to load files</div>';
    }
}

async function loadFileContent(path) {
    document.getElementById('current-file').textContent = path;
    try {
        const res = await fetch(`${API_BASE}/read?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': SESSION_TOKEN }
        });
        const data = await res.json();
        document.getElementById('code-editor').value = data.content || '';
    } catch (e) {
        alert('Could not read file');
    }
}

// --- UTILS ---
function addToTerminal(text, type = '') {
    // If text contains newlines, split them
    const lines = text.split('\n');
    lines.forEach(line => {
        if(line.trim() === '') return;
        const div = document.createElement('div');
        div.className = `terminal-line ${type}`;
        div.innerText = line;
        terminalOutput.appendChild(div);
    });
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.innerText = text;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Auto Install Button
document.getElementById('auto-install-btn').addEventListener('click', async () => {
    if(!confirm('This will run the setup_vps.sh script on the server. Continue?')) return;

    // We populate the input and trigger sendChat to use the SSE flow
    chatInput.value = "Setup the VPS environment for AI (Install Python, pip, venv)";
    sendChat();
});
