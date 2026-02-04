import { CompactEncrypt, compactDecrypt } from 'jose';

const ALG = 'dir';
const ENC = 'A256GCM';

// Helper to get key as Uint8Array
async function getSecretKey(envSecret: string): Promise<Uint8Array> {
    const secret = envSecret || 'default-insecure-secret-key-change-me-123';
    // Pad or truncate to 32 bytes for A256GCM if needed, or hash it.
    // Simple approach: Use Web Crypto to import.
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    // Hash it to ensure 32 bytes
    const hash = await crypto.subtle.digest('SHA-256', keyData);
    return new Uint8Array(hash);
}

export async function encryptSession(data: any, secret: string): Promise<string> {
    const key = await getSecretKey(secret);
    const encoder = new TextEncoder();
    const jwe = await new CompactEncrypt(encoder.encode(JSON.stringify(data)))
        .setProtectedHeader({ alg: ALG, enc: ENC })
        .encrypt(key);
    return jwe;
}

export async function decryptSession(token: string, secret: string): Promise<any> {
    try {
        const key = await getSecretKey(secret);
        const { plaintext } = await compactDecrypt(token, key);
        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(plaintext));
    } catch (e) {
        console.error('Decryption failed', e);
        return null;
    }
}
