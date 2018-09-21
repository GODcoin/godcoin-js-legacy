/* tslint:disable:max-classes-per-file */

export class DisconnectedError extends Error {
  constructor() {
    super('disconnected');
  }
}

export class EndOfClients extends Error {
  constructor() {
    super('end of clients');
  }
}

export class ApiError extends Error {
  constructor(msg: string) {
    super(msg);
  }
}
