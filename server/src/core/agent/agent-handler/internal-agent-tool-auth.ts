import { randomUUID } from 'crypto';

const token = randomUUID();

export function getInternalAgentToolToken(): string {
  return token;
}

export function isValidInternalAgentToolToken(value: string | undefined): boolean {
  return !!value && value === token;
}
