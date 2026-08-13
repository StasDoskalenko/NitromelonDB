/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render } from '@testing-library/react'
import Database from '../Database'
import { mockDatabase } from '../__tests__/testModels'
import DatabaseProvider from './DatabaseProvider'
import { DatabaseConsumer } from './DatabaseContext'
import withDatabase from './withDatabase'

function MockComponent() {
  return <span />
}

describe('DatabaseProvider', () => {
  let database
  beforeAll(() => {
    database = mockDatabase().db
  })
  it('throws if no database or adapter supplied', () => {
    expect(() => {
      render(
        <DatabaseProvider>
          <p />
        </DatabaseProvider>,
      )
    }).toThrow(/You must supply a valid database/i)
    expect(() => {
      render(
        <DatabaseProvider database={{ fake: 'db' }}>
          <p />
        </DatabaseProvider>,
      )
    }).toThrow(/You must supply a valid database/i)
  })
  it('passes database to consumer', () => {
    let received
    render(
      <DatabaseProvider database={database}>
        <DatabaseConsumer>
          {(db) => {
            received = db
            return <MockComponent />
          }}
        </DatabaseConsumer>
      </DatabaseProvider>,
    )
    expect(received).toBeInstanceOf(Database)
  })

  describe('withDatabase', () => {
    test('should pass the database from the context to the consumer', () => {
      let received
      const Child = withDatabase(function Wrapped({ database: db }) {
        received = db
        return <MockComponent />
      })
      render(
        <DatabaseProvider database={database}>
          <Child />
        </DatabaseProvider>,
      )
      expect(received).toBeInstanceOf(Database)
    })
  })
})
