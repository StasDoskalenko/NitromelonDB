// Standard (TC39 2023-11) decorators, as NotesApp uses them (its models are shared with this app).
// See docs/Advanced/StandardDecorators.
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
    '@babel/plugin-transform-class-static-block',
  ],
};
