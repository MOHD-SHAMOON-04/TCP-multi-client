## How to Use:
1. Start the server:

```bash
node server.js
```

2. Start multiple clients:

```bash
# Terminal 1
node client.js system1 alice 192.168.1.8

# Terminal 2
node client.js system1 bob 192.168.1.8

# on another device (Terminal 1)
node client.js system2 charlie 192.168.1.8
```

1. Send messages:
   Broadcast (to all):
   ```
   > Hello everyone!
   ```
   Private message:
   ```
   > @system1.bob Hey Bob, private message!
   ```
   List clients:
   ```
   > list
   ```
   Show help:
   ```
   > help
   ```

New Features Added:
- Private Messaging: Use @clientId message format
- Client Listing: See all connected clients with list command
- Client Mapping: Server tracks clients by their full ID (system.client)
- Message Types:
  - private_message - Private messages between two clients
  - private_sent - Confirmation when private message is sent
  - client_list - List of all connected clients

Message Examples:
Private Message Request:
```json
{
  "type": "private_message",
  "target": "system1.bob",
  "content": "Hey Bob!"
}
```

Private Message Received:
```json
{
  "type": "private_message",
  "from": "system1.alice",
  "content": "Hey Bob!",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```
