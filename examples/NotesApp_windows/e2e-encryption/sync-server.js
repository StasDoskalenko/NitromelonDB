// The reference sync server's test endpoints, from the test (the host), like
// ../../NotesApp/maestro-commands/sync-server.js does for Maestro. The script starts the server.
const SERVER = 'http://127.0.0.1:3000'

async function post(path, body, what) {
  const response = await fetch(SERVER + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })
  if (response.status !== 200) {
    throw new Error(`${what} failed with ${response.status}: ${await response.text()}`)
  }
}

// Empties the server and creates one note on it, as if from another device
async function prepareServer() {
  await post('/__test/reset', {}, 'Resetting the sync server')
  const now = Date.now()
  await post(
    '/__test/write',
    {
      table: 'notes',
      upsert: [
        {
          id: 'servernote000001',
          title: 'From the server',
          body: 'Created on the sync server',
          created_at: now,
          updated_at: now,
          pinned: false,
          // Rank 0 puts it above every local note (local ranks start at 1)
          rank: 0,
        },
      ],
    },
    'Creating a note on the sync server',
  )
}

// The notes on the server that aren't deleted
async function serverNotes() {
  const response = await fetch(SERVER + '/__test/dump')
  if (response.status !== 200) {
    throw new Error(`Reading the sync server failed with ${response.status}`)
  }
  return (await response.json()).notes.filter(note => !note.deleted)
}

module.exports = {prepareServer, serverNotes}
