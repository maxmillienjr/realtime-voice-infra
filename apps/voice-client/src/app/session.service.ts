import { Injectable } from '@angular/core';
import type { SessionInitResponse } from '@realtime-voice-infra/shared-types';

@Injectable({ providedIn: 'root' })
export class SessionService {
  constructor(private readonly baseUrl = 'http://localhost:3000') {}

  async init(): Promise<SessionInitResponse> {
    const res = await fetch(`${this.baseUrl}/session/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`session init failed: ${res.status}`);
    return (await res.json()) as SessionInitResponse;
  }
}
