import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { encryptSession, decryptSession } from './security';
import { getGeminiResponse } from './gemini';

type Bindings = {
    SECRET_KEY: string;
    ASSETS: Fetcher;
    vpsai_kv: KVNamespace;
}

const app = new Hono<{ Bindings: Bindings }>();

// --- MIDDLEWARE ---
app.use('*', async (c, next) => {
    await next();
});

// --- SESSION MANAGEMENT ---

// 1. Create Session (Web calls this)
app.post('/api/session/create', async (c) => {
    const body = await c.req.json();
    const { apiKey, model } = body;

    if (!apiKey) return c.json({ error: 'API Key Required' }, 400);

    // Create a unique session ID (Token)
    // In a real app, use crypto.randomUUID()
    const sessionId = crypto.randomUUID();

    // Store session config in KV
    const sessionConfig = {
        apiKey,
        model,
        created: Date.now(),
        status: 'waiting' // waiting -> connected
    };

    // We use the sessionId as the token for simplicity in this demo
    // The Token sent to the Agent will be this sessionId
    await c.env.vpsai_kv.put(`session:${sessionId}`, JSON.stringify(sessionConfig), { expirationTtl: 86400 }); // 24h

    return c.json({ success: true, sessionId });
});

// 2. Poll Status (Web calls this)
app.get('/api/session/status', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'No Token' }, 401);

    const sessionData = await c.env.vpsai_kv.get(`session:${sessionId}`);
    if (!sessionData) return c.json({ status: 'invalid' });

    const session = JSON.parse(sessionData);

    // Check heartbeat
    const lastHeartbeat = await c.env.vpsai_kv.get(`agent:${sessionId}:heartbeat`);
    if (lastHeartbeat && (Date.now() - parseInt(lastHeartbeat) < 15000)) {
        if (session.status !== 'connected') {
            session.status = 'connected';
            await c.env.vpsai_kv.put(`session:${sessionId}`, JSON.stringify(session));
        }
    } else {
        if (session.status === 'connected') {
            session.status = 'offline'; // Was connected, now lost
            // Don't update KV immediately to avoid flickering, just return status
        }
    }

    return c.json({ status: session.status, lastHeartbeat });
});

// --- AGENT API (Called by VPS) ---

// Middleware to validate Agent Token
app.use('/api/agent/*', async (c, next) => {
    const token = c.req.header('Authorization');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    // The token IS the sessionId
    const sessionData = await c.env.vpsai_kv.get(`session:${token}`);
    if (!sessionData) return c.json({ error: 'Invalid Session' }, 401);

    c.set('sessionId', token);
    await next();
});

// 1. Agent Heartbeat / Task Poll
app.get('/api/agent/tasks', async (c) => {
    const sessionId = c.get('sessionId');

    // Update Heartbeat
    await c.env.vpsai_kv.put(`agent:${sessionId}:heartbeat`, Date.now().toString(), { expirationTtl: 60 });

    // Check for pending tasks
    const taskJson = await c.env.vpsai_kv.get(`agent:${sessionId}:task`);

    if (taskJson) {
        await c.env.vpsai_kv.delete(`agent:${sessionId}:task`);
        return c.json(JSON.parse(taskJson));
    }

    return c.json({});
});

// 2. Agent Result
app.post('/api/agent/result', async (c) => {
    const sessionId = c.get('sessionId');
    const body = await c.req.json();

    // Store result
    await c.env.vpsai_kv.put(`agent:${sessionId}:res:${body.id}`, JSON.stringify(body), { expirationTtl: 300 });
    return c.json({ success: true });
});


// --- WEB INTERACTION (Client -> Worker -> Agent) ---

// Helper: Run Task
async function runAgentTask(c: any, sessionId: string, action: string, payload: any): Promise<any> {
    const taskId = Date.now().toString() + Math.random().toString().slice(2,6);
    const task = { id: taskId, action, payload };

    await c.env.vpsai_kv.put(`agent:${sessionId}:task`, JSON.stringify(task));

    // Poll for result
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
        const resJson = await c.env.vpsai_kv.get(`agent:${sessionId}:res:${taskId}`);
        if (resJson) {
            await c.env.vpsai_kv.delete(`agent:${sessionId}:res:${taskId}`);
            return JSON.parse(resJson);
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error("Agent Timeout (Is the VPS connected?)");
}

// API: List Files
app.get('/api/files', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    const path = c.req.query('path') || '~';

    try {
        const res = await runAgentTask(c, sessionId, 'list', { path });
        if(res.success) return c.json({ files: res.data });
        else throw new Error(res.output);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Read File
app.get('/api/read', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    const path = c.req.query('path');
    if(!path) return c.json({ error: 'No path' }, 400);

    try {
        const res = await runAgentTask(c, sessionId, 'read', { path });
        if(res.success) return c.json({ content: res.data });
        else throw new Error(res.output);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Write File
app.post('/api/write', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { path, content } = body;

    try {
        const res = await runAgentTask(c, sessionId, 'write', { path, content });
        if(res.success) return c.json({ success: true });
        else throw new Error(res.output);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Chat (Streaming)
app.get('/api/chat-stream', async (c) => {
    const sessionId = c.req.query('token');
    const message = c.req.query('message');
    const currentPath = c.req.query('currentPath') || '~';

    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    // Get Session Config (for API Key)
    const sessionJson = await c.env.vpsai_kv.get(`session:${sessionId}`);
    if (!sessionJson) return c.json({ error: 'Session Expired' }, 401);
    const session = JSON.parse(sessionJson);

    return streamSSE(c, async (stream) => {
        try {
            // 1. Ask Gemini
            const aiResponse = await getGeminiResponse(session.apiKey, session.model, message!, currentPath);

            await stream.writeSSE({
                event: 'ai-response',
                data: aiResponse.text || "No response text generated.",
            });

            // 2. Execute Command
            if (aiResponse.command) {
                await stream.writeSSE({ event: 'command', data: aiResponse.command });
                try {
                    const res = await runAgentTask(c, sessionId, 'exec', { command: aiResponse.command });
                    await stream.writeSSE({ event: 'output', data: res.output });
                } catch (err: any) {
                    await stream.writeSSE({ event: 'error', data: err.message });
                }
            }
        } catch (e: any) {
            await stream.writeSSE({ event: 'error', data: e.message });
        }
        await stream.writeSSE({ event: 'done', data: 'ok' });
    });
});

export default app;

// Serve Static Assets (Must be last)
app.get('/*', async (c) => {
    return await c.env.ASSETS.fetch(c.req.raw);
});
