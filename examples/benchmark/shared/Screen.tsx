import { StatusBar } from 'expo-status-bar'
import { useMemo, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from './BenchmarkScreen'

type Props = {
  title: string
  theme: BenchmarkTheme
  onBack: () => void
  children: ReactNode
}

// Generic single-benchmark screen: a back button, a title, and whatever card the caller passes
// in (SyncBenchmarkCard, CompetingWorkBenchmarkCard, a mass-delete card, ...). Reached from a
// Home tile; BenchmarkScreen (the main write/query/delete harness) has its own full-screen
// layout and doesn't use this.
export function Screen({ title, theme, onBack, children }: Props) {
  const styles = useMemo(() => createStyles(theme), [theme])

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable testID="screen-back" style={styles.backButton} onPress={onBack}>
          <Text style={styles.backLabel}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        {children}
      </ScrollView>
      <StatusBar style="light" />
    </View>
  )
}

function createStyles(theme: BenchmarkTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      paddingTop: 64,
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    backButton: {
      alignSelf: 'flex-start',
    },
    backLabel: {
      color: theme.accent,
      fontSize: 15,
      fontWeight: '700',
    },
    title: {
      marginTop: 10,
      color: theme.text,
      fontSize: 26,
      fontWeight: '800',
    },
  })
}
