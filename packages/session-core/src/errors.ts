export class SequenceExhaustedError extends Error {
  constructor() {
    super('Sequence number exhausted; session must be re-initialised.');
    this.name = 'SequenceExhaustedError';
  }
}

export class DecryptFailedError extends Error {
  constructor(message = 'GCM authentication failed') {
    super(message);
    this.name = 'DecryptFailedError';
  }
}

export class JWTReplayError extends Error {
  constructor() {
    super('JWT jti has already been used.');
    this.name = 'JWTReplayError';
  }
}
