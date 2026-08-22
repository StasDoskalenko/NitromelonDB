/**
 * Kill Metro / packager processes listening on the React Native port
 * (default 8081). Safe to run when nothing is bound.
 *
 * @format
 */

const {execFileSync, execSync} = require('child_process')

const PORT = Number(process.env.RCT_METRO_PORT || process.env.METRO_PORT || 8081)

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function pidsListeningOnPort(port) {
  if (process.platform === 'win32') {
    const out = execSync('netstat -ano', {encoding: 'utf8'})
    const pids = []
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) {
        continue
      }
      if (!line.includes(`:${port} `) && !line.endsWith(`:${port}`)) {
        continue
      }
      const pid = line.trim().split(/\s+/).pop()
      if (pid && pid !== '0') {
        pids.push(Number(pid))
      }
    }
    return unique(pids)
  }

  try {
    const out = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
    return unique(
      out
        .split(/\s+/)
        .map(value => Number(value))
        .filter(value => value > 0),
    )
  } catch {
    return []
  }
}

function metroCommandPids() {
  if (process.platform !== 'win32') {
    return []
  }
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'cli\\.js"?\\s+"?start|react-native(?:\\.cmd)?"?\\s+"?start|expo(?:\\.cmd)?"?\\s+"?start' } | Select-Object -ExpandProperty ProcessId`,
    ],
    {encoding: 'utf8'},
  )
  return unique(
    out
      .split(/\s+/)
      .map(value => Number(value))
      .filter(value => value > 0),
  )
}

function killPid(pid) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

const pids = unique([...pidsListeningOnPort(PORT), ...metroCommandPids()])
if (pids.length === 0) {
  console.log(`No Metro process found on port ${PORT}`)
  process.exit(0)
}

for (const pid of pids) {
  if (killPid(pid)) {
    console.log(`Killed Metro pid ${pid}`)
  }
}
