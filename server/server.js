const express       = require('express');
const http          = require('http');
const path          = require('path');
const { Server }    = require('socket.io');
const { createClient }  = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET','POST']
  }
});

// ─── Redis Adapter Setup ──────────────────────────────────────────────────────
const redisUrl  = process.env.REDIS_URL || 'redis://localhost:6379';
const pubClient = createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

;(async () => {
 await pubClient.connect();
 await subClient.connect();
  io.adapter(createAdapter(pubClient, subClient));
  console.log('🗄️  Redis adapter connected');
})().catch(err => {
  console.error('🔴 Redis connection error:', err);
});

// ─── Static Assets (if any) ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Pairing Logic ────────────────────────────────────────────────────────────
let waitingSocket = null;
const pairs = {};  // socket.id → peerId

io.on('connection', socket => {
  console.log(`🔌 ${socket.id} connected`);

  socket.on('join', () => {
    if (waitingSocket) {
      const peer = waitingSocket;
      waitingSocket = null;

      socket.emit('paired', { peerId: peer.id, initiator: true });
      peer.emit('paired',   { peerId: socket.id, initiator: false });

      pairs[socket.id] = peer.id;
      pairs[peer.id]   = socket.id;
    } else {
      waitingSocket = socket;
      socket.emit('waiting');
    }
  });

  socket.on('leave', () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partner-disconnected', { from: socket.id });
      delete pairs[socket.id];
      delete pairs[partnerId];
    }
    if (waitingSocket?.id === socket.id) {
      waitingSocket = null;
    }
  });

  socket.on('signal', ({ peerId, signal }) => {
    io.to(peerId).emit('signal', { peerId: socket.id, signal });
  });

  socket.on('disconnect', () => {
    console.log(`❌ ${socket.id} disconnected`);
    socket.emit('leave');
    if (waitingSocket?.id === socket.id) {
      waitingSocket = null;
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
});
