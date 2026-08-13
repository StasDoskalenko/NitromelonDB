/* eslint-disable no-console */
const formatMessages = (messages: unknown[]): unknown[] => {
  const [first, ...other] = messages
  return [typeof first === 'string' ? `[🍉] ${first}` : first, ...other]
}

class Logger {
  silent: boolean = false

  debug(...messages: unknown[]): void {
    !this.silent && console.debug(...formatMessages(messages))
  }

  log(...messages: unknown[]): void {
    !this.silent && console.log(...formatMessages(messages))
  }

  warn(...messages: unknown[]): void {
    !this.silent && console.warn(...formatMessages(messages))
  }

  error(...messages: unknown[]): void {
    !this.silent && console.error(...formatMessages(messages))
  }

  silence(): void {
    this.silent = true
  }
}

export default new Logger()
