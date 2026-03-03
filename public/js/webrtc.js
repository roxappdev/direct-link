// WebRTC manager for P2P file sharing
class WebRTCManager {
    constructor(socket) {
        this.socket = socket;
        this.peerConnection = null;
        this.dataChannel = null;
        this.remotePeerId = null;
        this.filesQueue = [];
        this.currentFile = null;
        this.chunkSize = 16 * 1024; // 16KB chunks
        this.onFileReceived = null;
        this.onConnectionStateChange = null;
        this.onDataChannelStateChange = null;
        this.onProgress = null;
    }

    // Initialize peer connection
    init(remotePeerId) {
        this.remotePeerId = remotePeerId;
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        this.peerConnection = new RTCPeerConnection(config);

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal', {
                    to: this.remotePeerId,
                    signal: { type: 'candidate', candidate: event.candidate }
                });
            }
        };

        // Handle incoming data channel
        this.peerConnection.ondatachannel = (event) => {
            console.log('Incoming data channel');
            this.setupDataChannel(event.channel);
        };

        // Connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('Connection state:', state);
            if (this.onConnectionStateChange) {
                this.onConnectionStateChange(state);
            }
        };

        // ICE connection state
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);
        };
    }

    // Create a data channel for file transfer
    createDataChannel() {
        if (!this.peerConnection) return;
        this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
            ordered: true,
            maxRetransmits: 0
        });
        this.setupDataChannel(this.dataChannel);
    }

    // Setup data channel event handlers
    setupDataChannel(channel) {
        this.dataChannel = channel;
        channel.binaryType = 'arraybuffer';

        channel.onopen = () => {
            console.log('Data channel opened');
            if (this.onDataChannelStateChange) {
                this.onDataChannelStateChange('open');
            }
        };

        channel.onclose = () => {
            console.log('Data channel closed');
            if (this.onDataChannelStateChange) {
                this.onDataChannelStateChange('closed');
            }
        };

        channel.onerror = (error) => {
            console.error('Data channel error:', error);
        };

        channel.onmessage = (event) => {
            this.handleIncomingMessage(event.data);
        };
    }

    // Handle incoming messages (file chunks or metadata)
    handleIncomingMessage(data) {
        if (typeof data === 'string') {
            try {
                const message = JSON.parse(data);
                if (message.type === 'file-meta') {
                    this.receiveFileMetadata(message);
                } else if (message.type === 'file-end') {
                    this.finalizeFile();
                }
            } catch (e) {
                console.log('Text message:', data);
            }
        } else {
            // Binary data (file chunk)
            this.receiveFileChunk(data);
        }
    }

    // Send file metadata
    sendFileMetadata(file) {
        const metadata = {
            type: 'file-meta',
            name: file.name,
            size: file.size,
            mime: file.type,
            lastModified: file.lastModified
        };
        this.dataChannel.send(JSON.stringify(metadata));
    }

    // Receive file metadata
    receiveFileMetadata(meta) {
        this.currentFile = {
            name: meta.name,
            size: meta.size,
            mime: meta.mime,
            receivedSize: 0,
            chunks: []
        };
        console.log('Receiving file:', meta.name);
        if (this.onFileReceived) {
            this.onFileReceived(this.currentFile);
        }
    }

    // Send a file in chunks
    sendFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            let offset = 0;

            const readNext = () => {
                const slice = file.slice(offset, offset + this.chunkSize);
                reader.readAsArrayBuffer(slice);
            };

            reader.onload = (event) => {
                const chunk = event.target.result;
                this.dataChannel.send(chunk);
                offset += chunk.byteLength;

                if (this.onProgress) {
                    this.onProgress(offset, file.size);
                }

                if (offset < file.size) {
                    setTimeout(readNext, 0); // yield to UI
                } else {
                    // Send end marker
                    this.dataChannel.send(JSON.stringify({ type: 'file-end' }));
                    resolve();
                }
            };

            reader.onerror = reject;
            readNext();
        });
    }

    // Receive a file chunk
    receiveFileChunk(chunk) {
        if (!this.currentFile) return;
        this.currentFile.chunks.push(chunk);
        this.currentFile.receivedSize += chunk.byteLength;

        if (this.onProgress) {
            this.onProgress(this.currentFile.receivedSize, this.currentFile.size);
        }

        // If file is complete, finalize
        if (this.currentFile.receivedSize >= this.currentFile.size) {
            this.finalizeFile();
        }
    }

    // Finalize received file and trigger download
    finalizeFile() {
        if (!this.currentFile) return;
        const blob = new Blob(this.currentFile.chunks, { type: this.currentFile.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.currentFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('File downloaded:', this.currentFile.name);
        this.currentFile = null;
    }

    // Create offer
    async createOffer() {
        if (!this.peerConnection) return;
        this.createDataChannel();
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        return offer;
    }

    // Create answer
    async createAnswer() {
        if (!this.peerConnection) return;
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        return answer;
    }

    // Set remote description
    async setRemoteDescription(desc) {
        if (!this.peerConnection) return;
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(desc));
    }

    // Add ICE candidate
    async addIceCandidate(candidate) {
        if (!this.peerConnection) return;
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    // Close connection
    close() {
        if (this.dataChannel) {
            this.dataChannel.close();
        }
        if (this.peerConnection) {
            this.peerConnection.close();
        }
        this.peerConnection = null;
        this.dataChannel = null;
    }
}