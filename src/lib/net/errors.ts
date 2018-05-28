export enum WsCloseCode {
  NORMAL = 1000,
  GOING_AWAY = 1001,
  UNSUPPORTED_DATA = 1003,
  POLICY_VIOLATION = 1008
}

export enum ApiErrorCode {
  MISC = 1000,
  UNKNOWN_METHOD = 1001,
  INVALID_PARAMS = 1002
}

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
  constructor(readonly code: ApiErrorCode, msg: string) {
    super(msg);
  }
}

export function check(cond: any, code: ApiErrorCode, msg: string) {
  if (!cond) throw new ApiError(code, msg);
}
