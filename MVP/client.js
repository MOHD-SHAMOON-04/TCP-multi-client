const net = require('net');
const readline = require('readline');

class TCPClient {
    constructor(host = 'localhost', port = 8080) {
        this.host = host;
        this.port = port;
        this.socket = null;
        this.systemId = null;
        this.clientId = null;
        this.registered = false;
        this.rl = null;
        this.connectedClients = [];
        this.buffer = ''; // Buffer for incomplete messages
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000; // 3 seconds
        this.isManualDisconnect = false;
    }

    connect(systemId, clientId) {
        this.systemId = systemId;
        this.clientId = clientId;

        console.log(`\n[${this.getTimestamp()}] Connecting to ${this.host}:${this.port}...`);

        this.socket = net.createConnection({
            host: this.host,
            port: this.port
        }, () => {
            console.log(`[${this.getTimestamp()}] ✓ Connected to server`);
            this.reconnectAttempts = 0;
            this.register();
        });

        // Set encoding and keep-alive
        this.socket.setEncoding('utf8');
        this.socket.setKeepAlive(true, 60000);
        this.socket.setTimeout(300000); // 5 minute timeout

        this.socket.on('data', (data) => {
            this.handleServerMessage(data);
        });

        this.socket.on('close', () => {
            console.log(`\n[${this.getTimestamp()}] Disconnected from server`);
            this.registered = false;
            
            if (!this.isManualDisconnect) {
                this.attemptReconnect();
            } else {
                this.cleanup();
            }
        });

        this.socket.on('timeout', () => {
            console.log(`\n[${this.getTimestamp()}] Connection timeout`);
            this.socket.end();
        });

        this.socket.on('error', (err) => {
            console.error(`\n[${this.getTimestamp()}] Connection error: ${err.message}`);
            if (err.code === 'ECONNREFUSED') {
                console.log('Server appears to be offline');
            }
        });

        this.setupCLI();
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log(`\n[${this.getTimestamp()}] Max reconnection attempts reached. Exiting...`);
            this.cleanup();
            process.exit(1);
            return;
        }

        this.reconnectAttempts++;
        console.log(`\n[${this.getTimestamp()}] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay/1000} seconds...`);

