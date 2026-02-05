import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getGeminiResponse } from './gemini';

type Bindings = {
    ASSETS: Fetcher;
    vpsai_kv: KVNamespace;
    vpsai_r2: R2Bucket;
}

const app = new Hono<{ Bindings: Bindings, Variables: { sessionId: string } }>();

// --- MIDDLEWARE ---
app.use('*', async (c, next) => {
    await next();
});

// --- SESSION MANAGEMENT ---

// 1. Create Session (Web calls this)
app.post('/api/session/create', async (c) => {
    try {
        const body = await c.req.json();
        const { apiKey, model } = body;

        if (!apiKey) return c.json({ error: 'API Key Required' }, 400);

        // Create a unique session ID (Token)
        const sessionId = crypto.randomUUID();

        // Store session config in KV
        const sessionConfig = {
            apiKey,
            model,
            created: Date.now(),
            status: 'waiting' // waiting -> connected
        };

        try {
            await c.env.vpsai_kv.put(`session:${sessionId}`, JSON.stringify(sessionConfig), { expirationTtl: 86400 }); // 24h
        } catch (e: any) {
            console.error("KV Error:", e);
            return c.json({ error: `Server Configuration Error: KV Namespace not binding. (${e.message})` }, 500);
        }

        return c.json({ success: true, sessionId });
    } catch (e: any) {
        return c.json({ error: `Internal Error: ${e.message}` }, 500);
    }
});

// 2. Poll Status (Web calls this)
app.get('/api/session/status', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'No Token' }, 401);

    try {
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
                session.status = 'offline';
            }
        }

        return c.json({ status: session.status, lastHeartbeat });
    } catch (e: any) {
         return c.json({ error: "KV Error" }, 500);
    }
});

// --- AGENT API (Called by VPS) ---

// Middleware to validate Agent Token
app.use('/api/agent/*', async (c, next) => {
    const token = c.req.header('Authorization');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    try {
        const sessionData = await c.env.vpsai_kv.get(`session:${token}`);
        if (!sessionData) return c.json({ error: 'Invalid Session' }, 401);
    } catch (e) {
        return c.json({ error: 'KV Error' }, 500);
    }

    c.set('sessionId', token);
    await next();
});

// 1. Agent Heartbeat / Task Poll
app.get('/api/agent/tasks', async (c) => {
    const sessionId = c.get('sessionId');

    try {
        // Update Heartbeat (Throttled)
        const lastHeartbeat = await c.env.vpsai_kv.get(`agent:${sessionId}:heartbeat`);
        if (!lastHeartbeat || (Date.now() - parseInt(lastHeartbeat) > 30000)) {
             await c.env.vpsai_kv.put(`agent:${sessionId}:heartbeat`, Date.now().toString(), { expirationTtl: 60 });
        }

        // Check for pending tasks
        const taskJson = await c.env.vpsai_kv.get(`agent:${sessionId}:task`);

        if (taskJson) {
            await c.env.vpsai_kv.delete(`agent:${sessionId}:task`);
            return c.json(JSON.parse(taskJson));
        }
    } catch (e) {
        return c.json({ error: "KV Error" }, 500);
    }

    return c.json({});
});

// 2. Agent Result
app.post('/api/agent/result', async (c) => {
    const sessionId = c.get('sessionId');
    const body = await c.req.json();

    try {
        // Store result
        await c.env.vpsai_kv.put(`agent:${sessionId}:res:${body.id}`, JSON.stringify(body), { expirationTtl: 300 });
        return c.json({ success: true });
    } catch(e) {
        return c.json({ error: "KV Error" }, 500);
    }
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

// --- R2 STORAGE API ---

// API: List R2 Files
app.get('/api/storage/list', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    try {
        const list = await c.env.vpsai_r2.list();
        const files = list.objects.map(obj => ({
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded
        }));
        return c.json({ files });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Upload to R2
app.post('/api/storage/upload', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
        return c.json({ error: 'No file uploaded' }, 400);
    }

    try {
        await c.env.vpsai_r2.put(file.name, file);
        return c.json({ success: true });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Download from R2
app.get('/api/storage/download', async (c) => {
    const sessionId = c.req.header('Authorization');
    // Note: For direct browser downloads, checking headers might be tricky if using standard links.
    // For now, we enforce auth via header (fetch).
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    const key = c.req.query('key');
    if (!key) return c.json({ error: 'No key provided' }, 400);

    try {
        const object = await c.env.vpsai_r2.get(key);
        if (object === null) {
            return c.json({ error: 'Object Not Found' }, 404);
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);

        return new Response(object.body, {
            headers,
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// API: Delete from R2
app.delete('/api/storage/delete', async (c) => {
    const sessionId = c.req.header('Authorization');
    if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

    const key = c.req.query('key');
    if (!key) return c.json({ error: 'No key provided' }, 400);

    try {
        await c.env.vpsai_r2.delete(key);
        return c.json({ success: true });
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
    let session;
    try {
        const sessionJson = await c.env.vpsai_kv.get(`session:${sessionId}`);
        if (!sessionJson) return c.json({ error: 'Session Expired' }, 401);
        session = JSON.parse(sessionJson);
    } catch (e) {
        return c.json({ error: "KV Error" }, 500);
    }

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

// Serve Static Assets (Must be last)
app.get('/*', async (c) => {
    return await c.env.ASSETS.fetch(c.req.raw);
});

export default app;
