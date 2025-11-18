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
  }

  connect(systemId, clientId) {
    this.systemId = systemId;
    this.clientId = clientId;

    console.log(`Connecting to ${this.host}:${this.port}...`);

    this.socket = net.createConnection({
      host: this.host,
      port: this.port
    }, () => {
      console.log(`OK Connected to server as ${systemId}.${clientId}`);
      this.register();
    });

    this.socket.on('data', (data) => {
      this.handleServerMessage(data);
    });

    this.socket.on('close', () => {
      console.log('Disconnected from server');
      this.cleanup();
    });

    this.socket.on('error', (err) => {
      console.error('Connection error:', err.message);
    });

    this.setupCLI();
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
    const messages = data.toString().trim().split('\n');

    for (const message of messages) {
      if (message) {
        try {
          const parsed = JSON.parse(message);
          this.displayMessage(parsed);
        } catch (error) {
          console.log('Raw:', message);
        }
      }
    }
  }

  displayMessage(message) {
    const timestamp = new Date(message.timestamp).toLocaleTimeString();

    switch (message.type) {
      case 'welcome':
        console.log(`\n[${timestamp}] Server: ${message.message}`);
        break;

      case 'registered':
        this.registered = true;
        console.log(`\n[${timestamp}] OK ${message.message}`);
        this.showHelp();
        break;

      case 'chat_message':
        console.log(`\n[${timestamp}] [BROADCAST] ${message.from}: ${message.content}`);
        break;

      case 'private_message':
        console.log(`\n[${timestamp}] [PRIVATE from ${message.from}]: ${message.content}`);
        break;

      case 'private_sent':
        console.log(`\n[${timestamp}] OK Private message sent to ${message.to}: ${message.content}`);
        break;

      case 'client_list':
        this.connectedClients = message.clients;
        console.log(`\n[${timestamp}] # Connected clients (${message.clients.length}):`);
        message.clients.forEach(client => {
          console.log(`   ${client}`);
        });
        break;

      case 'client_joined':
        console.log(`\n[${timestamp}] -> ${message.message}`);
        break;

      case 'client_left':
        console.log(`\n[${timestamp}] <- ${message.message}`);
        break;

      case 'error':
        console.log(`\n[${timestamp}] Error: ${message.message}`);
        break;

      default:
        console.log(`\n[${timestamp}] Unknown:`, message);
    }

    if (this.rl) this.rl.prompt();
  }

  showHelp() {
    console.log('\nCommands:');
    console.log('  <message>              - Broadcast message to all');
    console.log('  @<client> <message>    - Send private message to specific client');
    console.log('  list                   - Show connected clients');
    console.log('  help                   - Show this help');
    console.log('  quit                   - Disconnect\n');
  }

  sendBroadcastMessage(content) {
    if (!this.registered) {
      console.log('Not registered yet. Please wait...');
      return;
    }

    const message = {
      type: 'message',
      content: content
    };
    this.sendMessage(message);
  }

  sendPrivateMessage(target, content) {
    if (!this.registered) {
      console.log('Not registered yet. Please wait...');
      return;
    }

    const message = {
      type: 'private_message',
      target: target,
      content: content
    };
    this.sendMessage(message);
  }

  requestClientList() {
    const message = {
      type: 'list_clients'
    };
    this.sendMessage(message);
  }

  sendMessage(messageObj) {
    if (this.socket && this.socket.writable) {
      this.socket.write(JSON.stringify(messageObj) + '\n');
    }
  }

  setupCLI() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

    this.rl.prompt();

    this.rl.on('line', (input) => {
      const trimmed = input.trim();

      if (trimmed === 'quit') {
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

      // Check for private message format: @client message
      const privateMatch = trimmed.match(/^@(\S+)\s+(.+)$/);
      if (privateMatch) {
        const [, target, content] = privateMatch;
        this.sendPrivateMessage(target, content);
        this.rl.prompt();
        return;
      }

      if (trimmed) {
        this.sendBroadcastMessage(trimmed);
      }

      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.disconnect();
    });
  }

  disconnect() {
    console.log('Disconnecting...');
    this.cleanup();
    process.exit(0);
  }

  cleanup() {
    if (this.rl) {
      this.rl.close();
    }
    if (this.socket) {
      this.socket.end();
    }
  }
}

// Command line usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node client.js <systemId> <clientId> [host] [port]');
    console.log('Examples:');
    console.log('  node client.js system1 client1');
    console.log('  node client.js system1 client2 192.168.1.100 8080');
    process.exit(1);
  }

  const systemId = args[0];
  const clientId = args[1];
  const host = args[2] || 'localhost';
  const port = parseInt(args[3]) || 8080;

  const client = new TCPClient(host, port);
  client.connect(systemId, clientId);
}