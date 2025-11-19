const net = require('net');

class TCPServer {
    constructor(port = 8080, host = '0.0.0.0') {
        this.port = port;
        this.host = host;
        this.clients = new Map(); // connectionId -> {socket, systemId, clientId, buffer}
        this.clientMap = new Map(); // "systemId.clientId" -> connectionId
        this.server = null;
    }

    start() {
        this.server = net.createServer((socket) => {
            const connectionId = `${socket.remoteAddress}:${socket.remotePort}`;
            console.log(`[${this.getTimestamp()}] Client connected: ${connectionId}`);
            
            // Set socket encoding and keep-alive
            socket.setEncoding('utf8');
            socket.setKeepAlive(true, 60000); // 60 second keep-alive
            socket.setTimeout(300000); // 5 minute timeout
            
            // Store client with message buffer for handling partial messages
            this.clients.set(connectionId, {
                socket: socket,
                systemId: null,
                clientId: null,
                registered: false,
                buffer: '' // Buffer for incomplete JSON messages
            });

            socket.on('data', (data) => {
                this.handleClientData(connectionId, data);
            });

            socket.on('close', () => {
                console.log(`[${this.getTimestamp()}] Client disconnected: ${connectionId}`);
                this.handleClientDisconnect(connectionId);
            });

            socket.on('timeout', () => {
                console.log(`[${this.getTimestamp()}] Client timeout: ${connectionId}`);
                socket.end();
            });

            socket.on('error', (err) => {
                console.error(`[${this.getTimestamp()}] Client error (${connectionId}):`, err.message);
                this.handleClientDisconnect(connectionId);
            });

            // Send welcome message
            this.sendToClient(connectionId, {
                type: 'welcome',
                message: 'Connected to Chat Server. Send {"type": "register", "systemId": "sys1", "clientId": "cli1"} to register.',
                timestamp: this.getTimestamp()
            });
        });

        this.server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${this.port} is already in use. Retrying in 3 seconds...`);
                setTimeout(() => {
                    this.server.close();
                    this.server.listen(this.port, this.host);
                }, 3000);
            } else {
                console.error('Server error:', err);
            }
        });

        this.server.listen(this.port, this.host, () => {
            console.log(`[${this.getTimestamp()}] Chat Server running on ${this.host}:${this.port}`);
            console.log('Waiting for clients to connect...\n');
        });

        // Set max connections (adjust based on your needs)
        this.server.maxConnections = 100;
    }

    handleClientData(connectionId, data) {
        const client = this.clients.get(connectionId);
        if (!client) return;

        // Append data to buffer to handle partial messages
        client.buffer += data;

        // Process complete messages (delimited by newline)
        let newlineIndex;
        while ((newlineIndex = client.buffer.indexOf('\n')) !== -1) {
            const message = client.buffer.substring(0, newlineIndex).trim();
            client.buffer = client.buffer.substring(newlineIndex + 1);

            if (message) {
                this.processMessage(connectionId, message);
            }
        }

        // Prevent buffer overflow
        if (client.buffer.length > 10000) {
            console.warn(`[${this.getTimestamp()}] Buffer overflow for ${connectionId}, clearing buffer`);
            client.buffer = '';
            this.sendToClient(connectionId, {
                type: 'error',
                message: 'Message too large or malformed',
                timestamp: this.getTimestamp()
            });
        }
    }

    processMessage(connectionId, message) {
        const client = this.clients.get(connectionId);
        if (!client) return;

        try {
            const parsed = JSON.parse(message);
            
            // Validate message structure
            if (!parsed.type) {
                throw new Error('Message type is required');
            }

            switch (parsed.type) {
                case 'register':
                    if (!parsed.systemId || !parsed.clientId) {
                        this.sendToClient(connectionId, {
                            type: 'error',
                            message: 'systemId and clientId are required for registration',
                            timestamp: this.getTimestamp()
                        });
                        return;
                    }
                    this.registerClient(connectionId, parsed.systemId, parsed.clientId);
                    break;
                
                case 'message':
                    if (!client.registered) {
                        this.sendToClient(connectionId, {
                            type: 'error',
                            message: 'You must register before sending messages',
                            timestamp: this.getTimestamp()
                        });
                        return;
                    }
                    if (!parsed.content) {
                        this.sendToClient(connectionId, {
                            type: 'error',
                            message: 'Message content is required',
                            timestamp: this.getTimestamp()
                        });
                        return;
                    }
                    this.broadcastMessage({
                        type: 'chat_message',
                        from: `${client.systemId}.${client.clientId}`,
                        content: parsed.content,
                        timestamp: this.getTimestamp()
                    }, connectionId);
                    break;
                
                case 'private_message':
                    if (!client.registered) {
                        this.sendToClient(connectionId, {
                            type: 'error',
                            message: 'You must register before sending messages',
                            timestamp: this.getTimestamp()
                        });
                        return;
                    }
                    if (!parsed.target || !parsed.content) {
                        this.sendToClient(connectionId, {
                            type: 'error',
                            message: 'target and content are required for private messages',
                            timestamp: this.getTimestamp()
                        });
                        return;
                    }
                    this.sendPrivateMessage(
                        connectionId,
                        `${client.systemId}.${client.clientId}`,
                        parsed.target,
                        parsed.content
                    );
                    break;
                
                case 'list_clients':
                    if (!client.registered) {
                        this.sendToClient(connectionId, {
                            type: 'error',
                            message: 'You must register before listing clients',
                            timestamp: this.getTimestamp()
                        });
                        return;
                    }
                    this.sendClientList(connectionId);
                    break;
                
                case 'ping':
                    this.sendToClient(connectionId, {
                        type: 'pong',
                        timestamp: this.getTimestamp()
                    });
                    break;
                
                default:
                    this.sendToClient(connectionId, {
                        type: 'error',
                        message: `Unknown message type: ${parsed.type}`,
                        timestamp: this.getTimestamp()
                    });
            }
        } catch (error) {
            console.error(`[${this.getTimestamp()}] Parse error from ${connectionId}:`, error.message);
            this.sendToClient(connectionId, {
                type: 'error',
                message: `Invalid JSON format: ${error.message}`,
                timestamp: this.getTimestamp()
            });
        }
    }

    registerClient(connectionId, systemId, clientId) {
        const client = this.clients.get(connectionId);
        if (!client) return;

        // Validate systemId and clientId format
        const idRegex = /^[a-zA-Z0-9_-]+$/;
        if (!idRegex.test(systemId) || !idRegex.test(clientId)) {
            this.sendToClient(connectionId, {
                type: 'error',
                message: 'systemId and clientId can only contain letters, numbers, underscores, and hyphens',
                timestamp: this.getTimestamp()
            });
            return;
        }

        const fullId = `${systemId}.${clientId}`;

        // Check for duplicate registration
        if (this.clientMap.has(fullId)) {
            const existingConnectionId = this.clientMap.get(fullId);
            if (existingConnectionId !== connectionId && this.clients.has(existingConnectionId)) {
                this.sendToClient(connectionId, {
                    type: 'error',
                    message: `Client ID ${fullId} is already registered. Choose a different ID.`,
                    timestamp: this.getTimestamp()
                });
                return;
            }
            // If same connection is re-registering, allow it
            this.clientMap.delete(fullId);
        }

        // Update client registration
        client.systemId = systemId;
        client.clientId = clientId;
        client.registered = true;
        this.clientMap.set(fullId, connectionId);

        console.log(`[${this.getTimestamp()}] Client registered: ${fullId} (${connectionId})`);
        
        this.sendToClient(connectionId, {
            type: 'registered',
            message: `Successfully registered as ${fullId}`,
            fullId: fullId,
            timestamp: this.getTimestamp()
        });

        // Send current client list
        this.sendClientList(connectionId);

        // Notify all other clients about new connection
        this.broadcastMessage({
            type: 'client_joined',
            systemId: systemId,
            clientId: clientId,
            fullId: fullId,
            message: `${fullId} joined the chat`,
            timestamp: this.getTimestamp()
        }, connectionId);
    }

    sendPrivateMessage(senderConnectionId, senderFullId, targetFullId, content) {
        const targetConnectionId = this.clientMap.get(targetFullId);
        
        if (!targetConnectionId || !this.clients.has(targetConnectionId)) {
            this.sendToClient(senderConnectionId, {
                type: 'error',
                message: `Client ${targetFullId} not found or offline`,
                timestamp: this.getTimestamp()
            });
            return;
        }

        // Don't allow sending to self
        if (senderFullId === targetFullId) {
            this.sendToClient(senderConnectionId, {
                type: 'error',
                message: 'Cannot send private message to yourself',
                timestamp: this.getTimestamp()
            });
            return;
        }

        // Send to target client
        const sent = this.sendToClient(targetConnectionId, {
            type: 'private_message',
            from: senderFullId,
            content: content,
            timestamp: this.getTimestamp()
        });

        if (sent) {
            // Send confirmation to sender
            this.sendToClient(senderConnectionId, {
                type: 'private_sent',
                to: targetFullId,
                content: content,
                timestamp: this.getTimestamp()
            });

            console.log(`[${this.getTimestamp()}] Private message: ${senderFullId} -> ${targetFullId}`);
        }
    }

    sendClientList(connectionId) {
        const clientList = Array.from(this.clientMap.keys()).sort();
        const clientDetails = clientList.map(fullId => {
            const connId = this.clientMap.get(fullId);
            const client = this.clients.get(connId);
            return {
                fullId: fullId,
                systemId: client?.systemId,
                clientId: client?.clientId
            };
        });

        this.sendToClient(connectionId, {
            type: 'client_list',
            clients: clientList,
            clientDetails: clientDetails,
            count: clientList.length,
            timestamp: this.getTimestamp()
        });
    }

    broadcastMessage(message, excludeConnectionId = null) {
        let sentCount = 0;
        for (const [connectionId, client] of this.clients) {
            if (client.registered && connectionId !== excludeConnectionId) {
                if (this.sendToClient(connectionId, message)) {
                    sentCount++;
                }
            }
        }
        return sentCount;
    }

    sendToClient(connectionId, messageObj) {
        const client = this.clients.get(connectionId);
        if (!client || !client.socket || client.socket.destroyed || !client.socket.writable) {
            return false;
        }

        try {
            client.socket.write(JSON.stringify(messageObj) + '\n');
            return true;
        } catch (error) {
            console.error(`[${this.getTimestamp()}] Error sending to ${connectionId}:`, error.message);
            return false;
        }
    }

    handleClientDisconnect(connectionId) {
        const client = this.clients.get(connectionId);
        if (client) {
            if (client.registered) {
                const fullId = `${client.systemId}.${client.clientId}`;
                this.clientMap.delete(fullId);
                
                // Notify all other clients
                this.broadcastMessage({
                    type: 'client_left',
                    systemId: client.systemId,
                    clientId: client.clientId,
                    fullId: fullId,
                    message: `${fullId} left the chat`,
                    timestamp: this.getTimestamp()
                }, connectionId);

                console.log(`[${this.getTimestamp()}] Unregistered: ${fullId}`);
            }
            
            // Clean up socket
            if (client.socket) {
                client.socket.destroy();
            }
            
            this.clients.delete(connectionId);
        }
    }

    getTimestamp() {
        return new Date().toISOString();
    }

    getStats() {
        return {
            totalConnections: this.clients.size,
            registeredClients: this.clientMap.size,
            timestamp: this.getTimestamp()
        };
    }

    stop() {
        console.log(`\n[${this.getTimestamp()}] Shutting down server...`);
        
        // Notify all clients
        this.broadcastMessage({
            type: 'server_shutdown',
            message: 'Server is shutting down',
            timestamp: this.getTimestamp()
        });

        // Close all client connections
        for (const [connectionId, client] of this.clients) {
            if (client.socket) {
                client.socket.end();
            }
        }

        // Close server
        if (this.server) {
            this.server.close(() => {
                console.log(`[${this.getTimestamp()}] Server stopped`);
            });
        }

        this.clients.clear();
        this.clientMap.clear();
    }
}

// Start server
if (require.main === module) {
    const port = parseInt(process.argv[2]) || 8080;
    const host = process.argv[3] || '0.0.0.0';

    const server = new TCPServer(port, host);
    server.start();

    // Display stats periodically
    setInterval(() => {
        const stats = server.getStats();
        console.log(`\n[${stats.timestamp}] Server Stats: ${stats.registeredClients} clients (${stats.totalConnections} total connections)`);
    }, 60000); // Every minute

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        server.stop();
        setTimeout(() => process.exit(0), 1000);
    });

    process.on('SIGTERM', () => {
        server.stop();
        setTimeout(() => process.exit(0), 1000);
    });
}

module.exports = TCPServer;