        setTimeout(() => {
            if (!this.isManualDisconnect) {
                this.connect(this.systemId, this.clientId);
            }
        }, this.reconnectDelay);
    }

    register() {
        const registerMessage = {
            type: 'register',
            systemId: this.systemId,
            clientId: this.clientId
        };
        this.sendMessage(registerMessage);
    }

    handleServerMessage(data) {
        // Append to buffer to handle partial messages
        this.buffer += data;

        // Process complete messages (delimited by newline)
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const message = this.buffer.substring(0, newlineIndex).trim();
            this.buffer = this.buffer.substring(newlineIndex + 1);

            if (message) {
                try {
                    const parsed = JSON.parse(message);
                    this.displayMessage(parsed);
                } catch (error) {
                    console.log(`\n[${this.getTimestamp()}] Parse error:`, error.message);
                    console.log('Raw:', message);
                }
            }
        }

        // Prevent buffer overflow
        if (this.buffer.length > 10000) {
            console.warn(`\n[${this.getTimestamp()}] Buffer overflow, clearing buffer`);
            this.buffer = '';
        }
    }

    displayMessage(message) {
        const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : this.getTimestamp();
        
        // Pause readline to prevent prompt interference
        if (this.rl) {
            this.rl.pause();
        }

        switch (message.type) {
            case 'welcome':
                console.log(`\n[${timestamp}] 🌐 Server: ${message.message}`);
                break;
            
            case 'registered':
                this.registered = true;
                console.log(`\n[${timestamp}] ✓ ${message.message}`);
                console.log(`[${timestamp}] Your ID: ${message.fullId}`);
                this.showHelp();
                break;
            
            case 'chat_message':
                console.log(`\n[${timestamp}] [BROADCAST] ${message.from}: ${message.content}`);
                break;
            
            case 'private_message':
                console.log(`\n[${timestamp}] [PRIVATE from ${message.from}]: ${message.content}`);
                break;
            
            case 'private_sent':
                console.log(`\n[${timestamp}] ✓ Private message sent to ${message.to}`);
                break;
            
            case 'client_list':
                this.connectedClients = message.clients;
                console.log(`\n[${timestamp}] Connected clients (${message.count}):`);
                if (message.clients.length === 0) {
                    console.log('   (No other clients connected)');
                } else {
                    message.clients.forEach((client, index) => {
                        console.log(`   ${index + 1}. ${client}`);
                    });
                }
                break;
            
            case 'client_joined':
                console.log(`\n[${timestamp}] =>  ${message.fullId} joined the chat`);
                break;
            
            case 'client_left':
                console.log(`\n[${timestamp}] <=  ${message.fullId} left the chat`);
                break;
            
            case 'pong':
                console.log(`\n[${timestamp}]  Pong received from server`);
                break;
            
            case 'server_shutdown':
                console.log(`\n[${timestamp}] Warning!! : ${message.message}`);
                break;
            
            case 'error':
                console.log(`\n[${timestamp}] Error! : ${message.message}`);
                break;
            
            default:
                console.log(`\n[${timestamp}] Undefined message type! :`, message);
        }
        
        // Resume readline and show prompt
        if (this.rl) {
            this.rl.resume();
            this.rl.prompt();
        }
    }

    showHelp() {
        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║                     COMMANDS                           ║');
        console.log('╠════════════════════════════════════════════════════════╣');
        console.log('║  <message>              - Broadcast to all clients     ║');
        console.log('║  @<client> <message>    - Private message to client    ║');
        console.log('║  list                   - Show connected clients       ║');
        console.log('║  ping                   - Test connection to server    ║');
        console.log('║  help                   - Show this help               ║');
        console.log('║  clear                  - Clear screen                 ║');
        console.log('║  quit / exit            - Disconnect                   ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');
    }

    sendBroadcastMessage(content) {
        if (!this.checkRegistered()) return;

        const message = {
            type: 'message',
            content: content
        };
        this.sendMessage(message);
    }

    sendPrivateMessage(target, content) {
        if (!this.checkRegistered()) return;

        const message = {
            type: 'private_message',
            target: target,
            content: content
        };
        this.sendMessage(message);
    }

    requestClientList() {
        if (!this.checkRegistered()) return;

        const message = {
            type: 'list_clients'
        };
        this.sendMessage(message);
    }

    sendPing() {
        const message = {
            type: 'ping'
        };
        this.sendMessage(message);
        console.log(`[${this.getTimestamp()}] Ping sent to server`);
    }

    checkRegistered() {
        if (!this.registered) {
            console.log(`\n[${this.getTimestamp()}] Error! : Not registered yet. Please wait for registration to complete...`);
            return false;
        }
        return true;
    }

    sendMessage(messageObj) {
        if (!this.socket || this.socket.destroyed || !this.socket.writable) {
            console.log(`\n[${this.getTimestamp()}] Error! : Not connected to server`);
            return false;
        }

        try {
            this.socket.write(JSON.stringify(messageObj) + '\n');
            return true;
        } catch (error) {
            console.error(`\n[${this.getTimestamp()}] Error! Error in sending message:`, error.message);
            return false;
        }
    }

    setupCLI() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `${this.systemId}.${this.clientId}> `,
            terminal: true
        });

        this.rl.prompt();

        this.rl.on('line', (input) => {
            const trimmed = input.trim();
            
            // Handle empty input
            if (!trimmed) {
                this.rl.prompt();
                return;
            }

            // Handle commands
            if (trimmed === 'quit' || trimmed === 'exit') {
                this.disconnect();
                return;
            }
            
            if (trimmed === 'list') {
                this.requestClientList();
                this.rl.prompt();
                return;
            }
            
            if (trimmed === 'help') {
                this.showHelp();
                this.rl.prompt();
                return;
            }

            if (trimmed === 'ping') {
                this.sendPing();
                this.rl.prompt();
                return;
            }

            if (trimmed === 'clear') {
                console.clear();
                this.rl.prompt();
                return;
            }
            
            // Check for private message format: @client message
            const privateMatch = trimmed.match(/^@(\S+)\s+(.+)$/);
            if (privateMatch) {
                const [, target, content] = privateMatch;
                this.sendPrivateMessage(target, content);
                this.rl.prompt();
                return;
            }
            
            // Send as broadcast message
            this.sendBroadcastMessage(trimmed);
            this.rl.prompt();
        });

        this.rl.on('close', () => {
            this.disconnect();
        });

        // Handle Ctrl+C
        this.rl.on('SIGINT', () => {
            this.rl.question('\nAre you sure you want to exit? (y/n) ', (answer) => {
                if (answer.match(/^y(es)?$/i)) {
                    this.disconnect();
                } else {
                    this.rl.prompt();
                }
            });
        });
    }

    disconnect() {
        console.log(`\n[${this.getTimestamp()}] Disconnecting...`);
        this.isManualDisconnect = true;
        this.cleanup();
        setTimeout(() => process.exit(0), 500);
    }

    cleanup() {
        this.registered = false;
        
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }

    getTimestamp() {
        return new Date().toLocaleTimeString();
    }
}

// Command line usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('Usage: node client.js <systemId> <clientId> [host] [port]');
        console.log('\nExamples:');
        console.log('  node client.js system1 client1');
        console.log('  node client.js system1 client2 192.168.1.100 8080');
        console.log('\nMulti-Client Example (4 systems with 4 clients each):');
        for (let sys = 1; sys <= 4; sys++) {
            for (let cli = 1; cli <= 4; cli++) {
                console.log(`  node client.js system${sys} client${cli}`);
            }
        }
        process.exit(1);
    }
    
    const systemId = args[0];
    const clientId = args[1];
    const host = args[2] || 'localhost';
    const port = parseInt(args[3]) || 8080;

    const client = new TCPClient(host, port);
    client.connect(systemId, clientId);
}

module.exports = TCPClient;