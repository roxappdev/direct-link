// Main application with PeerJS
document.addEventListener('DOMContentLoaded', () => {
    let peer = null;
    let conn = null;
    let currentPeerId = null;
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

    // Initialize Peer
    function initPeer(peerId = null) {
        if (peer) peer.destroy();
        peer = new Peer(peerId, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            debug: 2
        });

        peer.on('open', (id) => {
            console.log('My peer ID is: ' + id);
            currentPeerId = id;
            peerIdEl.textContent = id;
        });

        peer.on('connection', (connection) => {
            console.log('Incoming connection from ' + connection.peer);
            handleConnection(connection);
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            alert('PeerJS error: ' + err.message);
        });
    }

    // Handle data connection
    function handleConnection(connection) {
        conn = connection;
        conn.on('open', () => {
            console.log('Data connection opened with ' + conn.peer);
            updateConnectionStatus(true, conn.peer);
            statusText.textContent = 'Ready to send files!';
        });
        conn.on('data', (data) => {
            handleIncomingData(data).catch(err => console.error('Error handling incoming data:', err));
        });
        conn.on('close', () => {
            console.log('Connection closed');
            updateConnectionStatus(false);
            alert('Peer disconnected.');
            conn = null;
        });
        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    }

    // Handle incoming data (file metadata or chunks)
    let receivingFile = null;
    let receivedChunks = [];
    let receivedSize = 0;
    let fileHandle = null;
    let fileWriter = null;
    let fileStream = null;

    async function handleIncomingData(data) {
        if (typeof data === 'string') {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'file-meta') {
                    receivingFile = {
                        name: msg.name,
                        size: msg.size,
                        mime: msg.mime,
                        receivedSize: 0,
                        chunks: []
                    };
                    receivedChunks = [];
                    receivedSize = 0;
                    console.log('Receiving file:', receivingFile.name);
                    addReceivedFile(receivingFile.name, receivingFile.size);

                    // Try to initiate streaming download via File System Access API
                    if ('showSaveFilePicker' in window) {
                        try {
                            fileHandle = await window.showSaveFilePicker({
                                suggestedName: receivingFile.name,
                                types: [{
                                    description: 'File',
                                    accept: { [receivingFile.mime || 'application/octet-stream']: ['*'] }
                                }]
                            });
                            fileStream = await fileHandle.createWritable();
                            fileWriter = fileStream.getWriter();
                            console.log('Streaming download started for', receivingFile.name);
                        } catch (err) {
                            console.warn('File System Access API not available or user canceled:', err);
                            fileHandle = null;
                            fileWriter = null;
                            fileStream = null;
                        }
                    }
                } else if (msg.type === 'file-end') {
                    if (receivingFile) {
                        // Finalize file
                        if (fileWriter) {
                            await fileWriter.close();
                            await fileStream.close();
                            console.log('File saved via streaming:', receivingFile.name);
                            fileWriter = null;
                            fileStream = null;
                            fileHandle = null;
                        } else {
                            // Fallback to blob download
                            const blob = new Blob(receivedChunks, { type: receivingFile.mime });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = receivingFile.name;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            console.log('File downloaded via blob:', receivingFile.name);
                        }
                        receivingFile = null;
                        receivedChunks = [];
                        receivedSize = 0;
                    }
                }
            } catch (e) {
                console.log('Text message:', data);
            }
        } else if (data instanceof ArrayBuffer) {
            // Binary chunk
            if (receivingFile) {
                if (fileWriter) {
                    // Write chunk to stream
                    await fileWriter.write(new Uint8Array(data));
                } else {
                    receivedChunks.push(data);
                }
                receivedSize += data.byteLength;
                const percent = receivingFile.size ? (receivedSize / receivingFile.size) * 100 : 0;
                showProgress(percent);
                if (receivedSize >= receivingFile.size) {
                    // Already handled by file-end
                }
            }
        }
    }

    // Send file metadata
    function sendFileMetadata(file) {
        if (!conn || !conn.open) {
            alert('Not connected to a peer.');
            return;
        }
        const metadata = {
            type: 'file-meta',
            name: file.name,
            size: file.size,
            mime: file.type,
            lastModified: file.lastModified
        };
        conn.send(JSON.stringify(metadata));
    }

    // Send file in chunks
    function sendFile(file) {
        return new Promise((resolve, reject) => {
            const chunkSize = 16 * 1024; // 16KB
            const reader = new FileReader();
            let offset = 0;

            const readNext = () => {
                const slice = file.slice(offset, offset + chunkSize);
                reader.readAsArrayBuffer(slice);
            };

            reader.onload = (event) => {
                const chunk = event.target.result;
                conn.send(chunk);
                offset += chunk.byteLength;
                const percent = file.size ? (offset / file.size) * 100 : 0;
                showProgress(percent);

                if (offset < file.size) {
                    setTimeout(readNext, 0);
                } else {
                    // Send end marker
                    conn.send(JSON.stringify({ type: 'file-end' }));
                    resolve();
                }
            };

            reader.onerror = reject;
            readNext();
        });
    }

    // Create room
    createRoomBtn.addEventListener('click', () => {
        initPeer(); // random ID
        roomInfo.classList.remove('hidden');
        statusText.textContent = 'Waiting for peer to join…';
        peerIdEl.textContent = 'Generating ID...';
        peer.on('open', (id) => {
            const url = `${window.location.origin}${window.location.pathname}?room=${id}`;
            roomLink.value = url;
            peerIdEl.textContent = id;
        });
    });

    // Join room
    joinRoomBtn.addEventListener('click', () => {
        const peerId = roomIdInput.value.trim();
        if (!peerId) {
            alert('Please enter a peer ID');
            return;
        }
        initPeer(); // we need our own peer ID
        joinStatus.classList.remove('hidden');
        peer.on('open', (myId) => {
            console.log('Connecting to ' + peerId);
            const connection = peer.connect(peerId, {
                reliable: true
            });
            connection.on('open', () => {
                joinStatus.classList.add('hidden');
                handleConnection(connection);
                alert(`Connected to peer ${peerId}`);
            });
            connection.on('error', (err) => {
                alert('Connection failed: ' + err.message);
                joinStatus.classList.add('hidden');
            });
        });
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
        if (!conn || !conn.open) {
            alert('Not connected to a peer. Please wait for connection.');
            return;
        }
        for (const file of selectedFiles) {
            try {
                sendFileMetadata(file);
                showProgress(0);
                await sendFile(file);
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

    // Check URL for room parameter
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        roomIdInput.value = roomParam;
        // Auto-join after a short delay to allow peer initialization
        setTimeout(() => {
            joinRoomBtn.click();
        }, 500);
    }
});