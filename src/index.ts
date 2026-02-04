import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { streamSSE } from 'hono/streaming';
import { encryptSession, decryptSession } from './security';
import { runSSHCommand, listRemoteFiles, readRemoteFile, runSSHCommandStream } from './ssh';
import { getGeminiResponse } from './gemini';

type Bindings = {
    SECRET_KEY: string;
    ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Bindings }>();

// --- MIDDLEWARE ---

// Logger
app.use('*', async (c, next) => {
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
    await next();
});

// Rate Limiter (Simple In-Memory)
const rateLimit = new Map<string, number>();
app.use('*', async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const lastRequest = rateLimit.get(ip) || 0;

    // Limit to 1 request per second (rough)
    if (now - lastRequest < 500) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    rateLimit.set(ip, now);
    await next();
});

// Serve Static Assets
app.get('/*', serveStatic({ root: './' }));

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
        // 1. Ask Gemini
        try {
            const aiResponse = await getGeminiResponse(session.apiKey, session.model, message, currentPath);

            // Send AI Text
            await stream.writeSSE({
                event: 'ai-response',
                data: aiResponse.text,
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
                                data: err.message
                            });
                            resolve();
                        }
                    );
                });
            }
        } catch (e: any) {
            await stream.writeSSE({
                event: 'error',
                data: e.message
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

export default app;
