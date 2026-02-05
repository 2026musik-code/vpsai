import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { encryptSession, decryptSession } from './security';
import { runSSHCommand, listRemoteFiles, readRemoteFile, writeRemoteFile, runSSHCommandStream } from './ssh';
import { getGeminiResponse } from './gemini';

type Bindings = {
    SECRET_KEY: string;
    ASSETS: Fetcher;
    vpsai_kv: KVNamespace;
}

const app = new Hono<{ Bindings: Bindings }>();

// --- MIDDLEWARE ---

// Logger
app.use('*', async (c, next) => {
    // console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
    await next();
});

// Rate Limiter (Simple In-Memory)
const rateLimit = new Map<string, number>();
app.use('*', async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const lastRequest = rateLimit.get(ip) || 0;

    if (now - lastRequest < 100) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    rateLimit.set(ip, now);
    await next();
});

// Serve Static Assets
app.get('/*', async (c) => {
    return await c.env.ASSETS.fetch(c.req.raw);
});

// API: Login (Create Session)
app.post('/api/login', async (c) => {
    const body = await c.req.json();
    const { ip, user, pass, apiKey, model } = body;

    if (!ip || !user || !pass || !apiKey) {
        return c.json({ success: false, error: 'Missing fields' }, 400);
    }

    const sessionData = { ip, user, pass, apiKey, model };
    const token = await encryptSession(sessionData, c.env.SECRET_KEY);

    return c.json({ success: true, token });
});

// Auth Middleware for /api/*
app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/login') return next();

    // For SSE, token might be in query param or header
    let token = c.req.header('Authorization');
    if (!token && c.req.query('token')) {
        token = c.req.query('token');
    }

    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const session = await decryptSession(token, c.env.SECRET_KEY);
    if (!session) return c.json({ error: 'Invalid Session' }, 401);

    c.set('session', session);
    await next();
});

// --- AGENT API (KV Based) ---

// Helper: Get Session ID (using IP as simple key for now, or hash of token)
// In a real app, use a unique ID per login. For now, IP is the "Machine".
function getAgentKey(session: any) {
    return `agent:${session.ip}`;
}

// 1. Poll Tasks (Agent calls this)
app.get('/api/agent/tasks', async (c) => {
    const session = c.get('session');
    const key = getAgentKey(session);

    // Update Heartbeat
    await c.env.vpsai_kv.put(`${key}:heartbeat`, Date.now().toString(), { expirationTtl: 60 }); // 1 min TTL

    // Check for pending command
    // We use a simple "one command at a time" queue for simplicity
    const cmdJson = await c.env.vpsai_kv.get(`${key}:cmd`);

    if (cmdJson) {
        // Delete it so it's only executed once
        await c.env.vpsai_kv.delete(`${key}:cmd`);
        return c.json(JSON.parse(cmdJson));
    }

    return c.json({}); // No tasks
});

// 2. Post Result (Agent calls this)
app.post('/api/agent/result', async (c) => {
    const session = c.get('session');
    const key = getAgentKey(session);
    const body = await c.req.json();

    // Store result
    // We assume the ID matches the pending command
    await c.env.vpsai_kv.put(`${key}:res`, JSON.stringify(body), { expirationTtl: 300 }); // 5 min TTL
    return c.json({ success: true });
});

// --- HELPER: Execute via Agent (Polling) ---
async function runAgentCommandStream(c: any, session: any, command: string, onData: (data: string) => void, onClose: () => void, onError: (err: any) => void) {
    const key = getAgentKey(session);
    const cmdId = Date.now().toString();

    // 1. Push Command
    const payload = { id: cmdId, command };
    await c.env.vpsai_kv.put(`${key}:cmd`, JSON.stringify(payload));

    // 2. Poll for Result
    // Wait up to 30 seconds
    const startTime = Date.now();
    let done = false;

    while (Date.now() - startTime < 30000 && !done) {
        const resJson = await c.env.vpsai_kv.get(`${key}:res`);
        if (resJson) {
            const res = JSON.parse(resJson);
            if (res.id === cmdId) {
                // Found our result
                if (res.output) onData(res.output);
                // Clear result
                await c.env.vpsai_kv.delete(`${key}:res`);
                done = true;
                onClose();
                return;
            }
        }
        // Wait 500ms
        await new Promise(r => setTimeout(r, 500));
    }

    if (!done) {
        onError(new Error("Agent execution timed out (Agent might be disconnected)"));
    }
}

// API: Chat (Streaming SSE)
app.get('/api/chat-stream', async (c) => {
    const session = c.get('session');
    const message = c.req.query('message');
    const currentPath = c.req.query('currentPath') || '~';
    const forceAgent = c.req.query('agent') === 'true'; // Allow forcing agent mode

    if (!message) return c.json({ error: 'No message' }, 400);

    return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'status', data: 'Connecting to AI...' });

        try {
            // Check if Agent is Active
            const key = getAgentKey(session);
            const lastHeartbeat = await c.env.vpsai_kv.get(`${key}:heartbeat`);
            const isAgentActive = lastHeartbeat && (Date.now() - parseInt(lastHeartbeat) < 15000); // 15s timeout

            if (isAgentActive) {
                 await stream.writeSSE({ event: 'status', data: 'Using VPS Agent (Stable Mode)' });
            }

            // 1. Ask Gemini
            const aiResponse = await getGeminiResponse(session.apiKey, session.model, message, currentPath);

            await stream.writeSSE({
                event: 'ai-response',
                data: aiResponse.text || "No response text generated.",
            });

            // 2. Execute Command
            if (aiResponse.command) {
                await stream.writeSSE({
                    event: 'command',
                    data: aiResponse.command,
                });

                if (isAgentActive || forceAgent) {
                    // Use Agent
                    await runAgentCommandStream(c, session, aiResponse.command!,
                        async (data) => stream.writeSSE({ event: 'output', data }),
                        () => {},
                        async (err) => stream.writeSSE({ event: 'error', data: err.message })
                    );
                } else {
                    // Use SSH Fallback
                    await new Promise<void>((resolve) => {
                        runSSHCommandStream(
                            session,
                            aiResponse.command!,
                            async (data) => {
                               await stream.writeSSE({ event: 'output', data });
                            },
                            () => { resolve(); },
                            async (err) => {
                                await stream.writeSSE({ event: 'error', data: err.message || "SSH Error occurred" });
                                resolve();
                            }
                        );
                    });
                }
            }
        } catch (e: any) {
            console.error('Stream Error:', e);
            await stream.writeSSE({
                event: 'error',
                data: e.message || 'Unknown server error'
            });
        }

        await stream.writeSSE({ event: 'done', data: 'ok' });
    });
});

// API: List Files
app.get('/api/files', async (c) => {
    const session = c.get('session');
    const path = c.req.query('path') || '~';

    // TODO: Implement Agent File Listing if needed. For now SSH fallback.
    try {
        const files = await listRemoteFiles(session, path);
        return c.json({ files });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Read File
app.get('/api/read', async (c) => {
    const session = c.get('session');
    const path = c.req.query('path');

    if(!path) return c.json({ error: 'No path' }, 400);

    try {
        const content = await readRemoteFile(session, path);
        return c.json({ content });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Write File
app.post('/api/write', async (c) => {
    const session = c.get('session');
    const body = await c.req.json();
    const { path, content } = body;

    if (!path || content === undefined) {
        return c.json({ error: 'Missing path or content' }, 400);
    }

    try {
        await writeRemoteFile(session, path, content);
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

export default app;
