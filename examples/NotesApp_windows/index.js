/**
 * @format
 */

const React = require('react');
const { AppRegistry, Text, View } = require('react-native');
const { name: appName } = require('./app.json');

function Fallback({ error }) {
  const message = error && (error.stack || error.message || String(error));
  return React.createElement(
    View,
    {
      style: {
        flex: 1,
        backgroundColor: '#f4f1ea',
        padding: 24,
      },
    },
    React.createElement(
      Text,
      { style: { fontSize: 28, fontWeight: '700', color: '#1c1917' } },
      'NitromelonDB',
    ),
    React.createElement(
      Text,
      { style: { marginTop: 12, color: '#b91c1c', fontSize: 14 } },
      message,
    ),
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return React.createElement(Fallback, { error: this.state.error });
    }
    return this.props.children;
  }
}

let App = null;
let loadError = null;
try {
  App = require('./App').default;
} catch (error) {
  loadError = error;
}

function Root() {
  if (loadError || !App) {
    return React.createElement(Fallback, { error: loadError });
  }
  return React.createElement(ErrorBoundary, null, React.createElement(App));
}

AppRegistry.registerComponent(appName, () => Root);
