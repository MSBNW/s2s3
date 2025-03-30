import Speaker from "@mastra/node-speaker";
import NodeMic from "node-mic";
import { mastra } from "./index";
import chalk from "chalk";
import 'dotenv/config';

export async function startVoiceAgent(agentName: "assistantAgent" = "assistantAgent") {
  const agent = mastra.getAgent(agentName);

  if (!agent.voice) {
    throw new Error("Agent does not have voice capabilities");
  }

  let speaker: Speaker | undefined;

  const makeSpeaker = () =>
    new Speaker({
      sampleRate: 24100,  // Audio sample rate in Hz - standard for high-quality audio
      channels: 1,        // Mono audio output (as opposed to stereo which would be 2)
      bitDepth: 16,       // Bit depth for audio quality - CD quality standard (16-bit resolution)
    });

  const mic = new NodeMic({
    rate: 24100,  // Audio sample rate in Hz - matches the speaker configuration for consistent audio processing
  });

  agent.voice.on("writing", (ev) => {
    if (ev.role === 'user') {
      process.stdout.write(chalk.green(ev.text));
    } else {
      process.stdout.write(chalk.blue(ev.text));
    }
  });

  agent.voice.on("speaker", (stream: any) => {
    if (speaker) {
      speaker.removeAllListeners();
      speaker.close(true);
    }

    mic.pause();
    speaker = makeSpeaker();
    
    stream.pipe(speaker);

    speaker.on('close', () => {
      console.log("Speaker finished, resuming mic");
      mic.resume();
    });
  });

  // Error from voice provider
  agent.voice.on("error", (error) => {
    console.error("Voice error:", error);
  });

  // Make sure we have the API key
  console.log("Using API key:", process.env.OPENAI_API_KEY ? "API key is set" : "API key is missing");
  
  await agent.voice.connect();

  mic.start();

  const microphoneStream = mic.getAudioStream();
  await agent.voice.send(microphoneStream);

  // Initiate the conversation
  await agent.voice.speak('Hello, how can I help you today?');

  // Handle user interruption with Ctrl+C
  process.on('SIGINT', async () => {
    console.log("\nShutting down voice agent...");
    if (speaker) {
      speaker.removeAllListeners();
      speaker.close(true);
    }
    mic.stop();
    process.exit(0);
  });

  return { agent, mic, makeSpeaker };
}
