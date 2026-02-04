import { Client } from 'ssh2';

export function runSSHCommand(session: any, command: string): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }
                let stdout = '';
                let stderr = '';
                stream.on('close', (code: any, signal: any) => {
                    conn.end();
                    resolve({ stdout, stderr });
                }).on('data', (data: any) => {
                    stdout += data.toString();
                }).stderr.on('data', (data: any) => {
                    stderr += data.toString();
                });
            });
        }).on('error', (err) => {
            reject(err);
        }).connect({
            host: session.ip,
            port: 22,
            username: session.user,
            password: session.pass,
            readyTimeout: 10000,
        });
    });
}

// Streaming version for SSE
export function runSSHCommandStream(session: any, command: string, onData: (data: string) => void, onClose: () => void, onError: (err: any) => void) {
    const conn = new Client();
    conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
            if (err) {
                conn.end();
                onError(err);
                return;
            }
            stream.on('close', (code: any, signal: any) => {
                conn.end();
                onClose();
            }).on('data', (data: any) => {
                onData(data.toString());
            }).stderr.on('data', (data: any) => {
                onData(data.toString()); // Treat stderr as data for terminal
            });
        });
    }).on('error', (err) => {
        onError(err);
    }).connect({
        host: session.ip,
        port: 22,
        username: session.user,
        password: session.pass,
        readyTimeout: 10000,
    });
}

export async function listRemoteFiles(session: any, path: string) {
    // Simple ls parsing. In production, use SFTP.
    const cmd = `ls -F "${path}"`;
    const { stdout } = await runSSHCommand(session, cmd);

    // Parse output
    const lines = stdout.split('\n').filter(l => l.trim() !== '');
    const files = lines.map(line => {
        const isDir = line.endsWith('/');
        const name = isDir ? line.slice(0, -1) : line;
        return {
            name,
            isDirectory: isDir,
            path: path === '~' ? name : `${path}/${name}` // Naive path joining
        };
    });
    return files;
}

export async function readRemoteFile(session: any, path: string) {
    const cmd = `cat "${path}"`;
    const { stdout, stderr } = await runSSHCommand(session, cmd);
    if (stderr) throw new Error(stderr);
    return stdout;
}
