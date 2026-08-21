#!/usr/bin/env node
'use strict'

/**
 * Reminds agents that the git root is the library and NotesApp is a separate example.
 *
 * Formats:
 *   claude-session  — SessionStart stdout (plain text)
 *   claude-prompt   — UserPromptSubmit JSON additionalContext
 *   cursor-session  — sessionStart JSON additional_context
 *   cursor-shell    — beforeShellExecution permission + optional agent_message
 */

const format = process.argv[2] || 'claude-session'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function normalize(p) {
  return String(p || '').replace(/\\/g, '/')
}

function isNotesAppCwd(cwd) {
  return /\/examples\/NotesApp(?:\/|$)/.test(normalize(cwd))
}

function reminder(cwd) {
  const here = isNotesAppCwd(cwd)
    ? 'You are in the EXAMPLE APP (examples/NotesApp). Library is ../..'
    : 'You are in the LIBRARY root. Example app is examples/NotesApp.'
  return [
    here,
    'Library: yarn test, yarn build. Never expo/maestro here.',
    'App: cd examples/NotesApp && yarn expo run:ios',
    'Metro: before start, check port 8081. For e2e use yarn start:e2e (--dev-client --no-dev).',
    'E2E: cd examples/NotesApp && maestro test maestro/',
  ].join('\n')
}

function isAppCommand(command) {
  return /\b(expo\s+run|expo\s+start|yarn\s+start|maestro\b)/.test(command)
}

function isMetroStartCommand(command) {
  return /\b(expo\s+run|expo\s+start|yarn\s+start)\b/.test(command)
}

function alreadyCdsToApp(command) {
  return /examples\/NotesApp/.test(normalize(command))
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj))
}

async function main() {
  const input = await readStdin()
  const cwd = input.cwd || process.cwd()
  const command = String(input.command || '')
  const text = reminder(cwd)

  if (format === 'cursor-shell') {
    const wrongDir =
      isAppCommand(command) && !isNotesAppCwd(cwd) && !alreadyCdsToApp(command)
    if (wrongDir) {
      print({
        permission: 'allow',
        agent_message:
          'WRONG DIRECTORY. Expo and Maestro must run from examples/NotesApp, not the library root. Use: cd examples/NotesApp && yarn expo run:ios   or   cd examples/NotesApp && maestro test maestro/',
      })
      return
    }

    if (isMetroStartCommand(command)) {
      const usesNoDev = /--no-dev\b|start:e2e\b/.test(command)
      print({
        permission: 'allow',
        agent_message: usesNoDev
          ? 'Before starting Metro, check port 8081 (lsof -i :8081 / curl -s http://localhost:8081/status). Reuse an existing server — do not start a second one.'
          : 'Before starting Metro, check port 8081. For Maestro/e2e prefer: cd examples/NotesApp && yarn start:e2e  (expo start --dev-client --no-dev). Reuse an existing server — do not start a second one.',
      })
      return
    }

    print({ permission: 'allow' })
    return
  }

  if (format === 'cursor-session') {
    print({ additional_context: text })
    return
  }

  if (format === 'claude-prompt') {
    print({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: text,
      },
    })
    return
  }

  process.stdout.write(`${text}\n`)
}

main().catch(() => {
  if (format === 'cursor-shell') {
    print({ permission: 'allow' })
  }
  process.exit(0)
})
