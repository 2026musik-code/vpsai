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
            console.error('SSH Connection Error:', err);
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
        console.log('SSH Stream Ready. Executing:', command);
        conn.exec(command, (err, stream) => {
            if (err) {
                console.error('SSH Exec Error:', err);
                conn.end();
                onError(err);
                return;
            }
            stream.on('close', (code: any, signal: any) => {
                console.log('SSH Stream Closed');
                conn.end();
                onClose();
            }).on('data', (data: any) => {
                onData(data.toString());
            }).stderr.on('data', (data: any) => {
                onData(data.toString()); // Treat stderr as data for terminal
            });
        });
    }).on('error', (err) => {
        console.error('SSH Stream Connection Error:', err);
        onError(err);
    }).connect({
        host: session.ip,
        port: 22,
        username: session.user,
        password: session.pass,
        readyTimeout: 10000,
    });
}

export function listRemoteFiles(session: any, path: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                // Resolve path relative to home if it starts with ~
                let remotePath = path;
                if (path === '~' || path === '') remotePath = '.';
                // Note: sftp.readdir('.') usually lists the user's home dir.

                sftp.readdir(remotePath, (err, list) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    const files = list.map(item => {
                        const isDir = item.attrs.isDirectory();
                        return {
                            name: item.filename,
                            isDirectory: isDir,
                            path: (path === '~' || path === '.') ? item.filename : `${path}/${item.filename}`
                        };
                    });

                    files.sort((a, b) => {
                         if (a.isDirectory === b.isDirectory) {
                             return a.name.localeCompare(b.name);
                         }
                         return a.isDirectory ? -1 : 1;
                    });

                    conn.end();
                    resolve(files);
                });
            });
        }).on('error', (err) => {
            console.error('SFTP Error:', err);
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

export function readRemoteFile(session: any, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }
                sftp.readFile(path, (err, buffer) => {
                    conn.end();
                    if (err) return reject(err);
                    resolve(buffer.toString('utf8'));
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

export function writeRemoteFile(session: any, path: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }
                const buffer = Buffer.from(content, 'utf8');
                sftp.writeFile(path, buffer, (err) => {
                    conn.end();
                    if (err) return reject(err);
                    resolve();
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
