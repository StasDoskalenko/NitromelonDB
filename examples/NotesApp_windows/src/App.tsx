import {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {useDatabaseReady} from 'nitromelondb/hooks';
import {createExampleDatabase} from '../../NotesApp/src/database';
import {LoadingScreen} from '../../NotesApp/src/screens/LoadingScreen';
import {NotesScreen} from '../../NotesApp/src/screens/NotesScreen';
import {SetupErrorScreen} from '../../NotesApp/src/screens/SetupErrorScreen';

// Mirrors ../../NotesApp/src/App.tsx (minus the Expo / keyboard-controller bits Windows doesn't
// have): the setup-error handling matters, because without it a database that can't be opened
// (an encrypted one, opened by a build without its passphrase) shows an empty, broken notes
// list instead of the error.
export default function App() {
  const [session] = useState(() => {
    try {
      return {ok: true as const, db: createExampleDatabase()};
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const ready = useDatabaseReady(session.ok ? session.db.database : null);
  // readyPromise rejects when setting up the database failed
  const [setupError, setSetupError] = useState<string | null>(null);
  useEffect(() => {
    if (!session.ok) {
      return;
    }
    session.db.database.readyPromise.catch((error: unknown) => {
      setSetupError(error instanceof Error ? error.message : String(error));
    });
  }, [session]);

  if (!session.ok || setupError) {
    return (
      <View style={styles.root}>
        <SetupErrorScreen
          message={session.ok ? (setupError ?? '') : session.message}
        />
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.root}>
        <LoadingScreen />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <NotesScreen db={session.db} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
