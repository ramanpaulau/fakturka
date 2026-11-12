import { invoke } from '@tauri-apps/api/core'
import { sep } from '@tauri-apps/api/path'
import type { Backend, DataLoadResult, DirEntry, ZipContents } from './backend'

const ZIP_FILTERS = [{ name: 'ZIP', extensions: ['zip'] }]

export function createTauriBackend(): Backend {
  // sep() is synchronous in Tauri 2 (reads window.__TAURI_INTERNALS__.plugins.path), so read it once.
  const separator = sep()
  return {
    dataLoad: () => invoke<DataLoadResult>('data_load'),
    dataSave: contents => invoke<void>('data_save', { contents }),
    dataFilePath: () => invoke<string>('data_file_path'),
    defaultInvoiceDir: () => invoke<string>('default_invoice_dir'),
    // Vec<u8> arrives as a JSON number array; a Uint8Array nested in the args would serialize as an object.
    writeInvoice: (dir, baseName, pdf, json) => invoke<void>('write_invoice', { dir, baseName, pdf: Array.from(pdf), json }),
    listDir: dir => invoke<DirEntry[]>('list_dir', { dir }),
    readText: path => invoke<string>('read_text', { path }),
    trash: paths => invoke<void>('trash_paths', { paths }),
    deletePaths: paths => invoke<void>('delete_paths', { paths }),
    moveInvoices: (from, to, names, overwrite) => invoke<{ moved: number }>('move_invoices', { from, to, names, overwrite }),
    exportZip: (dir, files, dataJson, dest) => invoke<void>('export_zip', { invoiceDir: dir, files, dataJson, dest }),
    zipList: path => invoke<ZipContents>('zip_list', { path }),
    zipExtract: (path, names, destDir, overwrite) => invoke<void>('zip_extract', { path, names, destDir, overwrite }),
    pickSavePath: async defaultName => {
      const { save } = await import('@tauri-apps/plugin-dialog')
      return save({ defaultPath: defaultName, filters: ZIP_FILTERS })
    },
    pickZip: async () => {
      const { open } = await import('@tauri-apps/plugin-dialog')
      return open({ multiple: false, directory: false, filters: ZIP_FILTERS })
    },
    pickFolder: async () => {
      const { open } = await import('@tauri-apps/plugin-dialog')
      return open({ directory: true, multiple: false })
    },
    join: (dir, name) => (dir.endsWith(separator) ? dir + name : dir + separator + name),
  }
}
