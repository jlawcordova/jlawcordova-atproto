/**
 * One JSON line per event. Callers pass only tool name, outcome, rkey, and HTTP
 * status codes: never request bodies, record text, tokens, or passwords.
 */
export interface LogEvent {
  event: string;
  tool?: string;
  outcome?: string;
  rkey?: string;
  status?: number;
}

export function log(entry: LogEvent): void {
  console.log(JSON.stringify(entry));
}
