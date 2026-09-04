import expect from './expect'

global.Buffer = class FakeBuffer {}
if (!global.process) {
  global.process = {}
}
if (!global.process.version) {
  global.process.version = 'bla'
}

global.expect = expect
