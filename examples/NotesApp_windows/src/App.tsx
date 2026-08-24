import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {createExampleDatabase} from '../../NotesApp/src/database';
import {NotesScreen} from '../../NotesApp/src/screens/NotesScreen';
import {SetupErrorScreen} from '../../NotesApp/src/screens/SetupErrorScreen';

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

  if (!session.ok) {
    return (
      <View style={styles.root}>
        <SetupErrorScreen message={session.message} />
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
