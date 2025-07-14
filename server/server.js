// server/server.js

// Add this block to the very top of your file to catch all unhandled errors
process.on('uncaughtException', err => {
  console.error('There was an uncaught error:', err);
  // This is a mandatory (as per the Node.js docs) step to prevent
  // the process from staying in a corrupted state.
  process.exit(1); 
});

const express       = require('express');
const http          = require('http');
const path          = require('path');
const { Server }    = require('socket.io');
const { createClient }  = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app    = express();
const server = http.createServer(app);

// Allow your production frontend origin (or default to localhost for dev)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ['GET','POST']
  }
});

// ─── Redis Adapter Setup ──────────────────────────────────────────────────────
// In dev, default to localhost. In prod, require REDIS_URL to be set.
const redisUrlDev = 'redis://localhost:6379';
const redisUrl = process.env.REDIS_URL || (process.env.NODE_ENV === 'development' ? redisUrlDev : null);

if (redisUrl) {
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  ;(async () => {
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));
    console.log('🗄️  Redis adapter connected to', redisUrl);
  })().catch(err => {
    console.error('🔴 Redis connection error:', err);
  });
} else {
  console.warn('⚠️ REDIS_URL not set; running without Redis adapter (in-memory only)');
}

// ─── Static Assets (if any) ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Pairing Logic ────────────────────────────────────────────────────────────
let waitingSocket = null;
const pairs = {};   // socket.id → peerId

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