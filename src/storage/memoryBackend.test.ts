import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryBackend } from './memoryBackend'

let b: MemoryBackend
beforeEach(() => {
  b = new MemoryBackend()
  b.files.set('/a/x.pdf', new Uint8Array([1]))
  b.files.set('/a/x.json', '{}')
})
const names = async (d: string) => (await b.listDir(d)).map(e => e.name).sort()

describe('MemoryBackend.moveInvoices', () => {
  it('moves the named files and removes the originals', async () => {
    expect(await b.moveInvoices('/a', '/b', ['x.pdf', 'x.json'], [])).toEqual({ moved: 2 })
    expect(await names('/b')).toEqual(['x.json', 'x.pdf'])
    expect(await names('/a')).toEqual([])
  })
  it('rejects a clash before changing anything, unless the name is in overwrite', async () => {
    b.files.set('/b/x.json', 'old')
    await expect(b.moveInvoices('/a', '/b', ['x.pdf', 'x.json'], [])).rejects.toThrow('Konflikt: x.json')
    expect(await names('/a')).toEqual(['x.json', 'x.pdf'])
    expect(await names('/b')).toEqual(['x.json'])
    await b.moveInvoices('/a', '/b', ['x.pdf', 'x.json'], ['x.json'])
    expect(b.files.get('/b/x.json')).toBe('{}')
  })
  it('fails without side effects when a source is missing, the folders are equal or a name is not plain', async () => {
    await expect(b.moveInvoices('/a', '/b', ['x.pdf', 'gone.pdf'], [])).rejects.toThrow()
    expect(await names('/b')).toEqual([])
    await expect(b.moveInvoices('/a', '/a/', ['x.pdf'], [])).rejects.toThrow()
    await expect(b.moveInvoices('/a', '/b', ['../x.pdf'], [])).rejects.toThrow('Neplatný název')
    await expect(b.moveInvoices('/a', '/b', ['C:x.pdf'], [])).rejects.toThrow('Neplatný název')
    expect(await names('/a')).toEqual(['x.json', 'x.pdf'])
  })
  it('pickFolder returns the preset value', async () => {
    expect(await b.pickFolder()).toBeNull()
    b.pickedFolder = '/z'
    expect(await b.pickFolder()).toBe('/z')
  })
})

describe('MemoryBackend zip (mirrors zipio.rs)', () => {
  const put = (path: string, entries: [string, string | Uint8Array][]) => b.zips.set(path, new Map(entries))

  it('exportZip stores faktury/<file> plus the data file, and rejects bad or missing names without a result', async () => {
    await b.exportZip('/a', ['x.json', 'x.pdf'], '{"d":1}', '/o.zip')
    expect([...b.zips.get('/o.zip')!.keys()]).toEqual(['faktury/x.json', 'faktury/x.pdf', 'faktura-data.json'])
    await expect(b.exportZip('/a', ['gone.json'], '{}', '/p.zip')).rejects.toThrow()
    await expect(b.exportZip('/a', ['../x.json'], '{}', '/p.zip')).rejects.toThrow('Neplatný název')
    expect(b.zips.has('/p.zip')).toBe(false)
  })

  it('zipList only sees faktury/<plain>.json|.pdf and the root data file', async () => {
    put('/z.zip', [
      ['faktury/a.json', '{}'], ['faktury/a.pdf', new Uint8Array([1])], ['faktury/notes.txt', 'x'], ['faktury/sub/b.json', '{}'],
      ['faktury/../evil.json', '{}'], ['faktury/c:d.json', '{}'], ['other/x.json', '{}'], ['sub/faktura-data.json', 'no'], ['faktura-data.json', '{"d":1}'],
    ])
    expect(await b.zipList('/z.zip')).toEqual({ invoiceJsons: [['a.json', '{}']], pdfNames: ['a.pdf'], dataJson: '{"d":1}' })
    await expect(b.zipList('/nope.zip')).rejects.toThrow()
  })

  it('zipExtract writes flattened files, overwrites, and rejects bad or missing names before writing anything', async () => {
    put('/z.zip', [['faktury/a.json', 'new'], ['faktury/../evil.json', 'x'], ['evil2.json', 'x']])
    b.files.set('/d/a.json', 'old')
    await b.zipExtract('/z.zip', ['a.json'], '/d', ['a.json'])
    expect(b.files.get('/d/a.json')).toBe('new')
    for (const bad of ['../evil.json', 'sub/a.json', 'evil.json', 'evil2.json', 'C:a.json', 'run.exe', '..']) {
      await expect(b.zipExtract('/z.zip', ['a.json', bad], '/e', ['a.json', bad])).rejects.toThrow()
    }
    expect(await names('/e')).toEqual([])
  })

  it('zipExtract refuses to overwrite an existing file that is not in overwrite (case-insensitive) and writes nothing', async () => {
    put('/z.zip', [['faktury/a.json', 'new-a'], ['faktury/b.json', 'new-b']])
    b.files.set('/d/B.json', 'unknown-old')
    await expect(b.zipExtract('/z.zip', ['a.json', 'b.json'], '/d', [])).rejects.toThrow('Konflikt: b.json')
    await expect(b.zipExtract('/z.zip', ['a.json', 'b.json'], '/d', ['a.json'])).rejects.toThrow('Konflikt: b.json')
    expect(await names('/d')).toEqual(['B.json'])
    expect(b.files.get('/d/B.json')).toBe('unknown-old')
    await b.zipExtract('/z.zip', ['a.json', 'b.json'], '/d', ['b.json'])
    expect(b.files.get('/d/b.json')).toBe('new-b')
  })

  it('zipList and zipExtract reject duplicate names under faktury/ compared case-insensitively', async () => {
    put('/z.zip', [['faktury/A.json', '{}'], ['faktury/a.json', '{}']])
    await expect(b.zipList('/z.zip')).rejects.toThrow('Záloha obsahuje duplicitní soubory.')
    await expect(b.zipExtract('/z.zip', ['a.json'], '/d', [])).rejects.toThrow('Záloha obsahuje duplicitní soubory.')
    put('/ok.zip', [['faktury/a.json', '{}'], ['other/a.json', '{}']])
    await expect(b.zipList('/ok.zip')).resolves.toBeDefined()
  })
})
