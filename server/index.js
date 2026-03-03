const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Store active rooms: roomId -> { peers: [socketId1, socketId2] }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Create a new room
  socket.on('create-room', () => {
    const roomId = uuidv4().substring(0, 8); // short ID for sharing
    rooms.set(roomId, { peers: [socket.id] });
    socket.join(roomId);
    socket.emit('room-created', roomId);
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  // Join an existing room
  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (room.peers.length >= 2) {
      socket.emit('error', 'Room is full (max 2 peers)');
      return;
    }
    room.peers.push(socket.id);
    socket.join(roomId);
    socket.emit('room-joined', roomId);

    // Notify the other peer that a new peer has joined
    socket.to(roomId).emit('peer-joined', socket.id);

    console.log(`Socket ${socket.id} joined room ${roomId}`);
  });

  // WebRTC signaling: offer, answer, ice candidate
  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  // File metadata (optional)
  socket.on('file-meta', ({ to, metadata }) => {
    io.to(to).emit('file-meta', { from: socket.id, metadata });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Remove from rooms
    for (const [roomId, room] of rooms.entries()) {
      const index = room.peers.indexOf(socket.id);
      if (index !== -1) {
        room.peers.splice(index, 1);
        if (room.peers.length === 0) {
          rooms.delete(roomId);
        } else {
          // Notify remaining peer
          socket.to(roomId).emit('peer-left', socket.id);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});