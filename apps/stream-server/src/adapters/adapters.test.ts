import { describe, expect, it } from 'vitest';
import { EchoAgent, EchoSTT, SilenceTTS } from './index.js';
import { FRAME_SAMPLES } from '@realtime-voice-infra/shared-types';

describe('stub adapters', () => {
  it('EchoSTT fires a partial every 10 frames', () => {
    const stt = new EchoSTT();
    const got: string[] = [];
    stt.onTranscript('s', (text) => got.push(text));
    for (let i = 0; i < 25; i++) stt.pushFrame('s', new Float32Array(FRAME_SAMPLES));
    expect(got.length).toBe(2);
    expect(got[0]).toMatch(/frame 10/);
  });

  it('SilenceTTS yields 50 silent frames', async () => {
    const tts = new SilenceTTS();
    let count = 0;
    for await (const frame of tts.synthesize('s', 'hi')) {
      expect(frame.length).toBe(FRAME_SAMPLES);
      count += 1;
    }
    expect(count).toBe(50);
  });

  it('EchoAgent prefixes the transcript', async () => {
    const agent = new EchoAgent();
    expect(await agent.respond('s', 'hello')).toBe('Echo: hello');
  });
});
