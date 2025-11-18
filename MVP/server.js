const net = require('net');

class TCPServer {
  constructor(port = 8080, host = '0.0.0.0') {
    this.port = port;
    this.host = host;
    this.clients = new Map(); // connectionId -> {socket, systemId, clientId}
    this.clientMap = new Map(); // "systemId.clientId" -> connectionId
    this.server = null;
  }

  start() {
    this.server = net.createServer((socket) => {
      const connectionId = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(`Client connected: ${connectionId}`);

      // Store client temporarily until registration
      this.clients.set(connectionId, {
        socket: socket,
        systemId: null,
        clientId: null,
        registered: false
      });

      socket.on('data', (data) => {
        this.handleClientData(connectionId, data);
      });

      socket.on('close', () => {
        console.log(`Client disconnected: ${connectionId}`);
        const client = this.clients.get(connectionId);
        if (client && client.registered) {
          const fullId = `${client.systemId}.${client.clientId}`;
          this.clientMap.delete(fullId);

          this.broadcastMessage({
            type: 'client_left',
            systemId: client.systemId,
            clientId: client.clientId,
            message: `${fullId} left the chat`,
            timestamp: new Date().toISOString()
          }, connectionId);
        }
        this.clients.delete(connectionId);
      });

      socket.on('error', (err) => {
        console.error(`Client error (${connectionId}):`, err.message);
        this.clients.delete(connectionId);
      });

      // Send welcome message
      this.sendToClient(connectionId, {
        type: 'welcome',
        message: 'Connected to Chat Server. Send {"type": "register", "systemId": "sys1", "clientId": "cli1"} to register.',
        timestamp: new Date().toISOString()
      });
    });

    this.server.listen(this.port, this.host, () => {
      console.log(`Chat Server running on ${this.host}:${this.port}`);
      console.log('Waiting for clients to connect...\n');
    });
  }

  handleClientData(connectionId, data) {
    try {
      const message = data.toString().trim();
      const client = this.clients.get(connectionId);
      if (!client) return;

      const parsed = JSON.parse(message);

      switch (parsed.type) {
        case 'register':
          this.registerClient(connectionId, parsed.systemId, parsed.clientId);
          break;

        case 'message':
          if (client.registered) {
            this.broadcastMessage({
              type: 'chat_message',
              from: `${client.systemId}.${client.clientId}`,
              content: parsed.content,
              timestamp: new Date().toISOString()
            }, connectionId);
          }
          break;

        case 'private_message':
          if (client.registered) {
            this.sendPrivateMessage(
              connectionId,
              `${client.systemId}.${client.clientId}`,
              parsed.target,
              parsed.content
            );
          }
          break;

        case 'list_clients':
          if (client.registered) {
            this.sendClientList(connectionId);
          }
          break;

        default:
          this.sendToClient(connectionId, {
            type: 'error',
            message: 'Unknown message type',
            timestamp: new Date().toISOString()
          });
      }
    } catch (error) {
      this.sendToClient(connectionId, {
        type: 'error',
        message: 'Invalid JSON format',
        timestamp: new Date().toISOString()
      });
    }
  }

  registerClient(connectionId, systemId, clientId) {
    const client = this.clients.get(connectionId);
    if (!client) return;

    client.systemId = systemId;
    client.clientId = clientId;
    client.registered = true;

    const fullId = `${systemId}.${clientId}`;
    this.clientMap.set(fullId, connectionId);

    console.log(`Client registered: ${fullId}`);

    this.sendToClient(connectionId, {
      type: 'registered',
      message: `Successfully registered as ${fullId}`,
      timestamp: new Date().toISOString()
    });

    // Send current client list
    this.sendClientList(connectionId);

    // Notify all clients about new connection
    this.broadcastMessage({
      type: 'client_joined',
      systemId: systemId,
      clientId: clientId,
      message: `${fullId} joined the chat`,
      timestamp: new Date().toISOString()
    }, connectionId);
  }

  sendPrivateMessage(senderConnectionId, senderFullId, targetFullId, content) {
    const targetConnectionId = this.clientMap.get(targetFullId);

    if (!targetConnectionId) {
      this.sendToClient(senderConnectionId, {
        type: 'error',
        message: `Client ${targetFullId} not found or offline`,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Send to target client
    this.sendToClient(targetConnectionId, {
      type: 'private_message',
      from: senderFullId,
      content: content,
      timestamp: new Date().toISOString()
    });

    // Send confirmation to sender
    this.sendToClient(senderConnectionId, {
      type: 'private_sent',
      to: targetFullId,
      content: content,
      timestamp: new Date().toISOString()
    });

    console.log(`Private message: ${senderFullId} -> ${targetFullId}`);
  }

  sendClientList(connectionId) {
    const clientList = Array.from(this.clientMap.keys());
    this.sendToClient(connectionId, {
      type: 'client_list',
      clients: clientList,
      timestamp: new Date().toISOString()
    });
  }

  broadcastMessage(message, excludeConnectionId = null) {
    const messageStr = JSON.stringify(message);

    for (const [connectionId, client] of this.clients) {
      if (client.registered && connectionId !== excludeConnectionId) {
        this.sendToClient(connectionId, message);
      }
    }
  }

  sendToClient(connectionId, messageObj) {
    const client = this.clients.get(connectionId);
    if (client && client.socket.writable) {
      client.socket.write(JSON.stringify(messageObj) + '\n');
    }
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('Server stopped');
    }
  }
}

// Start server
const server = new TCPServer(8080, '0.0.0.0');
server.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.stop();
  process.exit(0);
});