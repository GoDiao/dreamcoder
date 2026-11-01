import { afterEach, describe, expect, it } from 'vitest'
import { pageProgram } from '../../src/server/browserHost/snapshot/pageProgram'

function mountFrame(html: string) {
  document.title = 'Outer page'
  document.body.innerHTML = '<button id="outer">outer</button><iframe id="frame"></iframe>'
  const frame = document.getElementById('frame') as HTMLIFrameElement
  const inner = frame.contentDocument!
  inner.open()
  inner.write(html)
  inner.close()
  return inner
}

describe('page program: pick', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.title = ''
  })

  it('reports the address and title of the top document for an element in it', () => {
    mountFrame('<title>Inner</title><p id="p">hello</p>')
    const picked = pageProgram('pick', {} as never, document.getElementById('outer')!)
    expect(picked.url).toBe(location.href)
    expect(picked.title).toBe('Outer page')
  })

  it('reports the address and title of the iframe document for an element inside it', () => {
    const inner = mountFrame('<title>Board two</title><p id="p">hello</p>')
    const picked = pageProgram('pick', {} as never, inner.getElementById('p')!)

    expect(picked.url).toBe(inner.location.href)
    expect(picked.url).not.toBe(location.href)
    expect(picked.title).toBe('Board two')
    expect(picked.tag).toBe('p')
  })

  it('uses the element document for a masked sensitive pick too', () => {
    const inner = mountFrame('<title>Login</title><form id="f"><input type="password" value="secret"></form>')
    const picked = pageProgram('pick', {} as never, inner.getElementById('f')!)

    expect(picked.sensitive).toBe(true)
    expect(picked.title).toBe('Login')
    expect(picked.url).toBe(inner.location.href)
  })
})
