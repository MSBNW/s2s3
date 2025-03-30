import express, { Request, Response } from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { mastra } from './mastra/index';
import { Readable } from 'stream';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve the main HTML page
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Handle socket connections
io.on('connection', async (socket: Socket) => {
  console.log('Client connected', socket.id);
  
  // Handle test message
  socket.on('testMessage', (data) => {
    console.log('Received test message:', data);
    socket.emit('message', { text: 'Server received your message', timestamp: Date.now() });
  });
  
  // Handle ping message
  socket.on('ping', (data) => {
    console.log('Received ping:', data);
    socket.emit('pong', { timestamp: Date.now(), echo: data });
  });

  try {
    console.log('Getting agent from mastra...');
    // Get the agent
    const agent = mastra.getAgent('assistantAgent');
    console.log('Agent retrieved:', agent.name);

    console.log('Checking voice capabilities...');
    if (!agent.voice) {
      throw new Error('Agent does not have voice capabilities');
    }
    console.log('Agent has voice capabilities');

    // Connect to the voice service
    console.log('Connecting to voice service...');
    await agent.voice.connect();
    console.log('Voice service connected successfully');

    // Set up audio processing
    const audioChunks: Int16Array[] = [];
    
    // Listen for agent audio responses and send them to the client (using both event names to be safe)
    const handleAudioData = (data: any) => {
      console.log('Agent is speaking', data);
      
      if (data.audio) {
        try {
          console.log('Audio data type:', typeof data.audio);
          console.log('Audio data instanceof Int16Array:', data.audio instanceof Int16Array);
          console.log('Audio data instanceof Buffer:', data.audio instanceof Buffer);
          console.log('Audio data has .on method:', typeof data.audio.on === 'function');
          
          // Handle different audio formats (Int16Array or ReadableStream)
          if (data.audio instanceof Int16Array) {
            // Convert Int16Array to base64 for transmission
            const buffer = Buffer.from(data.audio.buffer);
            console.log('Sending Int16Array audio data to client, size:', buffer.length);
            socket.emit('audio', { buffer: buffer.toString('base64') });
          } else if (data.audio.on && typeof data.audio.on === 'function') {
            // Handle as a readable stream
            console.log('Setting up readable stream handlers');
            data.audio.on('data', (chunk: Buffer) => {
              console.log('Received chunk from stream, size:', chunk.length);
              socket.emit('audio', { buffer: chunk.toString('base64') });
            });
            
            data.audio.on('end', () => {
              console.log('Agent finished speaking');
              socket.emit('agentFinishedSpeaking');
            });
          } else if (Buffer.isBuffer(data.audio)) {
            // Handle as a Buffer
            console.log('Sending Buffer audio data to client, size:', data.audio.length);
            socket.emit('audio', { buffer: data.audio.toString('base64') });
          } else if (ArrayBuffer.isView(data.audio)) {
            // Handle as an ArrayBuffer view
            const buffer = Buffer.from(data.audio.buffer, data.audio.byteOffset, data.audio.byteLength);
            console.log('Sending ArrayBuffer view audio data to client, size:', buffer.length);
            socket.emit('audio', { buffer: buffer.toString('base64') });
          } else {
            console.error('Unsupported audio format:', typeof data.audio);
            console.error('Audio data properties:', Object.keys(data.audio));
          }
        } catch (error) {
          console.error('Error processing audio data:', error);
        }
      } else {
        console.log('No audio data in speaking event');
      }
    };
    
    // Listen for 'speaking' event (newer API)
    agent.voice.on('speaking', handleAudioData);
    
    // Also listen for 'speaker' event (older API)
    agent.voice.on('speaker', (stream: any) => {
      console.log('Agent is speaking (speaker event)');
      if (stream) {
        try {
          console.log('Stream type:', typeof stream);
          console.log('Stream has pipe method:', typeof stream.pipe === 'function');
          
          // Handle as a readable stream
          stream.on('data', (chunk: Buffer) => {
            console.log('Received chunk from speaker stream, size:', chunk.length);
            socket.emit('audio', { buffer: chunk.toString('base64') });
          });
          
          stream.on('end', () => {
            console.log('Agent finished speaking (speaker event)');
            socket.emit('agentFinishedSpeaking');
          });
        } catch (error) {
          console.error('Error processing speaker stream:', error);
        }
      } else {
        console.log('No stream in speaker event');
      }
    });

    // Listen for transcribed text and send it to the client
    agent.voice.on('writing', (ev: { text: string; role: string }) => {
      console.log(`Transcription (${ev.role}): ${ev.text}`);
      socket.emit('transcription', { role: ev.role, text: ev.text });
    });

    // Handle errors from the voice provider
    agent.voice.on('error', (error: any) => {
      console.error('Voice error:', error);
      socket.emit('error', { message: 'Voice service error: ' + (error.message || 'Unknown error') });
    });

    // Create a transform stream to convert base64 audio data to Int16Array
    const audioBuffers: Buffer[] = [];
    
    // Create a readable stream for audio data
    const audioStream = new Readable({
      read() {} // No-op implementation required for Readable streams
    });

    // Receive audio data from the client
    socket.on('audioData', async (data: { buffer: string }) => {
      try {
        console.log('Received audio data from client');
        const chunk = Buffer.from(data.buffer, 'base64');
        audioBuffers.push(chunk);
        
        // Push to the audio stream
        audioStream.push(chunk);
        
        // Send to the voice agent
        if (agent.voice) {
          try {
            // Convert to raw audio bytes (not an object)
            // Create a proper Int16Array from the buffer
            const arrayBuffer = new ArrayBuffer(chunk.length);
            const view = new Uint8Array(arrayBuffer);
            for (let i = 0; i < chunk.length; i++) {
              view[i] = chunk[i];
            }
            
            // Create Int16Array from the ArrayBuffer
            const int16Array = new Int16Array(arrayBuffer.slice(0, arrayBuffer.byteLength - (arrayBuffer.byteLength % 2)));
            
            console.log('Sending audio data to voice agent, size:', int16Array.length);
            await agent.voice.send(int16Array);
          } catch (error: any) {
            console.error('Error sending audio data:', error);
            console.error('Error details:', error.message || 'Unknown error');
          }
        }
      } catch (error) {
        console.error('Error processing audio data:', error);
      }
    });

    // Start the conversation when the client is ready
    socket.on('startConversation', async () => {
      console.log('Starting conversation');
      
      try {
        if (agent.voice) {
          // Reset the audio stream
          audioStream.push(null); // End the current stream if any
          
          // Create a new stream
          const newAudioStream = new Readable({
            read() {} // No-op implementation required for Readable streams
          });
          
          console.log('Initiating conversation with greeting');
          await agent.voice.speak('Hello, how can I help you today?');
          console.log('Greeting sent successfully');
        } else {
          console.error('Agent voice is undefined');
          socket.emit('error', { message: 'Voice service not available' });
        }
      } catch (error) {
        console.error('Error starting conversation:', error);
        socket.emit('error', { message: 'Error starting conversation: ' + (error as Error).message });
      }
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected');
      
      // End the audio stream
      audioStream.push(null);
      
      // Close the voice connection
      if (agent.voice) {
        try {
          agent.voice.close();
          console.log('Voice connection closed');
        } catch (error) {
          console.error('Error closing voice connection:', error);
        }
      }
    });

  } catch (error) {
    console.error('Error setting up voice agent:', error);
    socket.emit('error', { message: 'Failed to initialize voice agent' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
