/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable import/first */

process.env.NODE_ENV = 'test'
import React from 'react'
import { AppRegistry, Text, View, NativeModules, Platform } from 'react-native'

// Mysteriously fixes React Native stacktrace symbolication ¯\_(ツ)_/¯
if (typeof global.self === 'undefined') {
  global.self = global
}

// NOTE: Set to `true` to run src/__playground__/index.js
// WARN: DO NOT commit this change!
const openPlayground = false

if (openPlayground) {
  // eslint-disable-next-line react/function-component-definition
  const PlaygroundPlaceholder = () => <Text style={{ paddingTop: 100 }}>Playground is running</Text>
  AppRegistry.registerComponent('watermelonTest', () => PlaygroundPlaceholder)
  require('./__playground__')
} else {
  // eslint-disable-next-line react/function-component-definition
  const TestRoot = () => {
    require('./__tests__/setUpIntegrationTestEnv')

    const [status, setStatus] = React.useState('testing')

    const Tester = require('cavy/src/Tester').default
    const TestHookStore = require('cavy/src/TestHookStore').default
    const integrationTests = require('./__tests__/integrationTests').default

    const { current: testHookStore } = React.useRef(new TestHookStore())
    const sendReport = (report) => {
      // eslint-disable-next-line
      console.log('Done:')
      const { results = [], ...rest } = report
      // eslint-disable-next-line
      console.log(rest)
      // eslint-disable-next-line
      results.forEach((result) => console.log(result))
      // FIXME: Add test runner on windows
      if (Platform.OS !== 'windows') {
        NativeModules.BridgeTestReporter.testsFinished(report)
      }
      if (!report.errorCount) {
        setStatus('done')
        return
      }
      const failed = results.filter((result) => result.passed === false || result.error)
      const summary = failed
        .slice(0, 6)
        .map((result) => {
          const name = result.message || result.title || result.name || 'test'
          const error = result.error
          const errText =
            (error && error.message) || (typeof error === 'string' ? error : '') || result.reason || ''
          return errText ? `${name}: ${errText}` : name
        })
        .join(' | ')
      // WinAppDriver only sees this Text; keep "Error" so e2e can wait, then the failures.
      setStatus(`Error (${report.errorCount})${summary ? `: ${summary}` : ''}`)
    }

    return (
      <Tester
        specs={integrationTests}
        store={testHookStore}
        // start delay allows initial render to occur while running JSI (blocking) tests
        startDelay={500}
        waitTime={4000}
        sendReport={true}
        customReporter={sendReport}
      >
        <View testID="NitromelonTesterContent" accessible>
          <Text style={{ paddingTop: 100 }}>Nitromelon tester!</Text>
          <Text>Using hermes? {global.HermesInternal ? 'YES' : 'NO'}</Text>
          {status === 'testing' ? (
            <Text testID="NitromelonTesterStatus" accessible style={{ fontSize: 30 }}>
              The tests are running. Please remain calm.
            </Text>
          ) : null}
          {status === 'done' ? (
            <Text testID="NitromelonTesterStatus" accessible style={{ fontSize: 30, color: 'green' }}>
              Done
            </Text>
          ) : null}
          {status !== 'testing' && status !== 'done' ? (
            <Text testID="NitromelonTesterStatus" accessible style={{ fontSize: 16, color: 'red' }}>
              {status}
            </Text>
          ) : null}
        </View>
      </Tester>
    )
  }

  AppRegistry.registerComponent(
    // FIXME: Should be consistent; find RNW API to change module name or rename RNW project
    Platform.OS === 'windows' ? 'NitromelonWindows' : 'watermelonTest',
    () => TestRoot,
  )
}
