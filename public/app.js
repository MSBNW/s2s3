document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const startBtn = document.getElementById('start-btn');
    const muteBtn = document.getElementById('mute-btn');
    const statusLight = document.getElementById('status-light');
    const statusText = document.getElementById('status-text');
    const conversation = document.getElementById('conversation');

    // Audio context and processing variables
    let audioContext;
    let mediaStream;
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let isMuted = false;
    let socket;
    let audioQueue = [];
    let isPlaying = false;

    // Initialize socket connection
    function initializeSocket() {
        console.log('Initializing socket connection...');
        
        // Initialize socket with the same configuration that worked in the test page
        socket = io({
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        // Add a console log to show when the socket is created
        console.log('Socket object created');

        socket.on('connect', () => {
            updateStatus('ready', 'Connected');
            console.log('Connected to server', socket.id);
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            updateStatus('error', 'Connection error');
        });

        socket.on('disconnect', () => {
            updateStatus('error', 'Disconnected');
            console.log('Disconnected from server');
        });

        socket.on('transcription', (data) => {
            addMessage(data.text, data.role);
        });

        socket.on('audio', (data) => {
            console.log('Received audio data from server');
            try {
                // Convert base64 to ArrayBuffer
                const binaryString = atob(data.buffer);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                // Add to audio queue
                audioQueue.push(bytes.buffer);
                console.log(`Added ${len} bytes to audio queue. Queue size: ${audioQueue.length}`);
                
                // Start playing if not already playing
                if (!isPlaying) {
                    console.log('Starting audio playback');
                    playNextAudio();
                }
            } catch (error) {
                console.error('Error processing audio data from server:', error);
            }
        });

        socket.on('agentFinishedSpeaking', () => {
            updateStatus('listening', 'Listening');
        });

        socket.on('error', (data) => {
            console.error('Server error:', data.message);
            updateStatus('error', 'Error: ' + data.message);
        });
    }

    // Initialize audio context and request microphone access
    async function initializeAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            console.log('Requesting microphone access...');
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            console.log('Microphone access granted');
            
            // Try different MIME types
            const mimeTypes = [
                'audio/webm',
                'audio/webm;codecs=opus',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
            
            let options = {};
            
            // Find a supported MIME type
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    console.log(`Using MIME type: ${type}`);
                    options = { mimeType: type };
                    break;
                }
            }
            
            console.log('Creating MediaRecorder...');
            mediaRecorder = new MediaRecorder(mediaStream, options);
            console.log('MediaRecorder created successfully');
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && !isMuted) {
                    audioChunks.push(event.data);
                    
                    // Convert to base64 and send to server
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = reader.result.split(',')[1];
                        if (socket && socket.connected) {
                            console.log(`Sending ${event.data.size} bytes of audio data`);
                            socket.emit('audioData', { buffer: base64data });
                        } else {
                            console.warn('Socket not connected, cannot send audio data');
                        }
                    };
                    reader.readAsDataURL(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                audioChunks = [];
            };
            
            return true;
        } catch (error) {
            console.error('Error initializing audio:', error);
            updateStatus('error', 'Microphone access denied');
            return false;
        }
    }

    // Start recording audio
    function startRecording() {
        if (!mediaRecorder || isRecording) return;
        
        audioChunks = [];
        mediaRecorder.start(100); // Collect data every 100ms
        isRecording = true;
        updateStatus('listening', 'Listening');
        
        // Enable mute button
        muteBtn.disabled = false;
        
        // Change start button to stop
        startBtn.textContent = 'End Conversation';
        
        // Tell the server to start the conversation
        socket.emit('startConversation');
    }

    // Stop recording audio
    function stopRecording() {
        if (!mediaRecorder || !isRecording) return;
        
        mediaRecorder.stop();
        isRecording = false;
        updateStatus('ready', 'Ready');
        
        // Disable mute button
        muteBtn.disabled = true;
        isMuted = false;
        muteBtn.textContent = 'Mute Microphone';
        
        // Change stop button back to start
        startBtn.textContent = 'Start Conversation';
        
        // Close the socket connection
        if (socket) {
            socket.disconnect();
        }
        
        // Stop the media stream
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
    }

    // Toggle mute
    function toggleMute() {
        isMuted = !isMuted;
        muteBtn.textContent = isMuted ? 'Unmute Microphone' : 'Mute Microphone';
    }

    // Play audio from the agent
    async function playNextAudio() {
        if (audioQueue.length === 0) {
            isPlaying = false;
            updateStatus('listening', 'Listening');
            return;
        }
        
        isPlaying = true;
        updateStatus('speaking', 'Agent Speaking');
        
        const audioBuffer = audioQueue.shift();
        
        try {
            console.log('Decoding audio data...');
            // Decode the audio data
            const decodedData = await audioContext.decodeAudioData(audioBuffer);
            
            // Create a buffer source
            const source = audioContext.createBufferSource();
            source.buffer = decodedData;
            source.connect(audioContext.destination);
            
            console.log('Playing audio...');
            // Play the audio
            source.start(0);
            
            // When finished, play the next audio in queue
            source.onended = () => {
                console.log('Audio playback finished');
                playNextAudio();
            };
        } catch (error) {
            console.error('Error playing audio:', error);
            // Log more details about the error
            console.error('Error details:', error.message);
            console.error('Audio buffer type:', typeof audioBuffer);
            console.error('Audio buffer size:', audioBuffer.byteLength);
            
            // Skip to next audio
            playNextAudio();
        }
    }

    // Add a message to the conversation
    function addMessage(text, role) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        messageDiv.classList.add(role === 'user' ? 'user-message' : 'agent-message');
        messageDiv.textContent = text;
        
        conversation.appendChild(messageDiv);
        
        // Scroll to bottom
        conversation.scrollTop = conversation.scrollHeight;
    }

    // Update the status indicator
    function updateStatus(state, message) {
        statusLight.className = 'status-light';
        statusLight.classList.add(state);
        statusText.textContent = message;
    }

    // Event listeners
    startBtn.addEventListener('click', async () => {
        console.log('Start button clicked');
        if (!isRecording) {
            // Initialize if first time
            if (!socket) {
                console.log('No socket, initializing...');
                initializeSocket();
            } else {
                console.log('Reconnecting existing socket...');
                socket.connect();
            }
            
            if (!mediaRecorder) {
                const initialized = await initializeAudio();
                if (!initialized) return;
            }
            
            startRecording();
        } else {
            stopRecording();
        }
    });

    muteBtn.addEventListener('click', toggleMute);

    // Initial status
    updateStatus('ready', 'Ready');
});
