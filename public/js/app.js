// Main application
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let webrtc = null;
    let currentRoom = null;
    let selectedFiles = [];
    let filesTransferred = 0;

    // DOM elements
    const createRoomBtn = document.getElementById('createRoomBtn');
    const roomInfo = document.getElementById('roomInfo');
    const roomLink = document.getElementById('roomLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const shareBtn = document.getElementById('shareBtn');
    const statusText = document.getElementById('statusText');
    const roomIdInput = document.getElementById('roomIdInput');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const joinStatus = document.getElementById('joinStatus');
    const fileInput = document.getElementById('fileInput');
    const sendFilesBtn = document.getElementById('sendFilesBtn');
    const fileList = document.getElementById('fileList');
    const peerIdEl = document.getElementById('peerId');
    const channelStatus = document.getElementById('channelStatus');
    const filesTransferredEl = document.getElementById('filesTransferred');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressContainer = document.querySelector('.progress-container');
    const receivedFiles = document.getElementById('receivedFiles');

    // Update UI helpers
    function updateConnectionStatus(connected, peer = null) {
        channelStatus.textContent = connected ? 'Online' : 'Offline';
        channelStatus.className = 'badge ' + (connected ? 'online' : 'offline');
        peerIdEl.textContent = peer || 'Not connected';
        if (connected) {
            statusText.textContent = 'Connected to peer';
            statusText.parentElement.className = 'status connecting';
        }
    }

    function updateFilesTransferred(count) {
        filesTransferred = count;
        filesTransferredEl.textContent = count;
    }

    function showProgress(percent) {
        progressContainer.classList.remove('hidden');
        progressBar.style.width = percent + '%';
        progressText.textContent = percent.toFixed(1) + '%';
    }

    function hideProgress() {
        progressContainer.classList.add('hidden');
    }

    function addReceivedFile(name, size) {
        const item = document.createElement('div');
        item.className = 'received-item';
        item.innerHTML = `
            <div>
                <i class="fas fa-file-download"></i>
                <strong>${name}</strong> (${formatBytes(size)})
            </div>
            <span class="badge online">Received</span>
        `;
        receivedFiles.querySelector('.empty')?.remove();
        receivedFiles.appendChild(item);
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Create room
    createRoomBtn.addEventListener('click', () => {
        socket.emit('create-room');
    });

    // Join room
    joinRoomBtn.addEventListener('click', () => {
        const roomId = roomIdInput.value.trim();
        if (!roomId) {
            alert('Please enter a room ID');
            return;
        }
        socket.emit('join-room', roomId);
        joinStatus.classList.remove('hidden');
    });

    // Copy link
    copyLinkBtn.addEventListener('click', () => {
        roomLink.select();
        document.execCommand('copy');
        alert('Link copied to clipboard!');
    });

    // Share via WhatsApp
    shareBtn.addEventListener('click', () => {
        const text = `Join me for direct file sharing: ${roomLink.value}`;
        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    });

    // File selection
    fileInput.addEventListener('change', () => {
        selectedFiles = Array.from(fileInput.files);
        fileList.innerHTML = '';
        selectedFiles.forEach((file, idx) => {
            const div = document.createElement('div');
            div.className = 'file-item';
            div.innerHTML = `
                <div>
                    <i class="fas fa-file"></i>
                    ${file.name} (${formatBytes(file.size)})
                </div>
                <button class="btn icon remove-file" data-index="${idx}">
                    <i class="fas fa-times"></i>
                </button>
            `;
            fileList.appendChild(div);
        });
        sendFilesBtn.disabled = selectedFiles.length === 0;

        // Remove file buttons
        document.querySelectorAll('.remove-file').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.closest('button').dataset.index);
                selectedFiles.splice(idx, 1);
                fileInput.value = '';
                e.target.closest('.file-item').remove();
                sendFilesBtn.disabled = selectedFiles.length === 0;
            });
        });
    });

    // Send files
    sendFilesBtn.addEventListener('click', async () => {
        if (!webrtc || !webrtc.dataChannel || webrtc.dataChannel.readyState !== 'open') {
            alert('Not connected to a peer. Please wait for connection.');
            return;
        }
        for (const file of selectedFiles) {
            try {
                webrtc.sendFileMetadata(file);
                showProgress(0);
                await webrtc.sendFile(file);
                updateFilesTransferred(filesTransferred + 1);
                hideProgress();
            } catch (err) {
                console.error('Error sending file:', err);
                alert(`Failed to send ${file.name}: ${err.message}`);
            }
        }
        selectedFiles = [];
        fileList.innerHTML = '';
        sendFilesBtn.disabled = true;
    });

    // Socket events
    socket.on('room-created', (roomId) => {
        currentRoom = roomId;
        const url = `${window.location.origin}/?room=${roomId}`;
        roomLink.value = url;
        roomInfo.classList.remove('hidden');
        statusText.textContent = 'Waiting for peer to join…';
        peerIdEl.textContent = 'Waiting…';
    });

    socket.on('room-joined', (roomId) => {
        currentRoom = roomId;
        joinStatus.classList.add('hidden');
        alert(`Joined room ${roomId}. Establishing peer connection...`);
    });

    socket.on('peer-joined', (peerId) => {
        console.log('Peer joined:', peerId);
        statusText.textContent = 'Peer joined, negotiating connection...';
        // Initialize WebRTC as offerer
        webrtc = new WebRTCManager(socket);
        webrtc.init(peerId);
        webrtc.onConnectionStateChange = (state) => {
            console.log('Connection state:', state);
            if (state === 'connected') {
                updateConnectionStatus(true, peerId);
            }
        };
        webrtc.onDataChannelStateChange = (state) => {
            console.log('Data channel state:', state);
            if (state === 'open') {
                updateConnectionStatus(true, peerId);
                statusText.textContent = 'Ready to send files!';
            }
        };
        webrtc.onFileReceived = (fileMeta) => {
            console.log('Receiving file:', fileMeta.name);
            addReceivedFile(fileMeta.name, fileMeta.size);
        };
        webrtc.onProgress = (loaded, total) => {
            const percent = total ? (loaded / total) * 100 : 0;
            showProgress(percent);
        };

        // Create offer
        webrtc.createOffer().then(offer => {
            socket.emit('signal', { to: peerId, signal: offer });
        });
    });

    socket.on('signal', async ({ from, signal }) => {
        if (!webrtc) {
            // We are the answerer
            webrtc = new WebRTCManager(socket);
            webrtc.init(from);
            webrtc.onConnectionStateChange = (state) => {
                if (state === 'connected') {
                    updateConnectionStatus(true, from);
                }
            };
            webrtc.onDataChannelStateChange = (state) => {
                if (state === 'open') {
                    updateConnectionStatus(true, from);
                    statusText.textContent = 'Ready to send files!';
                }
            };
            webrtc.onFileReceived = (fileMeta) => {
                addReceivedFile(fileMeta.name, fileMeta.size);
            };
            webrtc.onProgress = (loaded, total) => {
                const percent = total ? (loaded / total) * 100 : 0;
                showProgress(percent);
            };
        }

        if (signal.type === 'offer') {
            await webrtc.setRemoteDescription(signal);
            const answer = await webrtc.createAnswer();
            socket.emit('signal', { to: from, signal: answer });
        } else if (signal.type === 'answer') {
            await webrtc.setRemoteDescription(signal);
        } else if (signal.type === 'candidate') {
            await webrtc.addIceCandidate(signal.candidate);
        }
    });

    socket.on('error', (msg) => {
        alert('Error: ' + msg);
    });

    socket.on('peer-left', (peerId) => {
        alert(`Peer ${peerId} disconnected.`);
        updateConnectionStatus(false);
        if (webrtc) webrtc.close();
        webrtc = null;
    });

    // Check URL for room parameter
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        roomIdInput.value = roomParam;
        joinRoomBtn.click();
    }
});