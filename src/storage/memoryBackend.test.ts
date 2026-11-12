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
  it('moves relative names (pdf/<name>, json/<name>, legacy <name>) to the same relative path', async () => {
    b.files.set('/a/pdf/y.pdf', new Uint8Array([2]))
    b.files.set('/a/json/y.json', '{"y":1}')
    b.files.set('/b/pdf/y.pdf', new Uint8Array([9]))
    await expect(b.moveInvoices('/a', '/b', ['pdf/y.pdf', 'json/y.json', 'x.pdf'], [])).rejects.toThrow('Konflikt: pdf/y.pdf')
    // a bare file name in overwrite does not cover the sub-folder path
    await expect(b.moveInvoices('/a', '/b', ['pdf/y.pdf'], ['y.pdf'])).rejects.toThrow('Konflikt: pdf/y.pdf')
    expect(await b.moveInvoices('/a', '/b', ['pdf/y.pdf', 'json/y.json', 'x.pdf'], ['pdf/y.pdf'])).toEqual({ moved: 3 })
    expect(b.files.get('/b/pdf/y.pdf')).toEqual(new Uint8Array([2]))
    expect(b.files.get('/b/json/y.json')).toBe('{"y":1}')
    expect(await names('/b')).toEqual(['x.pdf'])
    expect(await names('/a')).toEqual(['x.json'])
    expect(await names('/a/pdf')).toEqual([])
  })
  it('rejects relative names other than one pdf/ or json/ prefix', async () => {
    b.files.set('/a/pdf/y.pdf', new Uint8Array([2]))
    for (const bad of ['sub/x.pdf', 'pdf/', 'PDF/y.pdf', 'pdf/../x.pdf', 'pdf/sub/y.pdf', 'pdf\\y.pdf', 'pdf/C:y.pdf', '/x.pdf']) {
      await expect(b.moveInvoices('/a', '/b', [bad], [])).rejects.toThrow('Neplatný název')
      await expect(b.moveInvoices('/a', '/b', ['x.pdf'], [bad])).rejects.toThrow('Neplatný název')
    }
    expect(b.files.has('/b/x.pdf')).toBe(false)
  })
  it('writeInvoice writes pdf/<base>.pdf and json/<base>.json and leaves legacy files alone', async () => {
    await b.writeInvoice('/a', 'x', new Uint8Array([5]), '{"n":1}')
    expect(b.files.get('/a/pdf/x.pdf')).toEqual(new Uint8Array([5]))
    expect(b.files.get('/a/json/x.json')).toBe('{"n":1}')
    expect(b.files.get('/a/x.json')).toBe('{}')
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

  it('exportZip reads relative names and stores them flat; two paths with one file name are refused', async () => {
    b.files.set('/a/pdf/y.pdf', new Uint8Array([2]))
    b.files.set('/a/json/x.json', '{"new":1}')
    await b.exportZip('/a', ['pdf/y.pdf', 'x.pdf'], '{}', '/o.zip')
    expect([...b.zips.get('/o.zip')!.keys()]).toEqual(['faktury/y.pdf', 'faktury/x.pdf', 'faktura-data.json'])
    expect(b.zips.get('/o.zip')!.get('faktury/y.pdf')).toEqual(new Uint8Array([2]))
    await expect(b.exportZip('/a', ['json/x.json', 'x.json'], '{}', '/p.zip')).rejects.toThrow('x.json')
    await expect(b.exportZip('/a', ['sub/x.json'], '{}', '/p.zip')).rejects.toThrow('Neplatný název')
    await expect(b.exportZip('/a', ['pdf/x.txt'], '{}', '/p.zip')).rejects.toThrow('Neplatný název')
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
    b.files.set('/d/json/a.json', 'old')
    await b.zipExtract('/z.zip', ['a.json'], '/d', ['a.json'])
    expect(b.files.get('/d/json/a.json')).toBe('new')
    for (const bad of ['../evil.json', 'sub/a.json', 'evil.json', 'evil2.json', 'C:a.json', 'run.exe', '..']) {
      await expect(b.zipExtract('/z.zip', ['a.json', bad], '/e', ['a.json', bad])).rejects.toThrow()
    }
    expect(await names('/e')).toEqual([])
    expect(await names('/e/json')).toEqual([])
  })

  it('zipExtract puts PDFs into pdf/ and JSONs into json/, checking conflicts there', async () => {
    put('/z.zip', [['faktury/a.json', 'new-a'], ['faktury/a.pdf', new Uint8Array([3])]])
    b.files.set('/d/A.json', 'legacy') // a legacy (0.2.0) file of that name in the folder itself conflicts unless overwritten
    await expect(b.zipExtract('/z.zip', ['a.json', 'a.pdf'], '/d', [])).rejects.toThrow('Konflikt: a.json')
    expect(b.files.has('/d/pdf/a.pdf')).toBe(false)
    await b.zipExtract('/z.zip', ['a.json', 'a.pdf'], '/d', ['a.json'])
    expect(b.files.get('/d/json/a.json')).toBe('new-a')
    expect(b.files.get('/d/pdf/a.pdf')).toEqual(new Uint8Array([3]))
    expect(b.files.get('/d/A.json')).toBe('legacy')
    await expect(b.zipExtract('/z.zip', ['a.pdf'], '/d', [])).rejects.toThrow('Konflikt: a.pdf')
  })

  it('zipExtract refuses to overwrite an existing file that is not in overwrite (case-insensitive) and writes nothing', async () => {
    put('/z.zip', [['faktury/a.json', 'new-a'], ['faktury/b.json', 'new-b']])
    b.files.set('/d/json/B.json', 'unknown-old')
    await expect(b.zipExtract('/z.zip', ['a.json', 'b.json'], '/d', [])).rejects.toThrow('Konflikt: b.json')
    await expect(b.zipExtract('/z.zip', ['a.json', 'b.json'], '/d', ['a.json'])).rejects.toThrow('Konflikt: b.json')
    expect(await names('/d/json')).toEqual(['B.json'])
    expect(b.files.get('/d/json/B.json')).toBe('unknown-old')
    await b.zipExtract('/z.zip', ['a.json', 'b.json'], '/d', ['b.json'])
    expect(b.files.get('/d/json/b.json')).toBe('new-b')
  })

  it('zipList and zipExtract reject duplicate names under faktury/ compared case-insensitively', async () => {
    put('/z.zip', [['faktury/A.json', '{}'], ['faktury/a.json', '{}']])
    await expect(b.zipList('/z.zip')).rejects.toThrow('Záloha obsahuje duplicitní soubory.')
    await expect(b.zipExtract('/z.zip', ['a.json'], '/d', [])).rejects.toThrow('Záloha obsahuje duplicitní soubory.')
    put('/ok.zip', [['faktury/a.json', '{}'], ['other/a.json', '{}']])
    await expect(b.zipList('/ok.zip')).resolves.toBeDefined()
  })
})
