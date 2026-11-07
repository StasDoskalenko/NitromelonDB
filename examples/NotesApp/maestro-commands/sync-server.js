// Talks to the reference sync server's test endpoints from maestro/sync.yaml (runs on the host,
// not in the app). Needs the server started with `yarn start:notes-app` in examples/sync-server.
//   ACTION=prepare  empties the server and creates one note on it, as if from another device
//   ACTION=verify   sets output.serverNoteCount and output.serverHasDeviceNote
var headers = { 'Content-Type': 'application/json' }

function check(response, what) {
  if (response.status !== 200) {
    throw new Error(what + ' failed with ' + response.status + ': ' + response.body)
  }
  return response
}

if (ACTION === 'prepare') {
  check(
    http.post(SERVER + '/__test/reset', { headers: headers, body: '{}' }),
    'Resetting the sync server',
  )
  var now = Date.now()
  check(
    http.post(SERVER + '/__test/write', {
      headers: headers,
      body: JSON.stringify({
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
      }),
    }),
    'Creating a note on the sync server',
  )
} else if (ACTION === 'verify') {
  var dump = json(check(http.get(SERVER + '/__test/dump'), 'Reading the sync server').body)
  var notes = dump.notes.filter(function (note) {
    return !note.deleted
  })
  output.serverNoteCount = notes.length
  output.serverHasDeviceNote = notes.some(function (note) {
    return note.title === DEVICE_NOTE_TITLE
  })
} else {
  throw new Error('Unknown ACTION: ' + ACTION)
}
