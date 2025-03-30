import 'dotenv/config';
import { startVoiceAgent } from "./mastra/voice-agent";

async function main() {
  try {
    console.log("Starting voice agent...");
    await startVoiceAgent();
    console.log("Voice agent started successfully!");
    console.log("Press Ctrl+C to exit");
  } catch (error) {
    console.error("Error starting voice agent:", error);
    process.exit(1);
  }
}

main();
