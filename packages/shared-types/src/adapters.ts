export interface STTAdapter {
  pushFrame(sessionId: string, pcm: Float32Array): void;
  onTranscript(
    sessionId: string,
    handler: (text: string, isFinal: boolean) => void,
  ): void;
  endSession(sessionId: string): Promise<void>;
}

export interface TTSAdapter {
  synthesize(sessionId: string, text: string): AsyncIterable<Float32Array>;
}

export interface AgentAdapter {
  respond(sessionId: string, transcript: string): Promise<string>;
}
