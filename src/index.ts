import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { encryptSession, decryptSession } from './security';
import { runSSHCommand, listRemoteFiles, readRemoteFile, writeRemoteFile, runSSHCommandStream, installAgentSSH } from './ssh';
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

// API: Login (Create Session & Bootstrap)
app.post('/api/login', async (c) => {
    const body = await c.req.json();
    const { ip, user, pass, apiKey, model } = body;

    if (!ip || !user || !pass || !apiKey) {
        return c.json({ success: false, error: 'Missing fields' }, 400);
    }

    const sessionData = { ip, user, pass, apiKey, model };
    const token = await encryptSession(sessionData, c.env.SECRET_KEY);

    // Bootstrap Agent
    // We try to install the agent via SSH. If it fails, we still return the token,
    // but the frontend might see "Agent Offline" and prompt for manual install.
    // The install is fire-and-forget to speed up login.
    const apiUrl = new URL(c.req.url).origin;

    // We don't await this because SSH might take a few seconds and we want instant login.
    // However, for the user to see "Connected via Agent" immediately, maybe we should await?
    // Let's await with a short timeout, or let it run in background (ctx.waitUntil).

    c.executionCtx.waitUntil((async () => {
        try {
            console.log("Attempting Agent Bootstrap via SSH...");
            await installAgentSSH(sessionData, apiUrl, token, apiUrl);
            console.log("Agent Bootstrap command sent.");
        } catch (e) {
            console.error("Agent Bootstrap Failed:", e);
        }
    })());

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

function getAgentKey(session: any) {
    return `agent:${session.ip}`;
}

// 1. Poll Tasks (Agent calls this)
app.get('/api/agent/tasks', async (c) => {
    const session = c.get('session');
    const key = getAgentKey(session);

    // Update Heartbeat
    await c.env.vpsai_kv.put(`${key}:heartbeat`, Date.now().toString(), { expirationTtl: 60 });

    // Check for pending command
    const taskJson = await c.env.vpsai_kv.get(`${key}:task`);

    if (taskJson) {
        await c.env.vpsai_kv.delete(`${key}:task`);
        return c.json(JSON.parse(taskJson));
    }

    return c.json({});
});

// 2. Post Result (Agent calls this)
app.post('/api/agent/result', async (c) => {
    const session = c.get('session');
    const key = getAgentKey(session);
    const body = await c.req.json();

    // Store result
    await c.env.vpsai_kv.put(`${key}:res:${body.id}`, JSON.stringify(body), { expirationTtl: 300 });
    return c.json({ success: true });
});

// --- HELPER: Execute via Agent ---
async function runAgentTask(c: any, session: any, action: string, payload: any): Promise<any> {
    const key = getAgentKey(session);
    const taskId = Date.now().toString() + Math.random().toString().slice(2,6);

    const task = { id: taskId, action, payload };
    await c.env.vpsai_kv.put(`${key}:task`, JSON.stringify(task));

    // Poll for result
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
        const resJson = await c.env.vpsai_kv.get(`${key}:res:${taskId}`);
        if (resJson) {
            await c.env.vpsai_kv.delete(`${key}:res:${taskId}`);
            return JSON.parse(resJson);
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error("Agent Timeout");
}

// API: Chat (Streaming SSE)
app.get('/api/chat-stream', async (c) => {
    const session = c.get('session');
    const message = c.req.query('message');
    const currentPath = c.req.query('currentPath') || '~';
    const forceAgent = c.req.query('agent') === 'true';

    if (!message) return c.json({ error: 'No message' }, 400);

    return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'status', data: 'Connecting to AI...' });

        try {
            // Check Agent Status
            const key = getAgentKey(session);
            const lastHeartbeat = await c.env.vpsai_kv.get(`${key}:heartbeat`);
            const isAgentActive = lastHeartbeat && (Date.now() - parseInt(lastHeartbeat) < 15000);

            if (isAgentActive) {
                 await stream.writeSSE({ event: 'status', data: 'Using VPS Agent' });
            } else {
                 await stream.writeSSE({ event: 'status', data: 'Agent Offline. Falling back to SSH.' });
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
                    // Agent Execution
                    try {
                        const res = await runAgentTask(c, session, 'exec', { command: aiResponse.command });
                        await stream.writeSSE({ event: 'output', data: res.output });
                    } catch (err: any) {
                        await stream.writeSSE({ event: 'error', data: err.message });
                    }
                } else {
                    // SSH Fallback
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

    // Try Agent First
    try {
        const key = getAgentKey(session);
        const lastHeartbeat = await c.env.vpsai_kv.get(`${key}:heartbeat`);
        if (lastHeartbeat && (Date.now() - parseInt(lastHeartbeat) < 15000)) {
            const res = await runAgentTask(c, session, 'list', { path });
            if(res.success) return c.json({ files: res.data });
            else throw new Error(res.output);
        }
    } catch (e) {
        // Fallback to SSH
    }

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

    // Try Agent First
    try {
        const key = getAgentKey(session);
        const lastHeartbeat = await c.env.vpsai_kv.get(`${key}:heartbeat`);
        if (lastHeartbeat && (Date.now() - parseInt(lastHeartbeat) < 15000)) {
            const res = await runAgentTask(c, session, 'read', { path });
            if(res.success) return c.json({ content: res.data });
            else throw new Error(res.output);
        }
    } catch (e) {
        // Fallback
    }

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

    // Try Agent First
    try {
        const key = getAgentKey(session);
        const lastHeartbeat = await c.env.vpsai_kv.get(`${key}:heartbeat`);
        if (lastHeartbeat && (Date.now() - parseInt(lastHeartbeat) < 15000)) {
            const res = await runAgentTask(c, session, 'write', { path, content });
            if(res.success) return c.json({ success: true });
            else throw new Error(res.output);
        }
    } catch (e) {
        // Fallback
    }

    try {
        await writeRemoteFile(session, path, content);
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

export default app;
