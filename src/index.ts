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

    // Reduced to 100ms to allow parallel requests (e.g. file list + chat)
    // and prevent false positives on rapid UI interactions.
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

// API: Chat (Streaming SSE)
app.get('/api/chat-stream', async (c) => {
    const session = c.get('session');
    const message = c.req.query('message');
    const currentPath = c.req.query('currentPath') || '~';

    if (!message) return c.json({ error: 'No message' }, 400);

    return streamSSE(c, async (stream) => {
        // Send initial heartbeat/status to confirm connection
        await stream.writeSSE({ event: 'status', data: 'Connecting to AI...' });

        try {
            // 1. Ask Gemini
            const aiResponse = await getGeminiResponse(session.apiKey, session.model, message, currentPath);

            // Send AI Text
            await stream.writeSSE({
                event: 'ai-response',
                data: aiResponse.text || "No response text generated.",
            });

            // 2. If Command, Execute
            if (aiResponse.command) {
                await stream.writeSSE({
                    event: 'command',
                    data: aiResponse.command,
                });

                await new Promise<void>((resolve) => {
                    runSSHCommandStream(
                        session,
                        aiResponse.command!,
                        async (data) => {
                           await stream.writeSSE({
                               event: 'output',
                               data: data
                           });
                        },
                        () => {
                            resolve();
                        },
                        async (err) => {
                            await stream.writeSSE({
                                event: 'error',
                                data: err.message || "SSH Error occurred"
                            });
                            resolve();
                        }
                    );
                });
            }
        } catch (e: any) {
            // Catch any unexpected top-level errors (like crypto failure, or ssh2 init failure)
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
