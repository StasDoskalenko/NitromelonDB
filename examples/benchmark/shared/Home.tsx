import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { BenchmarkTheme } from './BenchmarkScreen'

export type BenchmarkTile = {
  key: string
  label: string
  description: string
}

type Props = {
  title: string
  subtitle: string
  engine: string | null
  setupError: string | null
  theme: BenchmarkTheme
  tiles: BenchmarkTile[]
  onSelect: (key: string) => void
}

// Landing screen: one tile per benchmark instead of stacking every card into a single long
// ScrollView. Each tile opens its benchmark on its own screen (see Screen.tsx) and comes back
// here via its own back button.
export function Home({ title, subtitle, engine, setupError, theme, tiles, onSelect }: Props) {
  const styles = useMemo(() => createStyles(theme), [theme])

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>DATABASE STRESS TEST</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {engine ? <Text style={styles.engine}>{engine}</Text> : null}
        {setupError ? <Text style={styles.error}>{setupError}</Text> : null}

        <View style={styles.tiles}>
          {tiles.map((tile) => (
            <Pressable
              key={tile.key}
              testID={`tile-${tile.key}`}
              style={styles.tile}
              onPress={() => onSelect(tile.key)}
            >
              <Text style={styles.tileLabel}>{tile.label}</Text>
              <Text style={styles.tileDescription}>{tile.description}</Text>
              <Text style={styles.tileArrow}>Open ›</Text>
            </Pressable>
          ))}
        </View>
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
    kicker: {
      color: theme.accent,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.4,
    },
    title: {
      marginTop: 8,
      color: theme.text,
      fontSize: 32,
      fontWeight: '800',
    },
    subtitle: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 16,
      lineHeight: 22,
    },
    engine: {
      marginTop: 4,
      color: theme.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    error: {
      marginTop: 12,
      color: theme.danger,
      fontSize: 14,
      lineHeight: 20,
    },
    tiles: {
      marginTop: 24,
      gap: 12,
    },
    tile: {
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 18,
    },
    tileLabel: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '800',
    },
    tileDescription: {
      marginTop: 6,
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
    },
    tileArrow: {
      marginTop: 12,
      color: theme.accent,
      fontSize: 13,
      fontWeight: '700',
    },
  })
}
