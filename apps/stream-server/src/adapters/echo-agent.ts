// STUB IMPLEMENTATION — returns the transcript prefixed with "Echo: ".
// Swap for OpenAI chat.completions: pass final transcript as user message.
import type { AgentAdapter } from '@realtime-voice-infra/shared-types';

export class EchoAgent implements AgentAdapter {
  async respond(_sessionId: string, transcript: string): Promise<string> {
    return `Echo: ${transcript}`;
  }
}
